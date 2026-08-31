/**
 * File-handler resolution — turn the "30sundays Aahaas" placeholder into the
 * real person who owns the file.
 *
 * Bookings created from the 30 Sundays feed arrive with `fileHandler` set to the
 * generic account name "30sundays Aahaas" rather than a handler's name. The
 * quotation tool knows better: `apple_quote_ai.tbl_corporate_parties` carries a
 * `file_handler` column keyed by `is_number`, filled in when the quote is saved.
 * This module joins the two on the IS number and writes the real name onto our
 * booking.
 *
 * Safety, in order of importance:
 *   - the quote database is opened through the read-only client (`quote-ai-db`),
 *     so this feature can never write to it;
 *   - the only write is `bookings.fileHandler`, and only on rows that still hold
 *     the placeholder — a booking a human has already renamed is never touched;
 *   - a quote row whose own `file_handler` is empty or is itself the placeholder
 *     resolves to nothing, so we never replace a placeholder with a placeholder.
 *
 * Three callers share this logic: the 10-minutes-after-creation sweep
 * (`file-handler-resolve-scheduler.ts` / `/api/cron/file-handler-resolve`), the
 * per-booking button on the booking detail page, and the "Replace all" button on
 * the admin settings page.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { prisma } from './prisma'
import { quoteAiQuery, isQuoteAiConfigured } from './quote-ai-db'
import { logActivity } from './activity'
import { PLACEHOLDER_FILE_HANDLER, isPlaceholderFileHandler } from './file-handler-placeholder'

export { PLACEHOLDER_FILE_HANDLER, isPlaceholderFileHandler }

/** How long after creation the automatic sweep is allowed to touch a booking. */
export const AUTO_RESOLVE_DELAY_MINUTES = 10

/** How far back the automatic sweep looks, so it is not an all-history scan. */
const AUTO_RESOLVE_WINDOW_HOURS = 72

/** IS-number comparison key — "VN 41532", "vn41532" and "VN41532" all agree. */
function isKey(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase().trim()
}

interface PartyRow extends RowDataPacket {
  is_number: string | null
  file_handler: string | null
  agent_name: string | null
  quotation_no: string | null
  updated_at: string | null
}

/**
 * Look up the real file handler for a set of IS numbers.
 *
 * Returns a map keyed by {@link isKey}. Only entries with a usable name are
 * present: a quote row with no `file_handler`, or one still holding the
 * placeholder, is deliberately absent so callers leave the booking alone.
 * When one IS number has several quote rows the most recently updated wins.
 */
export async function lookupRealFileHandlers(
  isNumbers: string[],
): Promise<Map<string, { name: string; quotationNo: string | null; agentName: string | null }>> {
  const out = new Map<string, { name: string; quotationNo: string | null; agentName: string | null }>()

  // Send both the compact and the spaced spelling ("VN41532" / "VN 41532") so a
  // differently-formatted quote row still matches; the JS side normalises again.
  const wanted = new Set<string>()
  for (const raw of isNumbers) {
    const compact = isKey(raw ?? '')
    if (!compact || compact === 'NA') continue
    wanted.add(compact)
    const m = compact.match(/^([A-Z]+)(\d+)$/)
    if (m) wanted.add(`${m[1]} ${m[2]}`)
  }
  if (!wanted.size) return out

  const values = Array.from(wanted)
  const CHUNK = 400
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK)
    const rows = await quoteAiQuery<PartyRow>(
      `SELECT is_number, file_handler, agent_name, quotation_no, updated_at
         FROM tbl_corporate_parties
        WHERE is_number IN (${chunk.map(() => '?').join(',')})
        ORDER BY updated_at ASC, thread_id ASC`,
      chunk,
    )
    // Ascending order means a later row simply overwrites an earlier one, so the
    // freshest quote for an IS number is the one that survives.
    for (const row of rows) {
      const key  = isKey(row.is_number ?? '')
      const name = (row.file_handler ?? '').trim()
      if (!key || !name || isPlaceholderFileHandler(name)) continue
      out.set(key, {
        name,
        quotationNo: row.quotation_no ?? null,
        agentName:   (row.agent_name ?? '').trim() || null,
      })
    }
  }

  return out
}

export interface ResolveOutcome {
  bookingRef: string
  /** 'replaced' | 'no-match' (no usable handler in the quote table) | 'not-placeholder' */
  status: 'replaced' | 'no-match' | 'not-placeholder'
  from: string | null
  to: string | null
}

export interface SweepSummary {
  scanned: number
  replaced: number
  noMatch: number
  errors: number
  changes: { bookingRef: string; from: string | null; to: string }[]
}

/** The booking fields this module needs; shared by both entry points. */
type Candidate = { id: string; bookingRef: string; isNumber: string | null; fileHandler: string | null }

/**
 * Apply the resolved names to a set of candidate bookings.
 *
 * `userId` — when present, each replacement is written to the activity log
 * under that user (the manual buttons). The scheduled sweep passes none.
 */
async function applyToCandidates(candidates: Candidate[], userId?: string): Promise<SweepSummary> {
  const summary: SweepSummary = { scanned: candidates.length, replaced: 0, noMatch: 0, errors: 0, changes: [] }
  if (!candidates.length) return summary

  const handlers = await lookupRealFileHandlers(
    candidates.map(b => b.isNumber || b.bookingRef),
  )

  for (const b of candidates) {
    const hit = handlers.get(isKey(b.isNumber || b.bookingRef))
    if (!hit) { summary.noMatch++; continue }

    try {
      // Guarded update: the row must still hold the placeholder. If someone
      // renamed the handler between the read and this write, count 0 rows come
      // back and their edit stands.
      const res = await prisma.booking.updateMany({
        where: { id: b.id, fileHandler: b.fileHandler },
        data:  { fileHandler: hit.name },
      })
      if (res.count === 0) { summary.noMatch++; continue }

      summary.replaced++
      summary.changes.push({ bookingRef: b.bookingRef, from: b.fileHandler, to: hit.name })

      if (userId) {
        await logActivity({
          userId,
          action:     'BOOKING_UPDATED',
          entityType: 'Booking',
          entityId:   b.id,
          details: {
            field: 'fileHandler',
            from:  b.fileHandler,
            to:    hit.name,
            source: 'apple_quote_ai.tbl_corporate_parties',
            quotationNo: hit.quotationNo,
          },
        })
      }
    } catch (err) {
      summary.errors++
      console.error(
        `[FileHandlerResolve] ${b.bookingRef} update failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return summary
}

/** Bookings still carrying the placeholder, newest first. */
async function placeholderBookings(opts: { createdBefore?: Date; createdAfter?: Date } = {}): Promise<Candidate[]> {
  const rows = await prisma.booking.findMany({
    where: {
      // MySQL's collation makes this case-insensitive; the exact spelling is
      // pinned by the fileHandlerKey() filter below, which also rules out the
      // unrelated "30 Sundays Agent" handler.
      fileHandler: { contains: 'sundays' },
      ...(opts.createdBefore || opts.createdAfter
        ? { createdAt: { ...(opts.createdBefore ? { lte: opts.createdBefore } : {}), ...(opts.createdAfter ? { gte: opts.createdAfter } : {}) } }
        : {}),
    },
    select: { id: true, bookingRef: true, isNumber: true, fileHandler: true },
    orderBy: { createdAt: 'desc' },
  })
  return rows.filter(b => isPlaceholderFileHandler(b.fileHandler))
}

/** How many bookings currently hold the placeholder — for the settings card. */
export async function countPlaceholderBookings(): Promise<number> {
  return (await placeholderBookings()).length
}

/**
 * Resolve one booking on demand (the button on the booking detail page).
 * Runs whatever the booking's age — this is an operator asking for it now.
 */
export async function resolveFileHandlerForBooking(
  bookingRef: string,
  userId?: string,
): Promise<ResolveOutcome> {
  const booking = await prisma.booking.findUnique({
    where:  { bookingRef },
    select: { id: true, bookingRef: true, isNumber: true, fileHandler: true },
  })
  if (!booking) throw new Error('Booking not found')

  if (!isPlaceholderFileHandler(booking.fileHandler)) {
    return { bookingRef, status: 'not-placeholder', from: booking.fileHandler, to: null }
  }

  const summary = await applyToCandidates([booking], userId)
  if (summary.errors) throw new Error('Update failed — see server logs')

  const change = summary.changes[0]
  return change
    ? { bookingRef, status: 'replaced', from: change.from, to: change.to }
    : { bookingRef, status: 'no-match', from: booking.fileHandler, to: null }
}

/**
 * Sweep every booking that still holds the placeholder (the "Replace all"
 * button on the settings page).
 */
export async function resolveAllFileHandlers(userId?: string): Promise<SweepSummary> {
  if (!isQuoteAiConfigured()) throw new Error('Quote AI database is not configured')
  return applyToCandidates(await placeholderBookings(), userId)
}

/**
 * The automatic pass: bookings created at least {@link AUTO_RESOLVE_DELAY_MINUTES}
 * ago (the quote row is written a few minutes after the booking lands, so an
 * immediate lookup would find nothing) and no older than the rolling window.
 */
export async function runFileHandlerAutoSweep(reason: string): Promise<SweepSummary> {
  if (!isQuoteAiConfigured()) {
    console.log('[FileHandlerResolve] skipped — quote DB not configured')
    return { scanned: 0, replaced: 0, noMatch: 0, errors: 0, changes: [] }
  }

  const now = Date.now()
  const candidates = await placeholderBookings({
    createdBefore: new Date(now - AUTO_RESOLVE_DELAY_MINUTES * 60_000),
    createdAfter:  new Date(now - AUTO_RESOLVE_WINDOW_HOURS * 3_600_000),
  })

  const summary = await applyToCandidates(candidates)
  if (summary.scanned) {
    console.log(
      `[FileHandlerResolve] ${reason} — ${summary.replaced}/${summary.scanned} replaced, ` +
      `${summary.noMatch} no match, ${summary.errors} errors`,
    )
  }
  return summary
}
