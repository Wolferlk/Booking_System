/**
 * "Is this a brand-new booking, or an old one confirmed again?"
 *
 * The auto-import creates an OPS booking the first time it sees a confirmed
 * (status 2) quotation, so the OPS `createdAt` is "when *we* first saw it", not
 * "when the sale happened". A quote first confirmed back in June, amended and
 * confirmed again today, lands in OPS today looking exactly like a fresh sale.
 *
 * The AppleSystem list API already carries the answer: every row has
 * `quotation_updates`, one entry per revision of the quotation number, each
 * with its status (R = quote, C = confirmed, X = cancelled) and its
 * `created_at` in Asia/Colombo. The earliest C is the first confirmation.
 *
 * Read-only towards AppleSystem — one `/api/quotation/list` search per quote
 * number. The only write anywhere is a small cache row in OPS
 * `system_settings` (`as_confirm_hist:<quoteNo>`), so a page refresh does not
 * ask AppleSystem the same question again. Nothing on the booking is changed.
 */

import { prisma } from '@/lib/prisma'
import { searchBookings, type ASBookingListItem } from '@/lib/applesystem'
import { findQuoteRow } from '@/lib/as-quote-lookup'
import { opsDayOf } from '@/lib/booking-date-window'

export type RevisionLetter = 'R' | 'C' | 'X'

export interface QuoteRevision {
  /** AppleSystem row id of this revision. */
  id: number | null
  letter: RevisionLetter
  /** Colombo calendar day, YYYY-MM-DD. */
  day: string
  /** Exact instant (ISO, UTC). */
  at: string
}

export interface QuoteHistory {
  quoteNo: string
  revisions: QuoteRevision[]
  fetchedAt: string
}

export type ConfirmOriginKind = 'NEW' | 'RECONFIRMED' | 'UNKNOWN'

export interface ConfirmOrigin {
  bookingRef: string
  quoteNo: string | null
  kind: ConfirmOriginKind
  /** First C revision in AppleSystem. */
  firstConfirmedAt: string | null
  firstConfirmedDay: string | null
  /** The C revision that OPS imported from (the latest C at or before OPS created it). */
  importedConfirmAt: string | null
  /** First revision of any kind, i.e. when the quote was first written. */
  firstQuotedDay: string | null
  /** OPS createdAt as a Colombo day. */
  opsCreatedDay: string
  /** Whole days between the first confirmation and OPS creating the file. */
  gapDays: number | null
  confirmCount: number
  /** A cancellation sits between the first confirmation and the latest one. */
  cancelledBetween: boolean
  revisions: QuoteRevision[]
  /** Why the answer is UNKNOWN, when it is. */
  reason?: string
}

/**
 * A confirmation counts as "new" when OPS created the file on the day it was
 * first confirmed, or the day after. The overnight import picks up the previous
 * day's confirmations at about 06:00, so a sale confirmed at 22:00 is first seen
 * by OPS the next morning and is still new.
 */
export const NEW_GRACE_DAYS = 1

const CACHE_PREFIX = 'as_confirm_hist:'
/** History is re-read at most this often. It only ever grows, so a stale copy is still right about the past. */
const CACHE_TTL_MS = 20 * 60_000
const memo = new Map<string, QuoteHistory>()

// ── Parsing ──────────────────────────────────────────────────────────────────

const TZ_OFFSET: Record<string, string> = { 'Asia/Colombo': '+05:30', UTC: 'Z' }

/** AppleSystem date node → { Colombo day, ISO instant }. The day is read straight off the string, never through the server clock. */
export function parseAsInstant(node: unknown): { day: string; at: string } | null {
  const obj = typeof node === 'string' ? { date: node } : (node as { date?: string; timezone?: string } | null)
  const raw = obj?.date
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const local = raw.replace(' ', 'T').slice(0, 19)
  const offset = TZ_OFFSET[obj?.timezone ?? 'Asia/Colombo'] ?? '+05:30'
  const d = new Date(local.length === 10 ? `${local}T00:00:00${offset}` : `${local}${offset}`)
  if (isNaN(d.getTime())) return null
  return { day: raw.slice(0, 10), at: d.toISOString() }
}

interface RawUpdate { id?: number | string; status?: string | number; status_letter?: string; created_at?: unknown }

function letterOf(u: RawUpdate): RevisionLetter | null {
  const s = String(u.status ?? '')
  if (s === '1') return 'R'
  if (s === '2') return 'C'
  if (s === '3') return 'X'
  const l = String(u.status_letter ?? '').toUpperCase()
  return l === 'R' || l === 'C' || l === 'X' ? l : null
}

export function revisionsFromRow(row: ASBookingListItem): QuoteRevision[] {
  const raw = (row as unknown as { quotation_updates?: RawUpdate[] }).quotation_updates
  const list: RawUpdate[] = Array.isArray(raw) && raw.length
    ? raw
    // Older API builds without the trail: the row itself is the only revision we know.
    : [{ id: row.id, status: row.status, created_at: row.created_at }]
  const out: QuoteRevision[] = []
  for (const u of list) {
    const letter = letterOf(u)
    const when = parseAsInstant(u.created_at)
    if (!letter || !when) continue
    out.push({ id: u.id != null ? Number(u.id) : null, letter, ...when })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

// ── Classification (pure) ────────────────────────────────────────────────────

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function classifyConfirmOrigin(
  bookingRef: string,
  opsCreatedAt: Date,
  history: QuoteHistory | null,
  reason?: string,
): ConfirmOrigin {
  const opsCreatedDay = opsDayOf(opsCreatedAt)
  const revisions = history?.revisions ?? []
  const confirms = revisions.filter(r => r.letter === 'C')
  const base: ConfirmOrigin = {
    bookingRef,
    quoteNo: history?.quoteNo ?? null,
    kind: 'UNKNOWN',
    firstConfirmedAt: null,
    firstConfirmedDay: null,
    importedConfirmAt: null,
    firstQuotedDay: revisions[0]?.day ?? null,
    opsCreatedDay,
    gapDays: null,
    confirmCount: confirms.length,
    cancelledBetween: false,
    revisions,
  }
  if (!history) return { ...base, reason: reason ?? 'Not found in the Apple system' }
  if (!confirms.length) return { ...base, reason: 'The Apple system has no confirmed revision for this quote' }

  const first = confirms[0]
  // The confirmation OPS actually imported: the last C at or before the OPS row
  // was written (with a few minutes' slack for clock skew). Later Cs are
  // amendments after import and do not change what this file was.
  const cutoff = opsCreatedAt.getTime() + 10 * 60_000
  const imported = [...confirms].reverse().find(c => Date.parse(c.at) <= cutoff) ?? confirms[confirms.length - 1]
  const gapDays = dayDiff(first.day, opsCreatedDay)
  const cancelledBetween = revisions.some(
    r => r.letter === 'X' && r.at > first.at && r.at < imported.at,
  )

  return {
    ...base,
    kind: gapDays <= NEW_GRACE_DAYS ? 'NEW' : 'RECONFIRMED',
    firstConfirmedAt: first.at,
    firstConfirmedDay: first.day,
    importedConfirmAt: imported.at,
    gapDays,
    cancelledBetween,
  }
}

// ── Fetching (read-only towards AppleSystem) ─────────────────────────────────

/** "506343CNTL" → "506343". Only a pure digits + CNTL control number is trusted. */
export function quoteNoFromCntl(cntl: string | null | undefined): string | null {
  const m = (cntl ?? '').trim().toUpperCase().match(/^(\d{4,})\s*CNTL$/)
  return m ? m[1] : null
}

async function readCache(quoteNo: string): Promise<QuoteHistory | null> {
  const hot = memo.get(quoteNo)
  if (hot && Date.now() - Date.parse(hot.fetchedAt) < CACHE_TTL_MS) return hot
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: CACHE_PREFIX + quoteNo } })
    if (!row) return null
    const parsed = JSON.parse(row.value) as QuoteHistory
    if (!parsed?.fetchedAt || Date.now() - Date.parse(parsed.fetchedAt) >= CACHE_TTL_MS) return null
    memo.set(quoteNo, parsed)
    return parsed
  } catch {
    return null
  }
}

async function writeCache(h: QuoteHistory): Promise<void> {
  memo.set(h.quoteNo, h)
  try {
    const value = JSON.stringify(h)
    if (value.length > 60_000) return // TEXT ceiling; a quote with this many revisions is not worth caching
    await prisma.systemSetting.upsert({
      where: { key: CACHE_PREFIX + h.quoteNo },
      update: { value },
      create: { key: CACHE_PREFIX + h.quoteNo, value },
    })
  } catch {
    /* cache is best-effort */
  }
}

function historyFrom(quoteNo: string, rows: ASBookingListItem[]): QuoteHistory | null {
  const mine = rows.filter(r => String(r.quotation_no) === quoteNo)
  if (!mine.length) return null
  // Every row of the same quote number carries the same trail; take the richest.
  const best = mine
    .map(r => revisionsFromRow(r))
    .sort((a, b) => b.length - a.length)[0]
  return { quoteNo, revisions: best, fetchedAt: new Date().toISOString() }
}

/** Revision history for one quotation number. Cached; throws only if AppleSystem fails. */
export async function getQuoteHistory(quoteNo: string): Promise<QuoteHistory | null> {
  const cached = await readCache(quoteNo)
  if (cached) return cached
  const { items } = await searchBookings({ quotationNo: quoteNo, statuses: [] })
  const h = historyFrom(quoteNo, items)
  if (h) await writeCache(h)
  return h
}

/** For bookings without a CNTL number: find the quote by IS number. */
export async function getQuoteHistoryByRef(bookingRef: string): Promise<QuoteHistory | null> {
  const row = await findQuoteRow(bookingRef)
  if (!row?.quotation_no) return null
  const quoteNo = String(row.quotation_no)
  const cached = await readCache(quoteNo)
  if (cached) return cached
  const h = historyFrom(quoteNo, [row])
  if (h) await writeCache(h)
  return h
}
