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
  ChevronRight, Columns3, Download, ExternalLink, EyeOff, FileSpreadsheet, FileText, Filter,
  GripVertical, Layers, Loader2, Navigation2, Pencil, Plus, RefreshCw, RotateCcw, Save, Search,
  Send, SlidersHorizontal, Star, Target, Trash2, TrendingDown, TrendingUp, Undo2, Users,
  Wallet, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { COST_TYPES, COST_TYPE_LABEL, type SettlementCostType } from '@/lib/sl-settlement-costs'
import {
  EMPTY_FILTERS, REGISTER_STATE_LABEL, REGISTER_STATE_TONE,
  amount, bracketed, parseRegisterQuery, percent, registerSearchParams, workbookDate,
  type RegisterGroup, type RegisterGroupBy, type RegisterQuery, type RegisterRow,
  type RegisterSortField, type RegisterTotals,
} from '@/lib/sl-settlement-register'
import {
  COLUMN_BY_ID, REGISTER_COLUMNS, columnText, columnTotal, columnValue, defaultView,
  isNumericKind, normaliseViews, resolveColumns,
  type RegisterColumnDef, type RegisterColumnGroup, type RegisterView,
} from '@/lib/sl-settlement-columns'
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
  // The variance the register prints: the package agreed with the driver less
  // what the transport actually came to. The budget is planning, not the base.
  const excess = row.packageCost !== null && cost !== null ? row.packageCost - cost : null

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
                  ? 'No package cost saved — the register shows no variance for this tour.'
                  : `Excess / (shortage) ${bracketed(excess)} against the package`}
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
  excess: 'Under the package', shortage: 'Over the package',
  on_budget: 'On the package', unbudgeted: 'No package cost saved',
}

const PAYMENT_LABEL: Record<string, string> = {
  rest_due: 'Rest payment due', settled: 'Fully settled', overpaid: 'Overpaid',
}

const GROUP_LABEL: Record<RegisterGroupBy, string> = {
  none: '', bulk: 'bulk', chauffeur: 'chauffeur', agent: 'agent', month: 'month',
}

/**
 * The register's columns are no longer fixed here — they live in
 * `sl-settlement-columns.ts` as a catalogue, and what is drawn is whatever the
 * person's current view asks for. See that file for why.
 */
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

  /* ── The layout ──
   * `view` is what is on screen right now, saved or not; `views` is what this
   * person has stored. They are deliberately separate: rearranging columns has
   * to be instant and free, and nothing is written until somebody presses save.
   */
  const [view, setView] = useState<RegisterView>(() => defaultView())
  const [views, setViews] = useState<RegisterView[]>([])
  const [showColumns, setShowColumns] = useState(false)
  const [showViews, setShowViews] = useState(false)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)

  const cols = useMemo(() => resolveColumns(view), [view])

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

  /**
   * This person's saved layouts, and whichever one they marked as their
   * default. A failure here is silent on purpose: a layout that will not load
   * costs some column order, and a red toast on a money screen should mean the
   * money did not load.
   */
  useEffect(() => {
    let live = true
    fetch('/api/srilanka/driver-settlements/views')
      .then(r => r.json())
      .then(json => {
        if (!live || !json?.success) return
        const saved = normaliseViews(json.data?.views)
        setViews(saved)

        const start = saved.find(v => v.isDefault)
        if (!start) return
        setView(start)
        // A view may carry the filters it was saved under. They are re-parsed
        // rather than trusted: what is stored is a query string this screen
        // wrote months ago, and the clamps have to be applied again.
        if (start.query) setQuery(parseRegisterQuery(new URLSearchParams(start.query)))
      })
      .catch(() => { /* see above */ })
    return () => { live = false }
  }, [])

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

  // ── Layouts ────────────────────────────────────────────────────────────────

  /**
   * Write the whole set back.
   *
   * The client always holds every view, so a whole-set write keeps the "exactly
   * one default" rule in one place on the server instead of spread across three
   * endpoints. What comes back is what was stored — possibly with a name
   * trimmed or a retired column dropped — and that is what is rendered.
   */
  const persistViews = useCallback(async (next: RegisterView[]): Promise<RegisterView[]> => {
    setViews(next)
    try {
      const res = await fetch('/api/srilanka/driver-settlements/views', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ views: next }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'The layout could not be saved.')
      const stored = normaliseViews(json.data.views)
      setViews(stored)
      return stored
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The layout could not be saved.')
      return next
    }
  }, [])

  /** True when the view on screen differs from the copy that was saved. */
  const saved = views.find(v => v.id === view.id)
  const dirty = !!saved && JSON.stringify(saved.columns) !== JSON.stringify(view.columns)

  const applyView = useCallback((v: RegisterView) => {
    setView(v)
    setShowViews(false)
    if (v.query) setQuery(parseRegisterQuery(new URLSearchParams(v.query)))
  }, [])

  const saveAsView = useCallback(async (name: string, withFilters: boolean) => {
    const next: RegisterView = {
      id: `v${Date.now().toString(36)}`,
      name,
      columns: view.columns,
      query: withFilters ? Object.fromEntries(registerSearchParams(query)) : null,
      isDefault: views.length === 0,
    }
    const stored = await persistViews([...views, next])
    const mine = stored.find(v => v.id === next.id)
    if (mine) setView(mine)
    toast.success(`Saved “${name}”`)
  }, [view.columns, query, views, persistViews])

  const updateView = useCallback(async () => {
    if (!saved) return
    const next = views.map(v => v.id === view.id
      ? { ...v, columns: view.columns, updatedAt: new Date().toISOString() }
      : v)
    await persistViews(next)
    toast.success(`Updated “${view.name}”`)
  }, [saved, views, view, persistViews])

  const renameView = useCallback(async (id: string, name: string) => {
    const next = views.map(v => (v.id === id ? { ...v, name } : v))
    await persistViews(next)
    if (view.id === id) setView(v => ({ ...v, name }))
  }, [views, view.id, persistViews])

  const deleteView = useCallback(async (id: string) => {
    await persistViews(views.filter(v => v.id !== id))
    // Deleting the layout you are standing in drops you back on the shipped
    // one rather than leaving a view on screen that no longer exists.
    if (view.id === id) setView(defaultView())
  }, [views, view.id, persistViews])

  const makeDefaultView = useCallback(async (id: string) => {
    await persistViews(views.map(v => ({ ...v, isDefault: v.id === id })))
  }, [views, persistViews])

  // ── Downloads ──────────────────────────────────────────────────────────────

  /**
   * The register as a workbook or as a printable statement.
   *
   * The layout is posted; the *rows* are re-read on the server from the same
   * filters the screen is showing. A browser left open since this morning would
   * otherwise hand somebody a download of this morning's figures under today's
   * date, and this is the page a payment run is approved from.
   */
  const download = useCallback(async (kind: 'xlsx' | 'pdf') => {
    setExporting(kind)
    try {
      const res = await fetch(
        `/api/srilanka/driver-settlements/${kind === 'pdf' ? 'export-pdf' : 'export'}?${qs}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view }),
        })

      if (!res.ok) {
        let message = 'The download could not be built.'
        try { message = (await res.json()).error ?? message } catch { /* not JSON */ }
        throw new Error(message)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `driver-settlements-${query.from}_${query.to}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The download could not be built.')
    } finally {
      setExporting(null)
    }
  }, [qs, view, query.from, query.to])

  /**
   * The register as a CSV, built from the rows already on screen.
   *
   * Kept beside the workbook because the two are used for different things: the
   * workbook is read, the CSV is fed to something else. Deliberately
   * client-side, and deliberately the person's own columns — a download that
   * ignored the layout would be a different sheet from the one on screen.
   */
  const exportCsv = () => {
    const cell = (v: unknown) => {
      const t = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const lines = [cols.map(c => cell(c.label)).join(',')]
    for (const r of rows) {
      lines.push(cols.map(c => cell(
        isNumericKind(c.kind) ? columnValue(r, c.id) : columnText(r, c, ''),
      )).join(','))
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
            <button
              type="button" onClick={() => setShowColumns(true)} className={ghostBtn}
              title="Choose, rename and reorder the columns"
            >
              <Columns3 className="h-3.5 w-3.5" /> Columns
              <span className="ml-0.5 rounded bg-white/[0.08] px-1 text-[10px] tabular-nums text-slate-300">
                {cols.length}
              </span>
            </button>

            <ViewMenu
              open={showViews}
              onOpen={setShowViews}
              current={view}
              views={views}
              dirty={dirty}
              onApply={applyView}
              onSaveAs={saveAsView}
              onUpdate={updateView}
              onRename={renameView}
              onDelete={deleteView}
              onMakeDefault={makeDefaultView}
              onReset={() => { setView(defaultView()); setShowViews(false) }}
            />

            <ExportMenu
              disabled={rows.length === 0}
              busy={exporting}
              onExcel={() => download('xlsx')}
              onPdf={() => download('pdf')}
              onCsv={exportCsv}
            />
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
            // The advance has two halves and the register only ever showed one.
            // What was promised at the start of a tour and never handed over is
            // owed just as much as the balance at the end of it, so the meter
            // now runs against the advance *due* and the line underneath says
            // what is still outstanding on it.
            tone="violet" icon={Wallet}
            label="Advance paid" value={amount(totals.advancePaid)}
            meter={totals.advanceDue > 0 ? totals.advancePaid / totals.advanceDue : null}
            sub={totals.advancePending > 0.009
              ? `${amount(totals.advancePending)} still pending of ${amount(totals.advanceDue)} due`
              : totals.advanceDue > 0
                ? `all ${amount(totals.advanceDue)} due has been handed over`
                : 'already handed to drivers'}
          />
          <Stat
            tone="indigo" icon={Target}
            label="Budgeted cost" value={amount(totals.budgetedCost)}
            meter={totals.rows > 0 ? totals.budgeted / totals.rows : null}
            sub={`${totals.budgeted} of ${totals.rows} tours budgeted`}
          />
          <Stat
            // With no package cost saved anywhere there is no variance to be
            // pleased about, so the card stays neutral rather than showing a
            // green zero.
            tone={totals.packaged === 0 ? 'slate' : totals.excess >= 0 ? 'emerald' : 'rose'}
            icon={totals.packaged === 0 ? Target : totals.excess >= 0 ? TrendingUp : TrendingDown}
            label="Excess / (shortage)"
            value={totals.packaged === 0 ? '—' : bracketed(totals.excess)}
            sub={totals.variancePct !== null
              ? `${percent(totals.variancePct)} of the package`
              : 'no package cost saved'}
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
                <option value="excess">Under the package (excess)</option>
                <option value="shortage">Over the package (shortage)</option>
                <option value="on_budget">On the package</option>
                <option value="unbudgeted">No package cost saved</option>
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
          <table className="w-full text-xs" style={{ minWidth: `${Math.max(900, cols.length * 108)}px` }}>
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
                {cols.map(c => (
                  <th
                    key={c.id} title={c.title}
                    onClick={() => sortBy(c.sort ?? null)}
                    className={cn(
                      'whitespace-nowrap px-2.5 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors',
                      isNumericKind(c.kind) ? 'text-right' : 'text-left',
                      c.sort && 'cursor-pointer select-none hover:text-slate-100',
                      c.sort && query.sortBy === c.sort ? 'text-sky-200' : 'text-slate-500',
                    )}
                  >
                    <span className={cn('inline-flex items-center gap-1',
                      isNumericKind(c.kind) && 'flex-row-reverse')}>
                      {c.label}
                      {c.sort && query.sortBy === c.sort
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
                  <td colSpan={cols.length + 2} className="px-4 py-20 text-center text-slate-500">
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-sky-400/70" />
                    Reading the register…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 2} className="px-4 py-20 text-center">
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
                      cols={cols}
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
                  <TotalCells
                    cols={cols} totals={totals} pad="py-3"
                    label={<>
                      Total
                      <span className="ml-2 text-[10px] font-bold normal-case tracking-normal text-slate-500">
                        {totals.rows} tours · {totals.pax} pax
                      </span>
                    </>}
                  />
                  <td className="px-2 py-3" />
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

      {showColumns ? (
        <ColumnsPanel
          view={view}
          dirty={dirty}
          savedName={saved?.name ?? null}
          onChange={setView}
          onSave={saved ? updateView : null}
          onClose={() => setShowColumns(false)}
        />
      ) : null}
    </div>
  )
}

// ── Group block ───────────────────────────────────────────────────────────────

function GroupBlock({
  group, cols, grouped, collapsed, onToggle, selected, onSelect, mayRecord, onEdit,
}: {
  group: RegisterGroup
  cols: RegisterColumnDef[]
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
          <TotalCells
            cols={cols} totals={group.totals} pad="py-2" bold
            label={<>
              {group.label}
              <span className="ml-2 text-[10px] font-bold text-slate-500">
                {group.totals.rows} tour{group.totals.rows === 1 ? '' : 's'} · {group.totals.pax} pax
              </span>
            </>}
          />
          <td className="px-2 py-2" />
        </tr>
      ) : null}

      {collapsed ? null : group.rows.map(r => (
        <Row
          key={r.bookingId}
          row={r}
          cols={cols}
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
  row, cols, checked, onSelect, mayRecord, onEdit,
}: {
  row: RegisterRow
  cols: RegisterColumnDef[]
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

      {cols.map(c => <BodyCell key={c.id} row={row} col={c} />)}

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

// ── Cells ─────────────────────────────────────────────────────────────────────

/**
 * One cell of the register, whichever column it turns out to be.
 *
 * Most columns are their `kind` and nothing more, and are formatted by the
 * catalogue. The handful below are exceptions because the *shape* of the cell
 * carries information no formatter could: a tour is a link into the booking, a
 * missing chauffeur is a warning rather than a blank, a status is a badge, and
 * a corrected total says so under itself. Everything else falls through to the
 * kind, which is what makes adding a column to the catalogue enough to make it
 * appear here.
 */
function BodyCell({ row, col }: { row: RegisterRow; col: RegisterColumnDef }) {
  const pad = 'px-2.5 py-2'
  const raw = columnValue(row, col.id)

  switch (col.id) {
    case 'bulk':
      return (
        <td className={pad}>
          {row.bulkNo ? (
            <span className="rounded-md border border-indigo-400/30 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-black text-indigo-200">
              {row.bulkNo}
            </span>
          ) : <Empty />}
        </td>
      )

    case 'tour':
      return (
        <td className={pad}>
          <Link
            href={`/dashboard/bookings/${row.bookingRef}`}
            className="inline-flex items-center gap-1 font-bold text-slate-100 transition-colors hover:text-sky-300"
          >
            {row.tour}
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </Link>
          {row.clientName ? (
            <p className="max-w-[160px] truncate text-[10px] text-slate-500">{row.clientName}</p>
          ) : null}
        </td>
      )

    case 'chauffeur':
      return (
        <td className={pad}>
          {row.chauffeur ? (
            <span className="text-slate-200">{row.chauffeur}</span>
          ) : row.vendorName ? (
            <span className="italic text-slate-400">{row.vendorName}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300">
              <AlertTriangle className="h-2.5 w-2.5" />Unallocated
            </span>
          )}
        </td>
      )

    case 'costType':
      return (
        <td className={cn(pad, 'whitespace-nowrap')}>
          {row.costTypeLabel
            ? <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-slate-300">{row.costTypeLabel}</span>
            : <Empty />}
        </td>
      )

    // The desk's corrected figure, with what accounts derived kept under it —
    // a corrected total that did not say so would look like a costing error.
    case 'totalCost':
      return (
        <td className={cn(pad, 'text-right')}>
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
      )

    case 'packageCost':
      return <td className={cn(pad, 'text-right')}><Num value={row.packageCost} tone="text-emerald-200" /></td>

    case 'balancePayable':
      return <td className={cn(pad, 'text-right')}><Num value={row.balancePayable} bold tone="text-sky-200" /></td>

    // Promised and not handed over. Amber only when there is something to
    // chase; a settled advance should not shout.
    case 'advancePending':
      return (
        <td className={cn(pad, 'text-right')}>
          <Num
            value={row.advancePending} bold={!!row.advancePending}
            tone={row.advancePending && row.advancePending > 0.009 ? 'text-amber-300' : 'text-slate-500'}
          />
        </td>
      )

    case 'restOutstanding':
      return (
        <td className={cn(pad, 'text-right')}>
          <Num
            value={row.restOutstanding}
            tone={row.restOutstanding && row.restOutstanding > 0.009 ? 'text-sky-200' : 'text-slate-500'}
          />
        </td>
      )

    case 'excess':
    case 'budgetVariance':
      return (
        <td className={cn(pad, 'text-right')}>
          <Num value={raw as number | null} bold bracket tone={varianceTone(raw as number | null)} />
        </td>
      )

    case 'variancePct':
      return (
        <td className={cn(pad, 'text-right tabular-nums font-bold', varianceTone(row.excess))}>
          {percent(row.variancePct)}
        </td>
      )

    case 'status':
      return (
        <td className={cn(pad, 'whitespace-nowrap')}>
          <span className={cn(
            'inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]',
            REGISTER_STATE_TONE[row.state],
          )}>
            {REGISTER_STATE_LABEL[row.state]}
          </span>
          {!row.payable ? (
            <span className="mt-0.5 block text-[9px] font-bold text-amber-400/80" title="Accounts cannot release against an unapproved P&L">
              P&amp;L not approved
            </span>
          ) : null}
        </td>
      )

    default:
      break
  }

  // Everything else is its kind.
  if (col.kind === 'outflow') {
    return (
      <td className={cn(pad, 'text-right')}>
        <Num
          value={raw === null || raw === undefined ? null : -(raw as number)}
          bracket tone="text-violet-300"
        />
      </td>
    )
  }
  if (col.kind === 'money') {
    return <td className={cn(pad, 'text-right')}><Num value={raw as number | null} bracket /></td>
  }
  if (col.kind === 'int') {
    return (
      <td className={cn(pad, 'text-right tabular-nums text-slate-500')}>
        {raw === null || raw === undefined ? <Empty /> : String(raw)}
      </td>
    )
  }
  if (col.kind === 'date') {
    return <td className={cn(pad, 'whitespace-nowrap text-slate-300')}>{workbookDate(row.date)}</td>
  }

  const text = columnText(row, col, '')
  return (
    <td className={cn(pad, 'max-w-[200px] truncate text-slate-400')} title={text || undefined}>
      {text || <Empty />}
    </td>
  )
}

/**
 * A subtotal line across the current columns.
 *
 * The label runs under the leading columns rather than sitting in the first
 * one: "Bulk 503 · 12 tours" needs the room, and the first money column is
 * wherever the person happened to put it. Columns with nothing to total are
 * left blank rather than filled with a dash, so the eye runs straight down the
 * figures that do add up.
 */
function TotalCells({
  cols, totals, label, pad, bold,
}: {
  cols: RegisterColumnDef[]
  totals: RegisterTotals
  label: React.ReactNode
  pad: string
  bold?: boolean
}) {
  const first = cols.findIndex(c => columnTotal(totals, c) !== null)
  const span = first === -1 ? cols.length : Math.max(1, first)

  return (
    <>
      <td className={cn('px-2.5 uppercase tracking-[0.1em] text-[11px] font-black text-slate-100', pad)} colSpan={span}>
        {label}
      </td>
      {cols.slice(span).map(c => {
        const v = columnTotal(totals, c)
        if (v === null) return <td key={c.id} className={cn('px-2.5', pad)} />
        if (c.id === 'variancePct') {
          return (
            <td key={c.id} className={cn('px-2.5 text-right tabular-nums font-bold', pad, varianceTone(totals.excess))}>
              {percent(totals.variancePct)}
            </td>
          )
        }
        return (
          <td key={c.id} className={cn('px-2.5 text-right', pad)}>
            <Num
              value={v} bold bracket
              tone={c.id === 'excess' ? varianceTone(totals.excess)
                : c.id === 'packageCost' ? 'text-emerald-200'
                : bold ? 'text-slate-200' : undefined}
            />
          </td>
        )
      })}
    </>
  )
}

// ── The column picker ─────────────────────────────────────────────────────────

/**
 * Where the table becomes the person's own.
 *
 * Two lists side by side: what is shown, in order, and what else there is. The
 * shown list is the one that can be dragged, because order only means something
 * there — a hidden column has no position. Drag is the fast path and the arrows
 * are the reliable one: this screen is worked on laptops with trackpads and on
 * a tablet in a bulk meeting, and a reorder that can only be done by dragging
 * is a reorder some people cannot do.
 *
 * Renaming edits a *label*, never an id. The register's arithmetic, sorting and
 * totals go on calling the column what it is, so a desk that renames "Package
 * cost" to "Agreed rate" changes nothing but the heading — and the hover note
 * still explains which figure it actually is.
 */
function ColumnsPanel({
  view, dirty, savedName, onChange, onSave, onClose,
}: {
  view: RegisterView
  dirty: boolean
  savedName: string | null
  onChange: (v: RegisterView) => void
  onSave: (() => void) | null
  onClose: () => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [search, setSearch] = useState('')

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

  const shown = view.columns
  const shownIds = new Set(shown.map(c => c.id))

  const put = (columns: RegisterView['columns']) => onChange({ ...view, columns })

  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length || from === to) return
    const next = [...shown]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    put(next)
  }

  const hide = (id: string) => {
    // The table has to keep at least one column; an empty register is not a
    // layout, it is a page with nothing on it.
    if (shown.length <= 1) {
      toast.error('The register needs at least one column.')
      return
    }
    put(shown.filter(c => c.id !== id))
  }

  const add = (id: string) => put([...shown, { id }])

  const rename = (id: string, label: string) =>
    put(shown.map(c => (c.id === id ? { ...c, label: label.trim() || null } : c)))

  const available = REGISTER_COLUMNS.filter(c =>
    !shownIds.has(c.id)
    && (search.trim() === ''
      || c.label.toLowerCase().includes(search.trim().toLowerCase())
      || c.group.toLowerCase().includes(search.trim().toLowerCase())))

  const byGroup = ['Tour', 'People', 'Money', 'Settlement'] as RegisterColumnGroup[]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.09] bg-slate-900 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-black text-white">
              <Columns3 className="h-4 w-4 text-sky-300" /> Columns
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Drag to reorder, click a heading to rename it, and add whatever this desk works from.
              {savedName ? ` Editing the layout “${savedName}”.` : ' This layout is not saved yet.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {/* ── Shown ── */}
          <section>
            <h3 className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
              <span>On the register · {shown.length}</span>
              <button
                type="button"
                onClick={() => put(defaultView().columns)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
              >
                <RotateCcw className="h-3 w-3" /> Reset to default
              </button>
            </h3>

            <ul className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
              {shown.map((c, i) => {
                const def = COLUMN_BY_ID[c.id]
                if (!def) return null
                return (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragOver={e => { e.preventDefault(); setOver(i) }}
                    onDragEnd={() => { setDrag(null); setOver(null) }}
                    onDrop={e => {
                      e.preventDefault()
                      if (drag !== null) move(drag, i)
                      setDrag(null); setOver(null)
                    }}
                    className={cn(
                      'group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition',
                      drag === i ? 'border-sky-400/50 bg-sky-500/10 opacity-60'
                        : over === i ? 'border-sky-400/40 bg-white/[0.05]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]',
                    )}
                  >
                    <GripVertical className="h-3.5 w-3.5 flex-shrink-0 cursor-grab text-slate-600" />

                    <input
                      value={c.label ?? def.label}
                      onChange={e => rename(c.id, e.target.value)}
                      title={def.title ?? def.label}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-bold text-slate-100 outline-none transition hover:border-white/[0.1] focus:border-sky-400/50 focus:bg-slate-950/60"
                    />

                    {c.label && c.label !== def.label ? (
                      <span className="hidden text-[9px] text-slate-500 sm:inline" title={`Shipped as “${def.label}”`}>
                        {def.label}
                      </span>
                    ) : null}

                    <div className="flex flex-shrink-0 items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                        title="Move left" className="rounded p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white disabled:opacity-20">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => move(i, i + 1)} disabled={i === shown.length - 1}
                        title="Move right" className="rounded p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white disabled:opacity-20">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => hide(c.id)}
                        title="Take this column off the register" className="rounded p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-200">
                        <EyeOff className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ── Available ── */}
          <section>
            <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
              Add a column · {available.length} available
            </h3>

            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search columns…"
                className="w-full rounded-lg border border-white/[0.08] bg-slate-950/60 py-1.5 pl-8 pr-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </div>

            <div className="max-h-[40vh] space-y-3 overflow-y-auto pr-1">
              {byGroup.map(g => {
                const items = available.filter(c => c.group === g)
                if (items.length === 0) return null
                return (
                  <div key={g}>
                    <p className="mb-1 text-[9px] font-black uppercase tracking-[0.14em] text-slate-600">{g}</p>
                    <ul className="space-y-1">
                      {items.map(c => (
                        <li key={c.id}>
                          <button
                            type="button" onClick={() => add(c.id)} title={c.title}
                            className="flex w-full items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 text-left transition hover:border-sky-400/40 hover:bg-sky-500/10"
                          >
                            <Plus className="h-3 w-3 flex-shrink-0 text-slate-500" />
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-200">{c.label}</span>
                            {c.derived ? (
                              <span className="flex-shrink-0 rounded bg-violet-500/15 px-1 text-[9px] font-black uppercase text-violet-300" title="Worked out from the other columns — there is nowhere to edit it">
                                calc
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
              {available.length === 0 ? (
                <p className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-center text-[11px] text-slate-500">
                  Every column is already on the register.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] bg-slate-950/40 px-5 py-3">
          <p className="text-[11px] text-slate-500">
            {dirty
              ? 'This layout has unsaved changes.'
              : savedName ? 'Saved.' : 'Save it as a view to keep it between sessions.'}
          </p>
          <div className="flex items-center gap-2">
            {onSave ? (
              <button
                type="button" onClick={() => { onSave(); }} disabled={!dirty}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" /> Save layout
              </button>
            ) : null}
            <button
              type="button" onClick={onClose}
              className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-white/[0.08]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Saved views ───────────────────────────────────────────────────────────────

/**
 * The layouts this person has kept, and the one they are standing in.
 *
 * A view is a *place on this screen*: the columns, and optionally the filters
 * that were set when it was saved. "Bulk 503, still owed, grouped by chauffeur"
 * is somewhere a person goes back to weekly, and a saved layout that dropped
 * the filters would only get them half way there — so saving offers both, and
 * says which it did.
 *
 * Views are per person and stored server-side, so the layout follows them from
 * the office desktop to the tablet in a bulk meeting. Nothing here is shared:
 * one desk's columns are not another's, and a shared layout is a change to
 * somebody else's screen that they did not ask for.
 */
function ViewMenu({
  open, onOpen, current, views, dirty,
  onApply, onSaveAs, onUpdate, onRename, onDelete, onMakeDefault, onReset,
}: {
  open: boolean
  onOpen: (v: boolean) => void
  current: RegisterView
  views: RegisterView[]
  dirty: boolean
  onApply: (v: RegisterView) => void
  onSaveAs: (name: string, withFilters: boolean) => void
  onUpdate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onMakeDefault: (id: string) => void
  onReset: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [withFilters, setWithFilters] = useState(true)

  useEffect(() => {
    if (!open) { setNaming(false); setName('') }
  }, [open])

  const saveAs = () => {
    const trimmed = name.trim()
    if (!trimmed) { toast.error('Give the view a name.'); return }
    onSaveAs(trimmed, withFilters)
    setNaming(false); setName(''); onOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button" onClick={() => onOpen(!open)}
        title="Saved layouts"
        className={ghostBtn}
      >
        <Layers className="h-3.5 w-3.5" />
        <span className="max-w-[130px] truncate">{current.name}</span>
        {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" /> : null}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open ? (
        <>
          {/* Click-away. A menu that only closes on its own button is a menu
              people leave open over the figures they were reading. */}
          <div className="fixed inset-0 z-40" onClick={() => onOpen(false)} />

          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/[0.09] bg-slate-900 shadow-2xl shadow-black/50">
            <div className="max-h-72 overflow-y-auto p-1.5">
              <button
                type="button" onClick={onReset}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]',
                  current.id === 'default' && 'bg-sky-500/10')}
              >
                <RotateCcw className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
                <span className="flex-1 text-xs font-bold text-slate-200">Register (default)</span>
                {current.id === 'default' ? <Check className="h-3.5 w-3.5 text-sky-300" /> : null}
              </button>

              {views.length ? <div className="my-1 border-t border-white/[0.06]" /> : null}

              {views.map(v => (
                <div
                  key={v.id}
                  className={cn('group flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-white/[0.06]',
                    current.id === v.id && 'bg-sky-500/10')}
                >
                  <button
                    type="button" onClick={() => onApply(v)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-slate-200">{v.name}</span>
                      <span className="block text-[10px] text-slate-500">
                        {v.columns.length} columns{v.query ? ' · with filters' : ''}
                        {v.isDefault ? ' · opens by default' : ''}
                      </span>
                    </span>
                    {current.id === v.id ? <Check className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" /> : null}
                  </button>

                  <div className="flex flex-shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button" title={v.isDefault ? 'Opens by default' : 'Open this one by default'}
                      onClick={() => onMakeDefault(v.id)}
                      className={cn('rounded p-1 transition hover:bg-white/[0.08]',
                        v.isDefault ? 'text-amber-300' : 'text-slate-500 hover:text-amber-200')}
                    >
                      <Star className="h-3 w-3" fill={v.isDefault ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button" title="Rename"
                      onClick={() => {
                        const next = window.prompt('Rename this view', v.name)
                        if (next && next.trim()) onRename(v.id, next.trim())
                      }}
                      className="rounded p-1 text-slate-500 transition hover:bg-white/[0.08] hover:text-slate-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button" title="Delete this view"
                      onClick={() => { if (window.confirm(`Delete the view “${v.name}”?`)) onDelete(v.id) }}
                      className="rounded p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-200"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/[0.07] bg-slate-950/40 p-2">
              {naming ? (
                <div className="space-y-2">
                  <input
                    autoFocus value={name} onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveAs() }}
                    placeholder="Name this view…"
                    className="w-full rounded-lg border border-white/[0.08] bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/40"
                  />
                  <label className="flex cursor-pointer items-center gap-2 px-0.5 text-[11px] text-slate-400">
                    <input
                      type="checkbox" className="accent-sky-500"
                      checked={withFilters} onChange={e => setWithFilters(e.target.checked)}
                    />
                    Remember the filters and grouping too
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button" onClick={saveAs}
                      className="flex-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/25"
                    >
                      Save view
                    </button>
                    <button
                      type="button" onClick={() => setNaming(false)}
                      className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/[0.08]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button" onClick={() => setNaming(true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-white/[0.08]"
                  >
                    <Plus className="h-3.5 w-3.5" /> Save as new view
                  </button>
                  {dirty ? (
                    <button
                      type="button" onClick={() => { onUpdate(); onOpen(false) }}
                      title={`Save the changes to “${current.name}”`}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/25"
                    >
                      <Save className="h-3.5 w-3.5" /> Update
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

// ── Downloads ─────────────────────────────────────────────────────────────────

/**
 * Three downloads, because they are read by three different people: the
 * workbook by whoever checks the arithmetic, the PDF by whoever signs the
 * payment run, and the CSV by whatever system it is being pasted into. All
 * three carry the columns on screen, under the headings on screen.
 */
function ExportMenu({
  disabled, busy, onExcel, onPdf, onCsv,
}: {
  disabled: boolean
  busy: 'xlsx' | 'pdf' | null
  onExcel: () => void
  onPdf: () => void
  onCsv: () => void
}) {
  const [open, setOpen] = useState(false)

  const pick = (fn: () => void) => { setOpen(false); fn() }

  const item = 'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]'

  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen(!open)} disabled={disabled || busy !== null}
        className={ghostBtn}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {busy === 'pdf' ? 'Building PDF…' : busy === 'xlsx' ? 'Building sheet…' : 'Export'}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/[0.09] bg-slate-900 p-1.5 shadow-2xl shadow-black/50">
            <button type="button" onClick={() => pick(onExcel)} className={item}>
              <FileSpreadsheet className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
              <span>
                <span className="block text-xs font-bold text-slate-100">Excel workbook</span>
                <span className="block text-[10px] leading-snug text-slate-500">
                  Your columns with subtotals, plus tabs by bulk, by chauffeur, and the exceptions to chase.
                </span>
              </span>
            </button>
            <button type="button" onClick={() => pick(onPdf)} className={item}>
              <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" />
              <span>
                <span className="block text-xs font-bold text-slate-100">Printable PDF</span>
                <span className="block text-[10px] leading-snug text-slate-500">
                  Landscape statement with the totals, the filters it was drawn under and a bulk summary to sign off.
                </span>
              </span>
            </button>
            <button type="button" onClick={() => pick(onCsv)} className={item}>
              <FileSpreadsheet className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
              <span>
                <span className="block text-xs font-bold text-slate-100">CSV</span>
                <span className="block text-[10px] leading-snug text-slate-500">
                  Raw values, no formatting — for pasting into another system.
                </span>
              </span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
