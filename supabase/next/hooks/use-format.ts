'use client'

import { format as fnsFormat, formatDistanceToNow as fnsDistanceToNow } from 'date-fns'
import { useCallback, useMemo } from 'react'

import { useUserSettings } from '@/hooks/use-user-settings'
import { getDateFnsLocale, getDateFormatString, getTimeFormatString } from '@/lib/format'

export function useFormat() {
  const { settings } = useUserSettings()
  const language = settings?.language ?? 'en-US'
  const dateFormat = settings?.date_format ?? 'MM/DD/YYYY'
  const timeFormat = settings?.time_format ?? '12h'
  const locale = useMemo(() => getDateFnsLocale(language), [language])

  const dateFmt = useMemo(() => getDateFormatString(dateFormat), [dateFormat])
  const timeFmt = useMemo(() => getTimeFormatString(timeFormat), [timeFormat])
  const dateTimeFmt = useMemo(() => `${dateFmt}, ${timeFmt}`, [dateFmt, timeFmt])

  const formatDate = useCallback(
    (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date
      return fnsFormat(d, dateFmt, { locale })
    },
    [dateFmt, locale],
  )

  const formatTime = useCallback(
    (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date
      return fnsFormat(d, timeFmt, { locale })
    },
    [timeFmt, locale],
  )

  const formatDateTime = useCallback(
    (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date
      return fnsFormat(d, dateTimeFmt, { locale })
    },
    [dateTimeFmt, locale],
  )

  const formatRelative = useCallback(
    (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date
      return fnsDistanceToNow(d, { addSuffix: true, locale })
    },
    [locale],
  )

  return { formatDate, formatTime, formatDateTime, formatRelative, locale }
}
