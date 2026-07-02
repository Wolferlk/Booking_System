import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, differenceInDays, parseISO, isValid } from 'date-fns'
import type { PNLLineItem, PNL } from '@prisma/client'
import type { PNLLineItemWithTotal, PNLWithTotals } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── P&L calculations (mirrors the spreadsheet formula) ─────────────────

export function computePNLLineTotal(
  line: Pick<PNLLineItem, 'sicRate' | 'pvtRatePP' | 'otherRate' | 'adEntrance' | 'chEntrance'>,
  paxAdults: number,
  paxChildren: number,
): number {
  const sic = Number(line.sicRate)
  const pvt = Number(line.pvtRatePP)
  const other = Number(line.otherRate)
  const adEnt = Number(line.adEntrance)
  const chEnt = Number(line.chEntrance)
  const totalPax = paxAdults + paxChildren

  return (sic + pvt + other) * totalPax + adEnt * paxAdults + chEnt * paxChildren
}

export function computePNLTotals(
  pnl: PNL & { lineItems: PNLLineItem[] },
): PNLWithTotals {
  const lineItemsWithTotal: PNLLineItemWithTotal[] = pnl.lineItems.map(line => ({
    ...line,
    totalCost: computePNLLineTotal(line, pnl.paxAdults, pnl.paxChildren),
  }))

  const totalRevenue = lineItemsWithTotal.reduce((sum, l) => sum + Number(l.mmtRate), 0)
  const totalCost = lineItemsWithTotal.reduce((sum, l) => sum + l.totalCost, 0)
  const profit = totalRevenue - totalCost
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0

  return {
    ...pnl,
    lineItems: lineItemsWithTotal,
    totalRevenue,
    totalCost,
    profit,
    margin,
  }
}

// ─── Date helpers ────────────────────────────────────────────────────────

export function formatDate(date: Date | string | null | undefined, fmt = 'dd MMM yyyy'): string {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    return isValid(d) ? format(d, fmt) : '—'
  } catch {
    return '—'
  }
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return formatDate(date, 'dd MMM yyyy, HH:mm')
}

export function getCancellationDeadline(arrivalDate: Date | string): Date {
  const d = typeof arrivalDate === 'string' ? parseISO(arrivalDate) : arrivalDate
  const result = new Date(d)
  result.setDate(result.getDate() - 21)
  return result
}

export function getDaysUntilTrip(arrivalDate: Date | string): number {
  const d = typeof arrivalDate === 'string' ? parseISO(arrivalDate) : arrivalDate
  return differenceInDays(d, new Date())
}

export function isClientPortalUnlocked(arrivalDate: Date | string): boolean {
  return getDaysUntilTrip(arrivalDate) <= 5
}

export function isRecheckRequired(arrivalDate: Date | string): boolean {
  const days = getDaysUntilTrip(arrivalDate)
  return days <= 7 && days > 0
}

// ─── Currency formatting ─────────────────────────────────────────────────

// Maps common currency symbols/abbreviations to ISO 4217 codes
const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  RM: 'MYR',
  S$: 'SGD',
  '₫': 'VND',
  Rs: 'LKR',
  '₹': 'INR',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
  A$: 'AUD',
}

export function normalizeCurrencyCode(code: string | null | undefined): string {
  if (!code) return 'USD'
  const upper = code.trim().toUpperCase()
  return CURRENCY_SYMBOL_MAP[code.trim()] ?? CURRENCY_SYMBOL_MAP[upper] ?? upper
}

export function formatCurrency(
  amount: number | string | null | undefined,
  currency = 'USD',
): string {
  if (amount === null || amount === undefined) return '—'
  const num = Number(amount)
  if (isNaN(num)) return '—'
  const iso = normalizeCurrencyCode(currency)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: iso,
      minimumFractionDigits: 2,
    }).format(num)
  } catch {
    // Fallback for unknown currency codes — display as plain number with code prefix
    return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
}

// ─── Misc ────────────────────────────────────────────────────────────────

export function generateBookingRef(prefix = 'VN'): string {
  const year = new Date().getFullYear().toString().slice(-2)
  const random = Math.floor(Math.random() * 90000 + 10000)
  return `${prefix}${year}${random}`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

export function parseJsonSafe<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

export function buildApiError(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status })
}

export function buildApiSuccess<T>(data: T, statusOrMessage?: number | string) {
  const status = typeof statusOrMessage === 'number' ? statusOrMessage : 200
  return Response.json({ success: true, data }, { status })
}

// Credit-based agents pay in bulk on 15th & 30th — no per-booking payment approval needed
const CREDIT_AGENT_NAMES = ['make my trip', 'makemytrip', 'mmt', '30sundays', 'thirty sundays']

export function isCreditAgent(agentName: string | null | undefined): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase().trim()
  return CREDIT_AGENT_NAMES.some(n => lower.includes(n))
}
