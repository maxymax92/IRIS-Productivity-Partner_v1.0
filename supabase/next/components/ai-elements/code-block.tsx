'use client'

import { Download } from 'lucide-react'
import type { ComponentProps, CSSProperties, HTMLAttributes } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from 'shiki'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSaveToFiles } from '@/hooks/use-save-to-files'
import { getStrictContext } from '@/lib/get-strict-context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { COPY_FEEDBACK_MS } from '@/lib/constants'

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check

const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1
// biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check

// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2
const isUnderline = (fontStyle: number | undefined) =>
  // biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check
  // oxlint-disable-next-line eslint(no-bitwise)
  fontStyle && fontStyle & 4

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
  token: ThemedToken
  key: string
}
interface KeyedLine {
  tokens: KeyedToken[]
  key: string
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
  lines.map((line, lineIdx) => ({
    key: `line-${lineIdx}`,
    tokens: line.map((token, tokenIdx) => ({
      key: `line-${lineIdx}-${tokenIdx}`,
      token,
    })),
  }))

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
  <span
    className='shiki-token'
    style={
      {
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? 'italic' : undefined,
        fontWeight: isBold(token.fontStyle) ? 'bold' : undefined,
        textDecoration: isUnderline(token.fontStyle) ? 'underline' : undefined,
        ...token.htmlStyle,
      } as CSSProperties
    }
  >
    {token.content}
  </span>
)

// Line rendering component
const LineSpan = ({
  keyedLine,
  showLineNumbers,
}: {
  keyedLine: KeyedLine
  showLineNumbers: boolean
}) => (
  <span className={showLineNumbers ? 'code-line-number' : 'block'}>
    {keyedLine.tokens.length === 0
      ? '\n'
      : keyedLine.tokens.map(({ token, key }) => <TokenSpan key={key} token={token} />)}
  </span>
)

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

interface CodeBlockContextType {
  code: string
  language?: string
}

// Context
const [CodeBlockProvider, useCodeBlock] = getStrictContext<CodeBlockContextType>('CodeBlock')

// Highlighter cache (singleton per language)
const highlighterCache = new Map<
  string,
  Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>()

// Token cache
const tokensCache = new Map<string, TokenizedCode>()

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()

const getTokensCacheKey = (code: string, language: BundledLanguage) => {
  const start = code.slice(0, 100)
  const end = code.length > 100 ? code.slice(-100) : ''
  return `${language}:${code.length}:${start}:${end}`
}

const getHighlighter = async (
  language: BundledLanguage,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
  const cached = highlighterCache.get(language)
  if (cached) {
    return await cached
  }

  const highlighterPromise = import('shiki').then(({ createHighlighter }) =>
    createHighlighter({
      langs: [language],
      themes: ['github-light', 'github-dark'],
    }),
  )

  highlighterCache.set(language, highlighterPromise)
  return await highlighterPromise
}

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
  bg: 'transparent',
  fg: 'inherit',
  tokens: code.split('\n').map((line) =>
    line === ''
      ? []
      : [
          {
            color: 'inherit',
            content: line,
          } as ThemedToken,
        ],
  ),
})

// Synchronous highlight with callback for async results
export const highlightCode = (
  code: string,
  language: BundledLanguage,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language)

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey)
  if (cached) {
    return cached
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set())
    }
    subscribers.get(tokensCacheKey)?.add(callback)
  }

  // Start highlighting in background - fire-and-forget async pattern
  getHighlighter(language)
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then((highlighter) => {
      const availableLangs = highlighter.getLoadedLanguages()
      const langToUse = availableLangs.includes(language) ? language : 'text'

      const result = highlighter.codeToTokens(code, {
        lang: langToUse,
        themes: {
          dark: 'github-dark',
          light: 'github-light',
        },
      })

      const tokenized: TokenizedCode = {
        bg: result.bg ?? 'transparent',
        fg: result.fg ?? 'inherit',
        tokens: result.tokens,
      }

      // Cache the result
      tokensCache.set(tokensCacheKey, tokenized)

      // Notify all subscribers
      const subs = subscribers.get(tokensCacheKey)
      if (subs) {
        for (const sub of subs) {
          sub(tokenized)
        }
        subscribers.delete(tokensCacheKey)
      }
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      console.error('Failed to highlight code:', error)
      subscribers.delete(tokensCacheKey)
    })

  return null
}

const CodeBlockBody = memo(
  ({
    tokenized,
    showLineNumbers,
    className,
  }: {
    tokenized: TokenizedCode
    showLineNumbers: boolean
    className?: string
  }) => {
    const preStyle = useMemo(
      () => ({
        backgroundColor: tokenized.bg,
        color: tokenized.fg,
      }),
      [tokenized.bg, tokenized.fg],
    )

    const keyedLines = useMemo(() => addKeysToTokens(tokenized.tokens), [tokenized.tokens])

    return (
      <pre className={cn('m-0 p-4 text-sm', 'shiki-pre', className)} style={preStyle}>
        <code className={cn('font-mono text-sm', showLineNumbers && 'code-block-with-lines')}>
          {keyedLines.map((keyedLine) => (
            <LineSpan key={keyedLine.key} keyedLine={keyedLine} showLineNumbers={showLineNumbers} />
          ))}
        </code>
      </pre>
    )
  },
  (prevProps, nextProps) =>
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers &&
    prevProps.className === nextProps.className,
)

CodeBlockBody.displayName = 'CodeBlockBody'

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
  <div
    className={cn(
      'group border-accent-muted/30 bg-surface text-foreground relative w-full overflow-hidden rounded-md border',
      className,
    )}
    data-language={language}
    style={{
      containIntrinsicSize: 'auto 200px',
      contentVisibility: 'auto',
      ...style,
    }}
    {...props}
  />
)

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'border-accent-muted/40 bg-accent-bg text-accent-strong flex items-center justify-between border-b px-3 py-2 text-xs',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export const CodeBlockTitle = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center gap-2', className)} {...props}>
    {children}
  </div>
)

export const CodeBlockFilename = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('font-mono', className)} {...props}>
    {children}
  </span>
)

export const CodeBlockActions = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('-my-1 -mr-1 flex items-center gap-2', className)} {...props}>
    {children}
  </div>
)

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}) => {
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code])

  // Try to get cached result synchronously, otherwise use raw tokens
  const [tokenized, setTokenized] = useState<TokenizedCode>(
    () => highlightCode(code, language) ?? rawTokens,
  )

  useEffect(() => {
    let cancelled = false
    const syncResult = highlightCode(code, language) ?? rawTokens

    // Defer sync update to avoid setState-in-effect (cascading renders)
    queueMicrotask(() => {
      if (!cancelled) {
        setTokenized(syncResult)
      }
    })

    // Subscribe to async highlighting result
    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setTokenized(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, language, rawTokens])

  return (
    <div className='relative overflow-auto'>
      <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
    </div>
  )
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code, language }), [code, language])

  return (
    <CodeBlockProvider value={contextValue}>
      <CodeBlockContainer className={className} language={language} {...props}>
        {children}
        <CodeBlockContent code={code} language={language} showLineNumbers={showLineNumbers} />
      </CodeBlockContainer>
    </CodeBlockProvider>
  )
}

export type CodeBlockCopyButtonProps = Omit<React.ComponentProps<typeof CopyButton>, 'content'> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError: _onError,
  timeout = COPY_FEEDBACK_MS,
  className,
  onCopyChange,
  ...props
}: CodeBlockCopyButtonProps) => {
  const { code } = useCodeBlock()

  const handleCopyChange = useCallback(
    (isCopied: boolean) => {
      if (isCopied) onCopy?.()
      onCopyChange?.(isCopied)
    },
    [onCopy, onCopyChange],
  )

  return (
    <CopyButton
      className={cn('shrink-0', className)}
      content={code}
      delay={timeout}
      onCopyChange={handleCopyChange}
      size='sm'
      variant='ghost'
      {...props}
    />
  )
}

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>

export const CodeBlockLanguageSelector = (props: CodeBlockLanguageSelectorProps) => (
  <Select {...props} />
)

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<typeof SelectTrigger>

export const CodeBlockLanguageSelectorTrigger = ({
  className,
  ...props
}: CodeBlockLanguageSelectorTriggerProps) => (
  <SelectTrigger
    className={cn('h-7 border-none bg-transparent px-2 text-xs shadow-none', className)}
    {...props}
  />
)

export type CodeBlockLanguageSelectorValueProps = ComponentProps<typeof SelectValue>

export const CodeBlockLanguageSelectorValue = (props: CodeBlockLanguageSelectorValueProps) => (
  <SelectValue {...props} />
)

export type CodeBlockLanguageSelectorContentProps = ComponentProps<typeof SelectContent>

export const CodeBlockLanguageSelectorContent = ({
  align = 'end',
  ...props
}: CodeBlockLanguageSelectorContentProps) => <SelectContent align={align} {...props} />

export type CodeBlockLanguageSelectorItemProps = ComponentProps<typeof SelectItem>

export const CodeBlockLanguageSelectorItem = (props: CodeBlockLanguageSelectorItemProps) => (
  <SelectItem {...props} />
)

// Language → file extension mapping for save-to-files
const LANG_TO_EXT: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  json: 'json',
  markdown: 'md',
  html: 'html',
  css: 'css',
  bash: 'sh',
  shell: 'sh',
  sql: 'sql',
  yaml: 'yml',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  tsx: 'tsx',
  jsx: 'jsx',
}

export const CodeBlockSaveButton = ({ className }: { className?: string }) => {
  const { code, language } = useCodeBlock()
  const { saveContent } = useSaveToFiles()
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const ext = LANG_TO_EXT[language ?? ''] ?? 'txt'
  const suggestedName = `snippet.${ext}`

  const handleSave = useCallback(() => {
    const filename = inputRef.current?.value.trim() ?? suggestedName
    setIsOpen(false)
    void saveContent(filename || suggestedName, code)
  }, [code, saveContent, suggestedName])

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
        <Button
          className={cn('shrink-0', className)}
          size='sm'
          variant='ghost'
          aria-label='Save to Files'
        >
          <Download className='size-3.5' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-2'>
        <div className='flex items-center gap-2'>
          <Input
            ref={inputRef}
            placeholder={suggestedName}
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
