'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { createClient } from '@/lib/supabase/client'
import type { Tables, TablesUpdate } from '@/types/database.types'

export type UserSettings = Tables<'user_settings'>

/** Fields that change rapidly during navigation — debounce writes */
const DEBOUNCED_FIELDS = new Set<string>(['active_tab', 'active_conversation_id'])

const DEBOUNCE_MS = 500

/** Store reference — mutated directly, read via getSnapshot */
let settingsRef: UserSettings | null = null
const listeners = new Set<() => void>()

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getSnapshot(): UserSettings | null {
  return settingsRef
}

function getServerSnapshot(): UserSettings | null {
  return null
}

/** Notify subscribers after mutating settingsRef. Uses queueMicrotask to avoid blocking. */
function notifyListeners(): void {
  queueMicrotask(() => {
    listeners.forEach((cb) => cb())
  })
}

/** Read current settings outside React (e.g. in Realtime handlers). */
export function getSettingsSnapshot(): UserSettings | null {
  return settingsRef
}

type FeaturesUpdater = (prev: UserSettings['features']) => UserSettings['features']

type SettingsUpdates = Partial<TablesUpdate<'user_settings'>> & {
  features?: UserSettings['features'] | FeaturesUpdater
}

interface UserSettingsContextValue {
  subscribe: typeof subscribe
  getSnapshot: typeof getSnapshot
  getServerSnapshot: typeof getServerSnapshot
  isLoading: boolean
  updateSettings: (updates: SettingsUpdates) => void
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null)

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [isLoading, setIsLoading] = useState(true)
  const userIdRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdatesRef = useRef<Partial<TablesUpdate<'user_settings'>>>({})

  const applySettings = useCallback((next: UserSettings | null) => {
    settingsRef = next
    notifyListeners()
  }, [])

  // Fetch settings via RPC (get-or-create pattern)
  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true)
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setIsLoading(false)
          return
        }
        userIdRef.current = user.id

        const { data, error } = await supabase.rpc('get_or_create_user_settings', {
          p_user_id: user.id,
        })

        if (error) {
          console.error('[use-user-settings] RPC error', error.message)
          setIsLoading(false)
          return
        }

        const row = Array.isArray(data) ? data[0] : data
        if (row) applySettings(row as UserSettings)
      } catch (err) {
        console.error('[use-user-settings] fetch error', err)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchSettings()
  }, [supabase, applySettings])

  // Realtime subscription for cross-device sync.
  // user_id filter is a safeguard — Realtime may emit for other users if channel config changes.
  useEffect(() => {
    const channel = supabase
      .channel('user-settings-realtime')
      .on<UserSettings>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_settings' },
        (payload) => {
          const row = payload.new
          if (row.user_id !== userIdRef.current) return
          // Preserve locally pending debounced fields — Realtime delivers stale
          // values for fields that haven't been flushed to the DB yet.
          const pending = pendingUpdatesRef.current
          const pendingKeys = Object.keys(pending)
          if (pendingKeys.length > 0 && settingsRef) {
            const merged = { ...row }
            for (const key of pendingKeys) {
              ;(merged as Record<string, unknown>)[key] = (settingsRef as Record<string, unknown>)[
                key
              ]
            }
            applySettings(merged as UserSettings)
            return
          }
          applySettings(row)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, applySettings])

  // Flush pending debounced updates to Supabase
  const flushPendingUpdates = useCallback(async () => {
    const updates = pendingUpdatesRef.current
    if (Object.keys(updates).length === 0) return
    pendingUpdatesRef.current = {}

    const userId = userIdRef.current
    if (!userId) return

    const { error } = await supabase.from('user_settings').update(updates).eq('user_id', userId)

    if (error) {
      console.error('[use-user-settings] update error', error.message)
    }
  }, [supabase])

  // Cleanup debounce timer on unmount.
  // flushPendingUpdates is not awaited — fire-and-forget avoids blocking unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        void flushPendingUpdates()
      }
    }
  }, [flushPendingUpdates])

  const updateSettings = useCallback(
    (updates: SettingsUpdates) => {
      const prev = settingsRef
      const resolvedUpdates = { ...updates }
      if (prev && updates.features !== undefined) {
        resolvedUpdates.features =
          typeof updates.features === 'function'
            ? (updates.features as FeaturesUpdater)(prev.features)
            : ({
                ...((prev.features as Record<string, unknown>) ?? {}),
                ...(updates.features as Record<string, unknown>),
              } as UserSettings['features'])
      } else if (typeof updates.features === 'function') {
        // Cannot resolve without prev; omit to avoid writing a function to DB
        delete resolvedUpdates.features
      }
      if (prev) {
        const merged = { ...prev, ...resolvedUpdates } as UserSettings
        settingsRef = merged
        notifyListeners()
      }

      // Separate immediate vs debounced fields; use resolved values for DB write.
      const immediate: Partial<TablesUpdate<'user_settings'>> = {}
      const debounced: Partial<TablesUpdate<'user_settings'>> = {}
      for (const [key, value] of Object.entries(resolvedUpdates)) {
        if (DEBOUNCED_FIELDS.has(key)) {
          debounced[key as keyof TablesUpdate<'user_settings'>] = value as never
        } else {
          immediate[key as keyof TablesUpdate<'user_settings'>] = value as never
        }
      }

      // Write immediate fields right away
      if (Object.keys(immediate).length > 0) {
        const userId = userIdRef.current
        if (userId) {
          void supabase
            .from('user_settings')
            .update(immediate)
            .eq('user_id', userId)
            .then(({ error }) => {
              if (error) console.error('[use-user-settings] immediate update error', error.message)
            })
        }
      }

      // Accumulate debounced fields and reset timer
      if (Object.keys(debounced).length > 0) {
        Object.assign(pendingUpdatesRef.current, debounced)

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null
          void flushPendingUpdates()
        }, DEBOUNCE_MS)
      }
    },
    [supabase, flushPendingUpdates],
  )

  const value = useMemo(
    () => ({ subscribe, getSnapshot, getServerSnapshot, isLoading, updateSettings }),
    [isLoading, updateSettings],
  )

  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>
}

/** Returns only updateSettings — does not subscribe to settings. Use in nav components. */
export function useUpdateSettings(): (updates: Partial<TablesUpdate<'user_settings'>>) => void {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useUpdateSettings must be used within UserSettingsProvider')
  return ctx.updateSettings
}

/** Full settings — re-renders when any field changes. Use for preference/modals. */
export function useUserSettings(): {
  settings: UserSettings | null
  isLoading: boolean
  updateSettings: (updates: Partial<TablesUpdate<'user_settings'>>) => void
} {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider')
  const settings = useSyncExternalStore(ctx.subscribe, ctx.getSnapshot, ctx.getServerSnapshot)
  return { settings, isLoading: ctx.isLoading, updateSettings: ctx.updateSettings }
}

type NavFieldKey = 'active_tab' | 'active_conversation_id'

function getField<K extends NavFieldKey>(
  settings: UserSettings | null,
  field: K,
): UserSettings[K] | null {
  if (!settings) return null
  return (settings[field] as UserSettings[K]) ?? null
}

/** Single-field subscription — re-renders only when this field changes. Use for nav state. */
export function useSettingsField<K extends NavFieldKey>(field: K): UserSettings[K] | null {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useSettingsField must be used within UserSettingsProvider')
  return useSyncExternalStore(
    ctx.subscribe,
    () => getField(ctx.getSnapshot(), field),
    () => getField(ctx.getServerSnapshot(), field),
  )
}
