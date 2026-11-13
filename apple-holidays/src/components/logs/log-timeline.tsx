'use client'

/**
 * Renders Booking Logs entries as a day-grouped timeline:
 *
 *   TODAY
 *   ●  Guest phone changed                       14:32
 *      Guest phone  +91 8247… → +91 9535…
 *      (SD) Sasindu D. · Guest contact
 */
import Link from 'next/link'
import {
  Plus, Pencil, Trash2, UserCheck, UserMinus, Send, AlertTriangle, MinusCircle, GitBranch, Info, ArrowRight, Bot,
} from 'lucide-react'
import type { LogEntry, LogSection, LogTone } from '@/lib/booking-logs'

export const SECTION_TEXT: Record<LogSection, string> = {
  overview: 'Overview & status',
  contact: 'Guest contact',
  passengers: 'Passengers',
  flights: 'Flights',
  accommodation: 'Accommodation',
  agenda: 'Movement chart',
  messages: 'Daily messages',
}

const TONE: Record<LogTone, { Icon: typeof Plus; dot: string; label: string }> = {
  create: { Icon: Plus, dot: 'bg-emerald-500 text-white', label: 'Created' },
  update: { Icon: Pencil, dot: 'bg-sky-500 text-white', label: 'Edited' },
  delete: { Icon: Trash2, dot: 'bg-rose-500 text-white', label: 'Deleted' },
  assign: { Icon: UserCheck, dot: 'bg-violet-500 text-white', label: 'Assigned' },
  unassign: { Icon: UserMinus, dot: 'bg-amber-500 text-white', label: 'Unassigned' },
  send: { Icon: Send, dot: 'bg-teal-500 text-white', label: 'Sent' },
  fail: { Icon: AlertTriangle, dot: 'bg-rose-600 text-white ring-4 ring-rose-100', label: 'Failed' },
  skip: { Icon: MinusCircle, dot: 'bg-amber-400 text-white ring-4 ring-amber-50', label: 'Not sent' },
  status: { Icon: GitBranch, dot: 'bg-indigo-500 text-white', label: 'Status' },
  info: { Icon: Info, dot: 'bg-slate-400 text-white', label: 'Info' },
}

function dayHeading(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })

function initials(name: string): string {
  return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

function Actor({ e }: { e: LogEntry }) {
  const automated = !e.actor || ['scheduler', 'system', 'automation', 'sync'].includes(e.source)
  const name = e.actor ?? (e.source === 'scheduler' ? 'Scheduler' : e.source === 'sync' ? 'Sync' : 'Automation')
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
      {automated && !e.actor ? (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Bot className="h-2.5 w-2.5" /></span>
      ) : (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-[8px] font-bold text-white">{initials(name)}</span>
      )}
      <span className="font-medium text-slate-600">{name}</span>
    </span>
  )
}

export function LogItem({ e, showRef, showSection }: { e: LogEntry; showRef?: boolean; showSection?: boolean }) {
  const t = TONE[e.tone] ?? TONE.info
  return (
    <li className="relative pl-9">
      <span className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full shadow-sm ${t.dot}`}>
        <t.Icon className="h-3 w-3" />
      </span>
      <div className={`rounded-xl border px-3 py-2 transition hover:shadow-sm ${
        e.tone === 'fail' ? 'border-rose-200 bg-rose-50/60' : e.tone === 'skip' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200/80 bg-white'}`}>
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-slate-800">{e.title}</p>
          <time className="shrink-0 text-[10.5px] tabular-nums text-slate-400" title={fullTime(e.at)} dateTime={e.at}>{timeOf(e.at)}</time>
        </div>

        {e.changes && e.changes.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {e.changes.slice(0, 12).map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1 text-[11.5px]">
                <span className="font-semibold text-slate-500">{c.field}</span>
                {c.from && <span className="max-w-[180px] truncate rounded bg-rose-50 px-1.5 py-px text-rose-700 line-through decoration-rose-300" title={c.from}>{c.from}</span>}
                {c.from && c.to && <ArrowRight className="h-3 w-3 text-slate-300" />}
                {c.to && <span className="max-w-[200px] truncate rounded bg-emerald-50 px-1.5 py-px font-medium text-emerald-700" title={c.to}>{c.to}</span>}
                {!c.from && !c.to && <span className="text-slate-400">cleared</span>}
              </li>
            ))}
            {e.changes.length > 12 && <li className="text-[11px] text-slate-400">+{e.changes.length - 12} more</li>}
          </ul>
        )}

        {e.detail && <p className="mt-1 line-clamp-2 break-words text-[11.5px] text-slate-500" title={e.detail}>{e.detail}</p>}

        {e.reason && (
          <div className={`mt-1.5 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] ${
            e.tone === 'fail' ? 'bg-rose-100/70 text-rose-800' : e.tone === 'skip' ? 'bg-amber-100/70 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span className="break-words"><b className="font-semibold">Why: </b>{e.reason}</span>
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Actor e={e} />
          {showSection && (
            <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500">{SECTION_TEXT[e.section]}</span>
          )}
          {showRef && e.bookingRef && (
            <Link href={`/dashboard/bookings/${encodeURIComponent(e.bookingRef)}`}
              className="rounded-full bg-indigo-50 px-1.5 py-px font-mono text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100">
              {e.bookingRef}
            </Link>
          )}
        </div>
      </div>
    </li>
  )
}

export function LogTimeline({ entries, showRef, showSection }: { entries: LogEntry[]; showRef?: boolean; showSection?: boolean }) {
  const groups: { day: string; items: LogEntry[] }[] = []
  for (const e of entries) {
    const day = dayHeading(e.at)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.items.push(e)
    else groups.push({ day, items: [e] })
  }
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.day}>
          <h4 className="sticky top-0 z-10 -mx-1 mb-2 bg-gradient-to-b from-white via-white/95 to-white/0 px-1 pb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">{g.day}</h4>
          <ol className="relative space-y-2.5 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-slate-200">
            {g.items.map(e => <LogItem key={e.id} e={e} showRef={showRef} showSection={showSection} />)}
          </ol>
        </section>
      ))}
    </div>
  )
}
