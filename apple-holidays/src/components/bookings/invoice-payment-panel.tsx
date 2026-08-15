'use client'

/**
 * "Invoice & Payments" — the client-money statement on the booking page.
 *
 * OPS could always see what a booking *costs*; it could never see whether the
 * client had actually paid for it, which meant opening the accounts system to
 * answer the single most-asked question about any booking. This panel answers
 * it in place, live, and read-only:
 *
 *   · the invoice, its revision, and what it is worth
 *   · a meter of how much of it has been banked
 *   · every receipt as a dated timeline — mode, bank reference, currency and
 *     the rate it converted at
 *   · the cancellation invoice, when the booking has one, kept visibly apart
 *     because it stands on its own ledger in accounts
 *
 * Nothing here writes. Payments are recorded in the accounts system and only
 * there; this is a window, and it says so.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Receipt, RefreshCw, Loader2, AlertCircle, FileQuestion, Ban, Landmark,
  Paperclip, Lock, LockOpen, ArrowDownLeft, CheckCircle2, Layers, ExternalLink,
  Database, CircleDollarSign, Hash,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn, formatCurrency, formatDate, formatDateTime, readApiResponse } from '@/lib/utils'
import { paidWidth, toneFor } from '@/lib/invoice-payment-view'
import type { InvoiceLedger, InvoiceReceipt } from '@/lib/accounts-invoice-db'

type Load =
  | { phase: 'loading' }
  | { phase: 'ready'; ledger: InvoiceLedger }
  | { phase: 'empty'; message: string }
  | { phase: 'error'; message: string }

export default function InvoicePaymentPanel({ bookingRef }: { bookingRef: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setState({ phase: 'loading' })

    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/invoice-payments`, {
        cache: 'no-store',
      })
      const body = await readApiResponse<
        { available: true; ledger: InvoiceLedger } | { available: false; message: string }
      >(res)

      if (!body.success || !body.data) {
        setState({ phase: 'error', message: body.error ?? 'Could not read the accounts ledger.' })
        return
      }
      if (!body.data.available) {
        setState({ phase: 'empty', message: body.data.message })
        return
      }
      setState({ phase: 'ready', ledger: body.data.ledger })
    } catch {
      setState({ phase: 'error', message: 'Could not reach the server to read the accounts ledger.' })
    } finally {
      setRefreshing(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  const ledger = state.phase === 'ready' ? state.ledger : null
  const summary = ledger?.summary
  const tone = toneFor(summary?.state ?? (state.phase === 'empty' ? 'none' : 'unknown'))

  return (
    <Card className={cn('overflow-hidden border-l-4', tone.edge)}>
      <CardHeader
        action={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              <Database className="w-3 h-3" /> Live from Accounts
            </span>
            <button
              onClick={() => void load(true)}
              disabled={refreshing || state.phase === 'loading'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center', tone.wash)}>
            <Receipt className={cn('w-4 h-4', tone.text)} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 leading-tight">Invoice &amp; Payments</h2>
            <p className="text-xs text-slate-500">
              What the client was billed, and what has actually been received
            </p>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {state.phase === 'loading' && <PanelSkeleton />}

        {state.phase === 'error' && (
          <Notice
            icon={<AlertCircle className="w-5 h-5 text-rose-500" />}
            title="The accounts ledger could not be read"
            body={state.message}
            action={
              <button onClick={() => void load()} className="text-xs font-semibold text-rose-700 hover:underline">
                Try again
              </button>
            }
            className="border-rose-200 bg-rose-50/60"
          />
        )}

        {state.phase === 'empty' && (
          <Notice
            icon={<FileQuestion className="w-5 h-5 text-slate-400" />}
            title="No invoice raised yet"
            body={state.message}
            className="border-slate-200 bg-slate-50"
          />
        )}

        {ledger && summary && (
          <>
            <Statement ledger={ledger} />

            {ledger.receipts.length > 0 ? (
              <Timeline
                receipts={ledger.receipts}
                invoiceCurrency={summary.currency ?? 'USD'}
                title="Payments received"
              />
            ) : summary.state !== 'cancelled' && (
              <Notice
                icon={<CircleDollarSign className="w-5 h-5 text-rose-400" />}
                title="No payment recorded against this invoice"
                body="The accounts system holds the invoice but has not banked anything against it yet."
                className="border-rose-200 bg-rose-50/50"
              />
            )}

            {ledger.revisions.length > 1 && <Revisions ledger={ledger} />}

            {summary.cancellation && (
              <Cancellation ledger={ledger} />
            )}

            <Footnote ledger={ledger} />
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── The statement: value, meter, three figures ────────────────────────────────

function Statement({ ledger }: { ledger: InvoiceLedger }) {
  const s = ledger.summary
  const tone = toneFor(s.state)
  const currency = s.currency ?? 'USD'
  const value = s.invoiceValue ?? 0
  const paid = s.paidAmount ?? 0
  const balance = s.balanceAmount ?? 0
  const overpaid = s.overpaidAmount ?? 0
  const percent = s.state === 'paid' ? 100 : paidWidth(s.paidPercent)

  return (
    <div className={cn('rounded-2xl border border-slate-200 overflow-hidden')}>
      {/* Hero */}
      <div className={cn('px-5 py-4 flex flex-wrap items-start justify-between gap-4', tone.wash)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 uppercase tracking-wide">
              <Hash className="w-3 h-3" />{s.invoiceNumber ?? '—'}
            </span>
            {(s.revision ?? 1) > 1 && (
              <span className="px-1.5 py-[1px] rounded-md bg-white/80 border border-slate-200 text-[10px] font-bold text-slate-600">
                Revision {s.revision} of {s.revisionCount}
              </span>
            )}
            {ledger.invoiceType && (
              <span className="px-1.5 py-[1px] rounded-md bg-white/80 border border-slate-200 text-[10px] font-bold text-slate-600 capitalize">
                {ledger.invoiceType.replace('_', '-')}
              </span>
            )}
          </div>
          <p className="mt-1 text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
            {formatCurrency(value, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Invoiced {formatDate(s.invoiceDate)}
            {ledger.customerName ? ` · ${ledger.customerName}` : ''}
          </p>
        </div>

        <div className="text-right">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold', tone.chip)}>
            {s.state === 'paid' && <CheckCircle2 className="w-3.5 h-3.5" />}
            {s.state === 'cancelled' && <Ban className="w-3.5 h-3.5" />}
            {(s.state === 'partial' || s.state === 'unpaid') && <span className="w-2 h-2 rounded-full" style={{ background: tone.hex }} />}
            {tone.headline}
          </span>
          <p className={cn('mt-1.5 text-2xl font-extrabold tabular-nums leading-none', tone.text)}>
            {Math.round(s.paidPercent ?? 0)}%
          </p>
          <p className="text-[11px] text-slate-500">of the invoice banked</p>
        </div>
      </div>

      {/* Meter */}
      <div className="px-5 pt-4">
        <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden ring-1 ring-inset ring-slate-200/70">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ type: 'spring', stiffness: 90, damping: 20 }}
            className={cn('h-full rounded-full', tone.bar)}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
          <span>{formatCurrency(paid, currency)} received</span>
          <span>{formatCurrency(value, currency)} invoiced</span>
        </div>
      </div>

      {/* Figures */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 mt-4 border-t border-slate-100">
        <Figure label="Invoice value" value={formatCurrency(value, currency)} />
        <Figure
          label="Received"
          value={formatCurrency(paid, currency)}
          tone={paid > 0 ? 'text-emerald-700' : 'text-slate-400'}
          note={s.paymentCount ? `${s.paymentCount} receipt${s.paymentCount === 1 ? '' : 's'}` : undefined}
        />
        {overpaid > 0.005 ? (
          <Figure
            label="Overpaid — refund due"
            value={formatCurrency(overpaid, currency)}
            tone="text-indigo-700"
            note="An amendment landed below what was already banked"
          />
        ) : (
          <Figure
            label="Outstanding"
            value={formatCurrency(Math.max(0, balance), currency)}
            tone={balance > 0.005 ? 'text-rose-700' : 'text-emerald-700'}
            note={balance > 0.005 ? 'Still to be collected' : 'Nothing outstanding'}
          />
        )}
      </div>
    </div>
  )
}

function Figure({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="px-5 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums', tone ?? 'text-slate-900')}>{value}</p>
      {note && <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{note}</p>}
    </div>
  )
}

// ── Receipts ──────────────────────────────────────────────────────────────────

function Timeline({
  receipts, invoiceCurrency, title,
}: {
  receipts: InvoiceReceipt[]
  invoiceCurrency: string
  title: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
        <span className="text-[11px] text-slate-400">{receipts.length} recorded in accounts</span>
      </div>

      <ol className="relative pl-6">
        {/* The spine */}
        <span className="absolute left-[9px] top-2 bottom-2 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />

        {receipts.map((r, i) => (
          <motion.li
            key={r.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="relative pb-3 last:pb-0"
          >
            {/* Node */}
            <span
              className={cn(
                'absolute -left-6 top-2.5 w-[18px] h-[18px] rounded-full border-2 border-white flex items-center justify-center shadow-sm',
                r.isRefund ? 'bg-indigo-500' : r.status === 'bounced' ? 'bg-rose-500' : r.status === 'pending' ? 'bg-amber-400' : 'bg-emerald-500',
              )}
            >
              {r.isRefund
                ? <ArrowDownLeft className="w-2.5 h-2.5 text-white" />
                : <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
            </span>

            <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 hover:border-slate-300 transition-colors">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-800">{r.label}</span>
                    <span className="text-[11px] text-slate-400">{formatDate(r.paymentDate)}</span>
                    {r.status !== 'confirmed' && (
                      <span className={cn(
                        'px-1.5 py-[1px] rounded-md text-[10px] font-bold uppercase',
                        r.status === 'bounced' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700',
                      )}>
                        {r.status}
                      </span>
                    )}
                    {!r.onCurrentRevision && (
                      <span
                        className="px-1.5 py-[1px] rounded-md bg-slate-100 text-[10px] font-bold text-slate-500"
                        title="Taken against an earlier revision of this invoice and carried forward onto the current one."
                      >
                        carried forward
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {r.modeLabel && (
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Landmark className="w-3 h-3" style={r.modeColour ? { color: r.modeColour } : undefined} />
                        {r.modeLabel}
                      </span>
                    )}
                    {r.referenceNumber && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Hash className="w-3 h-3" />{r.referenceNumber}
                      </span>
                    )}
                    {r.attachmentName && (
                      <span className="inline-flex items-center gap-1" title="Slip held in the accounts system">
                        <Paperclip className="w-3 h-3" />{r.attachmentName}
                      </span>
                    )}
                    {r.recordedBy && <span>by {r.recordedBy}</span>}
                  </div>

                  {r.remarks && <p className="mt-1 text-[11px] text-slate-500 italic">{r.remarks}</p>}
                </div>

                <div className="text-right flex-shrink-0">
                  <p className={cn('text-sm font-extrabold tabular-nums', r.isRefund ? 'text-indigo-700' : 'text-emerald-700')}>
                    {r.isRefund ? '− ' : '+ '}{formatCurrency(Math.abs(r.amount), r.currency)}
                  </p>
                  {/* Only worth stating when the client paid in a different currency. */}
                  {r.currency !== invoiceCurrency && (
                    <p className="text-[10px] text-slate-400 tabular-nums">
                      = {formatCurrency(Math.abs(r.amountInvoiceCcy), invoiceCurrency)}
                      {r.exchangeRate ? ` @ ${r.exchangeRate}` : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

// ── Revision history ──────────────────────────────────────────────────────────

function Revisions({ ledger }: { ledger: InvoiceLedger }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5 flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> Invoice revisions
      </h3>
      <div className="flex flex-wrap gap-2">
        {ledger.revisions.map(rev => (
          <div
            key={rev.id}
            className={cn(
              'px-3 py-2 rounded-xl border text-left',
              rev.isLatest ? 'border-slate-300 bg-white shadow-sm' : 'border-slate-200 bg-slate-50/70',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn('text-xs font-bold', rev.isLatest ? 'text-slate-800' : 'text-slate-500')}>
                V{rev.revision}
              </span>
              {rev.isLatest && (
                <span className="px-1.5 py-[1px] rounded-md bg-emerald-100 text-[9px] font-bold text-emerald-700 uppercase">
                  current
                </span>
              )}
            </div>
            <p className={cn('text-sm font-bold tabular-nums', rev.isLatest ? 'text-slate-900' : 'text-slate-400 line-through')}>
              {formatCurrency(rev.grandTotal, rev.currency)}
            </p>
            <p className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]">{rev.invoiceNumber}</p>
            <p className="text-[10px] text-slate-400">{formatDate(rev.invoiceDate)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400 leading-snug">
        Every revision shares one ledger in accounts, so money banked against an earlier version
        counts towards the current one — it is not re-collected.
      </p>
    </div>
  )
}

// ── Cancellation ──────────────────────────────────────────────────────────────

function Cancellation({ ledger }: { ledger: InvoiceLedger }) {
  const c = ledger.summary.cancellation
  if (!c) return null

  const tone = toneFor(c.state)

  return (
    <div className="rounded-2xl border border-slate-300 bg-slate-50/80 overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-slate-200/70 flex items-center justify-center">
            <Ban className="w-4 h-4 text-slate-600" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-800">Cancellation invoice</p>
            <p className="text-[11px] text-slate-500 font-mono">{c.invoiceNumber}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold text-slate-800 tabular-nums">
            {formatCurrency(c.feeAmount, c.currency)}
          </p>
          <span className={cn('inline-flex items-center px-2 py-[1px] rounded-full border text-[10px] font-bold', tone.chip)}>
            {tone.label}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">Fee received</p>
          <p className="font-bold text-slate-700 tabular-nums">{formatCurrency(c.paidAmount, c.currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">Fee outstanding</p>
          <p className={cn('font-bold tabular-nums', c.balanceAmount > 0.005 ? 'text-rose-700' : 'text-emerald-700')}>
            {formatCurrency(Math.max(0, c.balanceAmount), c.currency)}
          </p>
        </div>
      </div>

      {ledger.cancellationReceipts.length > 0 && (
        <div className="px-4 pb-4">
          <Timeline
            receipts={ledger.cancellationReceipts}
            invoiceCurrency={c.currency}
            title="Cancellation fee payments"
          />
        </div>
      )}

      <p className="px-4 pb-3 text-[11px] text-slate-500 leading-snug">
        The cancellation invoice bills the cancellation fee only and sits on its own ledger in
        accounts, so its payments are kept apart from the booking&apos;s.
      </p>
    </div>
  )
}

// ── Footnote ──────────────────────────────────────────────────────────────────

function Footnote({ ledger }: { ledger: InvoiceLedger }) {
  const s = ledger.summary
  const fixed = ledger.exchangeRateStatus === 'fixed'

  const matched = s.matchedBy === 'invoice_number'
    ? 'matched on the invoice number'
    : s.matchedBy === 'tour_ref'
      ? 'matched on the tour reference'
      : 'matched on the control number'

  return (
    <div className="pt-3 border-t border-slate-100 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        {ledger.exchangeRateStatus && ledger.exchangeRateStatus !== 'na' && (
          <span className="inline-flex items-center gap-1.5">
            {fixed ? <Lock className="w-3 h-3 text-emerald-600" /> : <LockOpen className="w-3 h-3 text-slate-400" />}
            {fixed
              ? <>Exchange rate fixed at <strong className="font-semibold text-slate-700">{ledger.fixedExchangeRate}</strong> by the first payment</>
              : 'Exchange rate not fixed — no payment has locked it in yet'}
          </span>
        )}
        {s.firstPaymentAt && (
          <span>First payment {formatDate(s.firstPaymentAt)}</span>
        )}
        {s.lastPaymentAt && (
          <span>Last payment {formatDate(s.lastPaymentAt)}</span>
        )}
        {ledger.updatedAt && (
          <span>Accounts last touched this invoice {formatDateTime(ledger.updatedAt)}</span>
        )}
      </div>

      {ledger.paymentRemarks && (
        <p className="text-[11px] text-slate-500 italic bg-slate-50 rounded-lg px-3 py-2">
          {ledger.paymentRemarks}
        </p>
      )}

      <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
        <ExternalLink className="w-3 h-3" />
        Read live from the accounts system ({matched}). Invoices and receipts are recorded there —
        this panel never changes them.
      </p>
    </div>
  )
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function Notice({
  icon, title, body, action, className,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3.5', className)}>
      <span className="flex-shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-snug">{body}</p>
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the accounts ledger…
      </div>
      <div className="rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
        <div className="px-5 py-4 bg-slate-50 space-y-2">
          <div className="h-3 w-28 bg-slate-200 rounded" />
          <div className="h-8 w-40 bg-slate-200 rounded" />
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="h-3 w-full bg-slate-100 rounded-full" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  )
}
