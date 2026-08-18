'use client'

/** Pills, formatters and tiny building blocks shared by the report screens. */

import type { FeedbackChannel, ReportStatus, RiskLevel } from '@/lib/te/experience-report/types'
import {
  AlertOctagon, Ban, CheckCircle2, ClipboardList, FileText, Hand,
  MessageSquareText, PhoneCall, Send, XCircle,
} from 'lucide-react'

// ─── Status ───────────────────────────────────────────────────────────────────

export const STATUS_META: Record<ReportStatus, {
  label: string
  /** Plain-language description used in tooltips and empty states. */
  hint: string
  pill: string
  dot: string
  icon: typeof Send
}> = {
  held: {
    label: 'Held',
    hint: 'The client had a bad experience — the agent has not been told.',
    pill: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
    icon: Hand,
  },
  draft: {
    label: 'Draft',
    hint: 'Written and waiting for someone to review and send it.',
    pill: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    icon: FileText,
  },
  queued: {
    label: 'Queued',
    hint: 'Cleared to send on the next run.',
    pill: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
    icon: ClipboardList,
  },
  sent: {
    label: 'Sent',
    hint: 'Delivered to the agent.',
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    hint: 'The mail server rejected it — safe to retry.',
    pill: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    hint: 'Closed without sending.',
    pill: 'bg-slate-100 text-slate-500 border-slate-200',
    dot: 'bg-slate-400',
    icon: Ban,
  },
}

export function StatusPill({ status, className = '' }: { status: ReportStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  const Icon = meta.icon
  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.pill} ${className}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.6} />
      {meta.label}
    </span>
  )
}

// ─── Risk ─────────────────────────────────────────────────────────────────────

export const RISK_META: Record<RiskLevel, { label: string; pill: string; bar: string }> = {
  none:   { label: 'No concerns', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-400' },
  low:    { label: 'Low',         pill: 'bg-lime-50 text-lime-700 border-lime-200',          bar: 'bg-lime-400' },
  medium: { label: 'Medium',      pill: 'bg-amber-50 text-amber-700 border-amber-200',       bar: 'bg-amber-400' },
  high:   { label: 'High',        pill: 'bg-rose-50 text-rose-700 border-rose-200',          bar: 'bg-rose-500' },
}

export function RiskPill({ level, score }: { level: RiskLevel; score?: number }) {
  const meta = RISK_META[level] ?? RISK_META.none
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.pill}`}>
      {level !== 'none' && <AlertOctagon className="h-3 w-3" strokeWidth={2.6} />}
      {meta.label}
      {score != null && level !== 'none' && <span className="opacity-60">· {score}</span>}
    </span>
  )
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export const CHANNEL_META: Record<FeedbackChannel, { label: string; short: string; icon: typeof PhoneCall }> = {
  ai_call:   { label: 'Follow-up calls',  short: 'Calls', icon: PhoneCall },
  guest_form:{ label: 'Guest feedback form', short: 'Form', icon: ClipboardList },
  desk_note: { label: 'Desk notes',       short: 'Desk',  icon: MessageSquareText },
}

export function ChannelChips({ channels }: { channels: FeedbackChannel[] }) {
  if (!channels.length) {
    return <span className="text-[11px] text-slate-300">—</span>
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {channels.map(c => {
        const meta = CHANNEL_META[c]
        if (!meta) return null
        const Icon = meta.icon
        return (
          <span
            key={c}
            title={meta.label}
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"
          >
            <Icon className="h-2.5 w-2.5" strokeWidth={2.6} />
            {meta.short}
          </span>
        )
      })}
    </span>
  )
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

export function fmtDateShort(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch { return '—' }
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

/** "3 days ago" — the list is scanned by recency more than by date. */
export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}

// ─── Layout atoms ─────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </p>
  )
}

export function Empty({ icon: Icon, title, hint }: { icon: typeof Send; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center">
      <Icon className="h-7 w-7 text-slate-300" strokeWidth={1.6} />
      <p className="text-sm font-bold text-slate-500">{title}</p>
      {hint && <p className="max-w-sm text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
