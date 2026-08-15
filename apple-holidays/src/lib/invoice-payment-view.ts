/**
 * One vocabulary for "has this booking been paid for", shared by the bookings
 * list cell and the booking-detail statement panel.
 *
 * The colour of money is a promise to whoever reads it: green means the cash is
 * in, red means someone still has to chase it, amber means part of it. Those
 * three have to mean exactly the same thing on the list as they do on the
 * booking page, so the mapping lives here once rather than being re-typed into
 * each screen's className soup.
 *
 * Two states are deliberately *not* red:
 *
 *   none     accounts has not raised an invoice yet. That is an ordinary early
 *            state for a new booking, not a debt — colouring it red would have
 *            the team chasing clients who were never billed.
 *   unknown  the accounts database could not be read. Silence is not evidence
 *            of non-payment, so it renders as a neutral, obviously-inconclusive
 *            slate rather than as any answer at all.
 *
 * Pure presentation — no data access, safe in client components.
 */
import type { InvoicePaymentState } from './accounts-invoice-db'

export type { InvoicePaymentState }

export interface PaymentTone {
  /** Short label for a pill. */
  label: string
  /** Longer phrasing for the detail panel's headline. */
  headline: string
  /** Pill: background + text + border. */
  chip: string
  /** Solid fill for the progress bar / accent. */
  bar: string
  /** Soft wash behind a card or row accent. */
  wash: string
  /** Text colour for a figure rendered in this state's colour. */
  text: string
  /** Border colour for the panel's left edge. */
  edge: string
  /** The dot / ring colour, as a raw hex for SVG and inline styles. */
  hex: string
}

export const PAYMENT_TONES: Record<InvoicePaymentState, PaymentTone> = {
  paid: {
    label: 'Paid',
    headline: 'Fully received',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-gradient-to-r from-emerald-400 to-emerald-600',
    wash: 'bg-emerald-50/70',
    text: 'text-emerald-700',
    edge: 'border-l-emerald-500',
    hex: '#059669',
  },
  partial: {
    label: 'Part paid',
    headline: 'Part payment received',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-gradient-to-r from-amber-400 to-orange-500',
    wash: 'bg-amber-50/70',
    text: 'text-amber-700',
    edge: 'border-l-amber-500',
    hex: '#d97706',
  },
  unpaid: {
    label: 'Unpaid',
    headline: 'Nothing received yet',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    bar: 'bg-gradient-to-r from-rose-400 to-rose-600',
    wash: 'bg-rose-50/70',
    text: 'text-rose-700',
    edge: 'border-l-rose-500',
    hex: '#e11d48',
  },
  cancelled: {
    label: 'Cancelled',
    headline: 'Invoice cancelled',
    chip: 'bg-slate-100 text-slate-600 border-slate-300',
    bar: 'bg-gradient-to-r from-slate-400 to-slate-500',
    wash: 'bg-slate-50',
    text: 'text-slate-600',
    edge: 'border-l-slate-400',
    hex: '#64748b',
  },
  none: {
    label: 'Not invoiced',
    headline: 'No invoice raised',
    chip: 'bg-slate-50 text-slate-500 border-slate-200',
    bar: 'bg-slate-300',
    wash: 'bg-slate-50',
    text: 'text-slate-500',
    edge: 'border-l-slate-300',
    hex: '#94a3b8',
  },
  unknown: {
    label: 'Unknown',
    headline: 'Could not read the accounts ledger',
    chip: 'bg-slate-50 text-slate-400 border-dashed border-slate-300',
    bar: 'bg-slate-200',
    wash: 'bg-slate-50',
    text: 'text-slate-400',
    edge: 'border-l-slate-200',
    hex: '#cbd5e1',
  },
}

export function toneFor(state: InvoicePaymentState | null | undefined): PaymentTone {
  return PAYMENT_TONES[state ?? 'unknown'] ?? PAYMENT_TONES.unknown
}

/**
 * A compact money figure for a table cell — `$1.2k`, `$259`.
 *
 * The full amount belongs on the booking page and in the tooltip; a column has
 * to stay narrow enough that the columns either side of it still fit.
 */
export function compactMoney(amount: number, currency = 'USD'): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''

  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
  if (abs >= 10_000)    return `${sign}${symbol}${(abs / 1_000).toFixed(0)}k`
  if (abs >= 1_000)     return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`
  return `${sign}${symbol}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2)}`
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', SGD: 'S$', MYR: 'RM', LKR: 'Rs ', EUR: '€', GBP: '£',
  AUD: 'A$', INR: '₹', VND: '₫', THB: '฿', AED: 'AED ', JPY: '¥',
}

/** Percentage of the invoice banked, clamped to something a bar can draw. */
export function paidWidth(percent: number | null | undefined): number {
  const p = Number(percent ?? 0)
  if (!Number.isFinite(p) || p <= 0) return 0
  // A sliver rather than nothing: 0.4% of a large invoice is still money in.
  return Math.max(3, Math.min(100, p))
}
