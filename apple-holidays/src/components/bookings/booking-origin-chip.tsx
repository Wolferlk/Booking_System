'use client'

/**
 * "Created 11 Sep 2026, 09:14 · Esther · AppleSystem import" — and, on a click,
 * the whole trail behind that sentence.
 *
 * The question this answers is asked on nearly every disputed file: who put
 * this in, when, and where did it come from. The booking page already held the
 * pieces — a created date buried in a version list, a source document nobody
 * opens, an activity log on another screen — and none of them next to each
 * other, so the question was answered by asking a colleague.
 *
 * The chip is deliberately cautious about the word "by". Most bookings here are
 * written by a pipeline under an automation account; saying a person created
 * one of those would be a lie the panel would then have to defend. When the
 * evidence says a job did it, the chip says the job did it and names the
 * account underneath. See `lib/booking-origin.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2, ChevronDown, Mail, Cloud, Plug, Bot, Keyboard, HelpCircle, Globe,
} from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import type { BookingOrigin, OriginChannel } from '@/lib/booking-origin'

const CHANNEL_ICON: Record<OriginChannel, typeof Mail> = {
  EMAIL: Mail, ONEDRIVE: Cloud, APPLESYSTEM: Plug, OPS_AI: Bot,
  API: Keyboard, MANUAL: Keyboard, UNKNOWN: HelpCircle,
}

const CHANNEL_TONE: Record<OriginChannel, string> = {
  EMAIL:       'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  ONEDRIVE:    'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
  APPLESYSTEM: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
  OPS_AI:      'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  API:         'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
  MANUAL:      'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
  UNKNOWN:     'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
}

function fmt(at: string | null, withTime = true): string {
  if (!at) return '—'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export default function BookingOriginChip({ bookingRef }: { bookingRef: string }) {
  const [data, setData]       = useState<BookingOrigin | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed]   = useState(false)
  const [open, setOpen]       = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/origin`)
      const json = await readApiResponse<BookingOrigin>(res)
      if (!json.success || !json.data) { setFailed(true); return }
      setData(json.data)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (loading) {
    return (
      <span className="flex items-center gap-1 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking who filed this…
      </span>
    )
  }

  if (failed || !data) return null

  const Icon  = CHANNEL_ICON[data.channel]
  const filed = data.stamps.find(s => s.key === 'filed')

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${CHANNEL_TONE[data.channel]}`}
        title="Who filed this booking, when, and where it came in from"
      >
        <Icon className="w-3.5 h-3.5" />
        Created {fmt(filed?.at ?? null)}
        <span className="opacity-70">·</span>
        {data.automated ? data.channelLabel : (data.who?.name ?? 'Unknown user')}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-40 w-[30rem] max-h-[32rem] overflow-auto bg-white border border-slate-200 rounded-xl shadow-lg p-4 space-y-3 text-left">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Where this booking came from
            </p>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{data.summary}</p>
          </div>

          {/* Who / when / where, the three answers, side by side. */}
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
            <Line label="Who">
              <span className="font-semibold text-slate-900">
                {data.automated ? data.channelLabel : data.who?.name ?? 'Unknown'}
              </span>
              {data.automated ? (
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Written by a pipeline, not a person. The row is stamped to the{' '}
                  {data.who?.name ?? 'automation'} account
                  {data.who?.role ? ` (${data.who.role.replace(/_/g, ' ')})` : ''} because the field cannot be empty —
                  nobody by that name typed it in.
                </span>
              ) : (
                data.who?.role && (
                  <span className="block text-[11px] text-slate-400 mt-0.5">{data.who.role.replace(/_/g, ' ')}</span>
                )
              )}
            </Line>

            <Line label="When">
              <span className="font-semibold text-slate-900">{fmt(filed?.at ?? null)}</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">{filed?.note}</span>
            </Line>

            <Line label="Where">
              <span className="font-semibold text-slate-900">{data.channelLabel}</span>
              <span className="block text-[11px] text-slate-500 mt-0.5 break-words">{data.where}</span>
              {data.ipAddress && (
                <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-slate-400">
                  <Globe className="w-3 h-3" /> request from {data.ipAddress}
                </span>
              )}
            </Line>
          </div>

          {data.confidence === 'inferred' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">
              Deduced, not recorded. No creation-time log survives for this booking, so the channel above is read
              off what the file carries. Treat it as a strong guess rather than a fact.
            </p>
          )}

          {/* Every clock this booking has, and what each one measures. */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Times on this file
            </p>
            <div className="space-y-1.5">
              {data.stamps.map(s => (
                <div key={s.key} className="flex items-start gap-2 text-xs">
                  <span className="tabular-nums text-slate-900 font-medium whitespace-nowrap w-40 shrink-0">
                    {fmt(s.at)}
                  </span>
                  <span className="text-slate-600 leading-tight">
                    {s.label}
                    <span className="block text-[10px] text-slate-400">{s.note}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The records the answer was built from. */}
          <div className="border-t border-slate-100 pt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              What that is based on
            </p>
            <div className="space-y-1.5">
              {data.evidence.map((e, i) => (
                <div key={i} className="text-xs">
                  <span className="font-semibold text-slate-700">{e.source}</span>
                  {e.at && <span className="text-slate-400"> · {fmt(e.at)}</span>}
                  <span className="block text-[11px] text-slate-500 leading-relaxed break-words">{e.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-slate-300 leading-relaxed">
            Times are shown in your own timezone. “Filed in this system” is the stamp the bookings list and the
            daily report count against — an email received the night before belongs to the morning it was processed.
          </p>
        </div>
      )}
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-12 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-slate-700 leading-tight min-w-0">{children}</span>
    </div>
  )
}
