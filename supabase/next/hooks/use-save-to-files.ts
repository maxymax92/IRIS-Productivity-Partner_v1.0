'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'

import { FILES_CHANGED_EVENT } from '@/hooks/use-project-files'

export function useSaveToFiles() {
  const saveContent = useCallback(async (filename: string, content: string): Promise<boolean> => {
    try {
      const blob = new Blob([content], { type: 'text/plain' })
      const file = new File([blob], filename, { type: 'text/plain' })

      const formData = new FormData()
      formData.set('file', file)
      formData.set('path', filename)

      const res = await fetch('/api/user/files', {
        method: 'POST',
        body: formData,
      })
      const data = (await res.json()) as { error?: string }

      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Failed to save file')
        return false
      }

      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
      toast.success(`Saved ${filename}`)
      return true
    } catch {
      toast.error('Failed to save file')
      return false
    }
  }, [])

  return { saveContent }
}
