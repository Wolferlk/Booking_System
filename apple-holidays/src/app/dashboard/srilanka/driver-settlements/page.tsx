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
import { COST_TYPES, COST_TYPE_LABEL, type SettlementCostType } from '@/lib/sl-transport-actuals'
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

function Kpi({
  label, value, sub, icon: Icon, tone,
}: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>; tone: string
}) {
  return (
    <div className={cn('flex-1 min-w-[190px] rounded-xl border px-4 py-3', tone)}>
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 opacity-80" />
        <p className="text-[10px] uppercase tracking-wider font-black opacity-80">{label}</p>
      </div>
      <p className="mt-1.5 text-lg font-black tabular-nums text-white">{value}</p>
      {sub ? <p className="text-[10px] opacity-70 mt-0.5">{sub}</p> : null}
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
        'px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors',
        active
          ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
          : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600',
      )}
    >
      {children}
    </button>
  )
}

const fieldCls =
  'w-full bg-slate-900/70 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 ' +
  'placeholder:text-slate-600 focus:outline-none focus:border-sky-500/60'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-black mb-1">{label}</span>
      {children}
    </label>
  )
}

/** A money cell. Negative in brackets, the workbook's convention throughout. */
function Num({
  value, bold, tone, bracket,
}: { value: number | null; bold?: boolean; tone?: string; bracket?: boolean }) {
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-black">Settle tour</p>
            <h2 className="text-lg font-black text-white">{row.tour}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {workbookDate(row.date)} · {row.chauffeur ?? 'no chauffeur allocated'}
              {row.acName ? ` · ${row.acName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* What the accounts system says, before anybody corrects it. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            {[
              ['Costed total', row.derivedTotalCost],
              ['Advance paid', row.advancePaid],
              ['Balance payable', row.balancePayable],
              ['Rest paid', row.restPaid],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[9px] uppercase tracking-wider text-slate-500 font-black">{String(label)}</p>
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

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          {row.state === 'pending' ? (
            <button
              type="button" disabled={busy !== null} onClick={() => post('withdraw')}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white disabled:opacity-50"
            >
              {busy === 'withdraw' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <>Withdraw</>}
            </button>
          ) : null}
          <button
            type="button" disabled={busy !== null} onClick={() => post('save')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-200 hover:text-white disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
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
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy === 'submit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Save &amp; submit
          </button>
        </div>
      </div>
    </div>
  )
}

// ── The page ──────────────────────────────────────────────────────────────────

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
    <div className="p-4 sm:p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-400" />
            <h1 className="text-xl font-black text-white">Driver Settlement Register</h1>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              Sri Lanka
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Finished tours, gathered into bulks and settled: what the transport cost, what was advanced,
            what is still payable and how it landed against budget. Recording here raises a request —
            the rest payment itself is released by the accounts team on Payable 1.0.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/srilanka/driver-allocation"
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            <Navigation2 className="w-3.5 h-3.5" /> Driver allocation
          </Link>
          <Link
            href="/dashboard/srilanka/drive-log"
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            <Wallet className="w-3.5 h-3.5" /> Drive Log
          </Link>
          <button
            type="button" onClick={exportCsv} disabled={rows.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export
          </button>
          <button
            type="button" onClick={reload}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Degradation notices ── */}
      {data && !data.advancesAvailable ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-xs text-orange-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          The accounts database could not be read, so no costed figures are shown. The tour, chauffeur and
          bulk columns are still live.
        </div>
      ) : null}
      {data && data.advancesAvailable && !data.actualsAvailable ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-xs text-orange-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          The saved settlement entries could not be read, so every row shows the costed figures alone.
          Do not record anything until this clears — a save would not see what is already there.
        </div>
      ) : null}
      {data?.truncated ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          This window holds {data.matched} tours; only the first {data.windowTotals.rows} are loaded. Narrow the
          dates — every total below counts only what is shown.
        </div>
      ) : null}

      {/* ── KPIs ── */}
      {totals ? (
        <div className="flex flex-wrap gap-3">
          <Kpi
            label="Total transport cost" value={amount(totals.totalCost)}
            sub={`${totals.rows} tour${totals.rows === 1 ? '' : 's'} in view`}
            icon={Layers} tone="bg-slate-500/10 border-slate-500/30 text-slate-300"
          />
          <Kpi
            label="Advance paid" value={amount(totals.advancePaid)}
            sub="already handed to drivers"
            icon={Wallet} tone="bg-violet-500/10 border-violet-500/30 text-violet-300"
          />
          <Kpi
            label="Balance payable" value={amount(totals.balancePayable)}
            sub={`still to release ${amount(totals.restOutstanding)}`}
            icon={Banknote} tone="bg-sky-500/10 border-sky-500/30 text-sky-300"
          />
          <Kpi
            label="Budgeted cost" value={amount(totals.budgetedCost)}
            sub={`${totals.budgeted} of ${totals.rows} tours budgeted`}
            icon={Target} tone="bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
          />
          <Kpi
            label="Excess / (shortage)" value={bracketed(totals.excess)}
            sub={totals.variancePct !== null ? `${percent(totals.variancePct)} of budget` : 'no budget entered'}
            icon={totals.excess >= 0 ? TrendingUp : TrendingDown}
            tone={totals.excess >= 0
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}
          />
          <Kpi
            label="Settled" value={`${totals.settled} / ${totals.rows}`}
            sub={`${totals.pending} with accounts`}
            icon={BadgeCheck} tone="bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          />
        </div>
      ) : null}

      {/* ── Filters ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
            <input
              className={cn(fieldCls, 'pl-8')}
              placeholder="Tour, control no, guest, chauffeur, agent, bulk, batch…"
              value={query.search}
              onChange={e => set({ search: e.target.value })}
            />
          </div>

          <div className="flex items-end gap-1.5">
            <Field label="From">
              <input
                type="date" className={fieldCls} value={query.from}
                onChange={e => set({ from: e.target.value })}
              />
            </Field>
            <Field label="To">
              <input
                type="date" className={fieldCls} value={query.to}
                onChange={e => set({ to: e.target.value })}
              />
            </Field>
            <Field label="On">
              <select
                className={fieldCls} value={query.dateField}
                onChange={e => set({ dateField: e.target.value as RegisterQuery['dateField'] })}
              >
                <option value="arrivalDate">Arrival</option>
                <option value="departureDate">Departure</option>
              </select>
            </Field>
          </div>

          <div className="flex items-center gap-1.5">
            {presets(today).map(p => (
              <Chip
                key={p.label}
                active={query.from === p.from && query.to === p.to}
                onClick={() => set({ from: p.from, to: p.to })}
              >
                <CalendarDays className="inline w-3 h-3 mr-1 -mt-0.5" />{p.label}
              </Chip>
            ))}
          </div>

          <button
            type="button" onClick={() => setAdvanced(a => !a)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5',
              advanced
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:text-white',
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
            {advanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </div>

        {advanced ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 border-t border-slate-800 pt-3">
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

            <div className="flex items-end gap-2 col-span-2">
              <Chip active={query.openOnly} onClick={() => set({ openOnly: !query.openOnly })}>
                Only what is still owed
              </Chip>
              <Chip active={query.approvedOnly} onClick={() => set({ approvedOnly: !query.approvedOnly })}>
                P&amp;L approved only
              </Chip>
              <Chip
                active={false}
                onClick={() => set({ ...EMPTY_FILTERS, dateField: query.dateField, from: query.from, to: query.to })}
              >
                <X className="inline w-3 h-3 mr-1 -mt-0.5" />Clear
              </Chip>
            </div>
          </div>
        ) : null}

        {data ? (
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Filter className="w-3 h-3" />
            Showing {totals?.rows ?? 0} of {data.windowTotals.rows} tours in this window
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
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1500px]">
            <thead className="bg-slate-950/70 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2.5 w-8">
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
                      'px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-black whitespace-nowrap',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.key && 'cursor-pointer hover:text-slate-300',
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
                  <td colSpan={COLUMNS.length + 2} className="px-4 py-16 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Reading the register…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="px-4 py-16 text-center text-slate-500">
                    No tours match these filters in this window.
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
              <tfoot className="bg-slate-950/80 border-t-2 border-slate-700">
                <tr className="font-black text-slate-200">
                  <td className="px-2 py-3" />
                  <td className="px-2.5 py-3" colSpan={8}>
                    Total · {totals.rows} tours · {totals.pax} pax
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
        <tr className="bg-slate-800/50 border-y border-slate-700/60">
          <td className="px-2 py-2">
            <button type="button" onClick={onToggle} className="text-slate-400 hover:text-white">
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </td>
          <td className="px-2.5 py-2 font-black text-slate-200" colSpan={8}>
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
      'border-b border-slate-800/60 hover:bg-slate-800/30',
      checked && 'bg-sky-500/5',
    )}>
      <td className="px-2 py-2">
        <input
          type="checkbox" className="accent-sky-500" checked={checked}
          onChange={onSelect} disabled={!mayRecord}
        />
      </td>

      <td className="px-2.5 py-2">
        {row.bulkNo ? (
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-indigo-500/15 border border-indigo-500/30 text-indigo-200">
            {row.bulkNo}
          </span>
        ) : <span className="text-slate-700">—</span>}
      </td>

      <td className="px-2.5 py-2">
        <Link
          href={`/dashboard/bookings/${row.bookingRef}`}
          className="font-bold text-slate-100 hover:text-sky-300 inline-flex items-center gap-1"
        >
          {row.tour}
          <ExternalLink className="w-3 h-3 opacity-50" />
        </Link>
        {row.clientName ? (
          <p className="text-[10px] text-slate-500 truncate max-w-[160px]">{row.clientName}</p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 whitespace-nowrap text-slate-300">{workbookDate(row.date)}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.year ?? '—'}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.month ?? '—'}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-500">{row.day ?? '—'}</td>

      <td className="px-2.5 py-2">
        {row.chauffeur ? (
          <span className="text-slate-200">{row.chauffeur}</span>
        ) : row.vendorName ? (
          <span className="text-slate-400 italic">{row.vendorName}</span>
        ) : (
          <span className="text-amber-400/80 text-[10px] font-bold uppercase tracking-wide">Unallocated</span>
        )}
      </td>

      <td className="px-2.5 py-2 max-w-[200px] truncate text-slate-300" title={row.acName ?? undefined}>
        {row.acName ?? '—'}
      </td>

      <td className="px-2.5 py-2 whitespace-nowrap">
        {row.costTypeLabel
          ? <span className="text-[10px] font-bold text-slate-300">{row.costTypeLabel}</span>
          : <span className="text-slate-700">—</span>}
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
          'px-1.5 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wide',
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
        {row.remarks ?? '—'}
      </td>

      <td className="px-2 py-2 text-right">
        <button
          type="button" onClick={onEdit}
          disabled={!mayRecord}
          title={mayRecord ? 'Record this settlement' : 'Only the accounts team and admins may record settlements'}
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30"
        >
          <Pencil className="w-3.5 h-3.5" />
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
    <div className="sticky top-2 z-20 rounded-xl border border-sky-500/40 bg-slate-900/95 backdrop-blur p-3 space-y-2 shadow-xl">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-2 pr-2">
          <Users className="w-4 h-4 text-sky-300" />
          <div>
            <p className="text-xs font-black text-white">{rows.length} selected</p>
            <p className="text-[10px] text-slate-400">{amount(owed)} still to release</p>
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
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy === 'assign' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Apply
        </button>
        <button
          type="button" disabled={busy !== null} onClick={() => run('submit')}
          title="Send each selected tour's saved balance payable to the accounts team"
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy === 'submit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Submit to accounts
        </button>
        <button
          type="button" disabled={busy !== null} onClick={() => run('withdraw')}
          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:text-white disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy === 'withdraw' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
          Withdraw
        </button>
        <button
          type="button" onClick={onClear}
          className="p-1.5 rounded-lg border border-slate-700 text-slate-500 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {failures.length > 0 ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 space-y-0.5 max-h-32 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-rose-300 font-black">
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
