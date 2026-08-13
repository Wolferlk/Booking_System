'use client'

/**
 * The last-minute mark — one chip, used everywhere a booking is listed or opened.
 *
 * It answers a single question at a glance: *was this file sold with no lead
 * time?* Everything it needs is already on the booking (`createdAt`,
 * `arrivalDate`), so it costs no query anywhere it is dropped in — the rule
 * lives in `src/lib/last-minute-shared.ts` and is computed on the spot.
 *
 * Three sizes, one meaning. The compact chip is for table rows where a dozen
 * badges compete for width; the full chip is for the booking header, where there
 * is room to say what the tier actually implies.
 */

import { Zap } from 'lucide-react'
import {
  LAST_MINUTE_TIERS, classifyLastMinute, leadLabel, leadSentence, arrivalSentence,
} from '@/lib/last-minute-shared'

interface Props {
  createdAt: string | Date
  arrivalDate: string | Date
  status?: string | null
  /** `compact` for table rows, `full` for the booking header. */
  size?: 'compact' | 'full'
  /**
   * Somebody has already taken responsibility for this file. The chip stays —
   * the fact is permanent — but it stops pulsing, because a mark that keeps
   * flashing after it has been handled is what teaches people to ignore marks.
   */
  acknowledged?: boolean
  className?: string
}

export default function LastMinuteBadge({
  createdAt, arrivalDate, status, size = 'compact', acknowledged = false, className = '',
}: Props) {
  const standing = classifyLastMinute({ createdAt, arrivalDate, status })
  if (!standing.lastMinute || !standing.tier) return null

  const meta = LAST_MINUTE_TIERS[standing.tier]

  // The pulse is earned, not decorative: only an unacknowledged file that is
  // still critical and still alive gets to move on the page.
  const pulsing = !acknowledged && standing.tier === 'CRITICAL' && !standing.cancelled

  const title = [
    `Last-minute booking — ${leadSentence(standing.leadDays)}.`,
    meta.hint,
    acknowledged ? 'Acknowledged by the team.' : 'Not yet acknowledged.',
  ].join(' ')

  if (size === 'compact') {
    return (
      <span
        title={title}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${meta.badgeClass} ${pulsing ? 'animate-pulse' : ''} ${className}`}
      >
        <Zap className="w-2.5 h-2.5" /> {leadLabel(standing.leadDays)}
      </span>
    )
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.badgeClass} ${pulsing ? 'animate-pulse' : ''} ${className}`}
    >
      <Zap className="w-3.5 h-3.5" />
      Last minute · {leadLabel(standing.leadDays)}
      <span className="font-semibold opacity-70">{leadSentence(standing.leadDays)}</span>
    </span>
  )
}

/**
 * The same fact in a sentence, for panels that want a line rather than a chip.
 * Returns nothing at all for a normal booking — a screen should never have to
 * render "not last minute".
 */
export function LastMinuteNote({
  createdAt, arrivalDate, today, status,
}: {
  createdAt: string | Date
  arrivalDate: string | Date
  today?: string
  status?: string | null
}) {
  const standing = classifyLastMinute({ createdAt, arrivalDate, today, status })
  if (!standing.lastMinute || !standing.tier) return null
  const meta = LAST_MINUTE_TIERS[standing.tier]

  return (
    <p className="flex items-start gap-1.5 text-[11px] text-slate-600 leading-snug">
      <Zap className="w-3.5 h-3.5 shrink-0 mt-px text-amber-500" />
      <span>
        <span className="font-semibold text-slate-800">
          {leadLabel(standing.leadDays)} — {leadSentence(standing.leadDays)}
        </span>
        {today && <> · {arrivalSentence(standing.daysToArrival)}</>}
        <span className="block text-slate-500">{meta.hint}</span>
      </span>
    </p>
  )
}
