export const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ??
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ??
    '',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'] ?? '',
} as const

export const serverEnv = {
  SUPABASE_URL: process.env['SUPABASE_URL'] ?? env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env['SUPABASE_SECRET_KEY'] ?? '',
  SUPABASE_ANON_KEY: process.env['SUPABASE_ANON_KEY'] ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  /** Persistent volume mount path for SDK session storage (e.g. '/data' on Railway). */
  SESSION_VOLUME_PATH: process.env['SESSION_VOLUME_PATH'] ?? '',
} as const

export function requireServerEnv() {
  if (!serverEnv.SUPABASE_SECRET_KEY) {
    throw new Error('Missing required server environment variable: SUPABASE_SECRET_KEY')
  }
  return {
    SUPABASE_URL: serverEnv.SUPABASE_URL,
    SUPABASE_SECRET_KEY: serverEnv.SUPABASE_SECRET_KEY,
  }
}
