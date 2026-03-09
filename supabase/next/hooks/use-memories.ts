'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { callEdgeFunction } from '@/lib/supabase/edge'

export interface KnowledgeMemory {
  id: string
  content: string
  content_type: string
  source_id: string | null
  source_table: string | null
  meta: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface SemanticMemory {
  id: string
  content: string
  memory_type: string
  importance: number
  source_type: string | null
  source_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type MemoryItem =
  | { source: 'knowledge'; data: KnowledgeMemory }
  | { source: 'episodic'; data: SemanticMemory }

const PAGE_SIZE = 20

export function useMemories() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const fetchAll = useCallback(async (offset = 0) => {
    setIsLoading(true)
    try {
      const [kRes, sRes] = await Promise.all([
        callEdgeFunction<KnowledgeMemory[]>(`memory?limit=${PAGE_SIZE}&offset=${offset}`, 'GET'),
        callEdgeFunction<SemanticMemory[]>(
          `memory/semantic?limit=${PAGE_SIZE}&offset=${offset}`,
          'GET',
        ),
      ])

      const knowledge: MemoryItem[] = (kRes.data ?? []).map((d) => ({
        source: 'knowledge' as const,
        data: d,
      }))
      const episodic: MemoryItem[] = (sRes.data ?? []).map((d) => ({
        source: 'episodic' as const,
        data: d,
      }))

      const merged = [...knowledge, ...episodic].sort(
        (a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime(),
      )

      if (offset === 0) {
        setItems(merged)
      } else {
        setItems((prev) => [...prev, ...merged])
      }
      setHasMore((kRes.data ?? []).length >= PAGE_SIZE || (sRes.data ?? []).length >= PAGE_SIZE)
    } catch {
      toast.error('Failed to load memories')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const searchMemories = useCallback(async (query: string) => {
    setIsLoading(true)
    try {
      const res = await callEdgeFunction<
        Array<{
          id: string
          content: string
          content_type: string
          similarity: number
          source: 'knowledge' | 'episodic'
          created_at: string
        }>
      >('memory/search', 'POST', { query, limit: 50, threshold: 0.3 })

      const results: MemoryItem[] = (res.data ?? []).map((r) =>
        r.source === 'knowledge'
          ? {
              source: 'knowledge' as const,
              data: {
                id: r.id,
                content: r.content,
                content_type: r.content_type,
                source_id: null,
                source_table: null,
                meta: null,
                created_at: r.created_at,
                updated_at: r.created_at,
              },
            }
          : {
              source: 'episodic' as const,
              data: {
                id: r.id,
                content: r.content,
                memory_type: r.content_type,
                importance: 0,
                source_type: null,
                source_id: null,
                metadata: null,
                created_at: r.created_at,
                updated_at: r.created_at,
              },
            },
      )
      setItems(results)
      setHasMore(false)
    } catch {
      toast.error('Failed to search memories')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateMemory = useCallback(
    async (id: string, source: 'knowledge' | 'episodic', content: string) => {
      const path = source === 'knowledge' ? `memory/${id}` : `memory/semantic/${id}`
      const body = { content }
      const res = await callEdgeFunction(path, 'PATCH', body)
      if (res.error) return res.error
      setItems((prev) =>
        prev.map((item): MemoryItem => {
          if (item.data.id !== id) return item
          if (item.source === 'knowledge') {
            return { source: 'knowledge', data: { ...item.data, content } }
          }
          return { source: 'episodic', data: { ...item.data, content } }
        }),
      )
      return null
    },
    [],
  )

  const deleteMemory = useCallback(async (id: string, source: 'knowledge' | 'episodic') => {
    const path = source === 'knowledge' ? `memory/${id}` : `memory/semantic/${id}`
    const res = await callEdgeFunction(path, 'DELETE')
    if (res.error) return res.error
    setItems((prev) => prev.filter((item) => item.data.id !== id))
    return null
  }, [])

  return { items, isLoading, hasMore, fetchAll, searchMemories, updateMemory, deleteMemory }
}
