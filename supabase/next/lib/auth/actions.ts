'use server'

import type { User } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export type AuthResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string }

export async function signInWithGoogle(redirectTo?: string): Promise<AuthResult> {
  const supabase = await createClient()
  const origin = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'
  const callbackUrl = redirectTo
    ? `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`
    : `${origin}/auth/callback`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    console.error('Google sign in error:', error.message)
    return { ok: false, error: error.message }
  }

  if (data.url) {
    redirect(data.url)
  }

  return { ok: false, error: 'No redirect URL returned' }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  redirect('/')
}

export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult<{ message: string }>> {
  const supabase = await createClient()
  const origin = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, message: 'Check your email for the confirmation link!' }
}

export async function signInWithMagicLink(email: string): Promise<AuthResult<{ message: string }>> {
  const supabase = await createClient()
  const origin = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, message: 'Check your email for the magic link!' }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    console.error('Sign out error:', error.message)
    // Still redirect to login even on error
  }

  redirect('/')
}

export async function getCurrentUser(): Promise<AuthResult<{ user: User }>> {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { ok: false, error: error?.message ?? 'Not authenticated' }
  }

  return { ok: true, user }
}
