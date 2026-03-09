import type { Locale } from 'date-fns'
import { de } from 'date-fns/locale/de'
import { enGB } from 'date-fns/locale/en-GB'
import { enUS } from 'date-fns/locale/en-US'
import { es } from 'date-fns/locale/es'
import { fr } from 'date-fns/locale/fr'
import { ja } from 'date-fns/locale/ja'

import { MS_PER_MINUTE } from '@/lib/constants'

// ── Relative age formatting ─────────────────────────────────────────────────

const MINS_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_MONTH = 30
const MONTHS_PER_YEAR = 12

/** Format a timestamp as a human-readable relative age (e.g., "2d ago", "3mo ago"). */
export function formatRelativeAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime()
  if (Number.isNaN(ms)) return 'unknown'
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / MS_PER_MINUTE)
  if (mins < 1) return 'just now'
  if (mins < MINS_PER_HOUR) return `${String(mins)}m ago`
  const hours = Math.floor(mins / MINS_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${String(hours)}h ago`
  const days = Math.floor(hours / HOURS_PER_DAY)
  if (days < DAYS_PER_MONTH) return `${String(days)}d ago`
  const months = Math.floor(days / DAYS_PER_MONTH)
  if (months < MONTHS_PER_YEAR) return `${String(months)}mo ago`
  const years = Math.floor(months / MONTHS_PER_YEAR)
  return `${String(years)}y ago`
}

// ── Locale and date format utilities ────────────────────────────────────────

const LOCALE_MAP: Record<string, Locale> = {
  'en-US': enUS,
  'en-GB': enGB,
  'es-ES': es,
  'fr-FR': fr,
  'de-DE': de,
  'ja-JP': ja,
}

const DATE_FORMAT_MAP = new Map<string, string>([
  ['MM/DD/YYYY', 'MM/dd/yyyy'],
  ['DD/MM/YYYY', 'dd/MM/yyyy'],
  ['YYYY-MM-DD', 'yyyy-MM-dd'],
])

export function getDateFnsLocale(language: string): Locale {
  return LOCALE_MAP[language] ?? enUS
}

export function getDateFormatString(dateFormat: string): string {
  return DATE_FORMAT_MAP.get(dateFormat) ?? 'MM/dd/yyyy'
}

export function getTimeFormatString(timeFormat: string): string {
  return timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
}
