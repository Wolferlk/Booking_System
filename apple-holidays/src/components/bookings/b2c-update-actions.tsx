'use client'

/**
 * "Update Booking" for Aahaas B2C store orders — shown on the booking page in
 * place of the AppleSystem "Fetch Data from API" / "Raw API Response" buttons,
 * which do not apply to these bookings.
 *
 * Opening it reads the store order (read-only) and lists every difference as a
 * tickable change. Nothing is written until "Apply", which saves the ticked
 * changes as a new booking version. The merge and protection rules live in
 * `src/lib/b2c-booking-sync.ts`.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, ChevronRight, History, RefreshCw, ShieldCheck, Store } from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { readApiResponse, cn } from '@/lib/utils'
import type { AccountsCall, AccountsPreview } from '@/lib/accounts-b2c-client'

type ChangeKey = string

interface Change {
  key: ChangeKey
  label: string
  from: string | null
  to: string | null
  editedHere: boolean
  recommended: boolean
  note?: string
}

interface ItinRow { dayNo: number; date: string; title: string; description: string | null }

interface PnlPlan {
  added: { activity: string; category: string; sell: number; cost: string }[]
  updated: { activity: string; fields: string[] }[]
  protectedLines: { activity: string; reason: string }[]
  removedUpstream: string[]
  createPnl: boolean
  locked: boolean
}

interface SyncResult {
  mode: 'preview' | 'apply'
  orderId: number
  version: number
  newVersion: number | null
  changes: Change[]
  applied: ChangeKey[]
  itinerary: { previous: ItinRow[]; next: ItinRow[] } | null
  pnl: PnlPlan
  store: {
    bookedDate: string | null
    checkoutStatus: string | null
    paymentStatus: string | null
    total: string | null
    paid: string | null
    balance: string | null
    currency: string
    productLines: number
  }
  warnings: string[]
  lastUpdate: { at: string; by: string; version: number } | null
  unchanged: boolean
  /** The Accounts system's own preview of the same order (P&L + invoice). */
  accounts?: AccountsCall<AccountsPreview>
}

interface LastUpdate {
  at: string
  by: string
  version: number
  changed: string[]
  accounts?: { status: string; message: string | null; versionNo?: number | null; invoice?: string | null } | null
}

export default function B2cUpdateActions({
  bookingRef,
  canUpdate,
  onUpdated,
}: {
  bookingRef: string
  canUpdate: boolean
  onUpdated?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SyncResult | null>(null)
  const [selected, setSelected] = useState<Set<ChangeKey>>(new Set())
  const [showItin, setShowItin] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<LastUpdate | null>(null)
  const [accPnl, setAccPnl] = useState(false)
  const [accInvoice, setAccInvoice] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/b2c-sync`)
      const json = await readApiResponse<{ lastUpdate: LastUpdate | null }>(res)
      if (json.success) setLastUpdate(json.data?.lastUpdate ?? null)
    } catch {
      /* the pill is informational */
    }
  }, [bookingRef])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function runPreview() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setPreview(null)
    setShowItin(false)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/b2c-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' }),
      })
      const json = await readApiResponse<SyncResult>(res)
      if (!json.success || !json.data) throw new Error(json.error || 'Could not read the store order')
      setPreview(json.data)
      setSelected(new Set(json.data.changes.filter((c) => c.recommended).map((c) => c.key)))
      const acc = json.data.accounts
      const accData = acc?.status === 'ok' ? acc.data : null
      setAccPnl(!!accData?.pnl.needs_update)
      setAccInvoice(accData?.invoice.action === 'revise' || accData?.invoice.action === 'create')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the store order')
    } finally {
      setLoading(false)
    }
  }

  async function apply() {
    if (!preview) return
    setApplying(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/b2c-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'apply',
          keys: Array.from(selected),
          expectedVersion: preview.version,
          accounts: accPnl || accInvoice ? { pnl: accPnl, invoice: accInvoice } : false,
        }),
      })
      const json = await readApiResponse<SyncResult>(res)
      if (!json.success || !json.data) throw new Error(json.error || 'Update failed')
      const acc = (json.data as SyncResult & { accounts?: { status: string } | null }).accounts
      if (acc && acc.status !== 'ok') toast.warning(json.message || 'OPS updated; Accounts was not')
      else toast.success(json.message || 'Booking updated')
      setOpen(false)
      setPreview(null)
      await loadStatus()
      onUpdated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setApplying(false)
    }
  }

  function toggle(key: ChangeKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!canUpdate && !lastUpdate) return null

  const pickedCount = preview ? preview.changes.filter((c) => selected.has(c.key)).length : 0
  const accData = preview?.accounts?.status === 'ok' ? preview.accounts.data : null
  const accountsHasWork = !!accData && (accData.pnl.needs_update || accData.invoice.action === 'revise' || accData.invoice.action === 'create')
  const totalPicked = pickedCount + (accPnl ? 1 : 0) + (accInvoice ? 1 : 0)
  const nothingAnywhere = !!preview && preview.unchanged && !accountsHasWork

  return (
    <>
      {canUpdate && (
        <button
          onClick={runPreview}
          className="btn btn-sm bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 flex items-center gap-1.5"
          title="Check the Aahaas store order for changes and update this booking as a new version"
        >
          <Store className="w-3.5 h-3.5" /> Update Booking
        </button>
      )}

      {lastUpdate && (
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
          title={`Last checked against the store: ${fmtDateTime(lastUpdate.at)} by ${lastUpdate.by}${
            lastUpdate.changed.length ? ` — changed: ${lastUpdate.changed.join(', ')}` : ' — nothing changed'
          }`}
        >
          <RefreshCw className="w-3 h-3 text-slate-400" />
          Store checked <span className="font-semibold text-slate-700">{relTimeAgo(lastUpdate.at)}</span>
          {lastUpdate.accounts && (
            <span className={lastUpdate.accounts.status === 'ok' ? 'text-emerald-600' : 'text-rose-600'}>
              · Accounts {lastUpdate.accounts.status === 'ok' ? (lastUpdate.accounts.versionNo ? `v${lastUpdate.accounts.versionNo}` : 'ok') : 'not updated'}
            </span>
          )}
        </span>
      )}

      <Modal
        open={open}
        onClose={() => !applying && setOpen(false)}
        title={`Update from Aahaas store — order ${bookingRef}`}
        size="4xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={applying}>
              {nothingAnywhere ? 'Close' : 'Cancel'}
            </Button>
            {preview && !nothingAnywhere && (
              <Button
                onClick={apply}
                loading={applying}
                disabled={totalPicked === 0}
                icon={<History className="w-3.5 h-3.5" />}
              >
                Apply {totalPicked} change{totalPicked === 1 ? '' : 's'} → OPS{accPnl || accInvoice ? ' + Accounts' : ''}
              </Button>
            )}
          </>
        }
      >
        {loading && (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" /> Reading order {bookingRef} from the store…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {/* Store snapshot */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Stat label="Booked in store" value={preview.store.bookedDate ?? '—'} />
              <Stat label="Payment" value={preview.store.paymentStatus ?? '—'} />
              <Stat
                label={`Paid / total (${preview.store.currency})`}
                value={`${preview.store.paid ?? '—'} / ${preview.store.total ?? '—'}`}
              />
              <Stat label="Checkout status" value={preview.store.checkoutStatus ?? '—'} />
            </div>

            {preview.warnings.map((w) => (
              <div key={w} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
              </div>
            ))}

            {preview.unchanged ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                The OPS booking already matches the store order.
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Tick what to take from the store. It will be saved as{' '}
                  <span className="font-semibold">a new version after V{preview.version}</span>, and earlier versions stay
                  available from the version menu. Status, tickets, drivers, agenda and confirmations are never touched.
                </p>

                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {preview.changes.map((c) => (
                    <label
                      key={c.key}
                      className={cn(
                        'flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50',
                        c.editedHere && 'bg-amber-50/40',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(c.key)}
                        onChange={() => toggle(c.key)}
                        disabled={applying}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          {c.label}
                          {c.editedHere && (
                            <span className="rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold">
                              EDITED HERE
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-600 mt-0.5 break-words">
                          <span className="line-through text-slate-400">{c.from ?? '—'}</span>
                          <span className="mx-1.5 text-slate-400">→</span>
                          <span className="font-medium text-slate-800">{c.to ?? '—'}</span>
                        </span>
                        {c.note && <span className="block text-[11px] text-slate-500 mt-0.5">{c.note}</span>}
                      </span>
                    </label>
                  ))}
                </div>

                {preview.itinerary && (
                  <div className="rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setShowItin((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {showItin ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Itinerary: current vs store
                    </button>
                    {showItin && (
                      <div className="grid md:grid-cols-2 gap-3 p-3 pt-0 text-xs">
                        <ItinList title="Current" rows={preview.itinerary.previous} />
                        <ItinList title="Store" rows={preview.itinerary.next} />
                      </div>
                    )}
                  </div>
                )}

                {(preview.pnl.added.length > 0 ||
                  preview.pnl.updated.length > 0 ||
                  preview.pnl.protectedLines.length > 0 ||
                  preview.pnl.removedUpstream.length > 0) && (
                  <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5">
                    <div className="font-semibold text-slate-700">P&amp;L detail</div>
                    {preview.pnl.added.map((l) => (
                      <div key={`a-${l.activity}`} className="text-emerald-700">
                        + {l.activity} <span className="text-slate-400">({l.category}, sell {l.sell.toFixed(2)}, cost {l.cost})</span>
                      </div>
                    ))}
                    {preview.pnl.updated.map((l) => (
                      <div key={`u-${l.activity}`} className="text-indigo-700">
                        ~ {l.activity} <span className="text-slate-400">({l.fields.join(', ')})</span>
                      </div>
                    ))}
                    {preview.pnl.removedUpstream.map((a) => (
                      <div key={`r-${a}`} className="text-rose-700">
                        − {a} <span className="text-slate-400">(no longer in the store order — kept and flagged, not deleted)</span>
                      </div>
                    ))}
                    {preview.pnl.protectedLines.map((l) => (
                      <div key={`p-${l.activity}`} className="text-slate-600 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-slate-400" /> {l.activity}{' '}
                        <span className="text-slate-400">— left alone: {l.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <AccountsSection
              call={preview.accounts}
              pnl={accPnl}
              invoice={accInvoice}
              onPnl={setAccPnl}
              onInvoice={setAccInvoice}
              disabled={applying}
            />

            {preview.lastUpdate && (
              <p className="text-[11px] text-slate-400">
                Last store update: {fmtDateTime(preview.lastUpdate.at)} by {preview.lastUpdate.by} (V{preview.lastUpdate.version})
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

/** The Accounts system's P&L + invoice for the same order, with its two tick boxes. */
function AccountsSection({
  call, pnl, invoice, onPnl, onInvoice, disabled,
}: {
  call?: AccountsCall<AccountsPreview>
  pnl: boolean
  invoice: boolean
  onPnl: (v: boolean) => void
  onInvoice: (v: boolean) => void
  disabled: boolean
}) {
  if (!call) return null
  const money = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(2))

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 text-xs space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-teal-900">
        <Calculator className="w-4 h-4" /> Accounts system (P&amp;L + invoice)
      </div>

      {call.status !== 'ok' ? (
        <p className={call.status === 'failed' ? 'text-rose-700' : 'text-slate-500'}>{call.message}</p>
      ) : (
        <>
          {call.data.warnings.map((w) => (
            <p key={w} className="text-amber-800 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</p>
          ))}
          {!call.data.available && (
            <p className="text-rose-700">Accounts has not run its b2c_order_versions migration yet — it will refuse the update.</p>
          )}

          <label className={cn('flex items-start gap-2', call.data.pnl.needs_update ? 'cursor-pointer' : 'opacity-60')}>
            <input type="checkbox" className="mt-0.5" checked={pnl} disabled={disabled || !call.data.pnl.needs_update} onChange={(e) => onPnl(e.target.checked)} />
            <span>
              <span className="font-semibold text-slate-800">Accounts P&amp;L</span>{' '}
              {call.data.pnl.protected
                ? <span className="text-slate-500">kept — the store&apos;s price snapshot was unreadable this time</span>
                : !call.data.pnl.needs_update
                  ? <span className="text-emerald-700">already matches the store</span>
                  : (
                    <span className="text-slate-600">
                      {call.data.pnl.exists ? '' : 'new record · '}
                      {call.data.pnl.changes.map((c) => `${c.label} ${String(c.from ?? '—')} → ${String(c.to ?? '—')}`).join(' · ') || 'line changes'}
                      {call.data.pnl.lines.added.length > 0 && ` · +${call.data.pnl.lines.added.length} line(s)`}
                      {call.data.pnl.lines.changed.length > 0 && ` · ${call.data.pnl.lines.changed.length} line(s) re-priced`}
                      {call.data.pnl.lines.removed.length > 0 && ` · ${call.data.pnl.lines.removed.length} line(s) gone`}
                    </span>
                  )}
            </span>
          </label>

          {(() => {
            const inv = call.data.invoice
            const actionable = inv.action === 'revise' || inv.action === 'create'
            return (
              <label className={cn('flex items-start gap-2', actionable ? 'cursor-pointer' : 'opacity-60')}>
                <input type="checkbox" className="mt-0.5" checked={invoice} disabled={disabled || !actionable} onChange={(e) => onInvoice(e.target.checked)} />
                <span>
                  <span className="font-semibold text-slate-800">Invoice</span>{' '}
                  {inv.action === 'revise' && (
                    <span className="text-slate-600">
                      {inv.current} ({money(inv.current_total)}) → new revision <b>{inv.next}</b> ({money(inv.store_total)}). The old one and its payments stay on record.
                    </span>
                  )}
                  {inv.action === 'create' && <span className="text-slate-600">none yet → <b>{inv.next}</b> ({money(inv.store_total)})</span>}
                  {inv.action === 'none' && <span className="text-emerald-700">{inv.current ?? 'No invoice'} already matches ({money(inv.store_total)})</span>}
                  {inv.action === 'blocked' && <span className="text-amber-800">{inv.reason}</span>}
                  {actionable && inv.mail_mode && (
                    <span className="block text-slate-500">Customer mail for this: <b>{inv.mail_mode}</b> (Accounts → Settings → Aahaas B2C)</span>
                  )}
                </span>
              </label>
            )
          })()}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="text-slate-800 font-medium truncate" title={value}>{value}</div>
    </div>
  )
}

function ItinList({ title, rows }: { title: string; rows: ItinRow[] }) {
  return (
    <div>
      <div className="font-semibold text-slate-500 mb-1">{title} ({rows.length})</div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="rounded border border-slate-100 px-2 py-1">
            <span className="font-mono text-slate-400 mr-1.5">D{r.dayNo} {r.date}</span>
            <span className="text-slate-800">{r.title}</span>
            {r.description && <span className="block text-slate-400">{r.description}</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="text-slate-400">—</li>}
      </ul>
    </div>
  )
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function relTimeAgo(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDateTime(iso)
}
