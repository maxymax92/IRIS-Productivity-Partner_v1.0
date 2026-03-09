'use client'

import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, UIMessage } from 'ai'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { getSettingsSnapshot, useSettingsField, useUpdateSettings } from '@/hooks/use-user-settings'
import type {
  PersistedToolCall,
  PersistedReasoningBlock,
  PersistedWebPreview,
} from '@/lib/agent/stream-adapter'
import { CONVERSATIONS_PAGE_SIZE, SIGNED_URL_EXPIRY_SECONDS, STORAGE_BUCKET } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'
import type { PersistedAttachment } from '@/types/attachments'
import type { Tables } from '@/types/database.types'

type Conversation = Tables<'conversations'>

// ── Persisted part reconstruction ────────────────────────────────────────────

function isToolCallRecord(v: unknown): v is PersistedToolCall {
  return typeof v === 'object' && v !== null && 'toolCallId' in v && 'toolName' in v && 'state' in v
}

function isReasoningRecord(v: unknown): v is PersistedReasoningBlock {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as Record<string, unknown>)['type'] === 'reasoning' &&
    'text' in v
  )
}

function toToolPart(tc: PersistedToolCall): DynamicToolUIPart {
  if (tc.state === 'output-available' && tc.output !== undefined) {
    return {
      type: 'dynamic-tool',
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      state: 'output-available',
      input: tc.input,
      output: tc.output,
    }
  }
  return {
    type: 'dynamic-tool',
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    state: 'input-available',
    input: tc.input,
  }
}

function toReasoningPart(r: PersistedReasoningBlock): ReasoningUIPart {
  return { type: 'reasoning', text: r.text, state: 'done' }
}

function isWebPreviewRecord(v: unknown): v is PersistedWebPreview {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['type'] === 'data-web-preview' &&
    typeof (v as Record<string, unknown>)['url'] === 'string'
  )
}

/** Reconstruct UIMessage parts from the tool_calls JSONB column. */
function reconstructParts(raw: unknown): UIMessage['parts'] {
  if (!Array.isArray(raw)) return []
  const parts: UIMessage['parts'] = []
  for (const entry of raw) {
    if (isReasoningRecord(entry)) {
      parts.push(toReasoningPart(entry))
    } else if (isToolCallRecord(entry)) {
      parts.push(toToolPart(entry))
    } else if (isWebPreviewRecord(entry)) {
      parts.push({
        type: 'data-web-preview',
        data: { url: entry.url },
      } as UIMessage['parts'][number])
    }
  }
  return parts
}

// ── Persisted attachment reconstruction ──────────────────────────────────────

function isPersistedAttachment(v: unknown): v is PersistedAttachment {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r['storagePath'] === 'string' &&
    typeof r['mediaType'] === 'string' &&
    typeof r['filename'] === 'string'
  )
}

/** Resolve persisted attachment metadata into FileUIParts with signed URLs. */
async function resolveAttachmentUrls(
  supabase: ReturnType<typeof createClient>,
  rawAttachments: unknown,
): Promise<FileUIPart[]> {
  if (!Array.isArray(rawAttachments)) return []

  const attachments = rawAttachments.filter(isPersistedAttachment)
  if (attachments.length === 0) return []

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(
    attachments.map((a) => a.storagePath),
    SIGNED_URL_EXPIRY_SECONDS,
  )

  if (error || !data) {
    console.error('[use-conversations] Failed to create signed URLs:', error?.message)
    return []
  }

  // Log per-item errors (e.g. deleted files) for diagnostics
  for (const item of data) {
    if (item.error) {
      console.error(
        `[use-conversations] Signed URL error for ${item.path ?? 'unknown'}:`,
        item.error,
      )
    }
  }

  return attachments
    .map((attachment, i): FileUIPart | null => {
      const signedUrl = data[i]?.signedUrl
      if (!signedUrl) return null
      return {
        type: 'file',
        url: signedUrl,
        mediaType: attachment.mediaType,
        filename: attachment.filename,
      }
    })
    .filter((part): part is FileUIPart => part !== null)
}

interface UseConversationsReturn {
  conversations: Conversation[]
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void
  createConversation: () => Promise<string | null>
  deleteConversation: (id: string) => Promise<void>
  loadMessages: (conversationId: string) => Promise<UIMessage[]>
  isLoading: boolean
}

export function useConversations(): UseConversationsReturn {
  const supabase = useMemo(() => createClient(), [])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const activeConversationId = useSettingsField('active_conversation_id') ?? null
  const [isLoading, setIsLoading] = useState(true)
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    async function fetchConversations() {
      setIsLoading(true)
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        userIdRef.current = user.id

        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(CONVERSATIONS_PAGE_SIZE)

        if (error) {
          toast.error('Failed to load conversations')
          return
        }
        setConversations(data ?? [])
      } catch {
        toast.error('Failed to load conversations')
      } finally {
        setIsLoading(false)
      }
    }

    void fetchConversations()
  }, [supabase])

  const updateSettings = useUpdateSettings()

  // Realtime subscription — keeps sidebar in sync when backend writes
  // (e.g. agent auto-generates title, conversation is archived)
  useEffect(() => {
    function handleInsert(payload: { new: Conversation }) {
      const row = payload.new
      if (row.user_id !== userIdRef.current) return
      setConversations((prev) => {
        if (prev.some((c) => c.id === row.id)) return prev
        return [row, ...prev]
      })
    }

    function handleUpdate(payload: { new: Conversation }) {
      const row = payload.new
      if (row.user_id !== userIdRef.current) return
      setConversations((prev) => prev.map((c) => (c.id === row.id ? row : c)))
    }

    function handleDelete(payload: { old: Partial<Conversation> }) {
      const row = payload.old
      if (!row.id) return
      if (getSettingsSnapshot()?.active_conversation_id === row.id) {
        updateSettings({ active_conversation_id: null })
      }
      setConversations((prev) => prev.filter((c) => c.id !== row.id))
    }

    const channel = supabase
      .channel('conversations-realtime')
      .on<Conversation>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        handleInsert,
      )
      .on<Conversation>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        handleUpdate,
      )
      .on<Conversation>(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conversations' },
        handleDelete,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, updateSettings])

  // Validate persisted activeConversationId against loaded conversations
  useEffect(() => {
    if (isLoading) return
    if (activeConversationId === null) return
    if (!conversations.some((c) => c.id === activeConversationId)) {
      updateSettings({ active_conversation_id: null })
    }
  }, [isLoading, activeConversationId, conversations, updateSettings])
  const setActiveConversationId = useCallback(
    (id: string | null) => {
      updateSettings({ active_conversation_id: id })
    },
    [updateSettings],
  )

  const createConversation = useCallback(async () => {
    if (!userIdRef.current) return null

    const { data } = await supabase
      .from('conversations')
      .insert({ user_id: userIdRef.current, status: 'active' })
      .select()
      .single()

    if (data) {
      setConversations((prev) => [data, ...prev])
      updateSettings({ active_conversation_id: data.id })
      return data.id
    }
    return null
  }, [supabase, updateSettings])

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!userIdRef.current) return

      await supabase.from('conversations').delete().eq('id', id).eq('user_id', userIdRef.current)

      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) {
        updateSettings({ active_conversation_id: null })
      }
    },
    [supabase, activeConversationId, updateSettings],
  )

  const loadMessages = useCallback(
    async (conversationId: string): Promise<UIMessage[]> => {
      const { data } = await supabase
        .from('conversation_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (!data) return []

      const filtered = data.filter((msg) => msg.role !== 'tool')

      // Resolve signed URLs for user messages with persisted attachments (parallel)
      const attachmentsByMsgId = new Map<string, FileUIPart[]>()
      const msgsWithAttachments = filtered.filter(
        (msg) =>
          msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0,
      )
      if (msgsWithAttachments.length > 0) {
        const resolved = await Promise.all(
          msgsWithAttachments.map(async (msg) => ({
            id: msg.id,
            parts: await resolveAttachmentUrls(supabase, msg.attachments),
          })),
        )
        for (const { id, parts } of resolved) {
          if (parts.length > 0) attachmentsByMsgId.set(id, parts)
        }
      }

      return filtered.map((msg) => {
        const parts: UIMessage['parts'] = []

        // File attachment parts (before text so they render above the message)
        const fileParts = attachmentsByMsgId.get(msg.id)
        if (fileParts) {
          parts.push(...fileParts)
        }

        // Text content
        if (msg.content) {
          parts.push({ type: 'text', text: msg.content })
        }

        // Reconstruct tool + reasoning parts from persisted tool_calls JSONB
        parts.push(...reconstructParts(msg.tool_calls))

        // Ensure at least one part exists
        if (parts.length === 0) {
          parts.push({ type: 'text', text: '' })
        }

        // Restore metadata (e.g. token usage) persisted on assistant messages
        const meta = msg.metadata as Record<string, unknown> | null
        const hasMetadata = meta != null && Object.keys(meta).length > 0

        return {
          id: msg.id,
          role: msg.role as UIMessage['role'],
          parts,
          ...(hasMetadata && { metadata: meta }),
        }
      })
    },
    [supabase],
  )

  return {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    loadMessages,
    isLoading,
  }
}
