'use client'

/**
 * The Driver Settlement Register — Sri Lanka.
 *
 * The workbook the desk has settled chauffeurs from for years, on screen and
 * joined to both databases: a line per finished tour, gathered into numbered
 * bulks, showing what the transport cost, what was advanced, what is therefore
 * still payable, what it was budgeted at, and the excess or shortage between
 * the two.
 *
 * ---- Why a second screen, when the Drive Log exists ----
 *
 * They are two different jobs on the same rows. The Drive Log looks *forward*
 * — the guests landing in two days, whose advances have to be counted and
 * handed over before they arrive — and it works one booking at a time. This
 * looks *backward*: the tours that have finished, gathered into a payment run,
 * measured against budget, and handed to accounts as a batch. Same figures,
 * opposite direction of travel, and a filter set that only makes sense here
 * (which bulk, over or under budget, what is left to pay).
 *
 * ---- What it does, and does not, do ----
 *
 * It records: a bulk number, what the tour is being settled for, the budget its
 * variance is measured against, the desk's own corrected figures, and a
 * submission to the accounts team. It pays nothing. Every rupee shown was
 * derived by the Apple Accounts system and is displayed verbatim; the rest
 * payment is released on Payable 1.0's Driver Settlements page by an accounts
 * user, against code that re-derives the obligation and refuses an unapproved
 * P&L. See `src/lib/sl-settlement-register.ts` for the arithmetic and
 * `src/lib/sl-transport-actuals.ts` for where the boundary sits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, Banknote, CalendarDays, Check, ChevronDown,
  ChevronRight, ExternalLink, FileSpreadsheet, Filter, Layers, Loader2, Navigation2, Pencil,
  RefreshCw, Search, Send, SlidersHorizontal, Target, TrendingDown, TrendingUp, Undo2, Users,
  Wallet, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { COST_TYPES, COST_TYPE_LABEL, type SettlementCostType } from '@/lib/sl-settlement-costs'
import {
  EMPTY_FILTERS, REGISTER_STATE_LABEL, REGISTER_STATE_TONE,
  amount, bracketed, percent, registerSearchParams, workbookDate,
  type RegisterGroup, type RegisterGroupBy, type RegisterQuery, type RegisterRow,
  type RegisterSortField, type RegisterTotals,
} from '@/lib/sl-settlement-register'
import type { UserRole } from '@prisma/client'

// ── Payload ───────────────────────────────────────────────────────────────────

interface RegisterPayload {
  query: RegisterQuery
  rows: RegisterRow[]
  groups: RegisterGroup[]
  totals: RegisterTotals
  windowTotals: RegisterTotals
  bulks: string[]
  advancesAvailable: boolean
  actualsAvailable: boolean
  truncated: boolean
  matched: number
  today: string
  canRecord: boolean
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const day = (d: Date) => d.toISOString().slice(0, 10)
const shift = (from: string, days: number) => day(new Date(Date.parse(`${from}T00:00:00Z`) + days * DAY_MS))

/** The windows the desk actually asks for, rather than a pair of empty date boxes. */
function presets(today: string): { label: string; from: string; to: string }[] {
  const [y, m] = today.split('-').map(Number)
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  const prevStart = `${prevY}-${String(prevM).padStart(2, '0')}-01`
  const prevEnd = shift(monthStart, -1)

  return [
    { label: 'Last 45 days', from: shift(today, -45), to: today },
    { label: 'This month',   from: monthStart,        to: today },
    { label: 'Last month',   from: prevStart,         to: prevEnd },
    { label: 'Last 90 days', from: shift(today, -90), to: today },
  ]
}

// ── Small pieces ──────────────────────────────────────────────────────────────

/**
 * Each figure on this screen means a different thing, and the eye should be
 * able to tell them apart before it has read a word: what it cost is neutral,
 * what has already been handed over is violet, what is still owed is sky, the
 * budget indigo, and the variance takes the colour of its own sign.
 */
const TONE = {
  slate:   { wash: 'from-slate-400/[0.10]',   chip: 'bg-slate-400/15 text-slate-200',     bar: 'bg-slate-300',   edge: 'via-slate-400/50' },
  violet:  { wash: 'from-violet-500/[0.14]',  chip: 'bg-violet-500/20 text-violet-200',   bar: 'bg-violet-400',  edge: 'via-violet-400/60' },
  sky:     { wash: 'from-sky-500/[0.18]',     chip: 'bg-sky-500/20 text-sky-200',         bar: 'bg-sky-400',     edge: 'via-sky-400/70' },
  indigo:  { wash: 'from-indigo-500/[0.14]',  chip: 'bg-indigo-500/20 text-indigo-200',   bar: 'bg-indigo-400',  edge: 'via-indigo-400/60' },
  emerald: { wash: 'from-emerald-500/[0.14]', chip: 'bg-emerald-500/20 text-emerald-200', bar: 'bg-emerald-400', edge: 'via-emerald-400/60' },
  rose:    { wash: 'from-rose-500/[0.14]',    chip: 'bg-rose-500/20 text-rose-200',       bar: 'bg-rose-400',    edge: 'via-rose-400/60' },
} as const

type Tone = keyof typeof TONE

/**
 * One headline figure.
 *
 * `meter` is the share of the figure that is already accounted for — advances
 * against cost, tours settled against tours in view — drawn as a hairline rail
 * so the proportion reads without a second number to compare against.
 */
function Stat({
  label, value, sub, icon: Icon, tone, meter, lead,
}: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone: Tone
  meter?: number | null
  lead?: boolean
}) {
  const t = TONE[tone]
  const pct = meter === null || meter === undefined || !Number.isFinite(meter)
    ? null
    : Math.max(0, Math.min(1, meter)) * 100

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-slate-900/60',
        'px-4 py-3.5 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.14]',
        'hover:shadow-lg hover:shadow-black/30',
        lead && 'col-span-2',
      )}
    >
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-80 transition-opacity group-hover:opacity-100', t.wash)} />
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent', t.edge)} />

      <div className="relative">
        <div className="flex items-center gap-2">
          <span className={cn('grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg', t.chip)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <p className="truncate text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">{label}</p>
        </div>

        <p className={cn('mt-2 font-black tabular-nums leading-none text-white', lead ? 'text-2xl' : 'text-lg')}>
          {value}
        </p>

        {pct !== null ? (
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className={cn('h-full rounded-full transition-[width] duration-700 ease-out', t.bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}

        {sub ? <p className="mt-1.5 truncate text-[10px] font-medium text-slate-500">{sub}</p> : null}
      </div>
    </div>
  )
}

function Chip({
  active, onClick, children, title,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode; title?: string
}) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold',
        'border transition duration-200 active:scale-[0.97]',
        active
          ? 'border-sky-400/50 bg-sky-500/20 text-sky-100 shadow-[0_0_0_3px_rgba(56,189,248,0.08)]'
          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-slate-100',
      )}
    >
      {children}
    </button>
  )
}

const fieldCls =
  'w-full rounded-lg border border-white/[0.08] bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100 ' +
  'transition duration-200 placeholder:text-slate-600 hover:border-white/[0.16] ' +
  'focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20 ' +
  '[color-scheme:dark]'

/** A quiet button, for everything that is not the action of the page. */
const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 ' +
  'text-xs font-bold text-slate-300 transition duration-200 hover:border-white/[0.18] hover:bg-white/[0.07] ' +
  'hover:text-white active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

/** A banner for something the desk has to know before it reads the figures. */
function Notice({ tone, children }: { tone: 'orange' | 'amber'; children: React.ReactNode }) {
  const c = tone === 'orange'
    ? 'border-orange-400/25 bg-orange-500/[0.09] text-orange-100'
    : 'border-amber-400/25 bg-amber-500/[0.09] text-amber-100'
  return (
    <div className={cn('flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs leading-relaxed', c)}>
      <AlertTriangle className="mt-px h-4 w-4 flex-shrink-0 opacity-80" />
      <span>{children}</span>
    </div>
  )
}

/** Nothing to show. Visible enough to be read as "empty", quiet enough to ignore. */
const Empty = () => <span className="text-slate-600">—</span>

/** A money cell. Negative in brackets, the workbook's convention throughout. */
function Num({
  value, bold, tone, bracket,
}: { value: number | null; bold?: boolean; tone?: string; bracket?: boolean }) {
  if (value === null) return <Empty />
  return (
    <span className={cn('tabular-nums', bold && 'font-bold', tone ?? 'text-slate-200')}>
      {bracket ? bracketed(value) : amount(value)}
    </span>
  )
}

/** Green when the tour came in under budget, red when it overran. */
function varianceTone(v: number | null): string {
  if (v === null) return 'text-slate-500'
  if (v > 0.009) return 'text-emerald-300'
  if (v < -0.009) return 'text-rose-300'
  return 'text-slate-300'
}

// ── The row editor ────────────────────────────────────────────────────────────

interface EditorState {
  actualPackageCost: string
  actualBalancePayable: string
  budgetedCost: string
  bulkNo: string
  costType: string
  remarks: string
  note: string
}

function toEditor(r: RegisterRow): EditorState {
  return {
    actualPackageCost:    r.costOverridden && r.totalCost !== null ? String(r.totalCost) : '',
    actualBalancePayable: '',
    budgetedCost: r.budgetedCost !== null ? String(r.budgetedCost) : '',
    bulkNo:   r.bulkNo ?? '',
    costType: r.costType ?? '',
    remarks:  r.remarks ?? '',
    note:     r.note ?? '',
  }
}

/**
 * Where one tour's settlement is written down.
 *
 * The two `actual_*` figures are the desk's assertion about what happened and
 * go to accounts as a claim; the bulk, cost type, budget and remark are
 * bookkeeping and are saved the same way but change no figure. Submitting sends
 * the balance payable to Payable 1.0 — it does not pay it.
 */
function RowEditor({
  row, onClose, onSaved,
}: {
  row: RegisterRow
  onClose: () => void
  onSaved: (bookingId: string) => void
}) {
  const [form, setForm] = useState<EditorState>(() => toEditor(row))
  const [busy, setBusy] = useState<'save' | 'submit' | 'withdraw' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<EditorState>) => setForm(f => ({ ...f, ...patch }))

  // Escape closes it, and the page behind stops scrolling while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const parse = (v: string): number | null => {
    if (v.trim() === '') return null
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }

  const budget = parse(form.budgetedCost)
  const cost   = parse(form.actualPackageCost) ?? row.totalCost
  const excess = budget !== null && cost !== null ? budget - cost : null

  const post = async (action: 'save' | 'submit' | 'withdraw') => {
    setBusy(action); setError(null)
    try {
      const res = await fetch('/api/srilanka/drive-log/actuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: action === 'withdraw' ? 'withdraw' : 'save',
          bookingId: row.bookingId,
          actualPackageCost:    form.actualPackageCost.trim() === '' ? null : parse(form.actualPackageCost),
          actualBalancePayable: form.actualBalancePayable.trim() === '' ? null : parse(form.actualBalancePayable),
          note: form.note.trim() || null,
          bulkNo: form.bulkNo.trim() || null,
          costType: form.costType || null,
          budgetedCost: form.budgetedCost.trim() === '' ? null : budget,
          remarks: form.remarks.trim() || null,
          computed: {
            totalCost: row.derivedTotalCost,
            balancePayable: row.balancePayable,
            advancePaid: row.advancePaid,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'That change could not be saved.')

      // A submit is a save followed by a send: the figures on screen have to be
      // the figures accounts receives, and saving first is what guarantees it.
      if (action === 'submit') {
        const sent = await fetch('/api/srilanka/drive-log/actuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit', bookingId: row.bookingId }),
        })
        const sentJson = await sent.json()
        if (!sent.ok || !sentJson.success) throw new Error(sentJson.error ?? 'That could not be submitted.')
        toast.success('Sent to the accounts team.')
      } else {
        toast.success(action === 'withdraw' ? 'Withdrawn.' : 'Saved.')
      }

      onSaved(row.bookingId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.1] bg-slate-900 shadow-2xl shadow-black/60">
        <div className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="pointer-events-none absolute -left-16 -top-20 h-44 w-44 rounded-full bg-sky-500/[0.12] blur-3xl" />
          <div className="relative">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">
              Settle tour
              <span className={cn(
                'rounded-full border px-2 py-0.5 tracking-[0.1em]',
                REGISTER_STATE_TONE[row.state],
              )}>
                {REGISTER_STATE_LABEL[row.state]}
              </span>
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-white">{row.tour}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {workbookDate(row.date)} · {row.chauffeur ?? 'no chauffeur allocated'}
              {row.acName ? ` · ${row.acName}` : ''}
            </p>
          </div>
          <button
            type="button" onClick={onClose} title="Close (Esc)"
            className="relative rounded-lg border border-white/[0.08] p-1.5 text-slate-500 transition hover:border-white/[0.2] hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* What the accounts system says, before anybody corrects it. */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.07] bg-slate-950/60 p-3 sm:grid-cols-4">
            {[
              ['Costed total', row.derivedTotalCost],
              ['Advance paid', row.advancePaid],
              ['Balance payable', row.balancePayable],
              ['Rest paid', row.restPaid],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">{String(label)}</p>
                <p className="text-sm font-bold tabular-nums text-slate-200">{amount(value as number | null)}</p>
              </div>
            ))}
          </div>

          {row.message ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {row.message}
            </p>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Actual transport cost">
              <input
                className={fieldCls} inputMode="decimal"
                placeholder={row.derivedTotalCost !== null ? amount(row.derivedTotalCost) : '0.00'}
                value={form.actualPackageCost}
                onChange={e => set({ actualPackageCost: e.target.value })}
              />
              <span className="block mt-1 text-[10px] text-slate-500">
                What the package really came to. Blank keeps the costed figure.
              </span>
            </Field>

            <Field label="Actual balance payable">
              <input
                className={fieldCls} inputMode="decimal"
                placeholder={row.balancePayable !== null ? amount(row.balancePayable) : '0.00'}
                value={form.actualBalancePayable}
                onChange={e => set({ actualBalancePayable: e.target.value })}
              />
              <span className="block mt-1 text-[10px] text-slate-500">
                The figure accounts acts on. Required before submitting.
              </span>
            </Field>

            <Field label="Budgeted cost">
              <input
                className={fieldCls} inputMode="decimal" placeholder="0.00"
                value={form.budgetedCost}
                onChange={e => set({ budgetedCost: e.target.value })}
              />
              <span className={cn('block mt-1 text-[10px] font-bold', varianceTone(excess))}>
                {excess === null
                  ? 'No budget — the register shows no variance for this tour.'
                  : `Excess / (shortage) ${bracketed(excess)}`}
              </span>
            </Field>

            <Field label="Bulk number">
              <input
                className={fieldCls} placeholder="e.g. 503"
                value={form.bulkNo}
                onChange={e => set({ bulkNo: e.target.value })}
              />
              <span className="block mt-1 text-[10px] text-slate-500">
                The payment run this tour is settled in. Optional.
              </span>
            </Field>

            <Field label="Cost type">
              <select
                className={fieldCls} value={form.costType}
                onChange={e => set({ costType: e.target.value })}
              >
                <option value="">Not set</option>
                {COST_TYPES.map(c => <option key={c} value={c}>{COST_TYPE_LABEL[c]}</option>)}
              </select>
            </Field>

            <Field label="Remark">
              <input
                className={fieldCls} placeholder="Shown on the register"
                value={form.remarks}
                onChange={e => set({ remarks: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Note to the accounts team">
            <textarea
              className={cn(fieldCls, 'h-20 resize-none')}
              placeholder="Why the actual figures differ from the costed ones."
              value={form.note}
              onChange={e => set({ note: e.target.value })}
            />
          </Field>

          {row.state === 'rejected' && row.decisionNote ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              Sent back by accounts: {row.decisionNote}
            </p>
          ) : null}
          {row.state === 'recorded' ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
              Accounts settled this tour{row.recordedBatchRef ? ` under ${row.recordedBatchRef}` : ''}. The
              figures are closed; the bulk number and remark can still be filed.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] bg-slate-950/40 px-5 py-3">
          {row.state === 'pending' ? (
            <button
              type="button" disabled={busy !== null} onClick={() => post('withdraw')}
              className={ghostBtn}
            >
              {busy === 'withdraw' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Withdraw
            </button>
          ) : null}
          <button
            type="button" disabled={busy !== null} onClick={() => post('save')}
            className={ghostBtn}
          >
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            type="button"
            disabled={busy !== null || row.state === 'pending' || row.state === 'recorded'}
            onClick={() => post('submit')}
            title={
              row.state === 'pending' ? 'Already with the accounts team'
                : row.state === 'recorded' ? 'Already settled'
                : 'Save and send the balance payable to the accounts team'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-100 transition duration-200 hover:bg-sky-500/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
          >
            {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Save &amp; submit
          </button>
        </div>
      </div>
    </div>
  )
}

// ── The page ──────────────────────────────────────────────────────────────────

const VARIANCE_LABEL: Record<string, string> = {
  excess: 'Under budget', shortage: 'Over budget',
  on_budget: 'On budget', unbudgeted: 'No budget entered',
}

const PAYMENT_LABEL: Record<string, string> = {
  rest_due: 'Rest payment due', settled: 'Fully settled', overpaid: 'Overpaid',
}

const GROUP_LABEL: Record<RegisterGroupBy, string> = {
  none: '', bulk: 'bulk', chauffeur: 'chauffeur', agent: 'agent', month: 'month',
}

const COLUMNS: { key: RegisterSortField | null; label: string; title?: string; align?: 'left' | 'right' }[] = [
  { key: 'bulk',      label: 'Bulk',      title: 'The payment run this tour is settled in' },
  { key: 'tour',      label: 'Tour' },
  { key: 'date',      label: 'Date' },
  { key: null,        label: 'Y',         title: 'Arrival year', align: 'right' },
  { key: null,        label: 'M',         title: 'Arrival month', align: 'right' },
  { key: null,        label: 'D',         title: 'Arrival day', align: 'right' },
  { key: 'chauffeur', label: 'Chauffeur' },
  { key: 'agent',     label: 'A/C Name',  title: 'The agent the tour was sold through' },
  { key: null,        label: 'Cost' },
  { key: 'cost',      label: 'Total transport cost', align: 'right' },
  { key: 'advance',   label: 'Advance paid', align: 'right' },
  { key: 'balance',   label: 'Balance payable', title: 'Total cost less the advance already handed over', align: 'right' },
  { key: 'budget',    label: 'Budgeted cost', align: 'right' },
  { key: 'excess',    label: 'Excess / (shortage)', title: 'Budget less what it actually cost', align: 'right' },
  { key: 'variancePct', label: '%', title: 'Excess as a share of the budget', align: 'right' },
  { key: null,        label: 'Status' },
  { key: null,        label: 'Remark' },
]

export default function DriverSettlementsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const mayRecord = role ? hasPermission(role, 'pnl:view_profit') : false

  const today = day(new Date())
  const [query, setQuery] = useState<RegisterQuery>(() => ({
    ...EMPTY_FILTERS,
    dateField: 'arrivalDate',
    from: shift(today, -45),
    to: today,
  }))

  const [data, setData] = useState<RegisterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<RegisterRow | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [nonce, setNonce] = useState(0)

  // The one place the filters become a request, so the screen, the URL and the
  // download can never disagree about which rows are being talked about.
  const qs = useMemo(() => registerSearchParams(query).toString(), [query])

  useEffect(() => {
    let live = true
    setLoading(true)

    fetch(`/api/srilanka/driver-settlements?${qs}`)
      .then(r => r.json())
      .then(json => {
        if (!live) return
        if (!json.success) throw new Error(json.error ?? 'The register could not be loaded.')
        setData(json.data as RegisterPayload)
      })
      .catch((err: unknown) => {
        if (!live) return
        toast.error(err instanceof Error ? err.message : 'The register could not be loaded.')
      })
      .finally(() => { if (live) setLoading(false) })

    return () => { live = false }
  }, [qs, nonce])

  const set = useCallback((patch: Partial<RegisterQuery>) => {
    setQuery(q => ({ ...q, ...patch }))
    setSelected(new Set())
  }, [])

  const reload = useCallback(() => setNonce(n => n + 1), [])

  const rows   = data?.rows ?? []
  const groups = data?.groups ?? []
  const totals = data?.totals

  const byId = useMemo(() => new Map(rows.map(r => [r.bookingId, r])), [rows])
  const chosen = useMemo(
    () => Array.from(selected).map(id => byId.get(id)).filter((r): r is RegisterRow => !!r),
    [selected, byId],
  )

  /**
   * Everything narrowing the view right now, each with the patch that undoes
   * it. The drawer can be shut and the person can still see — and lift — what
   * is being held back.
   */
  const activeFilters = useMemo(() => {
    const out: { label: string; clear: Partial<RegisterQuery> }[] = []
    if (query.search) out.push({ label: `“${query.search}”`, clear: { search: '' } })
    if (query.bulkNo) out.push({ label: `Bulk ${query.bulkNo}`, clear: { bulkNo: '' } })
    if (query.bulk !== 'all') {
      out.push({ label: query.bulk === 'in_bulk' ? 'In a bulk' : 'Not in a bulk', clear: { bulk: 'all' } })
    }
    if (query.costType !== 'all') {
      out.push({
        label: query.costType === 'unset' ? 'Cost type not set' : COST_TYPE_LABEL[query.costType as SettlementCostType],
        clear: { costType: 'all' },
      })
    }
    if (query.state !== 'all') {
      out.push({
        label: REGISTER_STATE_LABEL[query.state as keyof typeof REGISTER_STATE_LABEL],
        clear: { state: 'all' },
      })
    }
    if (query.variance !== 'all') out.push({ label: VARIANCE_LABEL[query.variance], clear: { variance: 'all' } })
    if (query.payment !== 'all') out.push({ label: PAYMENT_LABEL[query.payment], clear: { payment: 'all' } })
    if (query.chauffeur) out.push({ label: `Chauffeur “${query.chauffeur}”`, clear: { chauffeur: '' } })
    if (query.agent) out.push({ label: `Agent “${query.agent}”`, clear: { agent: '' } })
    if (query.minBalance !== null) out.push({ label: `Balance from ${amount(query.minBalance)}`, clear: { minBalance: null } })
    if (query.maxBalance !== null) out.push({ label: `Balance to ${amount(query.maxBalance)}`, clear: { maxBalance: null } })
    if (query.openOnly) out.push({ label: 'Only what is still owed', clear: { openOnly: false } })
    if (query.approvedOnly) out.push({ label: 'P&L approved only', clear: { approvedOnly: false } })
    if (query.groupBy !== 'none') out.push({ label: `Grouped by ${GROUP_LABEL[query.groupBy]}`, clear: { groupBy: 'none' } })
    return out
  }, [query])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleAll = () => setSelected(prev =>
    prev.size === rows.length ? new Set() : new Set(rows.map(r => r.bookingId)))

  const sortBy = (key: RegisterSortField | null) => {
    if (!key) return
    set(query.sortBy === key
      ? { sortDir: query.sortDir === 'asc' ? 'desc' : 'asc' }
      : { sortBy: key, sortDir: 'asc' })
  }

  /**
   * The register as a CSV, built from the rows already on screen.
   *
   * Deliberately client-side: the download must be the view the person is
   * looking at, and re-running the query server-side to build it would leave
   * room for the two to differ.
   */
  const exportCsv = () => {
    const head = [
      'Bulk No', 'Tour', 'Date', 'Y', 'M', 'D', 'Chauffeur', 'A/C Name', 'Cost',
      'Total Transport Cost', 'Advance Paid', 'Balance Payable', 'Budgeted Cost',
      'Excess / (Shortage)', '%', 'Status', 'Remark',
    ]
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([
        r.bulkNo, r.tour, workbookDate(r.date), r.year, r.month, r.day,
        r.chauffeur, r.acName, r.costTypeLabel,
        r.totalCost, r.advancePaid, r.balancePayable, r.budgetedCost,
        r.excess, r.variancePct, REGISTER_STATE_LABEL[r.state], r.remarks,
      ].map(cell).join(','))
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `driver-settlements-${query.from}_${query.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* ── Header ── */}
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-slate-900/60 px-5 py-4">
        {/* Two soft lights, so the top of the page has somewhere to look. */}
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-emerald-500/[0.13] blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -top-28 h-56 w-56 rounded-full bg-sky-500/[0.10] blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[280px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-300">
                <Banknote className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                Driver Settlement Register
              </h1>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.13em] text-emerald-200">
                Sri Lanka
              </span>
              {loading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.13em] text-sky-200">
                  <Loader2 className="h-3 w-3 animate-spin" /> Reading
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              Finished tours, gathered into bulks and settled: what the transport cost, what was advanced,
              what is still payable and how it landed against budget. Recording here raises a request —
              the rest payment itself is released by the accounts team on Payable 1.0.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/srilanka/driver-allocation" className={ghostBtn}>
              <Navigation2 className="h-3.5 w-3.5" /> Driver allocation
            </Link>
            <Link href="/dashboard/srilanka/drive-log" className={ghostBtn}>
              <Wallet className="h-3.5 w-3.5" /> Drive Log
            </Link>
            <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={ghostBtn}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export
            </button>
            <button
              type="button" onClick={reload} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-100 transition duration-200 hover:bg-sky-500/30 active:scale-[0.97] disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
            </button>
          </div>
        </div>
      </header>

      {/* ── Degradation notices ── */}
      {data && !data.advancesAvailable ? (
        <Notice tone="orange">
          The accounts database could not be read, so no costed figures are shown. The tour, chauffeur and
          bulk columns are still live.
        </Notice>
      ) : null}
      {data && data.advancesAvailable && !data.actualsAvailable ? (
        <Notice tone="orange">
          The saved settlement entries could not be read, so every row shows the costed figures alone.
          Do not record anything until this clears — a save would not see what is already there.
        </Notice>
      ) : null}
      {data?.truncated ? (
        <Notice tone="amber">
          This window holds {data.matched} tours; only the first {data.windowTotals.rows} are loaded. Narrow the
          dates — every total below counts only what is shown.
        </Notice>
      ) : null}

      {/* ── The figures ── */}
      {totals ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <Stat
            lead tone="sky" icon={Banknote}
            label="Balance payable" value={amount(totals.balancePayable)}
            meter={totals.balancePayable > 0 ? 1 - totals.restOutstanding / totals.balancePayable : null}
            sub={`still to release ${amount(totals.restOutstanding)}`}
          />
          <Stat
            tone="slate" icon={Layers}
            label="Total transport cost" value={amount(totals.totalCost)}
            sub={`${totals.rows} tour${totals.rows === 1 ? '' : 's'} in view`}
          />
          <Stat
            tone="violet" icon={Wallet}
            label="Advance paid" value={amount(totals.advancePaid)}
            meter={totals.totalCost > 0 ? totals.advancePaid / totals.totalCost : null}
            sub="already handed to drivers"
          />
          <Stat
            tone="indigo" icon={Target}
            label="Budgeted cost" value={amount(totals.budgetedCost)}
            meter={totals.rows > 0 ? totals.budgeted / totals.rows : null}
            sub={`${totals.budgeted} of ${totals.rows} tours budgeted`}
          />
          <Stat
            // With nothing budgeted there is no variance to be pleased about,
            // so the card stays neutral rather than showing a green zero.
            tone={totals.budgeted === 0 ? 'slate' : totals.excess >= 0 ? 'emerald' : 'rose'}
            icon={totals.budgeted === 0 ? Target : totals.excess >= 0 ? TrendingUp : TrendingDown}
            label="Excess / (shortage)"
            value={totals.budgeted === 0 ? '—' : bracketed(totals.excess)}
            sub={totals.variancePct !== null ? `${percent(totals.variancePct)} of budget` : 'no budget entered'}
          />
          <Stat
            tone="emerald" icon={BadgeCheck}
            label="Settled" value={`${totals.settled} / ${totals.rows}`}
            meter={totals.rows > 0 ? totals.settled / totals.rows : null}
            sub={`${totals.pending} with accounts`}
          />
        </div>
      ) : null}

      {/* ── Filters ── */}
      <div className="rounded-2xl border border-white/[0.07] bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              className={cn(fieldCls, 'h-9 rounded-xl pl-9 pr-8 text-[13px]')}
              placeholder="Tour, control no, guest, chauffeur, agent, bulk, batch…"
              value={query.search}
              onChange={e => set({ search: e.target.value })}
            />
            {query.search ? (
              <button
                type="button" onClick={() => set({ search: '' })} title="Clear the search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* The date window, as one control rather than three loose boxes. */}
          <div className="flex h-9 items-center gap-1 rounded-xl border border-white/[0.08] bg-slate-950/60 px-1.5">
            <CalendarDays className="ml-1 h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <input
              type="date" aria-label="From" title="From"
              className="w-[112px] bg-transparent px-1 text-xs text-slate-100 focus:outline-none [color-scheme:dark]"
              value={query.from} onChange={e => set({ from: e.target.value })}
            />
            <span className="text-slate-600">→</span>
            <input
              type="date" aria-label="To" title="To"
              className="w-[112px] bg-transparent px-1 text-xs text-slate-100 focus:outline-none [color-scheme:dark]"
              value={query.to} onChange={e => set({ to: e.target.value })}
            />
            <span className="mx-1 h-4 w-px bg-white/[0.1]" />
            <select
              aria-label="Date measured on" title="Which date the window is measured on"
              className="bg-transparent pr-1 text-xs font-bold text-slate-300 focus:outline-none [color-scheme:dark]"
              value={query.dateField}
              onChange={e => set({ dateField: e.target.value as RegisterQuery['dateField'] })}
            >
              <option value="arrivalDate">Arrival</option>
              <option value="departureDate">Departure</option>
            </select>
          </div>

          {/* The windows the desk actually asks for. */}
          <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-slate-950/40 p-1">
            {presets(today).map(p => {
              const on = query.from === p.from && query.to === p.to
              return (
                <button
                  key={p.label} type="button"
                  onClick={() => set({ from: p.from, to: p.to })}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition duration-200',
                    on
                      ? 'bg-sky-500/20 text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <button
            type="button" onClick={() => setAdvanced(a => !a)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition duration-200',
              advanced || activeFilters.length > 0
                ? 'border-sky-400/40 bg-sky-500/15 text-sky-100'
                : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:border-white/[0.18] hover:text-white',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            {activeFilters.length > 0 ? (
              <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-sky-400/25 px-1 text-[10px] font-black text-sky-100">
                {activeFilters.length}
              </span>
            ) : null}
            <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', advanced && 'rotate-180')} />
          </button>
        </div>

        {advanced ? (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Bulk">
              <select
                className={fieldCls} value={query.bulkNo || query.bulk}
                onChange={e => {
                  const v = e.target.value
                  if (v === 'all' || v === 'in_bulk' || v === 'no_bulk') set({ bulk: v, bulkNo: '' })
                  else set({ bulk: 'all', bulkNo: v })
                }}
              >
                <option value="all">All</option>
                <option value="in_bulk">In a bulk</option>
                <option value="no_bulk">Not in a bulk</option>
                {(data?.bulks ?? []).map(b => <option key={b} value={b}>Bulk {b}</option>)}
              </select>
            </Field>

            <Field label="Cost type">
              <select
                className={fieldCls} value={query.costType}
                onChange={e => set({ costType: e.target.value as RegisterQuery['costType'] })}
              >
                <option value="all">All</option>
                <option value="unset">Not set</option>
                {COST_TYPES.map(c => <option key={c} value={c}>{COST_TYPE_LABEL[c]}</option>)}
              </select>
            </Field>

            <Field label="Settlement">
              <select
                className={fieldCls} value={query.state}
                onChange={e => set({ state: e.target.value as RegisterQuery['state'] })}
              >
                <option value="all">All</option>
                {(Object.keys(REGISTER_STATE_LABEL) as (keyof typeof REGISTER_STATE_LABEL)[]).map(s => (
                  <option key={s} value={s}>{REGISTER_STATE_LABEL[s]}</option>
                ))}
              </select>
            </Field>

            <Field label="Against budget">
              <select
                className={fieldCls} value={query.variance}
                onChange={e => set({ variance: e.target.value as RegisterQuery['variance'] })}
              >
                <option value="all">All</option>
                <option value="excess">Under budget (excess)</option>
                <option value="shortage">Over budget (shortage)</option>
                <option value="on_budget">On budget</option>
                <option value="unbudgeted">No budget entered</option>
              </select>
            </Field>

            <Field label="Payment">
              <select
                className={fieldCls} value={query.payment}
                onChange={e => set({ payment: e.target.value as RegisterQuery['payment'] })}
              >
                <option value="all">All</option>
                <option value="rest_due">Rest payment due</option>
                <option value="settled">Fully settled</option>
                <option value="overpaid">Overpaid</option>
              </select>
            </Field>

            <Field label="Group by">
              <select
                className={fieldCls} value={query.groupBy}
                onChange={e => set({ groupBy: e.target.value as RegisterGroupBy })}
              >
                <option value="none">Nothing</option>
                <option value="bulk">Bulk</option>
                <option value="chauffeur">Chauffeur</option>
                <option value="agent">Agent</option>
                <option value="month">Month</option>
              </select>
            </Field>

            <Field label="Chauffeur">
              <input
                className={fieldCls} placeholder="Name contains…"
                value={query.chauffeur} onChange={e => set({ chauffeur: e.target.value })}
              />
            </Field>

            <Field label="Agent">
              <input
                className={fieldCls} placeholder="Name contains…"
                value={query.agent} onChange={e => set({ agent: e.target.value })}
              />
            </Field>

            <Field label="Balance from">
              <input
                className={fieldCls} inputMode="decimal" placeholder="min"
                value={query.minBalance ?? ''}
                onChange={e => set({ minBalance: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>

            <Field label="Balance to">
              <input
                className={fieldCls} inputMode="decimal" placeholder="max"
                value={query.maxBalance ?? ''}
                onChange={e => set({ maxBalance: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>

            <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-3 lg:col-span-2">
              <Chip active={query.openOnly} onClick={() => set({ openOnly: !query.openOnly })}>
                <Banknote className="h-3 w-3" />Only what is still owed
              </Chip>
              <Chip active={query.approvedOnly} onClick={() => set({ approvedOnly: !query.approvedOnly })}>
                <BadgeCheck className="h-3 w-3" />P&amp;L approved only
              </Chip>
            </div>
          </div>
        ) : null}

        {activeFilters.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.07] pt-3">
            <Filter className="h-3 w-3 flex-shrink-0 text-slate-600" />
            {activeFilters.map(f => (
              <button
                key={f.label} type="button" onClick={() => set(f.clear)}
                title="Remove this filter"
                className="group inline-flex max-w-[240px] items-center gap-1 rounded-full border border-sky-400/25 bg-sky-500/10 py-1 pl-2.5 pr-1.5 text-[11px] font-bold text-sky-100 transition duration-200 hover:border-sky-400/50 hover:bg-sky-500/20"
              >
                <span className="truncate">{f.label}</span>
                <X className="h-3 w-3 flex-shrink-0 text-sky-300/70 group-hover:text-sky-100" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => set({ ...EMPTY_FILTERS, dateField: query.dateField, from: query.from, to: query.to })}
              className="ml-1 rounded-full px-2 py-1 text-[11px] font-bold text-slate-500 underline-offset-2 transition hover:text-slate-200 hover:underline"
            >
              Clear all
            </button>
          </div>
        ) : null}

        {data ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-bold text-slate-300 tabular-nums">{totals?.rows ?? 0}</span>
            of
            <span className="tabular-nums">{data.windowTotals.rows}</span>
            tours in this window
            {totals && totals.noRate > 0
              ? ` · ${totals.noRate} have no rupee rate and are shown in their costed currency`
              : ''}
          </p>
        ) : null}
      </div>

      {/* ── Bulk actions ── */}
      {chosen.length > 0 && mayRecord ? (
        <BulkBar
          rows={chosen}
          onDone={() => { setSelected(new Set()); reload() }}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {/* ── The register ── */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-slate-900/60 shadow-xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-xs">
            <thead className="sticky top-0 z-10 bg-slate-950/85 backdrop-blur supports-[backdrop-filter]:bg-slate-950/70">
              <tr className="border-b border-white/[0.08]">
                <th className="w-8 px-2 py-2.5">
                  <input
                    type="checkbox" className="accent-sky-500"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                    disabled={!mayRecord || rows.length === 0}
                    title={mayRecord ? 'Select every row in view' : 'Read-only'}
                  />
                </th>
                {COLUMNS.map(c => (
                  <th
                    key={c.label} title={c.title}
                    onClick={() => sortBy(c.key)}
                    className={cn(
                      'whitespace-nowrap px-2.5 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.key && 'cursor-pointer select-none hover:text-slate-100',
                      c.key && query.sortBy === c.key ? 'text-sky-200' : 'text-slate-500',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.key && query.sortBy === c.key
                        ? (query.sortDir === 'asc'
                            ? <ArrowUp className="w-3 h-3" />
                            : <ArrowDown className="w-3 h-3" />)
                        : null}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2.5 w-10" />
              </tr>
            </thead>

            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center text-slate-500">
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-sky-400/70" />
                    Reading the register…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center">
                    <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-slate-600">
                      <Search className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-bold text-slate-300">No tours match these filters</p>
                    <p className="mt-1 text-xs text-slate-500">Widen the dates, or clear a filter above.</p>
                  </td>
                </tr>
              ) : (
                groups.map(group => {
                  const isCollapsed = collapsed.has(group.key)
                  return (
                    <GroupBlock
                      key={group.key || 'ungrouped'}
                      group={group}
                      grouped={query.groupBy !== 'none'}
                      collapsed={isCollapsed}
                      onToggle={() => setCollapsed(prev => {
                        const next = new Set(prev)
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key)
                        return next
                      })}
                      selected={selected}
                      onSelect={toggle}
                      mayRecord={mayRecord}
                      onEdit={setEditing}
                    />
                  )
                })
              )}
            </tbody>

            {totals && rows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-10 border-t border-white/[0.12] bg-slate-950/90 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80">
                <tr className="font-black text-slate-200">
                  <td className="px-2 py-3" />
                  <td className="px-2.5 py-3 uppercase tracking-[0.1em] text-[11px]" colSpan={8}>
                    Total
                    <span className="ml-2 text-[10px] font-bold normal-case tracking-normal text-slate-500">
                      {totals.rows} tours · {totals.pax} pax
                    </span>
                  </td>
                  <td className="px-2.5 py-3 text-right"><Num value={totals.totalCost} bold /></td>
                  <td className="px-2.5 py-3 text-right"><Num value={totals.advancePaid} bold /></td>
                  <td className="px-2.5 py-3 text-right"><Num value={totals.balancePayable} bold /></td>
                  <td className="px-2.5 py-3 text-right"><Num value={totals.budgetedCost} bold /></td>
                  <td className="px-2.5 py-3 text-right">
                    <Num value={totals.excess} bold bracket tone={varianceTone(totals.excess)} />
                  </td>
                  <td className={cn('px-2.5 py-3 text-right tabular-nums', varianceTone(totals.excess))}>
                    {percent(totals.variancePct)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {editing ? (
        <RowEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => reload()}
        />
      ) : null}
    </div>
  )
}

// ── Group block ───────────────────────────────────────────────────────────────

function GroupBlock({
  group, grouped, collapsed, onToggle, selected, onSelect, mayRecord, onEdit,
}: {
  group: RegisterGroup
  grouped: boolean
  collapsed: boolean
  onToggle: () => void
  selected: Set<string>
  onSelect: (id: string) => void
  mayRecord: boolean
  onEdit: (row: RegisterRow) => void
}) {
  return (
    <>
      {grouped ? (
        <tr className="border-y border-white/[0.08] bg-indigo-500/[0.07]">
          <td className="relative px-2 py-2">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-indigo-400/70" />
            <button
              type="button" onClick={onToggle}
              title={collapsed ? 'Show these tours' : 'Hide these tours'}
              className="rounded-md p-0.5 text-slate-400 transition hover:bg-white/[0.08] hover:text-white"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </td>
          <td className="px-2.5 py-2 font-black text-slate-100" colSpan={8}>
            {group.label}
            <span className="ml-2 text-[10px] font-bold text-slate-500">
              {group.totals.rows} tour{group.totals.rows === 1 ? '' : 's'} · {group.totals.pax} pax
            </span>
          </td>
          <td className="px-2.5 py-2 text-right"><Num value={group.totals.totalCost} bold /></td>
          <td className="px-2.5 py-2 text-right"><Num value={group.totals.advancePaid} bold /></td>
          <td className="px-2.5 py-2 text-right"><Num value={group.totals.balancePayable} bold /></td>
          <td className="px-2.5 py-2 text-right"><Num value={group.totals.budgetedCost} bold /></td>
          <td className="px-2.5 py-2 text-right">
            <Num value={group.totals.excess} bold bracket tone={varianceTone(group.totals.excess)} />
          </td>
          <td className={cn('px-2.5 py-2 text-right tabular-nums font-bold', varianceTone(group.totals.excess))}>
            {percent(group.totals.variancePct)}
          </td>
          <td colSpan={3} />
        </tr>
      ) : null}

      {collapsed ? null : group.rows.map(r => (
        <Row
          key={r.bookingId}
          row={r}
          checked={selected.has(r.bookingId)}
          onSelect={() => onSelect(r.bookingId)}
          mayRecord={mayRecord}
          onEdit={() => onEdit(r)}
        />
      ))}
    </>
  )
}

// ── One line of the workbook ──────────────────────────────────────────────────

function Row({
  row, checked, onSelect, mayRecord, onEdit,
}: {
  row: RegisterRow
  checked: boolean
  onSelect: () => void
  mayRecord: boolean
  onEdit: () => void
}) {
  return (
    <tr className={cn(
      'group border-b border-white/[0.05] transition-colors duration-150',
      checked ? 'bg-sky-500/[0.09]' : 'odd:bg-white/[0.015] hover:bg-white/[0.045]',
    )}>
      <td className="relative px-2 py-2">
        {checked ? <span className="absolute inset-y-0 left-0 w-[3px] bg-sky-400" /> : null}
        <input
          type="checkbox" className="accent-sky-500" checked={checked}
          onChange={onSelect} disabled={!mayRecord}
        />
      </td>

      <td className="px-2.5 py-2">
        {row.bulkNo ? (
          <span className="rounded-md border border-indigo-400/30 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-black text-indigo-200">
            {row.bulkNo}
          </span>
        ) : <Empty />}
      </td>

      <td className="px-2.5 py-2">
        <Link
          href={`/dashboard/bookings/${row.bookingRef}`}
          className="inline-flex items-center gap-1 font-bold text-slate-100 transition-colors hover:text-sky-300"
        >
          {row.tour}
          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </Link>
        {row.clientName ? (
          <p className="text-[10px] text-slate-500 truncate max-w-[160px]">{row.clientName}</p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 whitespace-nowrap text-slate-300">{workbookDate(row.date)}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.year ?? <Empty />}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.month ?? <Empty />}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.day ?? <Empty />}</td>

      <td className="px-2.5 py-2">
        {row.chauffeur ? (
          <span className="text-slate-200">{row.chauffeur}</span>
        ) : row.vendorName ? (
          <span className="text-slate-400 italic">{row.vendorName}</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300">
            <AlertTriangle className="h-2.5 w-2.5" />Unallocated
          </span>
        )}
      </td>

      <td className="px-2.5 py-2 max-w-[200px] truncate text-slate-300" title={row.acName ?? undefined}>
        {row.acName ?? <Empty />}
      </td>

      <td className="px-2.5 py-2 whitespace-nowrap">
        {row.costTypeLabel
          ? <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-slate-300">{row.costTypeLabel}</span>
          : <Empty />}
      </td>

      <td className="px-2.5 py-2 text-right">
        <Num value={row.totalCost} bold />
        {row.costOverridden ? (
          <span
            className="block text-[9px] font-black text-violet-300"
            title={`Accounts costed ${amount(row.derivedTotalCost)}`}
          >
            actual
          </span>
        ) : null}
      </td>

      <td className="px-2.5 py-2 text-right">
        <Num value={row.advancePaid === null ? null : -row.advancePaid} bracket tone="text-violet-300" />
      </td>
      <td className="px-2.5 py-2 text-right"><Num value={row.balancePayable} bold tone="text-sky-200" /></td>
      <td className="px-2.5 py-2 text-right"><Num value={row.budgetedCost} /></td>
      <td className="px-2.5 py-2 text-right">
        <Num value={row.excess} bold bracket tone={varianceTone(row.excess)} />
      </td>
      <td className={cn('px-2.5 py-2 text-right tabular-nums font-bold', varianceTone(row.excess))}>
        {percent(row.variancePct)}
      </td>

      <td className="px-2.5 py-2 whitespace-nowrap">
        <span className={cn(
          'inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]',
          REGISTER_STATE_TONE[row.state],
        )}>
          {REGISTER_STATE_LABEL[row.state]}
        </span>
        {!row.payable ? (
          <span className="block text-[9px] text-amber-400/80 font-bold mt-0.5" title="Accounts cannot release against an unapproved P&L">
            P&amp;L not approved
          </span>
        ) : null}
      </td>

      <td className="px-2.5 py-2 max-w-[180px] truncate text-slate-400" title={row.remarks ?? undefined}>
        {row.remarks ?? <Empty />}
      </td>

      <td className="px-2 py-2 text-right">
        <button
          type="button" onClick={onEdit}
          disabled={!mayRecord}
          title={mayRecord ? 'Record this settlement' : 'Only the accounts team and admins may record settlements'}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-1.5 text-slate-400 opacity-60 transition duration-200 hover:border-sky-400/40 hover:bg-sky-500/15 hover:text-sky-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-20"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

/**
 * What a selection can be told to become.
 *
 * A bulk here is a batch of *paperwork*: it files tours under one payment run,
 * names what they are settled for and sets the budget they are measured
 * against. "Submit" sends each one's saved balance payable to the accounts
 * team. Nothing on this bar pays anybody — the money leaves on Payable 1.0,
 * one booking at a time, against an approved P&L.
 */
function BulkBar({
  rows, onDone, onClear,
}: {
  rows: RegisterRow[]
  onDone: () => void
  onClear: () => void
}) {
  const [bulkNo, setBulkNo] = useState('')
  const [costType, setCostType] = useState<SettlementCostType | ''>('')
  const [budget, setBudget] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<{ tour: string; error: string }[]>([])

  const ids = rows.map(r => r.bookingId)
  const owed = rows.reduce((n, r) => n + (r.restOutstanding ?? 0), 0)

  const run = async (action: 'assign' | 'submit' | 'withdraw') => {
    setBusy(action); setFailures([])

    const body: Record<string, unknown> = { action, bookingIds: ids }
    if (action === 'assign') {
      // Only the boxes that were filled in travel. An empty one means "leave it
      // as it is", not "clear it" — clearing twenty rows by tabbing past a box
      // is not a thing this bar should be able to do.
      if (bulkNo.trim()) body.bulkNo = bulkNo.trim()
      if (costType) body.costType = costType
      if (budget.trim()) body.budgetedCost = budget.trim()
      if (remarks.trim()) body.remarks = remarks.trim()

      if (Object.keys(body).length === 2) {
        toast.error('Fill in a bulk number, cost type, budget or remark first.')
        setBusy(null)
        return
      }
    }

    try {
      const res = await fetch('/api/srilanka/driver-settlements/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'That could not be applied.')

      const failed = (json.data.results as { tour: string; ok: boolean; error?: string }[])
        .filter(r => !r.ok)
        .map(r => ({ tour: r.tour, error: r.error ?? 'Unknown' }))

      setFailures(failed)
      if (failed.length === 0) {
        toast.success(json.data.message)
        onDone()
      } else {
        toast.warning(json.data.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That could not be applied.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sticky top-2 z-30 space-y-2 rounded-2xl border border-sky-400/40 bg-slate-900/95 p-3 shadow-2xl shadow-sky-950/40 backdrop-blur">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-2.5 pr-2">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border border-sky-400/30 bg-sky-500/20 text-sky-200">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-black text-white">{rows.length} selected</p>
            <p className="text-[10px] tabular-nums text-slate-400">{amount(owed)} still to release</p>
          </div>
        </div>

        <div className="w-28"><Field label="Bulk no">
          <input className={fieldCls} placeholder="503" value={bulkNo} onChange={e => setBulkNo(e.target.value)} />
        </Field></div>

        <div className="w-44"><Field label="Cost type">
          <select
            className={fieldCls} value={costType}
            onChange={e => setCostType(e.target.value as SettlementCostType | '')}
          >
            <option value="">Leave as is</option>
            {COST_TYPES.map(c => <option key={c} value={c}>{COST_TYPE_LABEL[c]}</option>)}
          </select>
        </Field></div>

        <div className="w-32"><Field label="Budget (each)">
          <input className={fieldCls} inputMode="decimal" placeholder="0.00" value={budget} onChange={e => setBudget(e.target.value)} />
        </Field></div>

        <div className="flex-1 min-w-[160px]"><Field label="Remark">
          <input className={fieldCls} placeholder="Applied to every selected tour" value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field></div>

        <button
          type="button" disabled={busy !== null} onClick={() => run('assign')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-3 py-1.5 text-xs font-bold text-indigo-100 transition duration-200 hover:bg-indigo-500/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          {busy === 'assign' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Apply
        </button>
        <button
          type="button" disabled={busy !== null} onClick={() => run('submit')}
          title="Send each selected tour's saved balance payable to the accounts team"
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-100 transition duration-200 hover:bg-sky-500/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Submit to accounts
        </button>
        <button
          type="button" disabled={busy !== null} onClick={() => run('withdraw')}
          className={ghostBtn}
        >
          {busy === 'withdraw' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
          Withdraw
        </button>
        <button
          type="button" onClick={onClear} title="Clear the selection"
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-1.5 text-slate-500 transition hover:border-white/[0.2] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {failures.length > 0 ? (
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-xl border border-rose-400/25 bg-rose-500/[0.09] px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-300">
            {failures.length} could not be updated
          </p>
          {failures.map(f => (
            <p key={f.tour} className="text-[11px] text-rose-200">
              <span className="font-bold">{f.tour}</span> — {f.error}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
