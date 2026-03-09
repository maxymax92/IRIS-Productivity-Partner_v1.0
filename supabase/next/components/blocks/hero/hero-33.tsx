'use client'

import { ArrowRight } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { ProductTeaser } from '@/components/blocks/hero/product-teaser'
import { signInWithMagicLink, signInWithPassword, signUp } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { UnderlineButton } from '@/components/ui/underline-button'
import { createClient } from '@/lib/supabase/client'

type AuthMode = 'sign-in' | 'sign-up' | 'magic-link'

export default function Hero33() {
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(searchParams.get('login') === 'true')
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGoogleLogin = () => {
    const supabase = createClient()
    void supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'magic-link') {
        const result = await signInWithMagicLink(email)
        if (result.ok) {
          setMessage(result.message)
        } else {
          setError(result.error)
        }
      } else if (mode === 'sign-up') {
        const result = await signUp(email, password)
        if (result.ok) {
          setMessage(result.message)
        } else {
          setError(result.error)
        }
      } else {
        const result = await signInWithPassword(email, password)
        if (!result.ok) {
          setError(result.error)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className='relative overflow-hidden'>
      {/* Ambient glow */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 35%, oklch(from var(--muted-foreground) l c h / 6%) 0%, transparent 70%)',
        }}
      />

      {/* ─── Hero ─── */}
      <div className='relative flex flex-col items-center justify-center px-4 pt-20 pb-16 sm:pt-28 sm:pb-20'>
        <div className='mx-auto max-w-4xl text-center'>
          <p className='text-iris-title tracking-iris-display mb-6 text-6xl font-medium sm:text-7xl md:text-8xl'>
            I R I S
          </p>

          <h1 className='mb-4 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl'>
            Your Productivity Guardian
          </h1>

          <p className='text-muted-foreground mx-auto mb-10 max-w-xl text-xl'>
            A pro-active agentic AI partner to help you focus & reduce cognitive load
          </p>

          <UnderlineButton onClick={() => setOpen(true)} className='text-base'>
            Get Started
            <ArrowRight className='h-4 w-4' />
          </UnderlineButton>
        </div>
      </div>

      <ProductTeaser />

      {/* ─── Login Modal ─── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='bg-surface border-0 p-0 max-sm:inset-auto max-sm:right-3 max-sm:bottom-3 max-sm:left-3 max-sm:m-0 max-sm:w-auto max-sm:max-w-full max-sm:rounded-2xl sm:max-w-md'>
          <DialogTitle className='sr-only'>Sign in to Iris</DialogTitle>
          <DialogDescription className='sr-only'>
            Sign in to get started with Iris.
          </DialogDescription>
          {/* Drag handle — mobile only */}
          <div className='flex justify-center pt-3 sm:hidden'>
            <div className='bg-border/40 h-1 w-10 rounded-full' />
          </div>
          <Card className='border-0 bg-transparent shadow-none'>
            <CardHeader className='space-y-4 pb-4 text-center'>
              <div className='text-foreground/90 text-base font-bold tracking-wide'>I R I S</div>
              <CardTitle className='text-foreground/90 text-lg font-medium tracking-tight'>
                {mode === 'sign-up' ? 'Create your account' : 'Welcome back'}
              </CardTitle>
            </CardHeader>
            <CardContent
              className='space-y-4 px-6 pb-8'
              style={{ paddingBottom: 'max(2rem, var(--spacing-safe-bottom, 0px))' }}
            >
              <Button
                onClick={handleGoogleLogin}
                className='hover:bg-secondary hover:text-secondary-foreground w-full'
                variant='outline'
                size='lg'
              >
                Continue with Google
              </Button>

              <div className='flex items-center gap-3'>
                <Separator className='flex-1' />
                <span className='text-muted-foreground/50 text-xs'>or</span>
                <Separator className='flex-1' />
              </div>

              <form onSubmit={handleEmailSubmit} className='space-y-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='email'>Email</Label>
                  <Input
                    id='email'
                    type='email'
                    placeholder='you@example.com'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                {mode !== 'magic-link' && (
                  <div className='space-y-1.5'>
                    <Label htmlFor='password'>Password</Label>
                    <Input
                      id='password'
                      type='password'
                      placeholder='••••••••'
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                )}

                {error && <p className='text-destructive text-sm'>{error}</p>}
                {message && <p className='text-muted-foreground text-sm'>{message}</p>}

                <Button type='submit' className='w-full' size='lg' disabled={loading}>
                  {loading
                    ? 'Loading...'
                    : mode === 'magic-link'
                      ? 'Send magic link'
                      : mode === 'sign-up'
                        ? 'Create account'
                        : 'Sign in'}
                </Button>
              </form>

              <div className='text-muted-foreground flex flex-col items-center gap-1.5 text-xs'>
                {mode === 'sign-in' && (
                  <>
                    <button
                      type='button'
                      onClick={() => setMode('magic-link')}
                      className='hover:text-foreground'
                    >
                      Sign in with magic link instead
                    </button>
                    <button
                      type='button'
                      onClick={() => setMode('sign-up')}
                      className='hover:text-foreground'
                    >
                      Don&apos;t have an account? Sign up
                    </button>
                  </>
                )}
                {mode === 'sign-up' && (
                  <button
                    type='button'
                    onClick={() => setMode('sign-in')}
                    className='hover:text-foreground'
                  >
                    Already have an account? Sign in
                  </button>
                )}
                {mode === 'magic-link' && (
                  <button
                    type='button'
                    onClick={() => setMode('sign-in')}
                    className='hover:text-foreground'
                  >
                    Sign in with password instead
                  </button>
                )}
              </div>

              <p className='text-muted-foreground/50 text-center text-xs'>
                By continuing, you agree to our Terms of Service
              </p>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>
    </section>
  )
}
