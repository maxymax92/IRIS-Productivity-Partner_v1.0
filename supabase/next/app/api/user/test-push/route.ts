import { NextResponse } from 'next/server'

import { requireServerEnv } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

interface PushSendResponse {
  data?: {
    sent?: number
    failed?: number
    message?: string
  }
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if user has any push subscriptions before proceeding
  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)

  if (subErr) {
    return NextResponse.json({ error: 'Failed to check subscriptions' }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json(
      {
        error:
          'No push subscriptions found. Try disabling and re-enabling push notifications in settings.',
      },
      { status: 422 },
    )
  }

  const { error } = await supabase.from('notifications').insert({
    user_id: user.id,
    title: 'Test Notification',
    body: 'Push notifications are working!',
    type: 'system' as const,
    action_url: '/',
    source_type: 'test',
    push_sent: false,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Trigger push-send to deliver immediately
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = requireServerEnv()
  try {
    const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({ source: 'test-push' }),
    })

    if (!pushRes.ok) {
      return NextResponse.json(
        { error: `Push service error (${String(pushRes.status)})` },
        { status: 502 },
      )
    }

    // Read the actual delivery result — push-send wraps in { data: { ... } }
    const body = (await pushRes.json().catch(() => ({}))) as PushSendResponse
    const result = body.data

    if (!result || result.sent === 0) {
      return NextResponse.json(
        {
          error:
            result?.message ?? 'Push delivery failed — check VAPID key configuration on Supabase',
          sent: 0,
          failed: result?.failed ?? 0,
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      sent: result.sent ?? 0,
      failed: result.failed ?? 0,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to contact push service' }, { status: 502 })
  }
}
