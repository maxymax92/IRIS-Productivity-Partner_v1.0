'use client'

import { useEffect, useRef } from 'react'

import { useUserSettings } from '@/hooks/use-user-settings'
import { detectTimezone } from '@/lib/utils'

/**
 * Auto-detect timezone on first visit and write it to `user_settings.timezone`.
 *
 * Once a non-default timezone is stored (by auto-detect or manual selection),
 * subsequent mounts respect the stored value and do not overwrite it.
 *
 * All reads/writes go through `useUserSettings()` — no direct `users` table access.
 */
export function useTimezoneSync() {
  const { settings, updateSettings } = useUserSettings()
  const didSync = useRef(false)

  useEffect(() => {
    if (!settings || didSync.current) return

    const stored = settings.timezone
    // Only auto-detect when timezone is unset (null or DB default 'UTC')
    if (!stored || stored === 'UTC') {
      const detected = detectTimezone()
      if (detected !== 'UTC') {
        updateSettings({ timezone: detected })
      }
    }

    didSync.current = true
  }, [settings, updateSettings])
}
