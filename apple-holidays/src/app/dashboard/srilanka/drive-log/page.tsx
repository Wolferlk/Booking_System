'use client'

/**
 * The Drive Log — Sri Lanka transport settlement.
 *
 * One line per booking answering a single question the accounts desk asks every
 * morning: *for the guests landing in two days, what does the transport cost,
 * who is driving, how much of it has actually left the building, and what is
 * still owed?*
 *
 * ---- Why it looks the way it does ----
 *
 * Nine money columns is more than a table can carry without help, so the screen
 * gives each row one graphic — a three-part settlement bar (advance paid · rest
 * paid · still owed) — and lets the eye find the unfinished rows from twenty
 * feet away instead of reading nine figures per line. The numbers are still
 * there, right-aligned and tabular, for when the reading actually happens.
 *
 * Two views over the same rows, because the desk works in two modes:
 *
 *   By day     the operational read. What lands on the 22nd, and is it settled?
 *   By driver  the payment read. One transfer settles every file a driver is
 *              carrying, so the subtotal under his name is the figure that goes
 *              on the slip — and the panel behind his name carries the bank
 *              details it is paid into.
 *
 * ---- What it does not do ----
 *
 * It never writes. Every rupee on this page was derived by the Apple Accounts
 * system and is displayed verbatim, down to the timestamp saying how old it is;
 * money is released on Payable 1.0, and this screen is the statement, not the
 * cheque book. See `src/lib/sl-drive-log.ts` for the arithmetic and
 * `accounts-driver-advance-db.ts` for why the boundary sits there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, Banknote, CalendarDays, Car, ChevronDown,
  ChevronRight, Clock, Copy, ExternalLink, FileSpreadsheet, FileText, Filter,
  Gauge, Layers, Loader2, Phone, RefreshCw, Search, Sparkles, TrendingDown, TrendingUp,
  User2, Users, Wallet, X, XCircle,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import { cn } from '@/lib/utils'
import { freshness, CATEGORY_TONE } from '@/lib/driver-advance'
import {
  DEFAULT_ARRIVAL_OFFSET_DAYS, SETTLEMENT_LABEL, SETTLEMENT_TONE, STAGE_LABEL,
  amount, arrivalLabel, dayKey, daysBetween, driveLogSearchParams, driveLogTotals, formatDay,
  groupDriveLogRows, shiftDay, windowLabel,
  type DriveLogApproval, type DriveLogDriver, type DriveLogQuery, type DriveLogRow,
  type DriveLogSortField, type DriveLogStage, type DriveLogTotals, type DriveLogView,
} from '@/lib/sl-drive-log'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveLogResponse {
  rows: DriveLogRow[]
  advancesAvailable: boolean
  invoicesAvailable: boolean
  truncated: boolean
  matched: number
  today: string
  query: DriveLogQuery
  totals: DriveLogTotals
}

interface DriverProfile {
  driver: {
    id: string; name: string; phone: string; email: string | null; licenseNo: string | null
    isActive: boolean; photoUrl: string | null; country: string | null
    advanceBalance: number; createdAt: string
    bankName: string | null; bankBranch: string | null; bankCode: string | null
    bankHolder: string | null; bankAccountNo: string | null
    vehicle: {
      id: string; type: string; plateNo: string; brand: string | null; model: string | null
      capacity: number | null; description: string | null; isActive: boolean
      photoInside: string | null; photoOutside: string | null
    } | null
    vendorOwner: { id: string; name: string; phone: string | null; email: string | null } | null
  }
  bookings: {
    id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null
    arrivalDate: string; departureDate: string | null; status: string
    pax: number; clientName: string | null
  }[]
  window: { from: string; to: string }
}

// ── Small pieces ──────────────────────────────────────────────────────────────

/** A figure, right-aligned and tabular so columns line up down the page. */
function Num({
  value, tone = 'default', hint, bold,
}: {
  value: number | null | undefined
  tone?: 'default' | 'muted' | 'due' | 'over' | 'good'
  hint?: string
  bold?: boolean
}) {
  const text = value === null || value === undefined ? '—' : amount(value)
  return (
    <span
      title={hint}
      className={cn(
        'tabular-nums whitespace-nowrap',
        bold ? 'font-bold' : 'font-semibold',
        tone === 'muted' && 'text-slate-500',
        tone === 'due'   && 'text-amber-300',
        tone === 'over'  && 'text-rose-300',
        tone === 'good'  && 'text-emerald-300',
        tone === 'default' && 'text-slate-200',
        (value === null || value === undefined) && 'text-slate-600 font-normal',
      )}
    >
      {text}
    </span>
  )
}

/**
 * The settlement bar — advance paid, rest paid, still owed, in one 3-part rule.
 *
 * The single graphic that makes a row readable without reading it: a full green
 * bar is a finished booking, an empty one is a driver who has been handed
 * nothing yet, and the amber tail is the money the desk still has to move.
 */
function SettlementBar({ row }: { row: DriveLogRow }) {
  const s = row.settlement
  const total = s.totalCost ?? 0

  if (s.state !== 'ok' || total <= 0) {
    return <div className="h-1.5 rounded-full bg-slate-800/80" />
  }

  const pct = (v: number | null) => Math.max(0, Math.min(100, ((v ?? 0) / total) * 100))
  const adv  = pct(s.advancePaid)
  const rest = pct(s.restPaid)
  const owed = Math.max(0, 100 - adv - rest)

  return (
    <div
      className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden flex"
      title={`Advance paid ${amount(s.advancePaid)} · balance paid ${amount(s.restPaid)} · still owed ${amount(s.profitLoss)}`}
    >
      <div style={{ width: `${adv}%` }}  className="bg-emerald-500/80" />
      <div style={{ width: `${rest}%` }} className="bg-teal-400/80" />
      <div style={{ width: `${owed}%` }} className="bg-amber-500/40" />
    </div>
  )
}

/** A KPI tile. `sub` is the caveat — how many rows the figure could not include. */
function Kpi({
  label, value, sub, icon: Icon, tone,
}: {
  label: string
  value: string
  sub?: string | null
  icon: typeof Wallet
  tone: string
}) {
  return (
    <div className="flex-1 min-w-[150px] rounded-2xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cn('w-6 h-6 rounded-lg flex items-center justify-center border', tone)}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</span>
      </div>
      <p className="mt-1.5 text-lg font-black text-white tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p> : null}
    </div>
  )
}

/** A filter chip. */
function Chip({
  active, onClick, children, tone,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  tone?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors',
        active
          ? tone ?? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
          : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700',
      )}
    >
      {children}
    </button>
  )
}

/** A value the user will paste into a bank form — so it can be copied. */
function CopyField({ label, value }: { label: string; value: string | null }) {
  if (!value) return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">{label}</p>
      <p className="text-sm text-slate-600">not recorded</p>
    </div>
  )
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</p>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => toast.success(`${label} copied`),
            () => toast.error('Could not copy'),
          )
        }}
        className="group flex items-center gap-1.5 text-sm text-slate-100 font-semibold hover:text-yellow-300 transition-colors text-left"
      >
        <span className="break-all">{value}</span>
        <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    </div>
  )
}

// ── Driver panel ──────────────────────────────────────────────────────────────

/**
 * Everything about one driver, and everything he is carrying.
 *
 * The rows already in hand supply the money side — the same figures the table
 * is showing, so the panel can never disagree with the line the user clicked.
 * The profile and the wider schedule are fetched, because they are not worth
 * carrying on four hundred rows.
 */
function DriverPanel({
  driverId, fallback, rows, onClose,
}: {
  driverId: string | null
  fallback: DriveLogRow['driver']
  rows: DriveLogRow[]
  onClose: () => void
}) {
  const [profile, setProfile] = useState<DriverProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!driverId) { setProfile(null); return }
    let cancelled = false
    setLoading(true); setError(null)

    fetch(`/api/srilanka/drive-log/driver?driverId=${encodeURIComponent(driverId)}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error ?? 'Could not load this driver')
        return json.data as DriverProfile
      })
      .then(data => { if (!cancelled) setProfile(data) })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [driverId])

  // The files this driver holds inside the window currently on screen.
  const mine = useMemo(
    () => rows.filter(r => r.driver && (driverId ? r.driver.id === driverId : r.driver.name === fallback?.name)),
    [rows, driverId, fallback?.name],
  )
  const totals = useMemo(() => driveLogTotals(mine), [mine])

  const d = profile?.driver
  const bank = d
    ? { name: d.bankName, branch: d.bankBranch, code: d.bankCode, holder: d.bankHolder, accountNo: d.bankAccountNo }
    : fallback?.bank ?? null
  const vehicle = d?.vehicle ?? null

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl z-50 flex flex-col bg-[#0c1225] border-l border-slate-800 shadow-2xl shadow-black/50">

        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800 flex-shrink-0">
          {fallback?.photoUrl || d?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(d?.photoUrl ?? fallback?.photoUrl) as string}
              alt=""
              className="w-11 h-11 rounded-xl object-cover border border-slate-700"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center">
              <User2 className="w-5 h-5 text-teal-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base truncate">{d?.name ?? fallback?.name ?? 'Driver'}</p>
            <p className="text-slate-400 text-xs mt-0.5 truncate">
              {[d?.phone ?? fallback?.phone, fallback?.vendorName].filter(Boolean).join(' · ') || 'No contact recorded'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* What this driver is owed across the rows on screen. */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                In this window · {mine.length} file{mine.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Total transport cost</p><p className="font-bold text-white tabular-nums">LKR {amount(totals.totalCost)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Advance</p><p className="font-bold text-white tabular-nums">LKR {amount(totals.advance)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Actually paid</p><p className="font-bold text-emerald-300 tabular-nums">LKR {amount(totals.paid)}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Still owed</p><p className={cn('font-bold tabular-nums', totals.profitLoss > 0.01 ? 'text-amber-300' : 'text-emerald-300')}>LKR {amount(totals.profitLoss)}</p></div>
            </div>
            {d ? (
              <p className="mt-3 pt-3 border-t border-emerald-500/15 text-[11px] text-slate-400">
                Running advance balance held against this driver by Ground:{' '}
                <span className="font-bold text-slate-200 tabular-nums">LKR {amount(d.advanceBalance)}</span>
              </p>
            ) : null}
          </div>

          {/* Bank — the reason the panel exists at payment time. */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Banknote className="w-4 h-4 text-yellow-400" />
              <p className="text-xs font-black text-slate-300 uppercase tracking-wider">Account details</p>
            </div>
            {bank && (bank.accountNo || bank.name) ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <CopyField label="Account number" value={bank.accountNo} />
                <CopyField label="Account holder" value={bank.holder} />
                <CopyField label="Bank" value={bank.name} />
                <CopyField label="Branch" value={bank.branch} />
                <CopyField label="Bank code" value={bank.code} />
              </div>
            ) : (
              <p className="text-sm text-amber-300/80 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                No bank details on file — this driver cannot be paid by transfer until Ground records them.
              </p>
            )}
          </div>

          {/* Vehicle */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Car className="w-4 h-4 text-violet-400" />
              <p className="text-xs font-black text-slate-300 uppercase tracking-wider">Vehicle</p>
            </div>
            {vehicle || fallback?.vehicle ? (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Plate</p><p className="font-bold text-white font-mono">{vehicle?.plateNo ?? fallback?.vehicle?.plateNo ?? '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Type</p><p className="font-semibold text-slate-200">{vehicle?.type ?? fallback?.vehicle?.type ?? '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Make / model</p><p className="font-semibold text-slate-200">{[vehicle?.brand ?? fallback?.vehicle?.brand, vehicle?.model ?? fallback?.vehicle?.model].filter(Boolean).join(' ') || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Seats</p><p className="font-semibold text-slate-200">{vehicle?.capacity ?? fallback?.vehicle?.capacity ?? '—'}</p></div>
                </div>
                {vehicle?.photoOutside || vehicle?.photoInside ? (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {[vehicle.photoOutside, vehicle.photoInside].filter(Boolean).map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src as string} alt="" className="w-full h-24 object-cover rounded-lg border border-slate-800" />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">No vehicle linked to this driver.</p>
            )}
          </div>

          {/* Licence, vendor, contact */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <CopyField label="Phone" value={d?.phone ?? fallback?.phone ?? null} />
            <CopyField label="Email" value={d?.email ?? null} />
            <CopyField label="Licence no" value={d?.licenseNo ?? fallback?.licenseNo ?? null} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Vendor</p>
              <p className="text-sm text-slate-200 font-semibold">{d?.vendorOwner?.name ?? fallback?.vendorName ?? '—'}</p>
            </div>
          </div>

          {/* The wider schedule — is one transfer going to settle more than this window? */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-sky-400" />
              <p className="text-xs font-black text-slate-300 uppercase tracking-wider">Other files</p>
              {loading ? <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" /> : null}
            </div>

            {error ? (
              <p className="text-sm text-rose-300">{error}</p>
            ) : !driverId ? (
              <p className="text-sm text-slate-500">
                This name was typed onto a movement rather than allocated from the driver list, so there is no
                driver record to read a schedule from.
              </p>
            ) : profile ? (
              profile.bookings.length ? (
                <div className="space-y-1.5">
                  {profile.bookings.map(b => (
                    <Link
                      key={b.id}
                      href={`/dashboard/bookings/${b.bookingRef}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800/60 hover:border-slate-700 transition-colors"
                    >
                      <span className="font-mono text-xs font-bold text-yellow-400 w-20 flex-shrink-0">
                        {b.isNumber ?? b.bookingRef}
                      </span>
                      <span className="text-xs text-slate-300 flex-1 truncate">{b.clientName ?? '—'}</span>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">{formatDay(b.arrivalDate)}</span>
                    </Link>
                  ))}
                  <p className="text-[10px] text-slate-600 pt-1">
                    {formatDay(profile.window.from)} → {formatDay(profile.window.to)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No other Sri Lankan files in the last month or the next two.</p>
              )
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({
  row, onDriver,
}: {
  row: DriveLogRow
  onDriver: (row: DriveLogRow) => void
}) {
  const [open, setOpen] = useState(false)
  const s = row.settlement
  const inv = row.invoice

  const plTone = s.profitLoss === null ? 'muted'
    : s.profitLoss < -0.01 ? 'over'
    : s.profitLoss < 0.01 ? 'good'
    : 'due'

  return (
    <>
      <tr className={cn(
        'border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors',
        s.state === 'cancelled' && 'opacity-60',
      )}>
        {/* IS / CNTL */}
        <td className="px-3 py-2.5 align-top">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-start gap-1.5 text-left group"
          >
            <ChevronRight className={cn(
              'w-3.5 h-3.5 mt-0.5 text-slate-600 group-hover:text-slate-400 transition-transform flex-shrink-0',
              open && 'rotate-90',
            )} />
            <span>
              <span className="block font-mono text-xs font-black text-yellow-400">
                {row.isNumber ?? row.bookingRef}
              </span>
              <span className="block font-mono text-[10px] text-slate-500">{row.cntlNumber ?? '—'}</span>
            </span>
          </button>
        </td>

        {/* Arrival */}
        <td className="px-3 py-2.5 align-top whitespace-nowrap">
          <span className="block text-xs font-bold text-slate-200">{formatDay(row.arrivalDate)}</span>
          <span className={cn(
            'block text-[10px]',
            row.daysToArrival < 0 ? 'text-slate-500'
              : row.daysToArrival <= 2 ? 'text-amber-300 font-bold' : 'text-slate-500',
          )}>
            {arrivalLabel(row.daysToArrival)}
          </span>
        </td>

        {/* Client / driver */}
        <td className="px-3 py-2.5 align-top max-w-[220px]">
          <span className="block text-xs text-slate-300 truncate">{row.clientName ?? '—'}</span>
          {row.driver ? (
            <button
              onClick={() => onDriver(row)}
              className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-bold text-teal-300 hover:text-teal-200 transition-colors max-w-full"
            >
              <User2 className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{row.driver.name}</span>
              {row.driver.vehicle?.plateNo ? (
                <span className="font-mono text-[10px] text-slate-500 flex-shrink-0">{row.driver.vehicle.plateNo}</span>
              ) : null}
            </button>
          ) : (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-rose-300/80">
              <AlertTriangle className="w-3 h-3" /> no driver
            </span>
          )}
        </td>

        {/* Invoice */}
        <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
          {inv?.amount != null ? (
            <>
              <span className="block text-xs font-bold text-slate-200 tabular-nums">
                {inv.currency} {amount(inv.amount)}
              </span>
              <span className={cn(
                'block text-[10px] font-bold',
                inv.state === 'paid' ? 'text-emerald-400'
                  : inv.state === 'partial' ? 'text-sky-400' : 'text-slate-500',
              )}>
                {inv.state === 'paid' ? 'paid'
                  : inv.state === 'partial' ? `${inv.paidPercent ?? 0}% paid`
                  : inv.state}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-slate-600">{inv?.state === 'unknown' ? 'unreadable' : 'no invoice'}</span>
          )}
        </td>

        {/* The five settlement columns */}
        {s.state === 'ok' ? (
          <>
            <td className="px-3 py-2.5 align-top text-right"><Num value={s.totalCost} bold /></td>
            <td className="px-3 py-2.5 align-top text-right">
              <Num value={s.advance} />
              {s.edited ? <span className="block text-[9px] text-violet-300 font-bold">edited</span> : null}
            </td>
            <td className="px-3 py-2.5 align-top text-right"><Num value={s.balancePayable} /></td>
            <td className="px-3 py-2.5 align-top text-right"><Num value={s.advancePaid} tone={(s.advancePaid ?? 0) > 0 ? 'good' : 'muted'} /></td>
            <td className="px-3 py-2.5 align-top text-right"><Num value={s.restPaid} tone={(s.restPaid ?? 0) > 0 ? 'good' : 'muted'} /></td>
            <td className="px-3 py-2.5 align-top text-right"><Num value={s.profitLoss} tone={plTone} bold /></td>
          </>
        ) : (
          <td colSpan={6} className="px-3 py-2.5 align-top">
            <span className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-bold',
              SETTLEMENT_TONE[s.state],
            )}>
              {s.state === 'cancelled' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {SETTLEMENT_LABEL[s.state]}
            </span>
            <span className="ml-2 text-[11px] text-slate-500">{s.message}</span>
          </td>
        )}

        {/* The bar */}
        <td className="px-3 py-2.5 align-middle w-[110px]">
          <SettlementBar row={row} />
          <div className="flex items-center gap-1 mt-1">
            {s.stage ? (
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                {STAGE_LABEL[s.stage]}
              </span>
            ) : null}
            {s.state === 'ok' && s.approval !== 'approved' ? (
              <span className="text-[9px] font-bold uppercase tracking-wide text-amber-400" title="Payable 1.0 will not release money until the P&L is approved">
                · P&amp;L {s.approval}
              </span>
            ) : null}
          </div>
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-slate-800/50 bg-slate-950/60">
          <td colSpan={11} className="px-6 py-4">
            <div className="grid gap-5 lg:grid-cols-3">

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Booking</p>
                <dl className="space-y-1 text-xs">
                  <div className="flex gap-2"><dt className="text-slate-500 w-24">Reference</dt><dd className="text-slate-200 font-mono">{row.bookingRef}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-24">Agent</dt><dd className="text-slate-200">{row.agent ?? '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-24">File handler</dt><dd className="text-slate-200">{row.fileHandler ?? '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-24">Tour</dt><dd className="text-slate-200">{formatDay(row.arrivalDate)} → {formatDay(row.departureDate)}{row.nights !== null ? ` · ${row.nights}n` : ''}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-24">Pax</dt><dd className="text-slate-200">{row.pax}</dd></div>
                </dl>
                <div className="flex gap-2 mt-3">
                  <Link
                    href={`/dashboard/bookings/${row.bookingRef}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-700 text-[11px] font-bold text-slate-200 hover:border-slate-600 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> Open booking
                  </Link>
                  <Link
                    href="/dashboard/srilanka/driver-allocation"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-700 text-[11px] font-bold text-slate-200 hover:border-slate-600 transition-colors"
                  >
                    <Car className="w-3 h-3" /> Allocation board
                  </Link>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
                  What the envelope is made of
                </p>
                {s.sections.length ? (
                  <div className="space-y-1.5">
                    {s.sections.map(sec => (
                      <div key={sec.code} className="flex items-center gap-2">
                        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-black uppercase', CATEGORY_TONE[sec.code])}>
                          {sec.label}
                        </span>
                        <span className="flex-1 border-b border-dashed border-slate-800" />
                        <span className="text-xs tabular-nums font-semibold text-slate-200">{amount(sec.amount)}</span>
                      </div>
                    ))}
                    {s.transportCost !== null ? (
                      <p className="text-[10px] text-slate-500 pt-1">
                        Transport lines alone: <span className="tabular-nums font-semibold text-slate-400">{amount(s.transportCost)}</span>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">{s.message ?? 'No costed sections on this booking.'}</p>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Settlement</p>
                <dl className="space-y-1 text-xs">
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">Currency</dt><dd className="text-slate-200">{s.currency}{s.lkrAvailable ? '' : ' (no LKR rate)'}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">Rate used</dt><dd className="text-slate-200 tabular-nums">{s.rate ? `USD 1 = ${s.rate}` : '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">Computed advance</dt><dd className="text-slate-200 tabular-nums">{amount(s.computedAdvance)}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">Releases recorded</dt><dd className="text-slate-200">{s.paymentCount}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">Costed lines</dt><dd className="text-slate-200">{s.lineCount}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500 w-32">P&amp;L approval</dt><dd className={cn('font-bold', s.approval === 'approved' ? 'text-emerald-300' : 'text-amber-300')}>{s.approval}</dd></div>
                </dl>
                {s.computedAt ? (
                  <p className="text-[10px] text-slate-600 mt-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Accounts figures computed {freshness(s.computedAt)}
                  </p>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const SORT_LABELS: { value: DriveLogSortField; label: string }[] = [
  { value: 'arrival',  label: 'Arrival' },
  { value: 'isNumber', label: 'IS number' },
  { value: 'driver',   label: 'Driver' },
  { value: 'invoice',  label: 'Invoice' },
  { value: 'cost',     label: 'Total cost' },
  { value: 'advance',  label: 'Advance' },
  { value: 'balance',  label: 'Balance payable' },
  { value: 'profit',   label: 'Still owed' },
]

const STAGE_CHIPS: { value: DriveLogStage; label: string }[] = [
  { value: 'all',         label: 'All' },
  { value: 'advance_due', label: 'Advance due' },
  { value: 'rest_due',    label: 'Rest due' },
  { value: 'settled',     label: 'Settled' },
  { value: 'uncosted',    label: 'Not costed' },
]

export default function DriveLogPage() {
  const today = useMemo(() => dayKey(), [])
  const defaultDay = useMemo(() => shiftDay(today, DEFAULT_ARRIVAL_OFFSET_DAYS), [today])

  const [query, setQuery] = useState<DriveLogQuery>({
    dateField: 'arrivalDate',
    from: defaultDay,
    to: defaultDay,
    search: '',
    stage: 'all',
    approval: 'all',
    driver: 'all',
    openOnly: false,
    includeHotelOnly: false,
    sortBy: 'arrival',
    sortDir: 'asc',
  })

  const [searchDraft, setSearchDraft] = useState('')
  const [data, setData]       = useState<DriveLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [view, setView]       = useState<DriveLogView>('day')
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)
  const [panelRow, setPanelRow]   = useState<DriveLogRow | null>(null)

  // The search box types faster than the accounts database answers.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q => (q.search === searchDraft ? q : { ...q, search: searchDraft })), 400)
    return () => clearTimeout(t)
  }, [searchDraft])

  const reqId = useRef(0)

  const load = useCallback(async (q: DriveLogQuery) => {
    const id = ++reqId.current
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/srilanka/drive-log?${driveLogSearchParams(q)}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load the drive log')
      // A slow request must never overwrite a newer one's answer.
      if (id === reqId.current) setData(json.data as DriveLogResponse)
    } catch (err) {
      if (id === reqId.current) { setError((err as Error).message); setData(null) }
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load(query) }, [query, load])

  // Memoised because two useMemos below depend on it: `data?.rows ?? []`
  // yields a fresh array on every render, which would recompute the groups and
  // the freshness stamp on every keystroke.
  const rows   = useMemo(() => data?.rows ?? [], [data])
  const totals = data?.totals ?? driveLogTotals([])
  const groups = useMemo(() => groupDriveLogRows(rows, view), [rows, view])

  const set = (patch: Partial<DriveLogQuery>) => setQuery(q => ({ ...q, ...patch }))

  const setDay = (day: string) => set({ from: day, to: day })
  const setSpan = (fromDay: string, days: number) => set({ from: fromDay, to: shiftDay(fromDay, days) })

  const download = async (kind: 'pdf' | 'xlsx') => {
    setExporting(kind)
    try {
      const path = kind === 'pdf' ? 'export-pdf' : 'export'
      const res = await fetch(`/api/srilanka/drive-log/${path}?${driveLogSearchParams(query)}`)
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? 'The download could not be generated')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `drive-log-${query.from}${query.from === query.to ? '' : `_${query.to}`}.${kind}`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success(kind === 'pdf' ? 'PDF downloaded' : 'Spreadsheet downloaded')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setExporting(null)
    }
  }

  // The oldest snapshot on screen — the honest age of everything shown.
  const oldest = useMemo(() => {
    const stamps = rows.map(r => r.settlement.computedAt).filter((v): v is string => !!v).sort()
    return stamps[0] ?? null
  }, [rows])

  const spanDays = daysBetween(query.from, query.to)

  return (
    <div className="min-h-screen bg-[#060a14] text-white">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[400px] bg-emerald-700/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[400px] bg-yellow-700/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-[1700px] mx-auto px-6 py-8 space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center flex-shrink-0">
            <CountryFlag country="SRILANKA" className="w-7 h-5" />
          </div>
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight">Drive Log</h1>
              <span className="px-2 py-0.5 rounded-md bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-[10px] font-black uppercase tracking-wider">
                Sri Lanka
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">
              {windowLabel(query)} · {rows.length} of {data?.matched ?? 0} booking{(data?.matched ?? 0) === 1 ? '' : 's'}
              {oldest ? <span className="text-slate-600"> · accounts figures {freshness(oldest)}</span> : null}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => load(query)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
            </button>
            <button
              onClick={() => download('xlsx')}
              disabled={!!exporting || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {exporting === 'xlsx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              Excel
            </button>
            <button
              onClick={() => download('pdf')}
              disabled={!!exporting || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-xs font-bold text-yellow-300 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              {exporting === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              PDF
            </button>
          </div>
        </div>

        {/* ── Degradation notices ── */}
        {data && !data.advancesAvailable ? (
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-xs text-orange-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            The accounts database could not be read, so no settlement figures are shown. The booking and driver
            columns are still live.
          </div>
        ) : null}
        {data && data.advancesAvailable && !data.invoicesAvailable ? (
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-xs text-orange-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            The invoice ledger could not be read — the Invoice column is blank, every other figure is current.
          </div>
        ) : null}
        {data?.truncated ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            This window holds {data.matched} bookings; only the first {rows.length} are shown. Narrow the dates
            to see the rest — every total on this page counts only what is displayed.
          </div>
        ) : null}

        {/* ── KPIs ── */}
        <div className="flex flex-wrap gap-3">
          <Kpi
            label="Total transport cost" value={`LKR ${amount(totals.totalCost)}`}
            sub={`${totals.costedRows} costed file${totals.costedRows === 1 ? '' : 's'}`}
            icon={Layers} tone="bg-slate-500/10 border-slate-500/30 text-slate-300"
          />
          <Kpi
            label="Driver advance" value={`LKR ${amount(totals.advance)}`}
            sub={`released LKR ${amount(totals.advancePaid)}`}
            icon={Wallet} tone="bg-violet-500/10 border-violet-500/30 text-violet-300"
          />
          <Kpi
            label="Balance payable" value={`LKR ${amount(totals.balancePayable)}`}
            sub={`paid LKR ${amount(totals.restPaid)}`}
            icon={Banknote} tone="bg-sky-500/10 border-sky-500/30 text-sky-300"
          />
          <Kpi
            label="Actually paid" value={`LKR ${amount(totals.paid)}`}
            sub={`${totals.settled} settled · ${totals.advanceDue + totals.restDue} open`}
            icon={BadgeCheck} tone="bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          />
          <Kpi
            label="Still owed" value={`LKR ${amount(totals.profitLoss)}`}
            sub={totals.overpaid ? `${totals.overpaid} overpaid file${totals.overpaid === 1 ? '' : 's'}` : 'cost less what was released'}
            icon={totals.profitLoss > 0.01 ? TrendingUp : TrendingDown}
            tone={totals.profitLoss > 0.01
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}
          />
          <Kpi
            label="Client invoiced" value={`USD ${amount(totals.invoiceUsd)}`}
            sub={totals.invoiceOtherCcy ? `${totals.invoiceOtherCcy} in another currency excluded` : 'across this window'}
            icon={Gauge} tone="bg-yellow-500/10 border-yellow-500/30 text-yellow-300"
          />
        </div>

        {(totals.uncostedRows || totals.noRateRows) ? (
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            {totals.uncostedRows ? `${totals.uncostedRows} booking(s) not costed yet` : ''}
            {totals.uncostedRows && totals.noRateRows ? ' · ' : ''}
            {totals.noRateRows ? `${totals.noRateRows} carry no LKR rate` : ''}
            {' '}— excluded from every total above.
          </p>
        ) : null}

        {/* ── Filters ── */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-4 space-y-3">

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder="Search IS#, CNTL, client, agent, file handler, driver…"
                className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
              />
              {searchDraft ? (
                <button onClick={() => setSearchDraft('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={query.dateField}
                onChange={e => set({ dateField: e.target.value as DriveLogQuery['dateField'] })}
                className="px-2.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-bold text-slate-300 focus:outline-none focus:border-slate-600"
              >
                <option value="arrivalDate">Arrival date</option>
                <option value="departureDate">Departure date</option>
              </select>
              <input
                type="date" value={query.from}
                onChange={e => set({ from: e.target.value || defaultDay })}
                className="px-2.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-slate-600"
              />
              <span className="text-slate-600">→</span>
              <input
                type="date" value={query.to}
                onChange={e => set({ to: e.target.value || query.from })}
                className="px-2.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-slate-600"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Chip active={query.from === defaultDay && query.to === defaultDay} onClick={() => setDay(defaultDay)}>
                D+2 · default
              </Chip>
              <Chip active={query.from === today && query.to === today} onClick={() => setDay(today)}>Today</Chip>
              <Chip active={query.from === shiftDay(today, 1) && query.to === shiftDay(today, 1)} onClick={() => setDay(shiftDay(today, 1))}>Tomorrow</Chip>
              <Chip active={query.from === today && spanDays === 6} onClick={() => setSpan(today, 6)}>Next 7d</Chip>
              <Chip active={query.from === shiftDay(today, -7) && query.to === shiftDay(today, -1)} onClick={() => set({ from: shiftDay(today, -7), to: shiftDay(today, -1) })}>Last 7d</Chip>
              <Chip active={query.from === today && spanDays === 29} onClick={() => setSpan(today, 29)}>Next 30d</Chip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-1.5 pt-2">
              <Filter className="w-3.5 h-3.5 text-slate-600" />
              {STAGE_CHIPS.map(c => (
                <Chip key={c.value} active={query.stage === c.value} onClick={() => set({ stage: c.value })}>
                  {c.label}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-1.5 pt-2">
              {(['all', 'approved', 'pending'] as DriveLogApproval[]).map(v => (
                <Chip
                  key={v} active={query.approval === v} onClick={() => set({ approval: v })}
                  tone={v === 'pending' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : undefined}
                >
                  {v === 'all' ? 'Any P&L' : v === 'approved' ? 'P&L approved' : 'P&L pending'}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-1.5 pt-2">
              {(['all', 'assigned', 'unassigned'] as DriveLogDriver[]).map(v => (
                <Chip
                  key={v} active={query.driver === v} onClick={() => set({ driver: v })}
                  tone={v === 'unassigned' ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : undefined}
                >
                  {v === 'all' ? 'Any driver' : v === 'assigned' ? 'Allocated' : 'No driver'}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-1.5 pt-2">
              <Chip
                active={query.openOnly} onClick={() => set({ openOnly: !query.openOnly })}
                tone="bg-amber-500/15 border-amber-500/40 text-amber-300"
              >
                Open items only
              </Chip>
              <Chip active={query.includeHotelOnly} onClick={() => set({ includeHotelOnly: !query.includeHotelOnly })}>
                🏨 Include hotel-only
              </Chip>
            </div>

            <div className="flex items-center gap-1.5 pt-2 ml-auto">
              <span className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">View</span>
              <Chip active={view === 'day'} onClick={() => setView('day')}>By day</Chip>
              <Chip active={view === 'driver'} onClick={() => setView('driver')}>By driver</Chip>

              <span className="w-px h-4 bg-slate-800 mx-1" />

              <select
                value={query.sortBy}
                onChange={e => set({ sortBy: e.target.value as DriveLogSortField })}
                className="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] font-bold text-slate-300 focus:outline-none focus:border-slate-600"
              >
                {SORT_LABELS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button
                onClick={() => set({ sortDir: query.sortDir === 'asc' ? 'desc' : 'asc' })}
                className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-400 hover:text-white transition-colors"
                title={query.sortDir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {query.sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px]">
              <thead>
                <tr className="bg-slate-950/70 border-b border-slate-800">
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-black">IS # / CNTL</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-black">Arrival</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-black">Client / Driver</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black">Invoice</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="Balance payable + driver advance">Total cost</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="The envelope handed to the driver at the start of the tour">Advance</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="The rest payment: total cost less the advance">Balance payable</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="Of the envelope, what has actually been handed over">Advance paid</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="Of the rest payment, what the accounts team has released">Paid balance</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-black" title="Total cost less (advance paid + paid balance)">Still owed</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-black">Settlement</th>
                </tr>
              </thead>

              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={11} className="px-6 py-16 text-center">
                    <Loader2 className="w-6 h-6 text-slate-600 animate-spin mx-auto" />
                    <p className="text-sm text-slate-500 mt-3">Reading bookings, driver advances and invoices…</p>
                  </td></tr>
                ) : error ? (
                  <tr><td colSpan={11} className="px-6 py-16 text-center">
                    <AlertTriangle className="w-6 h-6 text-rose-400 mx-auto" />
                    <p className="text-sm text-rose-300 mt-3">{error}</p>
                    <button onClick={() => load(query)} className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200">
                      Try again
                    </button>
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={11} className="px-6 py-16 text-center">
                    <CalendarDays className="w-6 h-6 text-slate-700 mx-auto" />
                    <p className="text-sm text-slate-500 mt-3">
                      No Sri Lankan bookings match these filters in {windowLabel(query).toLowerCase()}.
                    </p>
                  </td></tr>
                ) : (
                  groups.map(g => (
                    <GroupBlock key={g.key} group={g} view={view} onDriver={setPanelRow} />
                  ))
                )}
              </tbody>

              {rows.length > 0 ? (
                <tfoot>
                  <tr className="bg-slate-950/80 border-t-2 border-slate-800">
                    <td colSpan={4} className="px-3 py-3 text-xs font-black text-slate-300 uppercase tracking-wider">
                      Total · {totals.costedRows} costed
                    </td>
                    <td className="px-3 py-3 text-right"><Num value={totals.totalCost} bold /></td>
                    <td className="px-3 py-3 text-right"><Num value={totals.advance} bold /></td>
                    <td className="px-3 py-3 text-right"><Num value={totals.balancePayable} bold /></td>
                    <td className="px-3 py-3 text-right"><Num value={totals.advancePaid} tone="good" bold /></td>
                    <td className="px-3 py-3 text-right"><Num value={totals.restPaid} tone="good" bold /></td>
                    <td className="px-3 py-3 text-right"><Num value={totals.profitLoss} tone={totals.profitLoss > 0.01 ? 'due' : 'good'} bold /></td>
                    <td className="px-3 py-3 text-[10px] text-slate-600">LKR</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 leading-relaxed max-w-3xl">
          Every figure in the settlement columns was derived by the Apple Accounts system and is shown here
          unchanged — this screen never computes, moves or approves money. Advances are released on Payable 1.0,
          and a booking whose P&amp;L is not approved will show a full envelope with nothing paid against it.
        </p>
      </div>

      {panelRow ? (
        <DriverPanel
          driverId={panelRow.driver?.id ?? null}
          fallback={panelRow.driver}
          rows={rows}
          onClose={() => setPanelRow(null)}
        />
      ) : null}
    </div>
  )
}

/** One heading and its rows, with the subtotal that makes the group self-checking. */
function GroupBlock({
  group, view, onDriver,
}: {
  group: ReturnType<typeof groupDriveLogRows>[number]
  view: DriveLogView
  onDriver: (row: DriveLogRow) => void
}) {
  const [open, setOpen] = useState(true)
  const t = group.totals

  return (
    <>
      <tr className="bg-slate-950/50 border-y border-slate-800">
        <td colSpan={4} className="px-3 py-2">
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left group">
            <ChevronDown className={cn('w-3.5 h-3.5 text-slate-600 transition-transform', !open && '-rotate-90')} />
            {view === 'driver' ? <User2 className="w-3.5 h-3.5 text-teal-400" /> : <CalendarDays className="w-3.5 h-3.5 text-sky-400" />}
            <span className="text-xs font-black text-white">{group.label}</span>
            {group.sublabel ? <span className="text-[11px] text-slate-500">{group.sublabel}</span> : null}
            {t.unassigned && view === 'day' ? (
              <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[9px] font-black uppercase">
                {t.unassigned} unallocated
              </span>
            ) : null}
            {t.unapproved ? (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-black uppercase">
                {t.unapproved} P&amp;L pending
              </span>
            ) : null}
          </button>
        </td>
        <td className="px-3 py-2 text-right"><Num value={t.totalCost} tone="muted" /></td>
        <td className="px-3 py-2 text-right"><Num value={t.advance} tone="muted" /></td>
        <td className="px-3 py-2 text-right"><Num value={t.balancePayable} tone="muted" /></td>
        <td className="px-3 py-2 text-right"><Num value={t.advancePaid} tone="muted" /></td>
        <td className="px-3 py-2 text-right"><Num value={t.restPaid} tone="muted" /></td>
        <td className="px-3 py-2 text-right"><Num value={t.profitLoss} tone={t.profitLoss > 0.01 ? 'due' : 'good'} /></td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] text-slate-600">
            <Users className="w-3 h-3" /> {group.rows.length}
            {view === 'driver' && group.rows[0].driver?.phone ? (
              <>
                <Phone className="w-3 h-3 ml-1" />
                <span className="truncate">{group.rows[0].driver.phone}</span>
              </>
            ) : null}
          </div>
        </td>
      </tr>

      {open ? group.rows.map(r => <Row key={r.bookingId} row={r} onDriver={onDriver} />) : null}
    </>
  )
}
