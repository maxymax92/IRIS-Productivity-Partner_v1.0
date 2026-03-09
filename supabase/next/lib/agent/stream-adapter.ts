import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageStreamWriter } from 'ai'

import { STREAM_KEEPALIVE_MS } from './config'

/** Usage data extracted from the Agent SDK result message. */
export interface AgentQueryUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalCostUsd: number
  numTurns: number
}

type StreamEvent = SDKPartialAssistantMessage['event']

/** Serializable representation of a tool call for DB persistence. */
export interface PersistedToolCall {
  toolCallId: string
  toolName: string
  input: unknown
  output?: unknown
  state: 'input-available' | 'output-available'
}

/** Serializable representation of a reasoning block for DB persistence. */
export interface PersistedReasoningBlock {
  type: 'reasoning'
  text: string
}

/** Serializable representation of a web preview for DB persistence. */
export interface PersistedWebPreview {
  type: 'data-web-preview'
  url: string
}

/** Union of all persistable non-text parts. */
export type PersistedPart = PersistedToolCall | PersistedReasoningBlock | PersistedWebPreview

interface ActiveBlock {
  id: string
  blockType: 'text' | 'tool_use' | 'thinking'
  toolName?: string
  inputJson?: string
  thinkingText?: string
}

function handleBlockStart(
  event: Extract<StreamEvent, { type: 'content_block_start' }>,
  activeBlocks: Map<number, ActiveBlock>,
  writer: UIMessageStreamWriter,
  nextId: (prefix: string) => string,
): void {
  const cb = event.content_block
  const idx = event.index

  if (cb.type === 'text') {
    const id = nextId('text')
    activeBlocks.set(idx, { id, blockType: 'text' })
    writer.write({ type: 'text-start', id })
  } else if (cb.type === 'tool_use') {
    activeBlocks.set(idx, { id: cb.id, blockType: 'tool_use', toolName: cb.name, inputJson: '' })
    writer.write({ type: 'tool-input-start', toolCallId: cb.id, toolName: cb.name })
  } else if (cb.type === 'thinking') {
    const id = nextId('reasoning')
    activeBlocks.set(idx, { id, blockType: 'thinking' })
    writer.write({ type: 'reasoning-start', id })
  }
}

function handleBlockDelta(
  event: Extract<StreamEvent, { type: 'content_block_delta' }>,
  activeBlocks: Map<number, ActiveBlock>,
  writer: UIMessageStreamWriter,
): string {
  const idx = event.index
  const block = activeBlocks.get(idx)
  const delta = event.delta
  if (!block) return ''

  if (block.blockType === 'text' && delta.type === 'text_delta' && 'text' in delta) {
    const text = (delta as { text: string }).text
    writer.write({ type: 'text-delta', id: block.id, delta: text })
    return text
  }

  if (
    block.blockType === 'tool_use' &&
    delta.type === 'input_json_delta' &&
    'partial_json' in delta
  ) {
    const partialJson = (delta as { partial_json: string }).partial_json
    block.inputJson = (block.inputJson ?? '') + partialJson
    writer.write({ type: 'tool-input-delta', toolCallId: block.id, inputTextDelta: partialJson })
  } else if (
    block.blockType === 'thinking' &&
    delta.type === 'thinking_delta' &&
    'thinking' in delta
  ) {
    const thinking = (delta as { thinking: string }).thinking
    block.thinkingText = (block.thinkingText ?? '') + thinking
    writer.write({ type: 'reasoning-delta', id: block.id, delta: thinking })
  }

  return ''
}

function handleBlockStop(
  event: Extract<StreamEvent, { type: 'content_block_stop' }>,
  activeBlocks: Map<number, ActiveBlock>,
  writer: UIMessageStreamWriter,
  partsAccumulator?: Map<string, PersistedPart>,
): void {
  const idx = event.index
  const block = activeBlocks.get(idx)
  if (!block) return

  if (block.blockType === 'text') {
    writer.write({ type: 'text-end', id: block.id })
  } else if (block.blockType === 'tool_use') {
    let input: unknown = {}
    try {
      input = JSON.parse(block.inputJson ?? '{}')
    } catch {
      /* use empty */
    }
    writer.write({
      type: 'tool-input-available',
      toolCallId: block.id,
      toolName: block.toolName ?? 'unknown',
      input,
    })
    if (partsAccumulator) {
      partsAccumulator.set(block.id, {
        toolCallId: block.id,
        toolName: block.toolName ?? 'unknown',
        input,
        state: 'input-available',
      })
    }
  } else {
    writer.write({ type: 'reasoning-end', id: block.id })
    if (partsAccumulator && block.thinkingText) {
      partsAccumulator.set(block.id, {
        type: 'reasoning',
        text: block.thinkingText,
      })
    }
  }

  activeBlocks.delete(idx)
}

function writeTextSnippet(
  writer: UIMessageStreamWriter,
  text: string,
  nextId: (prefix: string) => string,
): void {
  const id = nextId('text')
  writer.write({ type: 'text-start', id })
  writer.write({ type: 'text-delta', id, delta: text })
  writer.write({ type: 'text-end', id })
}

interface StreamEventContext {
  nextId: (prefix: string) => string
  partsAccumulator?: Map<string, PersistedPart> | undefined
}

function handleStreamEvent(
  msg: SDKPartialAssistantMessage,
  activeBlocks: Map<number, ActiveBlock>,
  writer: UIMessageStreamWriter,
  ctx: StreamEventContext,
): string {
  const { event } = msg
  switch (event.type) {
    case 'content_block_start':
      handleBlockStart(event, activeBlocks, writer, ctx.nextId)
      return ''
    case 'content_block_delta':
      return handleBlockDelta(event, activeBlocks, writer)
    case 'content_block_stop':
      handleBlockStop(event, activeBlocks, writer, ctx.partsAccumulator)
      return ''
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    default:
      return ''
  }
}

function handleAssistantMessage(msg: SDKAssistantMessage): string {
  // Extract text from the finalized assistant message. The caller decides
  // whether to write it to the UI writer based on whether the corresponding
  // turn already streamed this text via stream_event deltas.
  const parts: string[] = []
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text)
    }
  }
  return parts.join('')
}

function handleResultMessage(
  msg: SDKResultMessage,
  writer: UIMessageStreamWriter,
): AgentQueryUsage {
  // Forward token usage from the Agent SDK result to the client via
  // message-metadata so the context meter can display actual values.
  //
  // The Agent SDK's NonNullableUsage reports:
  //   input_tokens          — non-cached input tokens only
  //   cache_read_input_tokens    — tokens read from prompt cache
  //   cache_creation_input_tokens — tokens written to prompt cache
  //   output_tokens         — all output tokens
  //
  // Total input tokens = input_tokens + cache_read + cache_creation
  // (all three are disjoint subsets of the total prompt token count).
  const u = msg.usage
  const totalInputTokens =
    u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const usage: AgentQueryUsage = {
    inputTokens: totalInputTokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens,
    totalCostUsd: msg.total_cost_usd,
    numTurns: msg.num_turns,
  }

  writer.write({
    type: 'message-metadata',
    messageMetadata: {
      usage: {
        inputTokens: totalInputTokens,
        inputTokenDetails: {
          noCacheTokens: u.input_tokens,
          cacheReadTokens: u.cache_read_input_tokens,
          cacheWriteTokens: u.cache_creation_input_tokens,
        },
        outputTokens: u.output_tokens,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: totalInputTokens + u.output_tokens,
      },
    },
  })

  if (msg.is_error) {
    const errorMsg =
      'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('; ') : 'Agent query failed'
    writer.write({ type: 'error', errorText: errorMsg })
  }
  writer.write({ type: 'finish', finishReason: 'stop' })
  return usage
}

function handleSystemMessage(
  msg: SDKMessage,
  writer: UIMessageStreamWriter,
  nextId: (prefix: string) => string,
): void {
  const subtype = (msg as { subtype?: string }).subtype
  if (subtype === 'status') {
    const statusMsg = msg as SDKStatusMessage
    if (statusMsg.status === 'compacting') {
      writeTextSnippet(writer, '\n_Summarising conversation..._\n', nextId)
    }
  } else if (subtype === 'task_started') {
    const taskMsg = msg as SDKTaskStartedMessage
    writeTextSnippet(writer, `\n_Starting: ${taskMsg.description}_\n`, nextId)
  } else if (subtype === 'task_notification') {
    const notifMsg = msg as SDKTaskNotificationMessage
    const label = notifMsg.status === 'completed' ? 'Completed' : notifMsg.status
    writeTextSnippet(writer, `\n_${label}: ${notifMsg.summary}_\n`, nextId)
  } else if (subtype === 'task_progress') {
    const progressMsg = msg as SDKTaskProgressMessage
    const detail = progressMsg.last_tool_name
      ? `${progressMsg.description} (${progressMsg.last_tool_name})`
      : progressMsg.description
    writeTextSnippet(writer, `\n_Progress: ${detail}_\n`, nextId)
  }
  // init, compact_boundary, hook_*, files_persisted — skip
}

/** Diagnostic: log message type, subtype, event type, and parent for tracing. */
function logStreamMessage(msg: SDKMessage, index: number): void {
  const parentId =
    'parent_tool_use_id' in msg
      ? String((msg as SDKPartialAssistantMessage).parent_tool_use_id)
      : undefined
  const subtype = 'subtype' in msg ? (msg as { subtype: string }).subtype : undefined
  const eventType = msg.type === 'stream_event' ? msg.event.type : undefined

  const parts = [`[stream-adapter] msg #${String(index)} type=${msg.type}`]
  if (subtype) parts.push(`subtype=${subtype}`)
  if (eventType) parts.push(`event=${eventType}`)
  if (parentId) parts.push(`parent=${parentId}`)
  console.error(parts.join(' '))
}

/** Handle the assistant-type message, potentially writing unstreamed text. */
function handleAssistantTurn(
  msg: SDKAssistantMessage,
  didMainTurnStream: boolean,
  writer: UIMessageStreamWriter,
  nextId: (prefix: string) => string,
): string {
  const assistantText = handleAssistantMessage(msg)
  console.error(
    `[stream-adapter] assistant: textLen=${String(assistantText.length)} parent=${msg.parent_tool_use_id ?? 'null'} didStream=${String(didMainTurnStream)}`,
  )
  if (!assistantText) return ''
  // Skip subagent messages — their results arrive via PostToolUse hook
  if (msg.parent_tool_use_id !== null) return ''
  if (didMainTurnStream) {
    // Text was already written to the UI via stream_event deltas — skip.
    return ''
  }
  // This turn's text was NOT streamed via deltas (e.g., post-subagent
  // continuation arrives as a finalized message). Write it to the UI.
  writeTextSnippet(writer, assistantText, nextId)
  console.error(
    `[stream-adapter] Wrote unstreamed assistant text to UI (${String(assistantText.length)} chars)`,
  )
  return assistantText
}

/** Handle non-streaming message types (tool_progress, rate_limit, prompt_suggestion, etc.). */
function handleNonStreamMessage(
  msg: SDKMessage,
  writer: UIMessageStreamWriter,
  nextId: (prefix: string) => string,
): void {
  switch (msg.type) {
    case 'system':
      handleSystemMessage(msg, writer, nextId)
      break
    case 'tool_use_summary':
      writeTextSnippet(writer, `\n${msg.summary}\n`, nextId)
      break
    case 'tool_progress': {
      const elapsed = Math.round(msg.elapsed_time_seconds)
      writeTextSnippet(writer, `\n_Working: ${msg.tool_name} (${String(elapsed)}s)…_\n`, nextId)
      break
    }
    case 'rate_limit': {
      // SDK stub type is minimal — safely access retry_after if present at runtime
      const rl = msg as Record<string, unknown>
      const retryAfter = typeof rl['retry_after'] === 'number' ? rl['retry_after'] : undefined
      const detail = retryAfter !== undefined ? ` (retry in ${String(retryAfter)}s)` : ''
      writeTextSnippet(writer, `\n> **Rate limited**${detail}. Waiting…\n`, nextId)
      break
    }
    case 'prompt_suggestion': {
      // SDK stub type is minimal — safely access suggestions if present at runtime
      const ps = msg as Record<string, unknown>
      const suggestions = Array.isArray(ps['suggestions'])
        ? (ps['suggestions'] as string[])
        : undefined
      if (suggestions && suggestions.length > 0) {
        writer.write({
          type: 'data-prompt-suggestions',
          data: { suggestions },
        })
      }
      break
    }
    // Handled by the main switch in pipeAgentStreamToWriter — should not reach here
    case 'user':
    case 'assistant':
    case 'result':
    case 'stream_event':
    case 'auth_status':
      break
  }
}

export async function pipeAgentStreamToWriter(
  messages: AsyncIterable<SDKMessage>,
  writer: UIMessageStreamWriter,
  partsAccumulator?: Map<string, PersistedPart>,
): Promise<{ sessionId: string | undefined; text: string; usage: AgentQueryUsage | undefined }> {
  const activeBlocks = new Map<number, ActiveBlock>()
  let sessionId: string | undefined
  let accumulatedText = ''
  let partCounter = 0
  let resultUsage: AgentQueryUsage | undefined
  // Track whether the current main-agent turn has streamed text via deltas.
  // When false and an assistant message arrives with text, we know the text
  // was NOT delivered to the UI via stream_event deltas (e.g., post-subagent
  // continuation or non-streamed response) and needs to be written explicitly.
  let didMainTurnStream = false

  function nextId(prefix: string): string {
    partCounter += 1
    return `${prefix}-${String(partCounter)}`
  }

  // Keepalive: send periodic heartbeats to prevent idle connection timeouts
  // during long-running subagent execution when no data flows to the client.
  const keepaliveTimer = setInterval(() => {
    try {
      writer.write({ type: 'message-metadata', messageMetadata: {} })
    } catch {
      // Stream already closed — timer will be cleared when loop exits
    }
  }, STREAM_KEEPALIVE_MS)

  let messageCount = 0
  for await (const msg of messages) {
    messageCount += 1

    sessionId ??= msg.session_id
    logStreamMessage(msg, messageCount)

    switch (msg.type) {
      case 'stream_event': {
        // Skip subagent stream events — their results surface via
        // task_notification / task_progress system messages.
        if (msg.parent_tool_use_id !== null) break

        if (msg.event.type === 'message_start') {
          didMainTurnStream = false
        }
        const textDelta = handleStreamEvent(msg, activeBlocks, writer, { nextId, partsAccumulator })
        if (textDelta) {
          didMainTurnStream = true
        }
        accumulatedText += textDelta
        break
      }
      case 'assistant':
        accumulatedText += handleAssistantTurn(msg, didMainTurnStream, writer, nextId)
        break
      case 'result':
        console.error(
          `[stream-adapter] RESULT — is_error=${String(msg.is_error)} cost=$${String(msg.total_cost_usd)} turns=${String(msg.num_turns)} input=${String(msg.usage.input_tokens)}+${String(msg.usage.cache_read_input_tokens)}cr+${String(msg.usage.cache_creation_input_tokens)}cw output=${String(msg.usage.output_tokens)}`,
        )
        resultUsage = handleResultMessage(msg, writer)
        break
      case 'user':
      case 'auth_status':
        break
      case 'system':
      case 'tool_use_summary':
      case 'tool_progress':
      case 'rate_limit':
      case 'prompt_suggestion':
        handleNonStreamMessage(msg, writer, nextId)
        break
    }
  }
  clearInterval(keepaliveTimer)

  console.error(
    `[stream-adapter] Loop exited after ${String(messageCount)} msgs, text=${String(accumulatedText.length)} chars`,
  )
  return { sessionId, text: accumulatedText, usage: resultUsage }
}
