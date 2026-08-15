'use client'

/**
 * The bookings list's "Invoice" column.
 *
 * One cell that answers, at a glance and in colour, the question the list could
 * not answer before: has the client actually paid for this booking?
 *
 *   green   fully received
 *   amber   part received — the cell fills to the fraction banked and says what
 *           is still due, because "partly paid" without the number is not a
 *           thing anyone can act on
 *   red     invoiced and nothing received
 *   slate   not invoiced yet, or the accounts ledger could not be read
 *
 * The figures come from the accounts database, decorated onto the list response
 * server-side (see `/api/bookings`), so the column costs one query per page
 * rather than one per row and the browser makes no extra round trip.
 *
 * Deliberately no hover popover: the table scrolls horizontally, which clips
 * absolutely-positioned children, so the full breakdown goes in the native
 * `title` tooltip and the real statement lives on the booking page.
 */
import { Ban, FileQuestion, Minus } from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { compactMoney, paidWidth, toneFor } from '@/lib/invoice-payment-view'
import type { InvoicePaymentSummary } from '@/lib/accounts-invoice-db'

/**
 * `undefined` — the row predates this column (an older cached response).
 * `null`      — the accounts DB could not be read for this page.
 */
export default function PaymentStateCell({
  summary,
  checked = true,
}: {
  summary?: InvoicePaymentSummary | null
  checked?: boolean
}) {
  // Unknown is not an answer, and must not be dressed as one.
  if (!checked || summary == null) {
    return (
      <div className="flex items-center gap-1.5 text-slate-300" title="The accounts ledger could not be read for this page.">
        <Minus className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">—</span>
      </div>
    )
  }

  const tone = toneFor(summary.state)

  if (summary.state === 'none') {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-dashed border-slate-200 text-slate-400"
        title="No invoice has been raised for this booking in the accounts system yet."
      >
        <FileQuestion className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold">Not invoiced</span>
      </div>
    )
  }

  const currency = summary.currency ?? 'USD'
  const value    = summary.invoiceValue ?? 0
  const paid     = summary.paidAmount ?? 0
  const balance  = summary.balanceAmount ?? 0
  const percent  = summary.paidPercent ?? 0

  const tooltip = [
    `${summary.invoiceNumber ?? 'Invoice'}${(summary.revision ?? 1) > 1 ? ` (revision ${summary.revision})` : ''}`,
    `Invoice value: ${formatCurrency(value, currency)}`,
    `Received: ${formatCurrency(paid, currency)}`,
    balance > 0.005  ? `Outstanding: ${formatCurrency(balance, currency)}` : null,
    (summary.overpaidAmount ?? 0) > 0.005 ? `Overpaid (refund due): ${formatCurrency(summary.overpaidAmount, currency)}` : null,
    summary.lastPaymentAt ? `Last payment: ${formatDate(summary.lastPaymentAt)}` : null,
    summary.cancellation ? `Cancellation invoice: ${formatCurrency(summary.cancellation.feeAmount, summary.cancellation.currency)}` : null,
  ].filter(Boolean).join('\n')

  return (
    <div className="min-w-[132px] max-w-[168px]" title={tooltip}>
      {/* Amount + state pill */}
      <div className="flex items-center gap-1.5">
        <span className={cn('text-sm font-bold tabular-nums', summary.state === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-800')}>
          {compactMoney(value, currency)}
        </span>
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border text-[10px] font-bold uppercase tracking-wide', tone.chip)}>
          {summary.state === 'cancelled'
            ? <Ban className="w-2.5 h-2.5" />
            : <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.hex }} />}
          {tone.label}
        </span>
      </div>

      {/* Fill meter — the whole point of the cell for a part payment */}
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tone.bar)}
          style={{ width: `${summary.state === 'paid' ? 100 : paidWidth(percent)}%` }}
        />
      </div>

      {/* The actionable half-sentence: what is still owed */}
      <div className="mt-0.5 text-[10px] font-medium leading-tight">
        {summary.state === 'partial' && (
          <span className="text-amber-700">
            {Math.round(percent)}% in · {compactMoney(balance, currency)} due
          </span>
        )}
        {summary.state === 'unpaid' && (
          <span className="text-rose-600">{compactMoney(balance || value, currency)} outstanding</span>
        )}
        {summary.state === 'paid' && (
          <span className="text-emerald-600">
            {(summary.overpaidAmount ?? 0) > 0.005
              ? `Overpaid ${compactMoney(summary.overpaidAmount ?? 0, currency)}`
              : summary.lastPaymentAt ? `Settled ${formatDate(summary.lastPaymentAt)}` : 'Settled'}
          </span>
        )}
        {summary.state === 'cancelled' && <span className="text-slate-400">Ledger cancelled</span>}
      </div>
    </div>
  )
}
