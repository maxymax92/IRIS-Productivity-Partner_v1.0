'use client'

import Ansi from 'ansi-to-react'
import { TerminalIcon, Trash2Icon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'
import { COPY_FEEDBACK_MS } from '@/lib/constants'
import { getStrictContext } from '@/lib/get-strict-context'

import { Shimmer } from './shimmer'

interface TerminalContextType {
  output: string
  isStreaming: boolean
  autoScroll: boolean
  onClear?: () => void
}

const [TerminalProvider, useTerminal] = getStrictContext<TerminalContextType>('Terminal')

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  output: string
  isStreaming?: boolean
  autoScroll?: boolean
  onClear?: () => void
}

export const Terminal = ({
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  className,
  children,
  ...props
}: TerminalProps) => {
  const contextValue = useMemo(
    () => ({ autoScroll, isStreaming, ...(onClear !== undefined && { onClear }), output }),
    [autoScroll, isStreaming, onClear, output],
  )

  return (
    <TerminalProvider value={contextValue}>
      <div
        className={cn(
          'border-border/40 bg-surface text-foreground flex flex-col overflow-hidden rounded-lg border',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <TerminalHeader>
              <TerminalTitle />
              <div className='flex items-center gap-1'>
                <TerminalStatus />
                <TerminalActions>
                  <TerminalCopyButton />
                  {onClear ? <TerminalClearButton /> : null}
                </TerminalActions>
              </div>
            </TerminalHeader>
            <TerminalContent />
          </>
        )}
      </div>
    </TerminalProvider>
  )
}

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>

export const TerminalHeader = ({ className, children, ...props }: TerminalHeaderProps) => (
  <div
    className={cn(
      'border-border/40 flex items-center justify-between border-b px-4 py-2',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>

export const TerminalTitle = ({ className, children, ...props }: TerminalTitleProps) => (
  <div
    className={cn('text-foreground-muted flex items-center gap-2 text-sm', className)}
    {...props}
  >
    <TerminalIcon className='size-4' />
    {children ?? 'Terminal'}
  </div>
)

export type TerminalStatusProps = HTMLAttributes<HTMLDivElement>

export const TerminalStatus = ({ className, children, ...props }: TerminalStatusProps) => {
  const { isStreaming } = useTerminal()

  if (!isStreaming) {
    return null
  }

  return (
    <div
      className={cn('text-foreground-muted flex items-center gap-2 text-xs', className)}
      {...props}
    >
      {children ?? <Shimmer className='w-16'> </Shimmer>}
    </div>
  )
}

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>

export const TerminalActions = ({ className, children, ...props }: TerminalActionsProps) => (
  <div className={cn('flex items-center gap-1', className)} {...props}>
    {children}
  </div>
)

export type TerminalCopyButtonProps = Omit<ComponentProps<typeof CopyButton>, 'content'> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const TerminalCopyButton = ({
  onCopy,
  timeout = COPY_FEEDBACK_MS,
  className,
  onCopyChange,
  ...props
}: TerminalCopyButtonProps) => {
  const { output } = useTerminal()

  const handleCopyChange = useCallback(
    (isCopied: boolean) => {
      if (isCopied) onCopy?.()
      onCopyChange?.(isCopied)
    },
    [onCopy, onCopyChange],
  )

  return (
    <CopyButton
      className={cn(
        'text-foreground-muted hover:bg-surface-raised hover:text-foreground size-7 shrink-0',
        className,
      )}
      content={output}
      delay={timeout}
      onCopyChange={handleCopyChange}
      size='sm'
      variant='ghost'
      {...props}
    />
  )
}

export type TerminalClearButtonProps = ComponentProps<typeof Button>

export const TerminalClearButton = ({
  children,
  className,
  ...props
}: TerminalClearButtonProps) => {
  const { onClear } = useTerminal()

  if (!onClear) {
    return null
  }

  return (
    <Button
      className={cn(
        'text-foreground-muted hover:bg-surface-raised hover:text-foreground size-7 shrink-0',
        className,
      )}
      onClick={onClear}
      size='icon'
      variant='ghost'
      {...props}
    >
      {children ?? <Trash2Icon size={14} />}
    </Button>
  )
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>

export const TerminalContent = ({ className, children, ...props }: TerminalContentProps) => {
  const { output, isStreaming, autoScroll } = useTerminal()
  const containerRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: output triggers auto-scroll when new content arrives
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [output, autoScroll])

  return (
    <div
      className={cn('max-h-96 overflow-auto p-4 font-mono text-sm leading-relaxed', className)}
      ref={containerRef}
      {...props}
    >
      {children ?? (
        <pre className='break-words whitespace-pre-wrap'>
          <Ansi>{output}</Ansi>
          {isStreaming ? (
            <span className='bg-foreground ml-0.5 inline-block h-4 w-2 animate-pulse' />
          ) : null}
        </pre>
      )}
    </div>
  )
}
