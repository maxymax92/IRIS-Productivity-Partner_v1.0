import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { env, requireServerEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Ignored when called from a Server Component
          }
        },
      },
    },
  )
}

export function createAdminClient() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = requireServerEnv()
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    cookies: {
      getAll() {
        return []
      },
      setAll() {
        /* no-op */
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
