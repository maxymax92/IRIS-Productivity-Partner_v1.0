'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useUserSettings } from '@/hooks/use-user-settings'
import { env } from '@/lib/env'
import { createClient } from '@/lib/supabase/client'

type PermissionState = NotificationPermission | 'unsupported'

/** Base64 encoding uses 4-character alignment blocks */
const BASE64_BLOCK_SIZE = 4

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat(
    (BASE64_BLOCK_SIZE - (base64String.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE,
  )
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Detects whether the app is running as a standalone PWA (added to home screen).
 * On iOS, push notifications only work in standalone mode (iOS 16.4+).
 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari standalone
  if (
    'standalone' in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  ) {
    return true
  }
  // Standard display-mode check (Chrome, Firefox, Edge, Safari 17.4+)
  return window.matchMedia('(display-mode: standalone)').matches
}

/** Detects iOS/iPadOS devices where push requires standalone PWA mode. */
function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Safely extract the PushManager from a ServiceWorkerRegistration. */
function getPushManager(registration: ServiceWorkerRegistration): PushManager {
  return (registration as unknown as { pushManager: PushManager }).pushManager
}

export function usePushNotifications() {
  const { settings, updateSettings } = useUserSettings()
  const supabase = useMemo(() => createClient(), [])
  const [permission, setPermission] = useState<PermissionState>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  // Check current state on mount
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setPermission('unsupported')
      return
    }

    setPermission(Notification.permission)

    // Register service worker and check existing subscription
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async (registration) => {
        registrationRef.current = registration
        const pm: PushManager = getPushManager(registration)
        const subscription: PushSubscription | null = await pm.getSubscription()
        setIsSubscribed(subscription !== null)
      })
      .catch((err: unknown) => {
        console.error('[push] Service worker registration failed:', err)
      })
  }, [])

  const subscribe = useCallback(async () => {
    if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      toast.error('Push notifications are not configured')
      return false
    }

    setIsLoading(true)
    try {
      // Request notification permission
      const result = await Notification.requestPermission()
      setPermission(result)

      if (result !== 'granted') {
        toast.error('Notification permission denied')
        return false
      }

      // Get or register service worker
      let registration = registrationRef.current
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        registrationRef.current = registration
      }

      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready

      // Subscribe to push
      const pm: PushManager = getPushManager(registration)
      const keyBytes = urlBase64ToUint8Array(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
      const subscription: PushSubscription = await pm.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      })

      // Extract keys — PushSubscriptionJSON.keys is typed as Record<string, string> | undefined
      const subJson: PushSubscriptionJSON = subscription.toJSON()
      const keys = subJson.keys
      const p256dh = keys?.['p256dh']
      const authKey = keys?.['auth']
      if (!p256dh || !authKey) {
        toast.error('Failed to get push subscription keys')
        return false
      }

      // Save subscription to Supabase
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not authenticated')
        return false
      }

      const endpoint: string = subscription.endpoint
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth: authKey,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'user_id,endpoint' },
      )

      if (error) {
        console.error('[push] Failed to save subscription:', error)
        toast.error('Failed to save push subscription')
        return false
      }

      // Update user settings
      updateSettings({ push_notifications: true })
      setIsSubscribed(true)
      toast.success('Push notifications enabled')
      return true
    } catch (err) {
      console.error('[push] Subscribe error:', err)
      toast.error('Failed to enable push notifications')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [supabase, updateSettings])

  const unsubscribe = useCallback(async () => {
    setIsLoading(true)
    try {
      const registration = registrationRef.current
      if (registration) {
        const pm: PushManager = getPushManager(registration)
        const subscription: PushSubscription | null = await pm.getSubscription()
        if (subscription) {
          // Remove from Supabase first
          const endpoint: string = subscription.endpoint
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)

          // Then unsubscribe from push
          await subscription.unsubscribe()
        }
      }

      updateSettings({ push_notifications: false })
      setIsSubscribed(false)
      toast.success('Push notifications disabled')
    } catch (err) {
      console.error('[push] Unsubscribe error:', err)
      toast.error('Failed to disable push notifications')
    } finally {
      setIsLoading(false)
    }
  }, [supabase, updateSettings])

  const standalone = useMemo(() => isStandalone(), [])
  const iOS = useMemo(() => isIOSDevice(), [])

  return {
    permission,
    isSubscribed,
    isLoading,
    isStandalone: standalone,
    isIOS: iOS,
    isPushSupported: permission !== 'unsupported',
    isPushEnabled: settings?.push_notifications ?? false,
    subscribe,
    unsubscribe,
  }
}
