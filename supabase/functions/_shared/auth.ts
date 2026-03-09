import type { User } from '@supabase/supabase-js'
import { errors } from './response.ts'
import { createSupabaseClientWithAuth } from './supabase.ts'

export interface AuthContext {
  user: User
  userId: string
  supabase: ReturnType<typeof createSupabaseClientWithAuth>
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: Response }

/**
 * Validates JWT from Authorization header and returns authenticated context.
 * Uses the shared Supabase client from supabase.ts to avoid duplication.
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, response: errors.unauthorized('Missing token') }
  }

  const token = authHeader.replace('Bearer ', '')
  const supabase = createSupabaseClientWithAuth(authHeader)

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return { ok: false, response: errors.unauthorized('Invalid token') }
  }

  return { ok: true, ctx: { user, userId: user.id, supabase } }
}
