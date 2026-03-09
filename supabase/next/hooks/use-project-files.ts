'use client'

import { useCallback, useEffect, useState } from 'react'

import type { FileTreeNode } from '@/types/files'

export type { FileTreeNode } from '@/types/files'

/** Custom event dispatched when agent file operations complete */
export const FILES_CHANGED_EVENT = 'iris:files-changed'

async function fetchTree(): Promise<{ error: string | null; tree: FileTreeNode[] }> {
  const res = await fetch('/api/user/files')
  const data = (await res.json()) as { error?: string; tree?: FileTreeNode[] }
  if (data.error) return { error: data.error, tree: [] }
  return { error: null, tree: data.tree ?? [] }
}

export function useProjectFiles() {
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    void fetchTree().then(({ error: err, tree: t }) => {
      setError(err)
      setTree(t)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchTree().then(({ error: err, tree: t }) => {
      if (cancelled) return
      setError(err)
      setTree(t)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-refresh when agent file operations complete
  useEffect(() => {
    window.addEventListener(FILES_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(FILES_CHANGED_EVENT, refresh)
  }, [refresh])

  const uploadFile = useCallback(
    async (path: string, file: File): Promise<string | null> => {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('path', path)
      const res = await fetch('/api/user/files', {
        method: 'POST',
        body: formData,
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) return data.error ?? 'Upload failed'
      refresh()
      return null
    },
    [refresh],
  )

  const createFolder = useCallback(
    async (path: string): Promise<string | null> => {
      const res = await fetch('/api/user/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder: true }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) return data.error ?? 'Failed to create folder'
      refresh()
      return null
    },
    [refresh],
  )

  const deletePath = useCallback(
    async (path: string): Promise<string | null> => {
      const res = await fetch(`/api/user/files?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) return data.error ?? 'Failed to delete'
      refresh()
      return null
    },
    [refresh],
  )

  const getSignedUrl = useCallback(async (path: string): Promise<string | null> => {
    const res = await fetch(`/api/user/files?action=signed-url&path=${encodeURIComponent(path)}`)
    const data = (await res.json()) as { url?: string; error?: string }
    if (!res.ok || data.error) return null
    return data.url ?? null
  }, [])

  return { tree, error, loading, refresh, uploadFile, createFolder, deletePath, getSignedUrl }
}
