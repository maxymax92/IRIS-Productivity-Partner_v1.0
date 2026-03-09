import '@supabase/functions-js/edge-runtime.d.ts'

import * as webpush from '@negrel/webpush'

import { handleCors, createLogger, errors, success, withRetry, createSupabaseClient } from '../_shared/index.ts'

const log = createLogger('push-send')

const BATCH_LIMIT = 50

/**
 * Push-send Edge Function
 *
 * Sends pending push notifications to all subscribed devices for a given user.
 * Called by pg_cron via pg_net, or directly from other edge functions.
 *
 * Auth: Requires service-role key (internal use only, not user-facing).
 */

let appServer: webpush.ApplicationServer | null = null

async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (appServer) return appServer

  const keysJson = Deno.env.get('VAPID_KEYS_JSON')
  if (!keysJson) throw new Error('VAPID_KEYS_JSON secret is not set')

  const contactEmail = Deno.env.get('VAPID_EMAIL') ?? 'mailto:noreply@example.com'
  const vapidKeys = await webpush.importVapidKeys(
    JSON.parse(keysJson) as webpush.ExportedVapidKeys,
  )

  appServer = await webpush.ApplicationServer.new({
    contactInformation: contactEmail,
    vapidKeys,
  })

  return appServer
}

interface PushResult {
  notificationId: string
  endpoint: string
  ok: boolean
  stale: boolean
  error?: string
}

async function sendSinglePush(
  server: webpush.ApplicationServer,
  notification: { id: string; title: string; body: string | null; action_url: string | null },
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<PushResult> {
  try {
    const subscriber = await server.subscribe({
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    })

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body ?? '',
      icon: '/icon-192x192.png',
      data: { url: notification.action_url ?? '/' },
    })

    await withRetry(
      () => subscriber.pushTextMessage(payload, {}),
      { label: 'push', maxAttempts: 3, minTimeout: 500 },
    )
    return { notificationId: notification.id, endpoint: sub.endpoint, ok: true, stale: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isStale = message.includes('410') || message.includes('404')
    return { notificationId: notification.id, endpoint: sub.endpoint, ok: false, stale: isStale, error: message }
  }
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  // Only allow POST
  if (req.method !== 'POST') {
    return errors.badRequest('Method not allowed')
  }

  // Verify service-role auth (internal calls only)
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const expectedToken = `Bearer ${serviceKey ?? ''}`
  if (!serviceKey || authHeader !== expectedToken) {
    return errors.unauthorized('Service role key required')
  }

  try {
    let server: webpush.ApplicationServer
    try {
      server = await getAppServer()
    } catch (vapidErr) {
      const msg = vapidErr instanceof Error ? vapidErr.message : String(vapidErr)
      log.error('VAPID initialization failed', vapidErr)
      return success({ sent: 0, message: `VAPID config error: ${msg}` })
    }

    const supabase = createSupabaseClient()

    // Fetch unsent notifications (limit batch to prevent timeout)
    const { data: pending, error: fetchErr } = await supabase
      .from('notifications')
      .select('id, title, body, action_url, user_id')
      .eq('push_sent', false)
      .limit(BATCH_LIMIT)

    if (fetchErr) {
      log.error('Failed to fetch pending notifications', fetchErr)
      return errors.internal('Failed to fetch notifications')
    }

    if (!pending || pending.length === 0) {
      return success({ sent: 0, message: 'No pending notifications' })
    }

    // Collect unique user IDs
    const userIds = [...new Set(pending.map((n) => n.user_id))]

    // Fetch push subscriptions for these users
    const { data: subscriptions, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)

    if (subErr) {
      log.error('Failed to fetch subscriptions', subErr)
      return errors.internal('Failed to fetch subscriptions')
    }

    if (!subscriptions || subscriptions.length === 0) {
      log.info('No push subscriptions found for pending notifications')
      // Mark all as sent to prevent infinite retry (no devices to deliver to)
      const pendingIds = pending.map((n) => n.id)
      await supabase
        .from('notifications')
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .in('id', pendingIds)
      return success({ sent: 0, message: 'No subscriptions' })
    }

    // Group subscriptions by user_id
    const subsByUser = new Map<string, typeof subscriptions>()
    for (const sub of subscriptions) {
      const existing = subsByUser.get(sub.user_id) ?? []
      existing.push(sub)
      subsByUser.set(sub.user_id, existing)
    }

    // Build all push operations (notification × subscription pairs)
    const pushOps: Array<Promise<PushResult>> = []
    for (const notification of pending) {
      const userSubs = subsByUser.get(notification.user_id) ?? []
      for (const sub of userSubs) {
        pushOps.push(sendSinglePush(server, notification, sub))
      }
    }

    // Execute all push operations concurrently
    const results = await Promise.allSettled(pushOps)

    let sentCount = 0
    let failCount = 0
    const staleEndpoints: string[] = []

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.ok) {
          sentCount++
        } else {
          failCount++
          if (result.value.stale) {
            staleEndpoints.push(result.value.endpoint)
          }
          log.error(`Push failed for endpoint ${result.value.endpoint}: ${result.value.error ?? 'unknown'}`)
        }
      } else {
        failCount++
        log.error('Push operation rejected', result.reason)
      }
    }

    // Track which notifications had at least one successful push
    const successIds = new Set<string>()
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) {
        successIds.add(result.value.notificationId)
      }
    }

    // Mark only successfully delivered notifications as sent
    if (successIds.size > 0) {
      await supabase
        .from('notifications')
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .in('id', [...successIds])
    }

    // Mark remaining notifications as sent — covers users with zero subscriptions
    // and users whose every subscription was stale (prevents infinite retry)
    const unsentIds = pending.map((n) => n.id).filter((id) => !successIds.has(id))
    if (unsentIds.length > 0) {
      await supabase
        .from('notifications')
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .in('id', unsentIds)
    }

    // Clean up stale subscriptions
    if (staleEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', staleEndpoints)

      log.info(`Cleaned up ${String(staleEndpoints.length)} stale subscriptions`)
    }

    log.info(`Push batch complete: ${String(sentCount)} sent, ${String(failCount)} failed`)
    return success({ sent: sentCount, failed: failCount, staleRemoved: staleEndpoints.length })
  } catch (err) {
    log.error('Push send error', err)
    return errors.internal('Push send failed')
  }
})
