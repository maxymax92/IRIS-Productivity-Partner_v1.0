/**
 * Agent hook system — rate limiting, auto-approval, audit logging,
 * and observability hooks for the Iris agent.
 */

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  PermissionRequestHookInput,
  PermissionRequestHookSpecificOutput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  SessionStartHookInput,
  SessionStartHookSpecificOutput,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageStreamWriter } from 'ai'

import { requestApproval } from './approval-registry'
import type { PersistedPart } from './stream-adapter'
import { createAgentAdminClient, DEFAULT_ALLOWED_TOOLS, type AdminClient } from './tools'

import type { Json } from '@/types/database.types'

// ── Type guards ───────────────────────────────────────────────────────────────

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse'
}

function isSessionStart(input: HookInput): input is SessionStartHookInput {
  return input.hook_event_name === 'SessionStart'
}

function isPermissionRequest(input: HookInput): input is PermissionRequestHookInput {
  return input.hook_event_name === 'PermissionRequest'
}

// ── Auto-approve hook ─────────────────────────────────────────────────────────

function createAutoApproveHook(): HookCallback {
  // Auto-approve all allowed tools — derived from the single source of truth in tools.ts
  const autoApprovedTools = new Set(DEFAULT_ALLOWED_TOOLS)

  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (!isPreToolUse(input)) return {}

    if (autoApprovedTools.has(input.tool_name)) {
      const output: PreToolUseHookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      }
      return { hookSpecificOutput: output }
    }
    return {}
  }
}

// ── Permission request hook (user approval for sensitive tools) ────────────────

let approvalCounter = 0

function createPermissionRequestHook(writer: UIMessageStreamWriter): HookCallback {
  return async (input: HookInput, toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (!isPermissionRequest(input)) return {}

    const toolCallId = toolUseID ?? input.tool_name
    approvalCounter += 1
    const approvalId = `approval-${String(approvalCounter)}-${String(Date.now())}`

    console.error(
      `[iris-hooks] PermissionRequest for ${input.tool_name} — emitting tool-approval-request (approvalId=${approvalId}, toolCallId=${toolCallId})`,
    )

    // Write the approval request to the UI stream so the client shows the Confirmation UI
    writer.write({
      type: 'tool-approval-request',
      approvalId,
      toolCallId,
    })

    // Block until the user responds via /api/chat/approve
    const response = await requestApproval(approvalId)

    console.error(
      `[iris-hooks] PermissionRequest resolved: approved=${String(response.approved)} reason=${response.reason ?? '(none)'}`,
    )

    const output: PermissionRequestHookSpecificOutput = {
      hookEventName: 'PermissionRequest',
      decision: response.approved
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: response.reason ?? 'User denied' },
    }
    return { hookSpecificOutput: output }
  }
}

// ── Tool output hook (streams tool results to UI) ─────────────────────────────

/**
 * Emit additional rich data parts based on tool name and input/output.
 * These create standalone UI elements (web-preview, jsx-preview, schema-display)
 * that render alongside the standard tool output.
 */
function emitRichDataParts(
  writer: UIMessageStreamWriter,
  toolName: string,
  toolInput: unknown,
  partsAccumulator?: Map<string, PersistedPart>,
): void {
  const inp =
    typeof toolInput === 'object' && toolInput !== null
      ? (toolInput as Record<string, unknown>)
      : undefined

  console.error(
    `[iris-hooks] emitRichDataParts: toolName=${toolName} hasInput=${String(inp !== undefined)} inputKeys=${inp ? Object.keys(inp).join(',') : 'n/a'}`,
  )

  if (!inp) return

  // WebFetch → web-preview (show fetched URL in an iframe preview)
  if (toolName === 'WebFetch' && typeof inp['url'] === 'string') {
    console.error(`[iris-hooks] Emitting data-web-preview for URL: ${inp['url']}`)
    writer.write({
      type: 'data-web-preview',
      data: { url: inp['url'] },
    })
    partsAccumulator?.set(`web-preview-${inp['url']}`, {
      type: 'data-web-preview',
      url: inp['url'],
    })
  }

  // manage_file upload of .jsx/.tsx → jsx-preview (live preview of JSX content)
  if (
    toolName === 'mcp__iris-tools__manage_file' &&
    inp['action'] === 'upload' &&
    typeof inp['path'] === 'string' &&
    typeof inp['content'] === 'string' &&
    /\.(?:jsx|tsx)$/i.test(inp['path'])
  ) {
    writer.write({
      type: 'data-jsx-preview',
      data: { jsx: inp['content'] },
    })
  }
}

function createToolOutputHook(
  writer: UIMessageStreamWriter,
  partsAccumulator?: Map<string, PersistedPart>,
): HookCallback {
  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUse') return {}

    // Only forward tool-output-available for tool calls that were written to
    // the UI stream (i.e., parent-agent tool calls registered in the parts
    // accumulator via handleBlockStop). Subagent tool calls are filtered from
    // stream_events and never reach the client — sending tool-output-available
    // for them would cause UIMessageStreamError ("No tool invocation found").
    const isStreamedTool = partsAccumulator ? partsAccumulator.has(input.tool_use_id) : true // backwards-compatible: write if no accumulator

    if (isStreamedTool) {
      writer.write({
        type: 'tool-output-available',
        toolCallId: input.tool_use_id,
        output: input.tool_response,
      })

      // Capture tool output for persistence
      if (partsAccumulator) {
        const existing = partsAccumulator.get(input.tool_use_id)
        if (existing && 'toolCallId' in existing) {
          existing.output = input.tool_response
          existing.state = 'output-available'
        }
      }
    }

    // Emit rich data parts regardless of whether the tool_use block was
    // streamed. Data parts are standalone UI elements (web-preview,
    // jsx-preview) — they don't reference a tool call ID, so they won't
    // cause "No tool invocation found" errors. Built-in SDK tools
    // (WebFetch, WebSearch) may not stream tool_use blocks at all.
    emitRichDataParts(writer, input.tool_name, input.tool_input, partsAccumulator)

    return {}
  }
}

// ── Audit hook with execution time tracking (Phase 10) ────────────────────────

function createPreToolUseTimingHook(timingMap: Map<string, number>): HookCallback {
  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (!isPreToolUse(input)) return {}
    timingMap.set(input.tool_use_id, Date.now())
    return {}
  }
}

function createAuditHook(
  supabase: AdminClient,
  userId: string,
  timingMap: Map<string, number>,
): HookCallback {
  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUse') return {}

    // Phase 10: Calculate execution time
    const startTime = timingMap.get(input.tool_use_id)
    const executionTimeMs = startTime !== undefined ? Date.now() - startTime : null
    timingMap.delete(input.tool_use_id)

    // Fire-and-forget — never block the agent on audit logging
    void supabase
      .from('agent_audit_log')
      .insert({
        user_id: userId,
        tool_name: input.tool_name,
        // session_id omitted — SDK session IDs are stored on conversations, not audit logs
        tool_input: input.tool_input as Json | null,
        tool_output: input.tool_response as Json | null,
        permission_decision: 'allow',
        execution_time_ms: executionTimeMs,
      })
      .then(({ error }) => {
        if (error) console.error('[iris-hooks] Audit log insert failed', error.message)
      })

    return {}
  }
}

// ── PostToolUseFailure hook (Phase 4) ─────────────────────────────────────────

function createToolFailureHook(
  supabase: AdminClient,
  userId: string,
  timingMap: Map<string, number>,
  stream?: {
    writer: UIMessageStreamWriter | undefined
    partsAccumulator: Map<string, PersistedPart> | undefined
  },
): HookCallback {
  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUseFailure') return {}

    const startTime = timingMap.get(input.tool_use_id)
    const executionTimeMs = startTime !== undefined ? Date.now() - startTime : null
    timingMap.delete(input.tool_use_id)

    console.error('[iris-hooks] Tool execution failed', {
      toolName: input.tool_name,
      error: input.error,
    })

    // Emit web-preview even on failure — the user's browser can often
    // load URLs that the server-side agent couldn't (CORS, bot-blocking).
    if (stream?.writer) {
      emitRichDataParts(stream.writer, input.tool_name, input.tool_input, stream.partsAccumulator)
    }

    void supabase
      .from('agent_audit_log')
      .insert({
        user_id: userId,
        tool_name: input.tool_name,
        // session_id omitted — SDK session IDs are stored on conversations, not audit logs
        tool_input: input.tool_input as Json | null,
        permission_decision: 'allow',
        execution_time_ms: executionTimeMs,
        error_message: typeof input.error === 'string' ? input.error : 'Unknown error',
      })
      .then(({ error }) => {
        if (error) console.error('[iris-hooks] Audit failure log failed', error.message)
      })

    return {}
  }
}

// ── Rate limit hook ───────────────────────────────────────────────────────────

function createRateLimitHook(supabase: AdminClient, userId: string): HookCallback {
  return async (input: HookInput, _toolUseID, options): Promise<SyncHookJSONOutput> => {
    if (!isPreToolUse(input)) return {}

    if (options.signal.aborted) return {}

    const result = await supabase.rpc('consume_rate_limit_token', {
      p_bucket_key: 'tool_calls',
      p_user_id: userId,
    })

    if (result.error) {
      console.error('[iris-hooks] Rate limit check failed — denying tool use', result.error.message)
      const output: PreToolUseHookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Rate limit service unavailable — try again shortly',
      }
      return { hookSpecificOutput: output }
    }

    if (!result.data) {
      const output: PreToolUseHookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Rate limit exceeded. Please wait before making more requests.',
      }
      return { hookSpecificOutput: output }
    }

    return {}
  }
}

// ── SessionStart hook (post-compaction memory re-injection) ───────────────────

const POST_COMPACTION_CONTEXT = `<post_compaction_reminder>
Context was just compacted — earlier conversation details have been summarised.
If the conversation referenced specific facts, preferences, or project context,
use search_knowledge to re-retrieve them now. Your memory tools are still
available: search_knowledge, store_memory, update_memory, delete_memory, log_context.
</post_compaction_reminder>`

function createSessionStartHook(): HookCallback {
  return async (input: HookInput, _toolUseID, _options): Promise<SyncHookJSONOutput> => {
    if (!isSessionStart(input)) return {}

    // After compaction, inject a reminder about memory tools so the agent
    // knows to re-search for context that was lost during summarisation.
    if (input.source === 'compact') {
      console.warn('[iris-hooks] Post-compaction SessionStart — injecting memory reminder')
      const output: SessionStartHookSpecificOutput = {
        hookEventName: 'SessionStart',
        additionalContext: POST_COMPACTION_CONTEXT,
      }
      return { hookSpecificOutput: output }
    }

    return {}
  }
}

// ── Build hooks config ────────────────────────────────────────────────────────

export function buildHooksConfig(opts: {
  userId: string
  writer?: UIMessageStreamWriter
  adminClient?: AdminClient
  partsAccumulator?: Map<string, PersistedPart> | undefined
}): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const supabase = opts.adminClient ?? createAgentAdminClient()

  // Phase 10: Shared timing map for execution time tracking
  const timingMap = new Map<string, number>()

  const autoApproveHook = createAutoApproveHook()
  const rateLimitHook = createRateLimitHook(supabase, opts.userId)
  const auditHook = createAuditHook(supabase, opts.userId, timingMap)
  const timingHook = createPreToolUseTimingHook(timingMap)
  const toolFailureHook = createToolFailureHook(supabase, opts.userId, timingMap, {
    writer: opts.writer,
    partsAccumulator: opts.partsAccumulator,
  })

  const postToolUseHooks: HookCallback[] = [auditHook]
  if (opts.writer) {
    postToolUseHooks.unshift(createToolOutputHook(opts.writer, opts.partsAccumulator))
  }

  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    PreToolUse: [
      // Rate limit web and subagent tools (fail-closed)
      { matcher: 'WebSearch|WebFetch|Task', hooks: [rateLimitHook] },
      // Timing for all tools — must run before execution
      { matcher: '.*', hooks: [timingHook] },
      // Auto-approve allowed tools (returns 'ask' for sensitive tools)
      { matcher: '.*', hooks: [autoApproveHook] },
    ],
    PostToolUse: [{ matcher: '.*', hooks: postToolUseHooks }],
    // User approval for sensitive tools — blocks until the client responds
    ...(opts.writer && {
      PermissionRequest: [{ matcher: '.*', hooks: [createPermissionRequestHook(opts.writer)] }],
    }),
    // Phase 4: PostToolUseFailure — log failures with error details
    PostToolUseFailure: [{ matcher: '.*', hooks: [toolFailureHook] }],
    Stop: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<SyncHookJSONOutput> => {
            console.warn('[iris-hooks] Session stopped', {
              userId: opts.userId,
              sessionId: input.session_id,
            })
            return {}
          },
        ],
      },
    ],
    SubagentStart: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<SyncHookJSONOutput> => {
            console.warn('[iris-hooks] Subagent spawned', {
              userId: opts.userId,
              sessionId: input.session_id,
            })
            return {}
          },
        ],
      },
    ],
    // Phase 4: SubagentStop — log subagent completion
    SubagentStop: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<SyncHookJSONOutput> => {
            if (input.hook_event_name !== 'SubagentStop') return {}
            console.warn('[iris-hooks] Subagent completed', {
              userId: opts.userId,
              sessionId: input.session_id,
              agentId: input.agent_id,
              agentType: input.agent_type,
            })
            return {}
          },
        ],
      },
    ],
    // Post-compaction: re-inject memory tool awareness
    SessionStart: [
      {
        hooks: [createSessionStartHook()],
      },
    ],
    // Phase 4: PreCompact — log compaction for observability
    PreCompact: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<SyncHookJSONOutput> => {
            if (input.hook_event_name !== 'PreCompact') return {}
            console.warn('[iris-hooks] Context compaction triggered', {
              userId: opts.userId,
              sessionId: input.session_id,
              trigger: input.trigger,
            })
            return {}
          },
        ],
      },
    ],
  }

  return hooks
}
