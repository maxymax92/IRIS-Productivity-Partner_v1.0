import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Detect the user's IANA timezone, falling back to UTC. */
export function detectTimezone(): string {
  if (typeof window === 'undefined') return 'UTC'
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

const EVENING_HOUR = 18

export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'good morning'
  if (hour < EVENING_HOUR) return 'good afternoon'
  return 'good evening'
}
