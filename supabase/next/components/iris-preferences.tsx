'use client'

import { Bell, Calendar, Plug, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { useUserSettings } from '@/hooks/use-user-settings'
import { MODELS, getMaxOutputOptions, getModelOrDefault } from '@/lib/models'
import { detectTimezone } from '@/lib/utils'

const PERSONALITIES = [
  { id: 'default', name: 'Adaptive', description: 'Matches your energy' },
  { id: 'concise', name: 'Concise', description: 'Minimal and direct' },
  { id: 'warm', name: 'Warm', description: 'Encouraging and supportive' },
  { id: 'professional', name: 'Professional', description: 'Formal and business-like' },
] as const

const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'ja-JP', name: 'Japanese' },
] as const

const TIMEZONES = [
  { id: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { id: 'America/Anchorage', label: 'Alaska (AKST)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { id: 'America/Denver', label: 'Mountain (MT)' },
  { id: 'America/Chicago', label: 'Central (CT)' },
  { id: 'America/New_York', label: 'Eastern (ET)' },
  { id: 'America/Halifax', label: 'Atlantic (AT)' },
  { id: 'America/Sao_Paulo', label: 'Brasilia (BRT)' },
  { id: 'Atlantic/Reykjavik', label: 'Iceland (GMT)' },
  { id: 'Europe/London', label: 'London (GMT/BST)' },
  { id: 'Europe/Paris', label: 'Paris (CET)' },
  { id: 'Europe/Berlin', label: 'Berlin (CET)' },
  { id: 'Europe/Helsinki', label: 'Helsinki (EET)' },
  { id: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { id: 'Africa/Cairo', label: 'Cairo (EET)' },
  { id: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  { id: 'Asia/Dubai', label: 'Dubai (GST)' },
  { id: 'Asia/Kolkata', label: 'India (IST)' },
  { id: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { id: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { id: 'Asia/Shanghai', label: 'China (CST)' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { id: 'Asia/Seoul', label: 'Seoul (KST)' },
  { id: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { id: 'Australia/Perth', label: 'Perth (AWST)' },
  { id: 'Pacific/Auckland', label: 'Auckland (NZST)' },
] as const

function getTimezoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date())
    const abbr = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
    return `${city} (${abbr})`
  } catch {
    return tz
  }
}

const DATE_FORMATS = [
  { id: 'MM/DD/YYYY', example: '01/15/2025' },
  { id: 'DD/MM/YYYY', example: '15/01/2025' },
  { id: 'YYYY-MM-DD', example: '2025-01-15' },
] as const

function getPushStatusMessage(push: {
  isPushSupported: boolean
  isStandalone: boolean
  isIOS: boolean
  permission: string
}): string {
  if (!push.isPushSupported) return 'Not supported in this browser'
  if (push.isIOS && !push.isStandalone) return 'Add Iris to your home screen to enable'
  if (push.permission === 'denied') return 'Notifications blocked — check browser settings'
  return 'Receive reminders and alerts'
}

function TimezoneItems() {
  const detected = detectTimezone()
  const isInList = TIMEZONES.some((t) => t.id === detected)
  return (
    <>
      <SelectItem value={detected}>
        {isInList
          ? `${TIMEZONES.find((t) => t.id === detected)?.label} — Detected`
          : `${getTimezoneLabel(detected)} — Detected`}
      </SelectItem>
      {TIMEZONES.filter((t) => t.id !== detected).map((t) => (
        <SelectItem key={t.id} value={t.id}>
          {t.label}
        </SelectItem>
      ))}
    </>
  )
}

function RegionSection({
  language,
  timezone,
  dateFormat,
  timeFormat,
  onUpdate,
}: {
  language: string
  timezone: string
  dateFormat: string
  timeFormat: string
  onUpdate: (patch: Record<string, unknown>) => void
}) {
  return (
    <section className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <Calendar className='text-muted-foreground size-4' />
        <h3 className='text-foreground text-sm font-medium'>Region</h3>
      </div>
      <div className='border-border/40 flex flex-col gap-3 rounded-lg border p-4'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='language'>Language</Label>
          <Select value={language} onValueChange={(v) => onUpdate({ language: v })}>
            <SelectTrigger id='language' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='timezone'>Timezone</Label>
          <Select value={timezone} onValueChange={(v) => onUpdate({ timezone: v })}>
            <SelectTrigger id='timezone' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <TimezoneItems />
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='date-format'>Date format</Label>
          <Select value={dateFormat} onValueChange={(v) => onUpdate({ date_format: v })}>
            <SelectTrigger id='date-format' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.example}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='time-format'>Time format</Label>
          <Select value={timeFormat} onValueChange={(v) => onUpdate({ time_format: v })}>
            <SelectTrigger id='time-format' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='12h'>12-hour (2:30 PM)</SelectItem>
              <SelectItem value='24h'>24-hour (14:30)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}

export function IrisPreferences() {
  const { settings, updateSettings } = useUserSettings()
  const push = usePushNotifications()
  const [isTestLoading, setTestLoading] = useState(false)

  async function handleTestPush() {
    setTestLoading(true)
    try {
      const res = await fetch('/api/user/test-push', { method: 'POST' })
      if (res.ok) {
        toast.success('Test notification sent — check your device')
      } else {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        toast.error(typeof body['error'] === 'string' ? body['error'] : 'Failed to send test')
      }
    } catch {
      toast.error('Network error — could not send test')
    } finally {
      setTestLoading(false)
    }
  }

  if (!settings) return null

  const modelId = settings.model_id ?? 'claude-sonnet-4-6'
  const isExtendedThinking = settings.extended_thinking ?? true
  const maxOutputTokens = settings.max_output_tokens ?? getModelOrDefault(modelId).defaultMaxOutput

  return (
    <div className='flex flex-col gap-6 p-6'>
      <section className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <Settings2 className='text-muted-foreground size-4' />
          <h3 className='text-foreground text-sm font-medium'>Model & AI</h3>
        </div>
        <div className='border-border/40 flex flex-col gap-2 rounded-lg border p-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='model'>Model</Label>
            <Select
              value={modelId}
              onValueChange={(v) => {
                const selected = getModelOrDefault(v)
                updateSettings({
                  model_id: v,
                  max_output_tokens: Math.min(maxOutputTokens, selected.maxOutput),
                })
              }}
            >
              <SelectTrigger id='model' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-between'>
            <div>
              <Label htmlFor='extended-thinking'>Extended thinking</Label>
              <p className='text-muted-foreground text-xs'>Deeper reasoning (costs more tokens)</p>
            </div>
            <Switch
              id='extended-thinking'
              checked={isExtendedThinking}
              onCheckedChange={(v) => updateSettings({ extended_thinking: v })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='max-tokens'>Max output tokens</Label>
            <Select
              value={String(maxOutputTokens)}
              onValueChange={(v) => updateSettings({ max_output_tokens: Number.parseInt(v, 10) })}
            >
              <SelectTrigger id='max-tokens' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getMaxOutputOptions(modelId).map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='personality'>Personality</Label>
            <Select
              value={settings.ai_personality ?? 'default'}
              onValueChange={(v) => updateSettings({ ai_personality: v })}
            >
              <SelectTrigger id='personality' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSONALITIES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    <span className='text-muted-foreground ml-1.5 text-xs'>{p.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <Plug className='text-muted-foreground size-4' />
          <h3 className='text-foreground text-sm font-medium'>Integrations</h3>
        </div>
        <div className='border-border/40 text-muted-foreground rounded-lg border p-4 text-sm'>
          Calendar, email, and other integrations coming soon.
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <Bell className='text-muted-foreground size-4' />
          <h3 className='text-foreground text-sm font-medium'>Notifications</h3>
        </div>
        <div className='border-border/40 flex flex-col gap-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label htmlFor='push-notifications'>Push notifications</Label>
              <p className='text-muted-foreground text-xs'>{getPushStatusMessage(push)}</p>
            </div>
            <Switch
              id='push-notifications'
              checked={push.isSubscribed}
              disabled={
                push.isLoading ||
                !push.isPushSupported ||
                (push.isIOS && !push.isStandalone && !push.isSubscribed) ||
                push.permission === 'denied'
              }
              onCheckedChange={(checked) => {
                if (checked) {
                  void push.subscribe()
                } else {
                  void push.unsubscribe()
                }
              }}
            />
          </div>
          {push.isSubscribed ? (
            <Button
              variant='outline'
              size='sm'
              disabled={isTestLoading}
              onClick={() => void handleTestPush()}
            >
              {isTestLoading ? 'Sending...' : 'Send test notification'}
            </Button>
          ) : null}
        </div>
      </section>

      <RegionSection
        language={settings.language ?? 'en-US'}
        timezone={settings.timezone ?? detectTimezone()}
        dateFormat={settings.date_format ?? 'MM/DD/YYYY'}
        timeFormat={settings.time_format ?? '12h'}
        onUpdate={updateSettings}
      />
    </div>
  )
}
