'use client'

/**
 * "Which period?" — the step between a send button and the send.
 *
 * A schedule sends the period that just closed; this lets an operator send an
 * earlier one instead (a week that went out wrong, a month someone missed). A
 * weekly schedule is picked as "week N of a month", numbered the way the
 * server builds it (see `weeksOfMonth`), so the range shown on the button is
 * exactly the range the mail will cover. Daily and monthly schedules pick a day
 * or a month.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Send, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dateInTz, formatReportDate, shiftDate, weeksOfMonth } from '@/lib/reports/report-window'
import type { Schedule } from './types'

export interface SendRequest {
  schedule: Schedule
  mode: 'live' | 'test'
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T00:00:00Z`))
}

/** "20 Sept – 26 Sept" — the year is in the month heading already. */
function rangeLabel(from: string, to: string): string {
  return `${formatReportDate(from).slice(0, -5)} – ${formatReportDate(to).slice(0, -5)}`
}

export default function SendDialog({
  request, busy, onClose, onSend,
}: {
  request: SendRequest | null
  busy: boolean
  onClose: () => void
  /** `date` is an anchor inside the chosen period; null means the latest one. */
  onSend: (date: string | null) => void
}) {
  const s = request?.schedule
  const today = s ? dateInTz(new Date(), s.timezone) : ''
  const yesterday = today ? shiftDate(today, -1) : ''

  // null = "the latest completed period", which is what the schedule itself sends.
  const [date, setDate] = useState<string | null>(null)
  // null = the current month. Derived at render rather than seeded into state:
  // the dialog stays mounted with no request, so state seeded from `today`
  // would be '' on the first render after a send button is pressed, and
  // formatting an empty month throws ("Invalid time value") and takes the
  // whole page down.
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  const month = pickedMonth ?? today.slice(0, 7)
  const setMonth = (fn: (m: string) => string) => setPickedMonth(fn(month))

  useEffect(() => {
    setDate(null)
    setPickedMonth(null)
  }, [request])

  const weeks = useMemo(
    () => (s?.period === 'WEEKLY' && month ? weeksOfMonth(month, s.dayOfWeek) : []),
    [s, month],
  )

  if (!request || !s) return null

  const live = request.mode === 'live'
  const recipients = s.to.length + s.cc.length + s.bcc.length
  const chosenWeek = weeks.find(w => w.toDate === date)

  const summary = date === null
    ? 'the latest completed period'
    : s.period === 'WEEKLY'
      ? chosenWeek
        ? `week ${chosenWeek.n} of ${monthLabel(month)} (${rangeLabel(chosenWeek.fromDate, chosenWeek.toDate)})`
        : 'the chosen week'
      : s.period === 'MONTHLY'
        ? monthLabel(date.slice(0, 7))
        : formatReportDate(date, { weekday: true })

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 animate-slide-up">
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          live ? 'bg-amber-50 text-amber-600' : 'bg-teal-50 text-teal-600',
        )}>
          <Send className="w-5 h-5" />
        </div>
        <h3 className="text-base font-bold text-slate-900 mt-3">
          {live ? 'Send to everyone' : 'Send a test to me'} — {s.name}
        </h3>
        <p className="text-sm text-slate-500 mt-1">Choose which {s.period === 'WEEKLY' ? 'week' : s.period === 'MONTHLY' ? 'month' : 'day'} to report.</p>

        {/* Latest */}
        <button
          onClick={() => setDate(null)}
          className={cn(
            'w-full mt-4 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors',
            date === null ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
          )}
        >
          <span className="font-semibold">Latest</span>
          <span className="text-xs text-slate-500 ml-2">what the schedule would send now</span>
        </button>

        {s.period === 'WEEKLY' && (
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setMonth(m => shiftMonth(m, -1))}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-bold text-slate-800">{monthLabel(month)}</div>
              <button
                onClick={() => setMonth(m => shiftMonth(m, 1))}
                disabled={month >= today.slice(0, 7)}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {weeks.map(w => {
                // A week still running (or not started) has nothing whole to report.
                const open = w.toDate > yesterday
                return (
                  <button
                    key={w.n}
                    disabled={open}
                    onClick={() => setDate(w.toDate)}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      date === w.toDate ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    <div className="text-sm font-bold text-slate-900">Week {w.n}</div>
                    <div className="text-[11px] text-slate-500">
                      {rangeLabel(w.fromDate, w.toDate)}{open ? ' · not finished' : ''}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Weeks run {DAY_NAMES[s.dayOfWeek]} to {DAY_NAMES[(s.dayOfWeek + 6) % 7]} and are numbered by the month they start in.
            </p>
          </div>
        )}

        {s.period === 'DAILY' && (
          <input
            type="date"
            max={yesterday}
            value={date ?? ''}
            onChange={e => setDate(e.target.value || null)}
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        )}

        {s.period === 'MONTHLY' && (
          <input
            type="month"
            max={shiftMonth(today.slice(0, 7), -1)}
            value={date ? date.slice(0, 7) : ''}
            onChange={e => setDate(e.target.value ? `${e.target.value}-01` : null)}
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        )}

        <div className={cn(
          'mt-4 px-3 py-2 rounded-lg text-xs flex items-start gap-2',
          live ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-50 text-slate-600 border border-slate-200',
        )}>
          <Users className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span>
            {live
              ? `Sends ${summary} to all ${recipients} recipient${recipients === 1 ? '' : 's'}.`
              : `Sends ${summary} to your own address only.`}
          </span>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSend(date)}
            disabled={busy}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2',
              live ? 'bg-amber-600 hover:bg-amber-700' : 'bg-teal-600 hover:bg-teal-700',
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy ? 'Sending…' : live ? 'Send to everyone' : 'Send test'}
          </button>
        </div>
      </div>
    </div>
  )
}
