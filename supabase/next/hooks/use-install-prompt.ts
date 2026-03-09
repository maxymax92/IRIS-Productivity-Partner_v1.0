'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Captures the `beforeinstallprompt` event so the app can show a custom
 * "Install" button instead of relying on the browser's default prompt.
 *
 * Returns:
 * - `canInstall` – true when the browser has offered the install prompt
 * - `promptInstall()` – triggers the native install dialog
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  return { canInstall: deferredPrompt !== null, promptInstall }
}
