import { env } from '@/lib/env'
import { createClient } from '@/lib/supabase/client'

/** Module-level cached browser client — avoids re-creating per call. */
let cachedClient: ReturnType<typeof createClient> | null = null

function getClient(): ReturnType<typeof createClient> {
  cachedClient ??= createClient()
  return cachedClient
}

/**
 * Call a Supabase Edge Function from the browser using the current session token.
 * Routes CRUD through edge functions which handle business logic (versioning, embeddings).
 *
 * When `accessToken` is provided, the session fetch is skipped (useful when
 * multiple calls fire in parallel from the same hook).
 */
export async function callEdgeFunction<T = unknown>(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  accessToken?: string,
): Promise<{ data: T | null; error?: string }> {
  let token = accessToken
  if (!token) {
    const supabase = getClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return { data: null, error: 'Not authenticated' }
    token = session.access_token
  }

  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) }),
  })

  if (res.status === 204) return { data: null }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as Record<
      string,
      unknown
    >
    const errMsg = typeof err['error'] === 'string' ? err['error'] : res.statusText
    return { data: null, error: errMsg }
  }

  const json = (await res.json()) as Record<string, unknown>
  return { data: (json['data'] as T) ?? (json as T) }
}
