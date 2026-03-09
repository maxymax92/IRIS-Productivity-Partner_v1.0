'use client'

import { useChat } from '@ai-sdk/react'
import type { User } from '@supabase/supabase-js'
import { DefaultChatTransport } from 'ai'
import type { ChatStatus, LanguageModelUsage, UIMessage } from 'ai'
import { BrainIcon, Loader2Icon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
} from '@/components/ai-elements/attachments'
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from '@/components/ai-elements/context'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector'
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { MessagePartRenderer } from '@/components/chat/message-part-renderer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSidebar } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { FILES_CHANGED_EVENT } from '@/hooks/use-project-files'
import { useUserSettings } from '@/hooks/use-user-settings'
import { MODELS, type ModelOption, getMaxOutputOptions, getModelOrDefault } from '@/lib/models'
import { getGreeting } from '@/lib/utils'

function IrisEmptyState({ user }: { user: User | null }) {
  const metadata = user?.user_metadata as Record<string, string> | undefined
  const fullName = metadata?.['full_name']
  const firstName = fullName?.split(' ')[0] ?? 'there'
  const { state, isMobile } = useSidebar()
  const isSidebarOpen = state === 'expanded' && !isMobile

  return (
    <div className='flex flex-1 flex-col items-center justify-center'>
      <div
        className='flex flex-col items-center justify-center px-4 pt-12 transition-transform duration-300 ease-out'
        style={
          isSidebarOpen ? { transform: 'translateX(calc(var(--sidebar-width) / -2))' } : undefined
        }
      >
        <div className='mx-auto max-w-4xl text-center'>
          <p className='text-iris-title tracking-iris-display mb-6 text-6xl font-medium sm:text-7xl md:text-8xl'>
            I R I S
          </p>
          <p className='font-satoshi text-iris-greeting tracking-iris-greeting mt-4 text-lg font-normal uppercase'>
            {getGreeting()}, {firstName}
          </p>
        </div>
      </div>
    </div>
  )
}

function ChatMessagesSkeleton() {
  return (
    <div className='space-y-6 px-4 pt-8'>
      <div className='flex justify-end gap-3'>
        <div className='space-y-2'>
          <Skeleton className='h-4 w-48' />
          <Skeleton className='h-4 w-64' />
        </div>
      </div>
      <div className='flex gap-3'>
        <div className='space-y-2'>
          <Skeleton className='h-4 w-48' />
          <Skeleton className='h-4 w-64' />
          <Skeleton className='h-4 w-40' />
        </div>
      </div>
      <div className='flex justify-end gap-3'>
        <div className='space-y-2'>
          <Skeleton className='h-4 w-48' />
          <Skeleton className='h-4 w-64' />
        </div>
      </div>
    </div>
  )
}

function ChatConversationBody({
  isLoadingMessages,
  messages,
  onRegenerate,
  onToolApprovalResponse,
  status,
}: {
  isLoadingMessages: boolean
  messages: UIMessage[]
  onRegenerate: () => void
  onToolApprovalResponse: (opts: { id: string; approved: boolean; reason?: string }) => void
  status: ChatStatus | undefined
}) {
  if (isLoadingMessages) {
    return <ChatMessagesSkeleton />
  }
  return (
    <>
      {messages.map((message) => (
        <MessagePartRenderer
          key={message.id}
          message={message}
          messages={messages}
          onRegenerate={onRegenerate}
          onToolApprovalResponse={onToolApprovalResponse}
          status={status ?? 'ready'}
        />
      ))}
    </>
  )
}

function AttachmentsDisplay() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <Attachments variant='inline'>
      {attachments.files.map((file) => (
        <Attachment key={file.id} data={file} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

function ChatInputArea({
  handleSubmit,
  model,
  onStop,
  prefs,
  setModel,
  onUpdatePrefs,
  status,
  usage,
}: {
  handleSubmit: (msg: PromptInputMessage) => void
  model: string
  onStop: () => void
  prefs: { extendedThinking: boolean; maxOutputTokens: number }
  setModel: (m: string) => void
  onUpdatePrefs: (updates: { extended_thinking?: boolean; max_output_tokens?: number }) => void
  status: ChatStatus | undefined
  usage?: LanguageModelUsage | undefined
}) {
  const [isModelOpen, setIsModelOpen] = useState(false)
  const usedTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)

  return (
    <div className='px-content-x pb-safe-bottom w-full shrink-0 pb-4'>
      <PromptInput
        className='glass-panel backdrop-blur-panel backdrop-saturate-glass focus-within:border-accent-muted w-full rounded-lg transition-colors'
        onSubmit={handleSubmit}
      >
        <PromptInputHeader>
          <AttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea placeholder='Ask Iris anything...' enterKeyHint='send' />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger>
                <PlusIcon className='size-4' />
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label='Add photos or files' />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            <ModelSelector open={isModelOpen} onOpenChange={setIsModelOpen}>
              <ModelSelectorTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-muted-foreground hover:bg-surface-raised hover:text-foreground touch:min-h-touch touch:py-2 gap-1.5 text-xs font-medium'
                >
                  <ModelSelectorLogo provider='anthropic' />
                  <span className='truncate'>
                    {MODELS.find((m) => m.id === model)?.name ?? model}
                  </span>
                </Button>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder='Search models...' />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  <ModelSelectorGroup heading='Anthropic'>
                    {MODELS.map((m) => (
                      <ModelSelectorItem
                        key={m.id}
                        value={m.name}
                        onSelect={() => {
                          setModel(m.id)
                          setIsModelOpen(false)
                        }}
                      >
                        <ModelSelectorLogoGroup>
                          <ModelSelectorLogo provider='anthropic' />
                        </ModelSelectorLogoGroup>
                        <ModelSelectorName>{m.name}</ModelSelectorName>
                      </ModelSelectorItem>
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-muted-foreground hover:bg-surface-raised hover:text-foreground touch:min-h-touch touch:min-w-touch size-8 p-0'
                >
                  <SlidersHorizontalIcon className='size-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' side='top' className='w-56'>
                <DropdownMenuLabel>Settings</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={prefs.extendedThinking}
                  onCheckedChange={(v) => onUpdatePrefs({ extended_thinking: !!v })}
                >
                  <BrainIcon className='mr-2 size-4' />
                  Extended Thinking
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    Output limit: {prefs.maxOutputTokens / 1024}K
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={String(prefs.maxOutputTokens)}
                      onValueChange={(v) => onUpdatePrefs({ max_output_tokens: Number(v) })}
                    >
                      {getMaxOutputOptions(model).map((opt) => (
                        <DropdownMenuRadioItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            <Context
              maxTokens={getModelOrDefault(model).contextWindow}
              modelId={model}
              {...(usage !== undefined && { usage })}
              usedTokens={usedTokens}
            >
              <ContextTrigger className='text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2' />
              <ContextContent align='start' side='top'>
                <ContextContentHeader />
                <ContextContentBody>
                  <ContextInputUsage />
                  <ContextOutputUsage />
                  <ContextCacheUsage />
                </ContextContentBody>
              </ContextContent>
            </Context>
          </PromptInputTools>
          <PromptInputSubmit onStop={onStop} {...(status !== undefined && { status })} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}

/**
 * Accumulate token usage across ALL assistant messages in the conversation,
 * giving a session-cumulative total that never resets mid-conversation.
 *
 * Each agent query writes its own usage to its assistant message's metadata.
 * The Agent SDK result usage is cumulative within a single query but NOT
 * across queries, so we sum across all messages here.
 *
 * Preserves the last computed value across the 2-second auto-reload that
 * replaces in-memory messages (which carry stream metadata) with DB-loaded
 * ones using the "setState during render" pattern.
 * See: react.dev/reference/react/useState
 */
function useCumulativeUsage(
  messages: UIMessage[],
  conversationId: string | null,
): LanguageModelUsage | undefined {
  const currentUsage = useMemo((): LanguageModelUsage | undefined => {
    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheWrite = 0
    let totalNoCacheInput = 0
    let hasAnyUsage = false

    for (const m of messages) {
      if (m.role !== 'assistant' || m.metadata == null) continue
      const meta = m.metadata as Record<string, unknown>
      const usage = meta['usage'] as LanguageModelUsage | undefined
      if (usage == null) continue

      hasAnyUsage = true
      totalInput += usage.inputTokens ?? 0
      totalOutput += usage.outputTokens ?? 0
      totalCacheRead += usage.inputTokenDetails.cacheReadTokens ?? 0
      totalCacheWrite += usage.inputTokenDetails.cacheWriteTokens ?? 0
      totalNoCacheInput += usage.inputTokenDetails.noCacheTokens ?? 0
    }

    if (!hasAnyUsage) return undefined

    return {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      inputTokenDetails: {
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
        noCacheTokens: totalNoCacheInput,
      },
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
    }
  }, [messages])

  const [preserved, setPreserved] = useState<LanguageModelUsage | undefined>(undefined)
  const [prevConvId, setPrevConvId] = useState(conversationId)

  // Clear preserved usage when switching conversations to prevent stale data.
  // Return undefined because currentUsage may still reflect the old
  // conversation's messages that haven't been cleared yet on this render.
  if (prevConvId !== conversationId) {
    setPrevConvId(conversationId)
    if (preserved !== undefined) {
      setPreserved(undefined)
    }
    return undefined
  }

  if (currentUsage !== undefined && currentUsage !== preserved) {
    setPreserved(currentUsage)
  }

  return currentUsage ?? preserved
}

type ChatViewProps = {
  user: User | null
  activeConversationId: string | null
  createConversation: () => Promise<string | null>
  loadMessages: (id: string) => Promise<UIMessage[]>
}
export function ChatView({
  user,
  activeConversationId,
  createConversation,
  loadMessages,
}: ChatViewProps) {
  const { settings, updateSettings } = useUserSettings()
  const modelId = settings?.model_id ?? 'claude-sonnet-4-6'
  const isExtendedThinking = settings?.extended_thinking ?? true
  const maxOutputTokens = settings?.max_output_tokens ?? getModelOrDefault(modelId).defaultMaxOutput
  const model = MODELS.some((m) => m.id === modelId) ? modelId : (MODELS[0] as ModelOption).id

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages: msgs, body: mergedBody }) => {
          const lastUser = msgs.filter((m) => m.role === 'user').at(-1)
          const text =
            lastUser?.parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('\n') ?? ''

          const files =
            lastUser?.parts
              .filter(
                (p): p is { type: 'file'; url: string; mediaType: string; filename?: string } =>
                  p.type === 'file' && 'url' in p && 'mediaType' in p,
              )
              .map((p) => ({
                url: p.url,
                mediaType: p.mediaType,
                ...(p.filename && { filename: p.filename }),
              })) ?? []

          const convId = mergedBody?.['conversationId'] as string | undefined

          return {
            body: {
              message: text,
              conversationId: convId,
              model,
              extendedThinking: isExtendedThinking,
              maxOutputTokens,
              ...(files.length > 0 && { files }),
            },
          }
        },
      }),
    [model, isExtendedThinking, maxOutputTokens],
  )

  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const isSendingToNewRef = useRef(false)

  const { messages, regenerate, sendMessage, setMessages, status, stop } = useChat({
    ...(activeConversationId != null && { id: activeConversationId }),
    transport,
    messages: initialMessages,
  })

  // Refresh file tree when agent completes file operations
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'streaming' && status === 'ready') {
      const last = messages[messages.length - 1]
      const hasFileOp =
        last?.role === 'assistant' &&
        last.parts.some(
          (p) =>
            'toolName' in p && typeof p.toolName === 'string' && p.toolName.includes('manage_file'),
        )
      if (hasFileOp) {
        window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
      }
    }
  }, [status, messages])

  // Auto-reload messages from DB to recover from silent stream drops.
  // Separated from the file-op effect so that `messages` is not in the deps —
  // otherwise every message update would cancel the 2-second reload timer.
  // Race conditions are handled via effect cleanup: changing status (user sends
  // new msg) or activeConversationId (user switches chat) both trigger cleanup
  // which clears the timer before it fires.
  const prevStatusForReloadRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusForReloadRef.current
    prevStatusForReloadRef.current = status
    if (prev === 'streaming' && status === 'ready') {
      const RELOAD_DELAY_MS = 2000
      const timer = setTimeout(() => {
        const convId = activeConversationId
        if (!convId) return
        void loadMessages(convId).then((loaded) => {
          if (loaded.length > 0) {
            setMessages(loaded)
          }
        })
      }, RELOAD_DELAY_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [status, activeConversationId, loadMessages, setMessages])

  useEffect(() => {
    const load = async () => {
      if (!activeConversationId) {
        setInitialMessages([])
        setMessages([])
        isSendingToNewRef.current = false
        setIsLoadingMessages(false)
        return
      }
      if (isSendingToNewRef.current) {
        isSendingToNewRef.current = false
        return
      }
      setIsLoadingMessages(true)
      const loaded = await loadMessages(activeConversationId)
      setInitialMessages(loaded)
      setMessages(loaded)
      setIsLoadingMessages(false)
    }

    void load()
  }, [activeConversationId, loadMessages, setMessages])

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const hasText = message.text.trim().length > 0
      const hasFiles = message.files.length > 0
      if (!hasText && !hasFiles) return

      if (!activeConversationId) {
        if (isSendingToNewRef.current) return // guard against double submit
        isSendingToNewRef.current = true
        void createConversation().then(async (id) => {
          if (id) {
            await sendMessage(
              { text: message.text, files: message.files },
              { body: { conversationId: id } },
            )
          } else {
            isSendingToNewRef.current = false
            toast.error('Could not start a new conversation. Please try again.')
          }
        })
        return
      }

      void sendMessage(
        { text: message.text, files: message.files },
        { body: { conversationId: activeConversationId } },
      )
    },
    [activeConversationId, createConversation, sendMessage],
  )

  const handleRegenerate = useCallback(() => {
    void regenerate()
  }, [regenerate])

  const handleToolApprovalResponse = useCallback(
    (opts: { id: string; approved: boolean; reason?: string }) => {
      void fetch('/api/chat/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: opts.id,
          approved: opts.approved,
          ...(opts.reason && { reason: opts.reason }),
        }),
      })
    },
    [],
  )

  const handleStop = useCallback(() => {
    void stop()
  }, [stop])

  const displayUsage = useCumulativeUsage(messages, activeConversationId)

  const prefs = useMemo(
    () => ({ extendedThinking: isExtendedThinking, maxOutputTokens }),
    [isExtendedThinking, maxOutputTokens],
  )
  const setModel = useCallback((m: string) => updateSettings({ model_id: m }), [updateSettings])

  const isEmpty = !isLoadingMessages && messages.length === 0

  return (
    <div className='h-canvas flex flex-col'>
      {isEmpty ? (
        <IrisEmptyState user={user} />
      ) : (
        <Conversation className='min-h-0 flex-1'>
          <ConversationContent className='max-w-conversation px-content-x mx-auto w-full'>
            <ChatConversationBody
              isLoadingMessages={isLoadingMessages}
              messages={messages}
              onRegenerate={handleRegenerate}
              onToolApprovalResponse={handleToolApprovalResponse}
              status={status}
            />
            <AnimatePresence>
              {(status === 'submitted' || status === 'streaming') && (
                <motion.div
                  key='chat-spinner'
                  className='py-1.5'
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <Loader2Icon
                    role='status'
                    aria-label='Loading'
                    className='animate-spin-fast text-muted-foreground size-4'
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <ChatInputArea
        handleSubmit={handleSubmit}
        model={model}
        onStop={handleStop}
        prefs={prefs}
        setModel={setModel}
        onUpdatePrefs={updateSettings}
        status={status}
        usage={displayUsage}
      />
    </div>
  )
}
