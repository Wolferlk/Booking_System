'use client'

/**
 * The small vocabulary the Proforma Invoice screen is written in.
 *
 * The one idea worth stating: a proforma has two statuses, and they belong to
 * two different companies' worth of people. `status` is what *we* have done
 * with the paper (received it, checked it, sent it on). The settlement is what
 * *Accounts* has done with the money. `SettlementChip` never invents the second
 * from the first — an invoice with no settlement row reads "with Accounts",
 * not "unpaid", because we genuinely do not know yet.
 */

import { cn } from '@/lib/utils'
import {
  BadgeCheck, CircleDashed, Clock3, FileWarning, HandCoins, ShieldCheck, XCircle,
} from 'lucide-react'

export interface Settlement {
  status: string
  payableStatus: string | null
  payableMatched: boolean
  hotelName: string | null
  currency: string | null
  paidAmount: number | null
  paidAt: string | null
  paidBy: string | null
  reference: string | null
  note: string | null
  updatedAt: string | null
}

export interface Invoice {
  id: string
  bookingRef: string | null
  isNumber: string | null
  accommodationId: string | null
  hotelName: string | null
  city: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  currency: string
  amount: number | null
  taxAmount: number | null
  totalAmount: number | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  roomType: string | null
  mealPlan: string | null
  roomCount: number | null
  status: string
  origin: string
  hotelAdded: boolean
  fileUrl: string | null
  fileName: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  settlement: Settlement | null
}

export interface HotelSlot {
  key: string
  accommodationId: string | null
  hotelName: string
  city: string | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  roomType: string | null
  mealType: string | null
  ownArrangement: boolean
  addedByUser: boolean
  invoices: Invoice[]
}

export interface BookingHeader {
  id: string
  bookingRef: string
  isNumber: string | null
  refKey: string
  agent: string | null
  agentEmail: string | null
  status: string
  operationCountry: string | null
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  currency: string
  quotedTotal: number | null
  leadGuest: string | null
  dealName: string | null
  tourDestination: string | null
  fileHandler: string | null
}

export function money(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dayShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** For a `<input type="date">` default. */
export function dateValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

const PAPER_STATUS: Record<string, { label: string; className: string }> = {
  RECEIVED:     { label: 'Filed',        className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  UNDER_REVIEW: { label: 'Under review', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  DISCREPANCY:  { label: 'Discrepancy',  className: 'bg-red-50 text-red-700 ring-red-200' },
  VERIFIED:     { label: 'Verified',     className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  FORWARDED:    { label: 'With Accounts',className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  PAID:         { label: 'Paid',         className: 'bg-teal-50 text-teal-700 ring-teal-200' },
  REJECTED:     { label: 'Rejected',     className: 'bg-orange-50 text-orange-700 ring-orange-200' },
  VOID:         { label: 'Void',         className: 'bg-slate-100 text-slate-400 ring-slate-200 line-through' },
}

export function PaperChip({ status }: { status: string }) {
  const s = PAPER_STATUS[status] ?? { label: status, className: 'bg-slate-100 text-slate-600 ring-slate-200' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', s.className)}>
      {s.label}
    </span>
  )
}

/** What Accounts has done with the money, in Accounts' own words. */
export function SettlementChip({ settlement }: { settlement: Settlement | null }) {
  if (!settlement) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
        <CircleDashed className="h-3 w-3" /> With Accounts
      </span>
    )
  }

  if (settlement.status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 ring-1 ring-inset ring-teal-300">
        <BadgeCheck className="h-3 w-3" /> Payable done
      </span>
    )
  }
  if (settlement.status === 'partially_paid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-300">
        <HandCoins className="h-3 w-3" /> Part paid
      </span>
    )
  }
  if (settlement.status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 ring-1 ring-inset ring-red-300">
        <XCircle className="h-3 w-3" /> Returned by Accounts
      </span>
    )
  }
  if (settlement.payableMatched) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
        <ShieldCheck className="h-3 w-3" /> Matched to Payable 1.0
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
      <Clock3 className="h-3 w-3" /> Awaiting payment
    </span>
  )
}

export function MissingFileChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
      <FileWarning className="h-3 w-3" /> No document
    </span>
  )
}

export function Stat({
  label, value, sub, tone = 'slate',
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'slate' | 'teal' | 'indigo' | 'amber'
}) {
  const tones = {
    slate: 'border-slate-200',
    teal: 'border-teal-300',
    indigo: 'border-indigo-300',
    amber: 'border-amber-300',
  }
  return (
    <div className={cn('rounded-xl border-l-4 bg-white p-3 shadow-sm ring-1 ring-slate-100', tones[tone])}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}
