'use client'

/**
 * D-3 → D-1 brief readiness, on the board where the allocation is made.
 *
 * The table below this panel answers "does this file have a driver". This panel
 * answers the question that actually loses a tour: *has anyone spoken to him*.
 * A driver allocated four weeks ago and never phoned looks identical, on that
 * table, to one briefed yesterday — and the morning that difference shows up is
 * the morning of the pickup.
 *
 * Three columns because the desk can still act differently on each: D-3 is the
 * working deadline with room to swap a driver who says no, D-2 is a chase, D-1
 * is an escalation. Each file is one click from the deck that briefs it, so the
 * panel is not a report to read and then act on elsewhere — it is the work
 * queue itself.
 *
 * The same report is mailed at 07:00 daily by `driver-brief-report-scheduler`;
 * "Email now" sends that identical mail on demand.
 */

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Headphones, RefreshCw, Loader2, ChevronDown, AlertTriangle, Phone,
  BadgeCheck, CircleDashed, Mail, Coffee, CarFront,
} from 'lucide-react'
import { cn, formatDate, readApiResponse } from '@/lib/utils'

type Verdict = 'no_driver' | 'ready_to_brief' | 'brief_started' | 'briefed' | 'no_driver_needed'

interface Row {
  bookingRef: string; isNumber: string | null; agent: string | null
  arrivalDate: string; departureDate: string; leadDay: number
  pax: number; leadName: string | null; hotelOnly: boolean
  driverName: string | null; driverPhone: string | null; driverPhotoUrl: string | null
  vehicleType: string | null; vehiclePlate: string | null
  unassignedMovements: number; movementCount: number
  verdict: Verdict
  briefStatus: 'pending' | 'in_progress' | 'completed'
  briefedByName: string | null; briefedAt: string | null
}
interface Group { leadDay: number; label: string; instruction: string; rows: Row[] }
interface Report {
  generatedAt: string; forDate: string; country: string | null
  groups: Group[]
  totals: Record<Verdict, number> & { files: number }
}

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; dot: string }> = {
  no_driver:        { label: 'No driver',      cls: 'border-red-500/35 bg-red-500/10 text-red-300',           dot: 'bg-red-400' },
  ready_to_brief:   { label: 'Ready to brief', cls: 'border-teal-500/35 bg-teal-500/10 text-teal-300',        dot: 'bg-teal-400' },
  brief_started:    { label: 'Started',        cls: 'border-yellow-500/35 bg-yellow-500/10 text-yellow-300',  dot: 'bg-yellow-400' },
  briefed:          { label: 'Briefed',        cls: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  no_driver_needed: { label: 'No driver needed', cls: 'border-slate-600/40 bg-slate-700/20 text-slate-400',   dot: 'bg-slate-500' },
}

/** The three days, coloured by how loudly each is asking for attention. */
const DAY_ACCENT: Record<number, { ring: string; text: string; bar: string }> = {
  3: { ring: 'border-teal-500/30',  text: 'text-teal-300',  bar: 'bg-teal-500' },
  2: { ring: 'border-amber-500/30', text: 'text-amber-300', bar: 'bg-amber-500' },
  1: { ring: 'border-red-500/30',   text: 'text-red-300',   bar: 'bg-red-500' },
}

export interface DriverBriefReadinessProps {
  /** Opens the brief deck for a file. Owned by the page so one modal serves both. */
  onBrief: (bookingRef: string) => void
  /** Bumped by the page after a brief is signed off, to re-read the report. */
  refreshKey?: number
  /** Whether this user may trigger the email send. */
  canSend?: boolean
}

export default function DriverBriefReadiness({ onBrief, refreshKey = 0, canSend }: DriverBriefReadinessProps) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/srilanka/driver-brief-report')
      const json = await readApiResponse<Report>(res)
      if (json.success && json.data) setReport(json.data)
    } catch {
      /* the board below is the primary surface — a failed panel must not break it */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  const emailNow = useCallback(async () => {
    setSending(true)
    try {
      const res = await fetch('/api/srilanka/driver-brief-report', { method: 'POST' })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error ?? 'Send failed')
      toast.success(json.message ?? 'Report sent')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the report')
    } finally {
      setSending(false)
    }
  }, [])

  const toBrief = report ? report.totals.ready_to_brief + report.totals.brief_started : 0
  const noDriver = report?.totals.no_driver ?? 0

  return (
    <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 p-4">
        <span className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 grid place-items-center text-teal-300 flex-shrink-0">
          <Headphones className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            Driver Brief Readiness
            <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-400">D-3 → D-1</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {loading ? 'Reading the next three days…'
              : report
                ? <>
                    <span className={cn('font-bold', toBrief ? 'text-teal-300' : 'text-slate-300')}>{toBrief}</span> to call today
                    {noDriver > 0 && <> · <span className="font-bold text-red-400">{noDriver}</span> with no driver</>}
                    {' · '}{report.totals.briefed} briefed · {report.totals.files} file{report.totals.files === 1 ? '' : 's'} arriving
                  </>
                : 'Could not read the report'}
          </p>
        </div>

        {canSend && (
          <button
            onClick={emailNow} disabled={sending}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-xs font-semibold disabled:opacity-50"
            title="Send this exact report by email now"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Email now
          </button>
        )}
        <button
          onClick={() => void load()} disabled={loading}
          className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-white transition-all"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
        <button
          onClick={() => setOpen(o => !o)}
          className="p-2 rounded-xl text-slate-400 hover:text-white transition-all"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <ChevronDown className={cn('w-4 h-4 transition-transform', !open && '-rotate-90')} />
        </button>
      </div>

      {/* ── Three days ─────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 grid gap-3 lg:grid-cols-3">
              {(report?.groups ?? []).map(g => {
                const accent = DAY_ACCENT[g.leadDay] ?? DAY_ACCENT[1]
                return (
                  <div key={g.leadDay} className={cn('rounded-2xl border bg-slate-950/40 overflow-hidden', accent.ring)}>
                    <div className="p-3.5 border-b border-slate-800/60">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-1.5 h-4 rounded-full', accent.bar)} />
                        <p className={cn('text-xs font-black', accent.text)}>{g.label}</p>
                        <span className="ml-auto text-[10px] font-bold text-slate-500">{g.rows.length}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug mt-1.5">{g.instruction}</p>
                    </div>

                    <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto">
                      {g.rows.length === 0 && (
                        <p className="text-[11px] text-slate-600 text-center py-6">Nothing arriving on this day.</p>
                      )}
                      {g.rows.map((r, i) => {
                        const v = VERDICT_STYLE[r.verdict]
                        const actionable = r.verdict === 'ready_to_brief' || r.verdict === 'brief_started'
                        return (
                          <motion.div
                            key={r.bookingRef}
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.03, 0.3) }}
                            className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-2.5"
                          >
                            <div className="flex items-start gap-2">
                              <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0', v.dot)} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <a
                                    href={`/dashboard/bookings/${r.bookingRef}`}
                                    className="text-xs font-black text-white hover:text-teal-300 transition-colors truncate"
                                  >{r.bookingRef}</a>
                                  <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-bold whitespace-nowrap', v.cls)}>
                                    {v.label}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                  {r.leadName ?? '—'} · {r.pax} pax · {formatDate(r.arrivalDate, 'EEE dd MMM')}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                                  {r.verdict === 'no_driver_needed'
                                    ? <><Coffee className="w-3 h-3" />{r.hotelOnly ? 'Hotel Only file' : 'No movement needs a driver'}</>
                                    : r.driverName
                                      ? <><CarFront className="w-3 h-3" />{r.driverName}{r.driverPhone ? ` · ${r.driverPhone}` : ''}</>
                                      : <><AlertTriangle className="w-3 h-3 text-red-400" /><span className="text-red-400">nobody allocated</span></>}
                                </p>
                                {r.unassignedMovements > 0 && (
                                  <p className="text-[10px] text-amber-400/90 mt-0.5">
                                    {r.unassignedMovements} of {r.movementCount} movements unassigned
                                  </p>
                                )}
                                {r.briefedByName && (
                                  <p className="text-[10px] text-emerald-400/80 mt-0.5">
                                    briefed by {r.briefedByName}
                                    {r.briefedAt ? ` · ${formatDate(r.briefedAt, 'dd MMM HH:mm')}` : ''}
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-col gap-1 flex-shrink-0">
                                {r.verdict !== 'no_driver_needed' && (
                                  <button
                                    onClick={() => onBrief(r.bookingRef)}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-all',
                                      actionable
                                        ? 'border-teal-500/40 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20'
                                        : 'border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800',
                                    )}
                                    title="Open the driver brief deck"
                                  >
                                    {r.verdict === 'briefed'
                                      ? <BadgeCheck className="w-3 h-3" />
                                      : r.verdict === 'brief_started'
                                        ? <CircleDashed className="w-3 h-3" />
                                        : <Headphones className="w-3 h-3" />}
                                    Brief
                                  </button>
                                )}
                                {r.driverPhone && (
                                  <a
                                    href={`tel:${r.driverPhone.replace(/[^\d+]/g, '')}`}
                                    className="inline-flex items-center justify-center px-2 py-1 rounded-lg border border-slate-700/60 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-all"
                                    title={`Dial ${r.driverName}`}
                                  >
                                    <Phone className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {loading && !report && (
                <div className="lg:col-span-3 py-10 text-center text-slate-500 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Reading the next three days…
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
