/**
 * Shared Supabase client for Edge Functions
 *
 * Edge Functions automatically have access to:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_DB_URL
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Creates a Supabase client for use in Edge Functions.
 * Uses service role key by default for admin operations.
 *
 * @param useServiceRole - If true, uses service role key (bypasses RLS)
 */
export function createSupabaseClient(useServiceRole = true) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not set')

  const supabaseKey = useServiceRole
    ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    : Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseKey) throw new Error(`${useServiceRole ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY'} is not set`)

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Creates a Supabase client with user's JWT for RLS-protected operations.
 *
 * @param authHeader - The Authorization header from the request
 */
export function createSupabaseClientWithAuth(authHeader: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not set')

  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseAnonKey) throw new Error('SUPABASE_ANON_KEY is not set')

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  })
}
