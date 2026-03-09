'use client'

import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  DotIcon,
  Loader2Icon,
  XCircleIcon,
} from 'lucide-react'
import { isValidElement } from 'react'

import { CodeBlock } from './code-block'

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn('group not-prose w-full', className)} {...props} />
)

export type ToolPart = ToolUIPart | DynamicToolUIPart

export type ToolHeaderProps = {
  title?: string
  className?: string
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | {
      type: DynamicToolUIPart['type']
      state: DynamicToolUIPart['state']
      toolName: string
    }
)

const statusLabels: Record<ToolPart['state'], string> = {
  'approval-requested': 'Awaiting Approval',
  'approval-responded': 'Responded',
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
}

const statusIcons: Record<ToolPart['state'], ReactNode> = {
  'approval-requested': <ClockIcon className='text-accent-strong size-4 animate-pulse' />,
  'approval-responded': <CheckCircleIcon className='text-success size-4' />,
  'input-available': <Loader2Icon className='text-accent-strong animate-spin-fast size-4' />,
  'input-streaming': <CircleIcon className='text-muted-foreground size-4' />,
  'output-available': <CheckCircleIcon className='text-success size-4' />,
  'output-denied': <XCircleIcon className='text-destructive size-4' />,
  'output-error': <XCircleIcon className='text-destructive size-4' />,
}

const statusBadgeVariant: Record<
  ToolPart['state'],
  'accent' | 'success' | 'secondary' | 'destructive'
> = {
  'approval-requested': 'secondary',
  'approval-responded': 'success',
  'input-available': 'accent',
  'input-streaming': 'secondary',
  'output-available': 'success',
  'output-denied': 'destructive',
  'output-error': 'destructive',
}

export const getStatusBadge = (status: ToolPart['state']) => (
  <Badge className='gap-1.5 rounded-full text-xs' variant={statusBadgeVariant[status]}>
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
)

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const rawName = type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-')
  const derivedName = rawName.includes('__')
    ? (rawName.split('__').pop() ?? rawName).replaceAll('_', ' ')
    : rawName.replaceAll('_', ' ')

  return (
    <CollapsibleTrigger
      className={cn(
        'text-muted-foreground hover:text-foreground touch:min-h-touch flex w-full items-center gap-2 text-sm transition-colors',
        className,
      )}
      {...props}
    >
      <DotIcon
        className={cn(
          'size-4',
          state === 'input-streaming' && 'text-muted-foreground',
          (state === 'input-available' || state === 'approval-requested') &&
            'text-accent-strong animate-pulse',
          (state === 'output-available' || state === 'approval-responded') && 'text-success',
          (state === 'output-denied' || state === 'output-error') && 'text-destructive',
        )}
      />
      <span className='flex-1 text-left'>{title ?? derivedName}</span>
      <ChevronDownIcon className='size-4 transition-transform group-data-[state=open]:rotate-180' />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in mt-2 space-y-3 outline-none',
      className,
    )}
    {...props}
  />
)

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input']
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden', className)} {...props}>
    <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
      Parameters
    </h4>
    <CodeBlock code={JSON.stringify(input, null, 2)} language='json' />
  </div>
)

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output']
  errorText: ToolPart['errorText']
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null
  }

  let Output: ReactNode = null

  if (output != null) {
    if (typeof output === 'object' && !isValidElement(output)) {
      Output = <CodeBlock code={JSON.stringify(output, null, 2)} language='json' />
    } else if (typeof output === 'string') {
      Output = <CodeBlock code={output} language='json' />
    } else {
      Output = <div>{output as ReactNode}</div>
    }
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto text-xs [&_table]:w-full',
          errorText ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  )
}
