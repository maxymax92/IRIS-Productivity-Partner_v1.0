import '@supabase/functions-js/edge-runtime.d.ts'

import { handleCors, createLogger, errors, success, createSupabaseClient } from '../_shared/index.ts'

const log = createLogger('reminder-check')

const BATCH_LIMIT = 50

/**
 * Reminder Check Edge Function
 *
 * Processes due reminders by creating notifications and triggering push delivery.
 * Designed to be called on a cron schedule (e.g., every 1–5 minutes).
 *
 * Auth: Requires service-role key (internal use only).
 *
 * Flow:
 * 1. Query reminders where remind_at <= now() and status = 'pending'
 *    (skipping snoozed reminders where snoozed_until > now())
 * 2. For each due reminder: insert a notification row
 * 3. Handle recurrence: compute next_occurrence and reset to pending, or mark as sent
 * 4. Trigger push-send to deliver all pending notifications
 */

/** Simple recurrence computation — returns the next occurrence ISO string or null. */
function computeNextOccurrence(remindAt: string, rule: string): string | null {
  const date = new Date(remindAt)
  const lower = rule.toLowerCase().trim()

  if (lower === 'daily') {
    date.setDate(date.getDate() + 1)
    return date.toISOString()
  }

  if (lower === 'weekdays') {
    do {
      date.setDate(date.getDate() + 1)
    } while (date.getDay() === 0 || date.getDay() === 6)
    return date.toISOString()
  }

  if (lower.startsWith('every ')) {
    const dayName = lower.replace('every ', '').trim()
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const targetDay = days.indexOf(dayName)
    if (targetDay >= 0) {
      do {
        date.setDate(date.getDate() + 1)
      } while (date.getDay() !== targetDay)
      return date.toISOString()
    }
  }

  if (lower === 'weekly') {
    date.setDate(date.getDate() + 7)
    return date.toISOString()
  }

  if (lower.startsWith('monthly')) {
    date.setMonth(date.getMonth() + 1)
    return date.toISOString()
  }

  // Unknown rule — don't recur
  return null
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errors.badRequest('Method not allowed')
  }

  // Verify service-role auth (internal/cron calls only)
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const expectedToken = `Bearer ${serviceKey ?? ''}`
  if (!serviceKey || authHeader !== expectedToken) {
    return errors.unauthorized('Service role key required')
  }

  try {
    const supabase = createSupabaseClient()
    const now = new Date().toISOString()

    // Fetch due reminders: pending AND (not snoozed OR snooze expired)
    const { data: dueReminders, error: fetchErr } = await supabase
      .from('reminders')
      .select('id, user_id, title, body, remind_at, recurrence_rule, snoozed_until')
      .eq('status', 'pending')
      .lte('remind_at', now)
      .limit(BATCH_LIMIT)

    if (fetchErr) {
      log.error('Failed to fetch due reminders', fetchErr)
      return errors.internal('Failed to fetch reminders')
    }

    // Also fetch snoozed reminders whose snooze has expired
    const { data: snoozedReminders, error: snoozeErr } = await supabase
      .from('reminders')
      .select('id, user_id, title, body, remind_at, recurrence_rule, snoozed_until')
      .eq('status', 'snoozed')
      .lte('snoozed_until', now)
      .limit(BATCH_LIMIT)

    if (snoozeErr) {
      log.error('Failed to fetch snoozed reminders', snoozeErr)
    }

    const allDue = [...(dueReminders ?? []), ...(snoozedReminders ?? [])]

    if (allDue.length === 0) {
      return success({ processed: 0, message: 'No due reminders' })
    }

    // Filter out reminders still within snooze period
    const actionable = allDue.filter(
      (r) => !r.snoozed_until || new Date(r.snoozed_until) <= new Date(now),
    )

    if (actionable.length === 0) {
      return success({ processed: 0, message: 'No actionable reminders' })
    }

    // Step 1: Create all notifications in parallel
    const notifResults = await Promise.all(
      actionable.map((reminder) =>
        supabase
          .from('notifications')
          .insert({
            user_id: reminder.user_id,
            title: reminder.title,
            body: reminder.body,
            type: 'reminder',
            action_url: '/chat',
            source_id: reminder.id,
            source_type: 'reminder',
            push_sent: false,
          })
          .then(({ error: notifErr }) => ({ reminder, notifErr })),
      ),
    )

    // Step 2: Update reminder statuses in parallel (only for successfully notified ones)
    const statusUpdates = notifResults
      .filter(({ notifErr }) => {
        if (notifErr) {
          log.error('Failed to create notification', notifErr)
          return false
        }
        return true
      })
      .map(({ reminder }) => {
        if (reminder.recurrence_rule) {
          const nextAt = computeNextOccurrence(reminder.remind_at, reminder.recurrence_rule)
          if (nextAt) {
            return supabase
              .from('reminders')
              .update({
                remind_at: nextAt,
                next_occurrence: nextAt,
                snoozed_until: null,
                status: 'pending',
              })
              .eq('id', reminder.id)
          }
        }
        // One-time or unknown recurrence — mark as sent
        return supabase
          .from('reminders')
          .update({ status: 'sent', snoozed_until: null })
          .eq('id', reminder.id)
      })

    await Promise.all(statusUpdates)
    const processedCount = statusUpdates.length

    // Trigger push-send to deliver all pending notifications
    if (processedCount > 0) {
      try {
        const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/push-send`
        const pushRes = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ source: 'reminder-check' }),
        })

        if (!pushRes.ok) {
          log.error(`push-send returned ${String(pushRes.status)}`)
        }
      } catch (pushErr) {
        log.error('Failed to call push-send', pushErr)
      }
    }

    log.info(`Processed ${String(processedCount)} due reminders`)
    return success({ processed: processedCount })
  } catch (err) {
    log.error('Reminder check error', err)
    return errors.internal('Reminder check failed')
  }
})
