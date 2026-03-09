import { anthropic } from '@ai-sdk/anthropic'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  ContentBlockParam,
  DocumentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages'
import { createUIMessageStream, createUIMessageStreamResponse, generateText } from 'ai'

import {
  AGENT_MAX_BUDGET_USD,
  AGENT_MAX_TURNS,
  AGENT_MODEL,
  buildHooksConfig,
  createAgentAdminClient,
  createIrisToolsServer,
  DEFAULT_ALLOWED_TOOLS,
  IRIS_SYSTEM_PROMPT,
  IRIS_SUBAGENTS,
  TITLE_MODEL,
} from '@/lib/agent/config'
import {
  pipeAgentStreamToWriter,
  type AgentQueryUsage,
  type PersistedPart,
} from '@/lib/agent/stream-adapter'
import {
  STORAGE_BUCKET,
  SUMMARY_MAX_LENGTH,
  TITLE_FALLBACK_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MAX_TOKENS,
} from '@/lib/constants'
import { serverEnv } from '@/lib/env'
import { formatRelativeAge } from '@/lib/format'
import { getModelOrDefault, isValidModelId } from '@/lib/models'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import type { PersistedAttachment } from '@/types/attachments'
import type { Json } from '@/types/database.types'

export const maxDuration = 300

interface ChatFileAttachment {
  url: string
  mediaType: string
  filename?: string
}

interface ChatRequestBody {
  message?: string
  conversationId?: string
  files?: ChatFileAttachment[]
  model?: string
  extendedThinking?: boolean
  maxOutputTokens?: number
}

async function persistMessage(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    conversationId: string
    userId: string
    role: 'user' | 'assistant'
    content: string
    modelId?: string | undefined
    persistedParts?: PersistedPart[] | undefined
    metadata?: Record<string, unknown> | undefined
    attachments?: PersistedAttachment[] | undefined
  },
): Promise<void> {
  await admin.from('conversation_messages').insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    role: opts.role,
    content: opts.content,
    ...(opts.role === 'assistant' && opts.modelId && { model_id: opts.modelId }),
    ...(opts.persistedParts &&
      opts.persistedParts.length > 0 && {
        tool_calls: opts.persistedParts as unknown as Json,
      }),
    ...(opts.metadata && { metadata: opts.metadata as Json }),
    ...(opts.metadata?.['usage']
      ? { tokens_used: (opts.metadata['usage'] as { totalTokens?: number }).totalTokens ?? null }
      : {}),
    ...(opts.attachments &&
      opts.attachments.length > 0 && {
        attachments: opts.attachments as unknown as Json,
      }),
    is_complete: true,
  })
}

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** MIME types that are text-based but use application/* prefix */
const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/x-python',
])

/** Office document MIME types handled via officeparser v6 (OOXML + ODF only — legacy .doc/.xls/.ppt not supported) */
const OFFICE_MEDIA_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'application/vnd.oasis.opendocument.presentation', // .odp
])

function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || TEXT_APPLICATION_TYPES.has(mediaType)
}

function isOfficeMediaType(mediaType: string): boolean {
  return OFFICE_MEDIA_TYPES.has(mediaType)
}

/** ~500KB of text — well within API context limits while preventing OOM on huge files */
const MAX_TEXT_CONTENT_LENGTH = 500_000

function decodeBase64Text(base64Data: string): string {
  const text = Buffer.from(base64Data, 'base64').toString('utf-8')
  if (text.length > MAX_TEXT_CONTENT_LENGTH) {
    return (
      text.slice(0, MAX_TEXT_CONTENT_LENGTH) + '\n\n[Content truncated — file exceeded size limit]'
    )
  }
  return text
}

async function extractOfficeText(base64Data: string): Promise<string> {
  const { OfficeParser } = await import('officeparser')
  const buffer = Buffer.from(base64Data, 'base64')
  const ast = await OfficeParser.parseOffice(buffer)
  return ast.toText()
}

async function buildContentBlocks(
  text: string,
  files: ChatFileAttachment[],
): Promise<ContentBlockParam[]> {
  const blocks: ContentBlockParam[] = []
  const skipped: string[] = []

  for (const file of files) {
    // Data URLs: "data:<mediaType>;base64,<data>"
    const base64Data = file.url.split(',')[1] ?? ''

    if (!base64Data) {
      console.error(`[chat/route] Skipping file with empty base64 data (type=${file.mediaType})`)
      skipped.push(file.mediaType)
      continue
    }

    if (IMAGE_MEDIA_TYPES.has(file.mediaType)) {
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.mediaType as ImageMediaType,
          data: base64Data,
        },
      }
      blocks.push(imageBlock)
    } else if (file.mediaType === 'application/pdf') {
      const docBlock: DocumentBlockParam = {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data,
        },
      }
      blocks.push(docBlock)
    } else if (isTextMediaType(file.mediaType)) {
      const textContent = decodeBase64Text(base64Data)
      if (!textContent.trim()) {
        console.error(`[chat/route] Skipping empty text file (type=${file.mediaType})`)
        skipped.push(file.mediaType)
        continue
      }
      const docBlock: DocumentBlockParam = {
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: textContent },
        ...(file.filename && { title: file.filename }),
      }
      blocks.push(docBlock)
    } else if (isOfficeMediaType(file.mediaType)) {
      try {
        const extracted = await extractOfficeText(base64Data)
        if (!extracted.trim()) {
          console.error(`[chat/route] Skipping empty office document (type=${file.mediaType})`)
          skipped.push(file.mediaType)
          continue
        }
        const textContent =
          extracted.length > MAX_TEXT_CONTENT_LENGTH
            ? extracted.slice(0, MAX_TEXT_CONTENT_LENGTH) +
              '\n\n[Content truncated — file exceeded size limit]'
            : extracted
        const docBlock: DocumentBlockParam = {
          type: 'document',
          source: { type: 'text', media_type: 'text/plain', data: textContent },
          ...(file.filename && { title: file.filename }),
        }
        blocks.push(docBlock)
      } catch (err) {
        console.error(`[chat/route] Failed to parse office document (type=${file.mediaType}):`, err)
        skipped.push(file.mediaType)
      }
    } else {
      console.error(`[chat/route] Unsupported file type: ${file.mediaType}`)
      skipped.push(file.mediaType)
    }
  }

  // Text block — always include user text, plus note about skipped files
  const parts: string[] = []
  if (text) parts.push(text)
  if (skipped.length > 0) {
    parts.push(`[Unsupported attachment types: ${skipped.join(', ')}]`)
  }
  if (parts.length > 0 || blocks.length === 0) {
    blocks.push({ type: 'text', text: parts.join('\n\n') || '(attached file)' })
  }

  return blocks
}

/**
 * Yields a single user message with multimodal content blocks.
 * All required SDKUserMessage fields are included — the SDK subprocess
 * expects `session_id` and `parent_tool_use_id` to be present.
 *
 * @see https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
 */
async function* createUserMessageStream(
  text: string,
  files: ChatFileAttachment[],
  sessionId: string,
): AsyncGenerator<SDKUserMessage> {
  const content = await buildContentBlocks(text, files)
  console.error(
    `[chat/route] Yielding multimodal message: ${String(content.length)} content blocks (${String(files.length)} files), sessionId=${sessionId || '(new)'}`,
  )
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  }
}

async function persistAssistantResponse(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    conversationId: string
    userId: string
    agentModel: string
    message: string
    files: ChatFileAttachment[]
    newSessionId: string | undefined
    assistantText: string
    partsAccumulator: Map<string, PersistedPart>
    usage?: AgentQueryUsage | undefined
  },
): Promise<void> {
  if (opts.newSessionId) {
    const { error: sessionErr } = await admin
      .from('conversations')
      .update({ sdk_session_id: opts.newSessionId })
      .eq('id', opts.conversationId)
      .is('sdk_session_id', null)
    if (sessionErr) console.error('[chat/route] sdk_session_id update failed', sessionErr.message)
  }

  // Construct metadata matching the Vercel AI SDK LanguageModelUsage shape
  // so the context meter can read it back identically after DB reload.
  const messageMetadata = opts.usage
    ? {
        usage: {
          inputTokens: opts.usage.inputTokens,
          outputTokens: opts.usage.outputTokens,
          totalTokens: opts.usage.inputTokens + opts.usage.outputTokens,
          inputTokenDetails: {
            noCacheTokens:
              opts.usage.inputTokens -
              opts.usage.cacheReadInputTokens -
              opts.usage.cacheCreationInputTokens,
            cacheReadTokens: opts.usage.cacheReadInputTokens,
            cacheWriteTokens: opts.usage.cacheCreationInputTokens,
          },
        },
      }
    : undefined

  const persistedParts = Array.from(opts.partsAccumulator.values())
  await persistMessage(admin, {
    conversationId: opts.conversationId,
    userId: opts.userId,
    role: 'assistant',
    content: opts.assistantText || '(streamed response)',
    modelId: opts.agentModel,
    ...(persistedParts.length > 0 && { persistedParts }),
    ...(messageMetadata && { metadata: messageMetadata }),
  })

  const { data: conv, error: selectErr } = await admin
    .from('conversations')
    .select('title')
    .eq('id', opts.conversationId)
    .single()
  if (selectErr) {
    console.error('[chat/route] conversation select failed', selectErr.message)
  } else if (!conv?.title) {
    const titleInput =
      opts.message || `File attachment: ${opts.files.map((f) => f.mediaType).join(', ')}`
    const title = await generateTitle(titleInput)
    const { error: titleErr } = await admin
      .from('conversations')
      .update({ title })
      .eq('id', opts.conversationId)
    if (titleErr) console.error('[chat/route] title update failed', titleErr.message)
  }
}

async function generateTitle(message: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: anthropic(TITLE_MODEL),
      maxOutputTokens: TITLE_MAX_TOKENS,
      prompt: `Generate a short conversation title (max 6 words) for this message. Reply with ONLY the title, no quotes:\n\n${message}`,
    })
    const title = text.trim().slice(0, TITLE_MAX_LENGTH)
    return title || message.trim().slice(0, TITLE_FALLBACK_LENGTH)
  } catch {
    return message.trim().slice(0, TITLE_FALLBACK_LENGTH)
  }
}

function validateFileDataUrls(files: ChatFileAttachment[]): void {
  for (const file of files) {
    if (!file.url.startsWith('data:')) {
      console.error(
        `[chat/route] WARNING: file URL is not a data URL (type=${file.mediaType}, url prefix=${file.url.slice(0, 30)})`,
      )
    }
    const base64Data = file.url.split(',')[1] ?? ''
    if (!base64Data) {
      console.error(`[chat/route] WARNING: empty base64 data for file (type=${file.mediaType})`)
    }
  }
}

/**
 * Upload chat file attachments to Supabase Storage (best-effort).
 * Failures are logged but never block the message from sending.
 */
async function uploadChatAttachments(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  conversationId: string,
  files: ChatFileAttachment[],
): Promise<PersistedAttachment[]> {
  if (files.length === 0) return []

  const timestamp = Date.now()

  const uploadResults = await Promise.allSettled(
    files.map(async (file): Promise<PersistedAttachment | null> => {
      const base64Data = file.url.split(',')[1]
      if (!base64Data) return null

      const sanitised = (file.filename ?? 'attachment')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 100)
      const storagePath = `${userId}/chat-attachments/${conversationId}/${String(timestamp)}-${sanitised}`

      const buffer = Buffer.from(base64Data, 'base64')

      const { error } = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
        contentType: file.mediaType,
        upsert: false,
      })

      if (error) {
        console.error(`[chat/route] Attachment upload failed (${sanitised}):`, error.message)
        return null
      }

      return {
        storagePath,
        mediaType: file.mediaType,
        filename: file.filename ?? sanitised,
      }
    }),
  )

  return uploadResults
    .filter(
      (r): r is PromiseFulfilledResult<PersistedAttachment> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value)
}

/** Authenticate and return userId + accessToken, or null on failure. */
async function authenticateRequest(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  accessToken: string
} | null> {
  const supabase = await createClient()
  const [
    {
      data: { user },
      error: userError,
    },
    {
      data: { session },
    },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()])
  if (userError || !user) return null
  if (!session?.access_token) return null

  return { supabase, userId: user.id, accessToken: session.access_token }
}

/** Parse and validate the chat request body. */
function parseChatBody(body: ChatRequestBody): {
  message: string
  agentModel: string
  isExtendedThinking: boolean
  files: ChatFileAttachment[]
} {
  const message = typeof body.message === 'string' ? body.message : ''
  const agentModel = isValidModelId(body.model) ? body.model : AGENT_MODEL
  const isExtendedThinking = body.extendedThinking !== false
  const files = (Array.isArray(body.files) ? body.files : []).filter(
    (f): f is ChatFileAttachment =>
      typeof f === 'object' &&
      f !== null &&
      typeof f.url === 'string' &&
      typeof f.mediaType === 'string' &&
      (f.filename === undefined || typeof f.filename === 'string'),
  )
  return { message, agentModel, isExtendedThinking, files }
}

/** Ensure a conversation exists, persist the user message, and return convId + sdk_session_id. */
async function ensureConversation(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    supabase: Awaited<ReturnType<typeof createClient>>
    userId: string
    conversationId: string | undefined
    message: string
    files: ChatFileAttachment[]
  },
): Promise<{ convId: string | undefined; sdkSessionId: string | undefined }> {
  const { supabase, userId, conversationId, message, files } = opts
  let convId = conversationId
  let sdkSessionId: string | undefined

  if (!convId) {
    const { data: conversation } = await supabase
      .from('conversations')
      .insert({ user_id: userId, status: 'active' })
      .select('id, sdk_session_id')
      .single()
    convId = conversation?.id
    sdkSessionId = conversation?.sdk_session_id ?? undefined
  } else {
    const { data } = await supabase
      .from('conversations')
      .select('sdk_session_id')
      .eq('id', convId)
      .single()
    sdkSessionId = data?.sdk_session_id ?? undefined
  }

  if (convId) {
    const attachments = await uploadChatAttachments(admin, userId, convId, files)
    await persistMessage(admin, {
      conversationId: convId,
      userId,
      role: 'user',
      content: message,
      attachments,
    })

    if (message) {
      void admin
        .from('conversations')
        .update({ summary: message.slice(0, SUMMARY_MAX_LENGTH) })
        .eq('id', convId)
        .is('summary', null)
        .then(({ error }) => {
          if (error) console.error('[chat/route] summary update failed', error.message)
        })
    }
  }
  return { convId, sdkSessionId }
}

/** Build the locale block for the system prompt. */
async function buildLocaleBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  maxOutputTokens: number | undefined,
): Promise<string> {
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('language, date_format, time_format, timezone, ai_personality')
    .eq('user_id', userId)
    .single()

  const outputPref = maxOutputTokens ? `${String(Math.round(maxOutputTokens / 1024))}K` : '16K'

  let block = `\n<user_locale>
Language: ${userSettings?.language ?? 'en-US'}
Timezone: ${userSettings?.timezone ?? 'UTC'}
Date format: ${userSettings?.date_format ?? 'MM/DD/YYYY'}
Time format: ${userSettings?.time_format ?? '12h'}
Output preference: Keep responses concise. Target approximately ${outputPref} output tokens unless the user requests otherwise.
</user_locale>`

  const personality = userSettings?.ai_personality
  if (personality && personality !== 'default') {
    const personalityModifiers: Record<string, string> = {
      concise:
        'The user prefers extremely concise responses. Minimise pleasantries, skip preamble, lead with the answer.',
      warm: 'The user prefers a warmer, more encouraging tone. Be more generous with reassurance and positive feedback while staying genuine.',
      professional:
        'The user prefers a professional, formal tone. Avoid slang, teasing, and casual language. Be direct and business-like.',
    }
    const modifier = personalityModifiers[personality]
    if (modifier) {
      block += `\n<personality_preference>\n${modifier}\n</personality_preference>`
    }
  }

  return block
}

/** Semantic memory context — searches memories relevant to the user's message. */
const MEMORY_CONTEXT_LIMIT = 10
const MEMORY_CONTEXT_THRESHOLD = 0.4

interface MemorySearchResult {
  content: string
  content_type: string
  similarity: number
  source: string
  created_at: string
}

async function buildMemoryContext(accessToken: string, userMessage: string): Promise<string> {
  if (!userMessage.trim()) return ''

  try {
    const url = `${serverEnv.SUPABASE_URL}/functions/v1/memory/search`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: userMessage,
        limit: MEMORY_CONTEXT_LIMIT,
        threshold: MEMORY_CONTEXT_THRESHOLD,
      }),
    })

    if (!res.ok) {
      let errBody: string
      try {
        const errJson = (await res.json()) as { error?: { code?: string; message?: string } }
        errBody = JSON.stringify(errJson)
      } catch {
        errBody = await res.text()
      }
      console.error(`[chat/route] Memory context fetch failed: ${String(res.status)}`, errBody)
      return ''
    }

    const json = (await res.json()) as { data: MemorySearchResult[] }
    const results = json.data
    if (!results || results.length === 0) {
      console.error('[chat/route] Memory context: 0 results (no relevant memories found)')
      return ''
    }

    const items = results.map((r) => {
      const age = r.created_at ? ` (${formatRelativeAge(r.created_at)})` : ''
      return `- [${r.content_type}]${age} ${r.content}`
    })

    console.error(
      `[chat/route] Memory context: ${String(results.length)} results injected into system prompt`,
    )

    return `\n<user_context>
Relevant memories (${String(results.length)} results, searched by semantic similarity to your message):
${items.join('\n')}
</user_context>`
  } catch (err) {
    console.error('[chat/route] Memory context search failed', err)
    return ''
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest()
  if (!auth) return new Response('Unauthorized', { status: 401 })
  const { supabase, userId, accessToken } = auth

  const body = (await request.json()) as ChatRequestBody
  const { message, agentModel, isExtendedThinking, files } = parseChatBody(body)
  if (!message && files.length === 0) {
    return new Response('Message or files required', { status: 400 })
  }

  console.error(
    `[chat/route] Received: text=${String(message.length)} chars, files=${String(files.length)}, mediaTypes=${files.map((f) => f.mediaType).join(',')}`,
  )

  const admin = createAdminClient()
  const { convId: conversationId, sdkSessionId: existingSessionId } = await ensureConversation(
    admin,
    {
      supabase,
      userId,
      conversationId: body.conversationId,
      message,
      files,
    },
  )

  // Fetch locale (always needed) and semantic memory context (only on first message —
  // resumed sessions already have full conversation context, and the agent can
  // search_knowledge proactively if a new topic comes up mid-conversation).
  const [localeBlock, memoryContext] = await Promise.all([
    buildLocaleBlock(supabase, userId, body.maxOutputTokens),
    existingSessionId ? Promise.resolve('') : buildMemoryContext(accessToken, message),
  ])

  const sessionLabel = existingSessionId ? 'resuming ' + existingSessionId : 'new'
  let memoryLabel = 'empty'
  if (memoryContext) memoryLabel = 'injected'
  else if (existingSessionId) memoryLabel = 'skipped (resumed)'
  console.error('[chat/route] Session: ' + sessionLabel + ', memoryContext: ' + memoryLabel)

  const modelConfig = getModelOrDefault(agentModel)
  const agentAdmin = createAgentAdminClient()
  const irisToolsServer = createIrisToolsServer(userId, accessToken, agentAdmin)

  // Build env for the SDK subprocess — override HOME when a persistent volume
  // is configured so session files survive container restarts (e.g. Railway).
  const volumePath = serverEnv.SESSION_VOLUME_PATH
  const sdkEnv: Record<string, string | undefined> = { ...process.env }
  if (volumePath) {
    sdkEnv['HOME'] = volumePath
  }

  // Session persistence: SDK writes JSONL transcripts to ~/.claude/projects/.
  // On Railway, HOME is overridden to the persistent volume via SESSION_VOLUME_PATH.
  // resume is handled exclusively inside executeAgentQuery to avoid stale IDs on retry.
  const baseQueryOptions = {
    systemPrompt: IRIS_SYSTEM_PROMPT + localeBlock + memoryContext,
    model: agentModel,
    maxTurns: AGENT_MAX_TURNS,
    maxBudgetUsd: AGENT_MAX_BUDGET_USD,
    ...(isExtendedThinking && {
      thinking:
        agentModel === 'claude-opus-4-6'
          ? { type: 'adaptive' as const }
          : { type: 'enabled' as const, budgetTokens: modelConfig.thinkingBudget },
    }),
    ...(!isExtendedThinking && { thinking: { type: 'disabled' as const } }),
    // 1M context beta — Sonnet 4+ only, gives more headroom before compaction
    ...(agentModel.includes('sonnet') && { betas: ['context-1m-2025-08-07' as const] }),
    includePartialMessages: true,
    permissionMode: 'acceptEdits' as const,
    settingSources: [],
    env: sdkEnv,
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    mcpServers: { 'iris-tools': irisToolsServer },
    agents: IRIS_SUBAGENTS,
  }

  return createUIMessageStreamResponse({
    headers: { 'X-Conversation-Id': conversationId ?? '' },
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const partsAccumulator = new Map<string, PersistedPart>()
        const hooks = buildHooksConfig({
          userId,
          writer,
          adminClient: agentAdmin,
          partsAccumulator,
        })

        validateFileDataUrls(files)

        const hasFiles = files.length > 0
        const promptInput = hasFiles ? createUserMessageStream(message, files, '') : message

        /** Run the agent query and pipe the stream to the UI writer. */
        async function executeAgentQuery(resumeSessionId: string | undefined): Promise<{
          sessionId: string | undefined
          text: string
          usage: AgentQueryUsage | undefined
        }> {
          const options = { ...baseQueryOptions, hooks }
          if (resumeSessionId) {
            ;(options as Record<string, unknown>)['resume'] = resumeSessionId
          }

          console.error(
            `[chat/route] Query mode: ${hasFiles ? 'multimodal generator' : 'string prompt'}, resume=${resumeSessionId ?? 'new session'}`,
          )
          let thinkingMode = 'disabled'
          if (isExtendedThinking && agentModel === 'claude-opus-4-6') thinkingMode = 'adaptive'
          else if (isExtendedThinking)
            thinkingMode = `enabled(${String(modelConfig.thinkingBudget)})`
          console.error(
            `[chat/route] Starting agent query (model=${agentModel}, thinking=${thinkingMode}, maxOutput=${String(body.maxOutputTokens ?? 'default')})`,
          )

          const agentMessages = query({ prompt: promptInput, options })
          return await pipeAgentStreamToWriter(agentMessages, writer, partsAccumulator)
        }

        // Resume existing session, falling back to fresh if the session file is missing/corrupted.
        const result = existingSessionId
          ? await executeAgentQuery(existingSessionId).catch(async (resumeErr: unknown) => {
              console.error(
                `[chat/route] Resume failed for session ${existingSessionId}, retrying without resume:`,
                resumeErr,
              )
              if (conversationId) {
                const { error } = await admin
                  .from('conversations')
                  .update({ sdk_session_id: null })
                  .eq('id', conversationId)
                if (error)
                  console.error('[chat/route] Failed to clear stale sdk_session_id', error.message)
              }
              partsAccumulator.clear()
              return await executeAgentQuery(undefined)
            })
          : await executeAgentQuery(undefined)

        const { sessionId: newSessionId, text: assistantText, usage } = result
        console.error(
          `[chat/route] Agent query complete (sessionId=${newSessionId ?? '(none)'}, textLen=${String(assistantText.length)}, inputTokens=${String(usage?.inputTokens ?? 0)}, outputTokens=${String(usage?.outputTokens ?? 0)}, cost=$${String(usage?.totalCostUsd ?? 0)}, turns=${String(usage?.numTurns ?? 0)})`,
        )

        if (conversationId) {
          try {
            await persistAssistantResponse(admin, {
              conversationId,
              userId,
              agentModel,
              message,
              files,
              newSessionId,
              assistantText,
              partsAccumulator,
              usage,
            })
          } catch (err) {
            console.error('[chat/route] Post-stream persistence failed', err)
          }
        }

        if (usage) {
          void agentAdmin
            .rpc('increment_usage_stats', {
              p_user_id: userId,
              p_api_calls: 1,
              p_input_tokens: usage.inputTokens,
              p_output_tokens: usage.outputTokens,
            })
            .then(({ error }) => {
              if (error) console.error('[chat/route] Usage stats update failed', error.message)
            })
        }

        if (conversationId) {
          void agentAdmin
            .from('conversations')
            .select('message_count')
            .eq('id', conversationId)
            .single()
            .then(({ data }) => {
              return agentAdmin
                .from('conversations')
                .update({ message_count: (data?.message_count ?? 0) + 2 })
                .eq('id', conversationId)
            })
            .then(({ error: updateErr }) => {
              if (updateErr)
                console.error('[chat/route] Message count update failed', updateErr.message)
            })
        }
      },
      onError: (error) => {
        console.error(
          '[chat/route] Stream error:',
          error instanceof Error ? (error.stack ?? error.message) : error,
        )
        return error instanceof Error ? error.message : 'Unknown error'
      },
    }),
  })
}
