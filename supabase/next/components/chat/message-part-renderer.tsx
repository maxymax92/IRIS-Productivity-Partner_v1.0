'use client'

import { isToolUIPart } from 'ai'
import type { DynamicToolUIPart, FileUIPart, ToolUIPart, UIMessage } from 'ai'
import { Download, RefreshCwIcon } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockSaveButton,
} from '@/components/ai-elements/code-block'
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation'
import { Image } from '@/components/ai-elements/image'
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from '@/components/ai-elements/inline-citation'
import {
  JSXPreview,
  JSXPreviewContent,
  JSXPreviewError,
} from '@/components/ai-elements/jsx-preview'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
} from '@/components/ai-elements/plan'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Sandbox, SandboxContent, SandboxHeader } from '@/components/ai-elements/sandbox'
import { SchemaDisplay } from '@/components/ai-elements/schema-display'
import {
  Snippet,
  SnippetAddon,
  SnippetCopyButton,
  SnippetInput,
} from '@/components/ai-elements/snippet'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'
import {
  StackTrace,
  StackTraceActions,
  StackTraceContent,
  StackTraceCopyButton,
  StackTraceError,
  StackTraceErrorMessage,
  StackTraceErrorType,
  StackTraceExpandButton,
  StackTraceFrames,
  StackTraceHeader,
} from '@/components/ai-elements/stack-trace'
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task'
import { Terminal } from '@/components/ai-elements/terminal'
import { Tool, ToolContent, ToolHeader, ToolOutput } from '@/components/ai-elements/tool'
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewUrl,
} from '@/components/ai-elements/web-preview'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSaveToFiles } from '@/hooks/use-save-to-files'

type Part = UIMessage['parts'][number]
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const PART_ORDER: Record<string, number> = {
  reasoning: 0,
  'dynamic-tool': 1,
  text: 2,
}

function getPartSortOrder(part: Part): number {
  if (isToolUIPart(part)) return 1
  return PART_ORDER[part.type] ?? 1
}

function sortPartsToolsFirst(parts: Part[]): Part[] {
  return [...parts].sort((a, b) => getPartSortOrder(a) - getPartSortOrder(b))
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

function hasImageData(p: Part): p is Part & { base64: string; mediaType: string } {
  return 'base64' in p && 'mediaType' in p
}

const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'json', 'markdown'] as const
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

type ToolApprovalResponseFn = (opts: { id: string; approved: boolean; reason?: string }) => void

function ToolPartView({
  reactKey,
  tp,
  onToolApprovalResponse,
}: {
  reactKey: string
  tp: ToolUIPart | DynamicToolUIPart
  onToolApprovalResponse?: ToolApprovalResponseFn | undefined
}) {
  const record = tp as Record<string, unknown>
  const toolOutput = record['output']
  const toolError = typeof record['errorText'] === 'string' ? record['errorText'] : undefined
  const approval = record['approval'] as
    | { id: string; approved?: boolean; reason?: string }
    | undefined
  const toolName = 'toolName' in tp ? tp.toolName : tp.type.replace('tool-', '')

  return (
    <Tool key={reactKey}>
      <ToolHeader
        state={tp.state}
        {...(tp.type === 'dynamic-tool'
          ? { type: 'dynamic-tool' as const, toolName: tp.toolName }
          : { type: tp.type })}
      />
      <ToolContent>
        {toolOutput != null || toolError ? (
          <ToolOutput output={toolOutput} errorText={toolError} />
        ) : null}
      </ToolContent>
      <Confirmation approval={approval} state={tp.state}>
        <ConfirmationTitle>
          Allow <strong>{toolName}</strong> to execute?
        </ConfirmationTitle>
        <ConfirmationRequest>
          <ConfirmationActions>
            <ConfirmationAction
              variant='outline'
              onClick={() => {
                if (approval?.id && onToolApprovalResponse) {
                  onToolApprovalResponse({ id: approval.id, approved: false })
                }
              }}
            >
              Deny
            </ConfirmationAction>
            <ConfirmationAction
              onClick={() => {
                if (approval?.id && onToolApprovalResponse) {
                  onToolApprovalResponse({ id: approval.id, approved: true })
                }
              }}
            >
              Approve
            </ConfirmationAction>
          </ConfirmationActions>
        </ConfirmationRequest>
        <ConfirmationAccepted>Approved</ConfirmationAccepted>
        <ConfirmationRejected>Denied</ConfirmationRejected>
      </Confirmation>
    </Tool>
  )
}

function renderAgentPart(
  part: Record<string, unknown>,
  key: string,
  isStreaming: boolean,
): ReactNode {
  if (part['type'] === 'plan' && typeof part['title'] === 'string') {
    return (
      <Plan key={key} isStreaming={isStreaming} defaultOpen={false}>
        <PlanHeader>
          <PlanTitle>{part['title']}</PlanTitle>
          {typeof part['description'] === 'string' ? (
            <PlanDescription>{part['description']}</PlanDescription>
          ) : null}
        </PlanHeader>
        {typeof part['content'] === 'string' ? (
          <PlanContent>
            <MessageResponse>{part['content']}</MessageResponse>
          </PlanContent>
        ) : null}
      </Plan>
    )
  }

  if (part['type'] === 'chain-of-thought' && Array.isArray(part['steps'])) {
    const steps = part['steps'] as { label: string; description?: string; status?: string }[]
    return (
      <ChainOfThought key={key} defaultOpen={false}>
        <ChainOfThoughtHeader>Chain of Thought</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {steps.map((step) => (
            <ChainOfThoughtStep
              key={step.label}
              label={step.label}
              description={step.description}
              status={(step.status ?? 'complete') as 'complete' | 'active' | 'pending'}
            />
          ))}
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
  }

  if (part['type'] === 'terminal' && typeof part['output'] === 'string') {
    return <Terminal key={key} output={part['output']} isStreaming={isStreaming} />
  }

  if (part['type'] === 'sandbox' && typeof part['title'] === 'string') {
    const state = (part['state'] ?? 'output-available') as ToolUIPart['state']
    return (
      <Sandbox key={key}>
        <SandboxHeader title={part['title']} state={state} />
        <SandboxContent>
          {typeof part['content'] === 'string' ? (
            <pre className='p-4 font-mono text-sm whitespace-pre-wrap'>{part['content']}</pre>
          ) : null}
        </SandboxContent>
      </Sandbox>
    )
  }

  if (part['type'] === 'task' && typeof part['title'] === 'string') {
    return (
      <Task key={key} defaultOpen={false}>
        <TaskTrigger title={part['title']} />
        {typeof part['content'] === 'string' ? (
          <TaskContent>
            <MessageResponse>{part['content']}</MessageResponse>
          </TaskContent>
        ) : null}
      </Task>
    )
  }

  if (part['type'] === 'data-web-preview') {
    const d = part['data'] as Record<string, unknown> | undefined
    if (d && typeof d['url'] === 'string') {
      return (
        <WebPreview key={key} defaultUrl={d['url']}>
          <WebPreviewNavigation>
            <WebPreviewUrl />
          </WebPreviewNavigation>
          <WebPreviewBody />
        </WebPreview>
      )
    }
  }

  return null
}

function renderRichOutputPart(
  part: Record<string, unknown>,
  key: string,
  isStreamingReasoning?: boolean,
): ReactNode {
  if (part['type'] === 'data-jsx-preview') {
    const d = part['data'] as Record<string, unknown> | undefined
    if (d && typeof d['jsx'] === 'string') {
      return (
        <JSXPreview key={key} jsx={d['jsx']} isStreaming={isStreamingReasoning ?? false}>
          <JSXPreviewContent />
          <JSXPreviewError />
        </JSXPreview>
      )
    }
  }

  if (part['type'] === 'data-schema-display') {
    const d = part['data'] as Record<string, unknown> | undefined
    if (d && typeof d['method'] === 'string' && typeof d['path'] === 'string') {
      return (
        <SchemaDisplay
          key={key}
          method={d['method'] as HttpMethod}
          path={d['path']}
          description={typeof d['description'] === 'string' ? d['description'] : undefined}
          parameters={Array.isArray(d['parameters']) ? d['parameters'] : undefined}
          requestBody={Array.isArray(d['requestBody']) ? d['requestBody'] : undefined}
          responseBody={Array.isArray(d['responseBody']) ? d['responseBody'] : undefined}
        />
      )
    }
  }

  return null
}

function renderCodeOutputPart(part: Record<string, unknown>, key: string): ReactNode {
  if (part['type'] === 'code-block' && typeof part['code'] === 'string') {
    const langRaw = (part['language'] ?? 'typescript') as string
    const lang: SupportedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(langRaw)
      ? (langRaw as SupportedLanguage)
      : 'typescript'
    return (
      <CodeBlock key={key} code={part['code']} language={lang} showLineNumbers>
        <CodeBlockHeader>
          <CodeBlockActions>
            <CodeBlockSaveButton />
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    )
  }

  if (part['type'] === 'snippet' && typeof part['code'] === 'string') {
    return (
      <Snippet key={key} code={part['code']}>
        <SnippetAddon align='inline-end'>
          <SnippetCopyButton />
        </SnippetAddon>
        <SnippetInput />
      </Snippet>
    )
  }

  if (part['type'] === 'stack-trace' && typeof part['trace'] === 'string') {
    return (
      <StackTrace key={key} trace={part['trace']} defaultOpen={false}>
        <StackTraceHeader>
          <StackTraceError>
            <StackTraceErrorType />
            <StackTraceErrorMessage />
            <StackTraceActions>
              <StackTraceCopyButton />
              <StackTraceExpandButton />
            </StackTraceActions>
          </StackTraceError>
        </StackTraceHeader>
        <StackTraceContent>
          <StackTraceFrames />
        </StackTraceContent>
      </StackTrace>
    )
  }

  if (
    part['type'] === 'inline-citation' &&
    Array.isArray(part['sources']) &&
    part['sources'].length > 0
  ) {
    const sources = part['sources'] as string[]
    return (
      <InlineCitation key={key}>
        <InlineCitationCard>
          <InlineCitationCardTrigger sources={sources} />
          <InlineCitationCardBody>
            {sources.map((url) => (
              <a
                className='hover:bg-surface-raised/50 block truncate p-2 text-xs'
                href={url}
                key={url}
                rel='noopener noreferrer'
                target='_blank'
              >
                {url}
              </a>
            ))}
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    )
  }

  return null
}

interface RenderPartOptions {
  isStreamingReasoning: boolean
  key: string
  onToolApprovalResponse?: ToolApprovalResponseFn | undefined
}

function renderPartContent(part: Part, opts: RenderPartOptions): ReactNode {
  const { isStreamingReasoning, key, onToolApprovalResponse } = opts

  switch (part.type) {
    case 'text':
      return <MessageResponse key={key}>{part.text}</MessageResponse>
    case 'reasoning':
      return (
        <Reasoning
          className='w-full'
          defaultOpen={false}
          isStreaming={isStreamingReasoning}
          key={key}
        >
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      )
    case 'dynamic-tool':
      return (
        <ToolPartView
          key={key}
          reactKey={key}
          tp={part}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      )
    case 'source-url':
    case 'source-document':
    case 'file':
    case 'step-start':
      return null
    default:
      break
  }

  if (isToolUIPart(part)) {
    return (
      <ToolPartView
        key={key}
        reactKey={key}
        tp={part}
        onToolApprovalResponse={onToolApprovalResponse}
      />
    )
  }

  if (hasImageData(part)) {
    return (
      <Image
        key={key}
        alt='AI generated'
        base64={part.base64}
        mediaType={part.mediaType}
        uint8Array={new Uint8Array()}
      />
    )
  }

  const record = part as Record<string, unknown>
  return (
    renderAgentPart(record, key, isStreamingReasoning) ??
    renderRichOutputPart(record, key, isStreamingReasoning) ??
    renderCodeOutputPart(record, key)
  )
}

function SaveToFilesAction({ content }: { content: string }) {
  const { saveContent } = useSaveToFiles()
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const namePreviewLength = 8
  const suggestedName = `chat-${content.slice(0, namePreviewLength).replace(/[^a-zA-Z0-9]/g, '')}.md`

  const handleSave = useCallback(() => {
    const filename = inputRef.current?.value.trim() ?? suggestedName
    setIsOpen(false)
    void saveContent(filename || suggestedName, content)
  }, [content, saveContent, suggestedName])

  // Focus the input when the popover opens (avoids autoFocus prop for a11y)
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [])

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <MessageAction tooltip='Save to Files'>
          <Download className='size-3.5' />
        </MessageAction>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-2'>
        <div className='flex items-center gap-2'>
          <Input
            ref={inputRef}
            placeholder='filename.md'
            defaultValue={suggestedName}
            className='h-8 text-sm'
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
          <Button size='sm' onClick={handleSave}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function MessagePartRenderer({
  message,
  messages,
  onRegenerate,
  onToolApprovalResponse,
  status,
}: {
  message: UIMessage
  messages: UIMessage[]
  onRegenerate?: (() => void) | undefined
  onToolApprovalResponse?: ToolApprovalResponseFn | undefined
  status: string
}) {
  const isLastAssistant = message.role === 'assistant' && message.id === messages.at(-1)?.id
  const sortedParts = useMemo(() => sortPartsToolsFirst(message.parts), [message.parts])

  const sourceUrlParts = message.parts.filter((p) => p.type === 'source-url' && 'url' in p) as {
    type: 'source-url'
    url: string
    title?: string
  }[]

  const fileParts = message.parts.filter(
    (p): p is FileUIPart => p.type === 'file' && 'url' in p && 'mediaType' in p,
  )

  return (
    <div>
      {message.role === 'assistant' && sourceUrlParts.length > 0 ? (
        <Sources>
          <SourcesTrigger count={sourceUrlParts.length} />
          <SourcesContent>
            {sourceUrlParts.map((part) => (
              <Source
                href={part.url}
                key={`${message.id}-source-${part.url}`}
                title={part.title ?? part.url}
              />
            ))}
          </SourcesContent>
        </Sources>
      ) : null}

      {fileParts.length > 0 ? (
        <Attachments variant='grid' className='mb-2'>
          {fileParts.map((part, i) => (
            <Attachment
              key={`${message.id}-file-${String(i)}`}
              data={{ ...part, id: `${message.id}-file-${String(i)}` }}
            >
              <AttachmentPreview />
              <AttachmentInfo />
            </Attachment>
          ))}
        </Attachments>
      ) : null}

      <Message from={message.role}>
        <MessageContent>
          {sortedParts.map((part, i): ReactNode => {
            const key = `${message.id}-part-${part.type}-${String(i)}`
            const isStreamingReasoning =
              status === 'streaming' && part === message.parts.at(-1) && isLastAssistant

            return renderPartContent(part, { isStreamingReasoning, key, onToolApprovalResponse })
          })}
        </MessageContent>

        {status !== 'streaming' || !isLastAssistant ? (
          <MessageActions className={message.role === 'user' ? 'justify-end' : undefined}>
            <CopyButton content={getMessageText(message)} variant='ghost' size='sm' />
            {message.role === 'assistant' ? (
              <SaveToFilesAction content={getMessageText(message)} />
            ) : null}
            {isLastAssistant && status !== 'streaming' && onRegenerate ? (
              <MessageAction onClick={onRegenerate} tooltip='Regenerate'>
                <RefreshCwIcon className='size-3.5' />
              </MessageAction>
            ) : null}
          </MessageActions>
        ) : null}
      </Message>
    </div>
  )
}
