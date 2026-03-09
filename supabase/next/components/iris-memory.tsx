'use client'

import { Brain, ChevronDown, Download, Loader2, Pencil, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useFormat } from '@/hooks/use-format'
import { type MemoryItem, useMemories } from '@/hooks/use-memories'

type FilterTab = 'all' | 'knowledge' | 'episodic'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'episodic', label: 'Episodic' },
]

/** Max characters shown before a memory is truncated with "show more". */
const CONTENT_PREVIEW_LENGTH = 120

function MemoryItemCard({
  item,
  onEdit,
  onDelete,
}: {
  item: MemoryItem
  onEdit: (id: string, source: 'knowledge' | 'episodic', content: string) => void
  onDelete: (id: string, source: 'knowledge' | 'episodic') => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(item.data.content)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  const { formatDate } = useFormat()

  const isLong = item.data.content.length > CONTENT_PREVIEW_LENGTH
  const displayContent =
    isExpanded || !isLong
      ? item.data.content
      : `${item.data.content.slice(0, CONTENT_PREVIEW_LENGTH)}...`

  const typeLabel =
    item.source === 'knowledge'
      ? ((item.data as { content_type?: string }).content_type ?? 'memory')
      : ((item.data as { memory_type?: string }).memory_type ?? 'episodic')

  const date = formatDate(new Date(item.data.created_at))

  const handleSaveEdit = () => {
    onEdit(item.data.id, item.source, editContent)
    setIsEditing(false)
  }

  return (
    <div className='border-border/40 flex flex-col gap-2 rounded-lg border p-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge variant='secondary' className='touch:text-sm text-xs'>
            {item.source === 'knowledge' ? 'Knowledge' : 'Episodic'}
          </Badge>
          <Badge variant='outline' className='touch:text-sm text-xs'>
            {typeLabel}
          </Badge>
        </div>
        <span className='text-muted-foreground touch:text-sm shrink-0 text-xs'>{date}</span>
      </div>

      {isEditing ? (
        <div className='flex flex-col gap-2'>
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className='min-h-20 text-sm'
          />
          <div className='flex gap-2'>
            <Button size='sm' variant='default' onClick={handleSaveEdit}>
              Save
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                setIsEditing(false)
                setEditContent(item.data.content)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type='button'
          className='text-foreground cursor-pointer text-left text-sm whitespace-pre-wrap'
          onClick={() => {
            if (isLong) setIsExpanded((prev) => !prev)
          }}
        >
          {displayContent}
        </button>
      )}

      {!isEditing ? (
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='sm'
            className='text-muted-foreground h-7 px-2 text-xs'
            onClick={() => setIsEditing(true)}
          >
            <Pencil className='mr-1 size-3' />
            Edit
          </Button>
          {isConfirmingDelete ? (
            <>
              <Button
                variant='destructive'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => {
                  onDelete(item.data.id, item.source)
                  setIsConfirmingDelete(false)
                }}
              >
                Confirm
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => setIsConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              className='text-destructive hover:text-destructive h-7 px-2 text-xs'
              onClick={() => setIsConfirmingDelete(true)}
            >
              <Trash2 className='mr-1 size-3' />
              Delete
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function IrisMemory() {
  const { items, isLoading, hasMore, fetchAll, searchMemories, updateMemory, deleteMemory } =
    useMemories()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isClearConfirmed, setIsClearConfirmed] = useState(false)
  const didFetchRef = useRef(false)

  useEffect(() => {
    if (!didFetchRef.current) {
      didFetchRef.current = true
      void fetchAll(0)
    }
  }, [fetchAll])

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      void fetchAll(0)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    void searchMemories(searchQuery.trim())
  }, [searchQuery, fetchAll, searchMemories])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setIsSearching(false)
    void fetchAll(0)
  }, [fetchAll])

  const handleEdit = useCallback(
    (id: string, source: 'knowledge' | 'episodic', content: string) => {
      void updateMemory(id, source, content).then((err) => {
        if (err) toast.error(err)
        else toast.success('Memory updated')
      })
    },
    [updateMemory],
  )

  const handleDelete = useCallback(
    (id: string, source: 'knowledge' | 'episodic') => {
      void deleteMemory(id, source).then((err) => {
        if (err) toast.error(err)
        else toast.success('Memory deleted')
      })
    },
    [deleteMemory],
  )

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const res = await fetch('/api/user/export')
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `iris-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  const handleClear = async () => {
    if (!isClearConfirmed) return
    setIsClearing(true)
    try {
      const res = await fetch('/api/user/clear-memory', { method: 'POST' })
      if (!res.ok) throw new Error('Clear failed')
      setIsClearConfirmed(false)
      void fetchAll(0)
      toast.success('Memory cleared')
    } finally {
      setIsClearing(false)
    }
  }

  const filteredItems = useMemo(
    () => items.filter((item) => activeFilter === 'all' || item.source === activeFilter),
    [items, activeFilter],
  )

  return (
    <div className='flex max-h-(--max-height-settings) flex-col'>
      {/* Header */}
      <div className='flex flex-col gap-3 p-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Brain className='text-muted-foreground size-4' />
          <h3 className='text-foreground text-sm font-medium'>Memory</h3>
        </div>

        {/* Search */}
        <div className='flex gap-2'>
          <div className='relative flex-1'>
            <Search className='text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              type='search'
              enterKeyHint='search'
              autoComplete='off'
              placeholder='Search memories...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
              className='h-8 pl-8 text-sm'
            />
            {isSearching ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                onClick={handleClearSearch}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
              >
                <X className='size-3.5' />
              </Button>
            ) : null}
          </div>
          <Button size='sm' variant='outline' className='h-8' onClick={handleSearch}>
            Search
          </Button>
        </div>

        {/* Filter tabs */}
        <div className='flex gap-1'>
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.value}
              size='sm'
              variant={activeFilter === tab.value ? 'default' : 'ghost'}
              className='h-7 px-3 text-xs'
              onClick={() => setActiveFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Memory list */}
      <ScrollArea className='flex-1 px-4'>
        <div className='flex flex-col gap-2 pb-2'>
          {isLoading && items.length === 0 ? (
            <div className='text-muted-foreground flex items-center justify-center py-8 text-sm'>
              <Loader2 className='mr-2 size-4 animate-spin' />
              Loading...
            </div>
          ) : null}

          {!isLoading && filteredItems.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              {isSearching ? 'No matching memories found.' : 'No memories stored yet.'}
            </div>
          ) : null}

          {filteredItems.map((item) => (
            <MemoryItemCard
              key={item.data.id}
              item={item}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}

          {hasMore && !isLoading && filteredItems.length > 0 ? (
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground mx-auto'
              onClick={() => {
                void fetchAll(items.length)
              }}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </ScrollArea>

      {/* Footer: export + clear */}
      <div className='border-border/40 flex flex-col gap-3 border-t p-4'>
        <details className='group'>
          <summary className='text-muted-foreground flex cursor-pointer items-center gap-1 text-xs'>
            <ChevronDown className='size-3 transition-transform group-open:rotate-180' />
            Data management
          </summary>
          <div className='mt-3 flex flex-col gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='w-fit'
              disabled={isExporting}
              onClick={() => {
                void handleExport()
              }}
            >
              {isExporting ? (
                <>
                  <Loader2 className='mr-2 size-3 animate-spin' />
                  Preparing...
                </>
              ) : (
                <>
                  <Download className='mr-2 size-3' />
                  Export data
                </>
              )}
            </Button>
            {isClearConfirmed ? (
              <div className='flex flex-col gap-2'>
                <p className='text-destructive text-xs font-medium'>
                  This will delete all memories. Cannot be undone.
                </p>
                <div className='flex gap-2'>
                  <Button
                    variant='destructive'
                    size='sm'
                    disabled={isClearing}
                    onClick={() => {
                      void handleClear()
                    }}
                  >
                    {isClearing ? <Loader2 className='size-3 animate-spin' /> : 'Confirm'}
                  </Button>
                  <Button variant='outline' size='sm' onClick={() => setIsClearConfirmed(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant='outline'
                size='sm'
                className='text-destructive hover:text-destructive w-fit'
                onClick={() => setIsClearConfirmed(true)}
              >
                <Trash2 className='mr-2 size-3' />
                Clear all memory
              </Button>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
