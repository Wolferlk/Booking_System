/**
 * Test bookings — the shared register of bookings that were only ever tests.
 *
 * ## What it is
 *
 * The register lives in the accounts database (`test_bookings`), because a test
 * booking has to disappear from both systems at once: the accounts invoice,
 * P&L, payable and B2B / B2C screens and daily mails there, and this system's
 * booking lists, counts and daily report here. One row says "this reference is
 * a test"; both systems read it.
 *
 * ## Nothing is changed to hide a booking
 *
 * Marking writes one register row and nothing else — no booking status, no
 * flag on the booking, no invoice or P&L. Every list *derives* "hidden" from
 * the register, so releasing the row (it is stamped, never deleted) brings the
 * booking straight back everywhere.
 *
 * ## Fail-open
 *
 * If the accounts database cannot be read, the last set read on this instance
 * is used for a while; with nothing to fall back on the set is empty and every
 * list shows exactly what it showed before this feature existed. Hiding real
 * business because a lookup failed is the worst way a filter like this could
 * fail, so it never does.
 *
 * Keys must stay identical to `TestBookingService::keyFor()` in the accounts
 * system (app/Services/TestBookingService.php).
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery, accountsWrite } from '@/lib/accounts-db'
import { prisma } from '@/lib/prisma'
import { B2C_AGENT_NAME, isB2cBooking } from '@/lib/booking-source'
import type { UserRole } from '@prisma/client'

// ─── Keys ─────────────────────────────────────────────────────────────────────

const EMPTY_KEYS = new Set(['', 'NA', 'N/A', 'NULL', '-', '—'])

/**
 * "IS 48715", "is-48715", "IS48715_R2/R2" and "IS48715-CXL" → "IS48715".
 * Port of TestBookingService::keyFor (revision + CXL stripped, then every
 * non-alphanumeric removed, upper-cased).
 */
export function testBookingKey(reference: string | null | undefined): string {
  let ref = String(reference ?? '').trim()
  if (!ref) return ''
  ref = ref.replace(/_R\d+(\/R\d+)?$/i, '').replace(/-?CXL$/i, '')
  const key = ref.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return EMPTY_KEYS.has(key) ? '' : key
}

/**
 * The reference an OPS booking is registered under. B2C orders are imported
 * with the bare checkout id as their ref (and IS number), but accounts files
 * them as AHS-<id> (B2cPnlService::invoiceNumberFor) — and a bare number is
 * refused by the register. Everything else: the IS number, else the ref.
 */
export function testBookingReference(b: { bookingRef: string; isNumber?: string | null; agent?: string | null }): string {
  const ref = b.bookingRef.trim()
  if (isB2cBooking(b.agent) && /^\d+$/.test(ref)) return `AHS-${ref}`
  return b.isNumber || b.bookingRef
}

/** Why a reference cannot be marked, or null. Mirrors TestBookingRegistry::problemWith. */
export function testBookingProblem(key: string): string | null {
  if (!key) return 'Enter a booking reference.'
  if (!/[A-Z]/.test(key) || !/\d/.test(key)) {
    return 'A booking reference has letters and digits (IS48715). A bare number is a control / tour number other bookings also carry.'
  }
  if (key.length < 5 || key.length > 40) return 'That does not look like a booking reference.'
  return null
}

/** Mirrors TestBookingRegistry::channelOf. */
export function testBookingChannel(key: string): 'as' | 'b2c' | 'b2b' | 'b2b_ticket' | 'doc' {
  if (/^AAHB2B\d+$/.test(key)) return 'b2b'
  if (/^AAHTKT\d+$/.test(key)) return 'b2b_ticket'
  if (/^AHS\d+$/.test(key)) return 'b2c'
  if (/^[A-Z]{2,3}\d{4,}$/.test(key)) return 'as'
  return 'doc'
}

/** Who may mark or restore a test booking from OPS. */
export function canManageTestBookings(role: UserRole | string | undefined): boolean {
  return role === 'ULTRA_SUPER_ADMIN' || role === 'SUPER_ADMIN' || role === 'AC_USER'
}

// ─── The register ─────────────────────────────────────────────────────────────

export interface TestBookingMark {
  id: number
  key: string
  ref: string
  channel: string | null
  reason: string | null
  markedBy: string | null
  markedFrom: string | null
  markedAt: string | null
}

interface MarkRow extends RowDataPacket {
  id: number
  booking_key: string
  booking_ref: string
  channel: string | null
  reason: string | null
  marked_by: string | null
  marked_from: string | null
  marked_at: Date | string | null
}

export interface TestBookingSet {
  /** Active marks keyed on the normalised reference. */
  marks: Map<string, TestBookingMark>
  /** False when the register could not be read just now (a stale or empty set is in use). */
  checked: boolean
  /**
   * Why it could not be read: 'missing' — the accounts migration that creates
   * test_bookings has not been run; 'unreachable' — the accounts DB did not
   * answer; 'error' — anything else. Null when `checked`.
   */
  problem: RegisterProblem | null
  /** The underlying message, for the log line and the person who has to fix it. */
  detail: string | null
}

export type RegisterProblem = 'missing' | 'unreachable' | 'error'

/** Sort a failed register query into something a person can act on. */
export function classifyRegisterError(err: unknown): { problem: RegisterProblem; detail: string } {
  const e = err as { code?: string; errno?: number; message?: string }
  const detail = String(e?.message ?? err)
  if (e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146 || /test_bookings.*doesn't exist/i.test(detail)) {
    return { problem: 'missing', detail }
  }
  if (/timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|PROTOCOL_CONNECTION_LOST|exceeded \d+ms/i.test(detail)
    || ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(String(e?.code))) {
    return { problem: 'unreachable', detail }
  }
  return { problem: 'error', detail }
}

/** What a person is told for each problem. */
export const REGISTER_PROBLEM_MESSAGE: Record<RegisterProblem, string> = {
  missing: 'The Test Bookings register is not set up in the Accounts database yet — run `php artisan migrate` on the Accounts server. Nothing was changed.',
  unreachable: 'The Accounts database did not answer, so the Test Bookings register could not be reached. Nothing was changed — try again in a minute.',
  error: 'The Test Bookings register could not be read. Nothing was changed.',
}

/** Trusted this long; the register changes by hand, a few times a day at most. */
const FRESH_MS = 30_000
/** If the accounts DB is down, keep using a set this old rather than showing tests. */
const STALE_MS = 10 * 60_000
/** The bookings list is the most-opened screen: never wait longer than this for the register. */
const READ_BUDGET_MS = 3_500

let cache: { at: number; marks: Map<string, TestBookingMark> } | null = null

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`test-booking register read exceeded ${ms}ms`)), ms).unref?.()),
  ])
}

/** Every active test booking. Never throws. */
export async function loadTestBookings(): Promise<TestBookingSet> {
  const now = Date.now()
  if (cache && now - cache.at < FRESH_MS) return { marks: cache.marks, checked: true, problem: null, detail: null }

  try {
    const rows = await withBudget(accountsQuery<MarkRow>(
      `SELECT id, booking_key, booking_ref, channel, reason, marked_by, marked_from, marked_at
         FROM test_bookings
        WHERE released_at IS NULL
        ORDER BY id`,
    ), READ_BUDGET_MS)

    const marks = new Map<string, TestBookingMark>()
    for (const r of rows) {
      const key = testBookingKey(r.booking_ref) || testBookingKey(r.booking_key)
      if (!key || marks.has(key)) continue
      marks.set(key, {
        id: Number(r.id),
        key,
        ref: String(r.booking_ref),
        channel: r.channel,
        reason: r.reason,
        markedBy: r.marked_by,
        markedFrom: r.marked_from,
        markedAt: r.marked_at ? new Date(r.marked_at).toISOString() : null,
      })
    }

    cache = { at: now, marks }
    return { marks, checked: true, problem: null, detail: null }
  } catch (err) {
    // A missing table (accounts not migrated yet) lands here too: nothing hidden.
    const { problem, detail } = classifyRegisterError(err)
    console.error(`[test-bookings] register unreadable (${problem}), falling back:`, detail)
    if (cache && now - cache.at < STALE_MS) return { marks: cache.marks, checked: false, problem, detail }
    return { marks: new Map(), checked: false, problem, detail }
  }
}

/** Forget the cached set (after a mark / release from this instance). */
export function flushTestBookings(): void {
  cache = null
}

// ─── This system's bookings ───────────────────────────────────────────────────

/** "IS48715" → the spellings this system stores: IS48715, IS 48715, IS-48715. */
function spellings(key: string): string[] {
  const m = key.match(/^([A-Z]+)(\d.*)$/)
  return m ? [key, `${m[1]} ${m[2]}`, `${m[1]}-${m[2]}`] : [key]
}

let refCache: { at: number; keys: string; refs: string[] } | null = null

/**
 * The OPS bookingRefs that are test bookings — matched on bookingRef, isNumber
 * and agentBookingId, then confirmed on the normalised key so a LIKE-ish match
 * can never hide a neighbouring booking.
 */
export async function testBookingRefs(set?: TestBookingSet): Promise<{ refs: string[]; checked: boolean }> {
  const { marks, checked } = set ?? await loadTestBookings()
  if (marks.size === 0) return { refs: [], checked }

  const keys = Array.from(marks.keys()).sort()
  const signature = keys.join(',')
  if (refCache && refCache.keys === signature && Date.now() - refCache.at < FRESH_MS) {
    return { refs: refCache.refs, checked }
  }

  const candidates = keys.flatMap(spellings)
  // AHS14999 → the B2C order stored here as bookingRef "14999".
  const b2cIds = keys.map(k => k.match(/^AHS(\d+)$/)?.[1]).filter((id): id is string => !!id)
  const rows = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingRef: { in: candidates } },
        { isNumber: { in: candidates } },
        { agentBookingId: { in: candidates } },
        ...(b2cIds.length ? [{ bookingRef: { in: b2cIds }, agent: B2C_AGENT_NAME }] : []),
      ],
    },
    select: { bookingRef: true, isNumber: true, agentBookingId: true, agent: true },
  })

  const refs = rows
    .filter(b => [b.bookingRef, b.isNumber, b.agentBookingId, testBookingReference(b)].some(r => marks.has(testBookingKey(r))))
    .map(b => b.bookingRef)

  refCache = { at: Date.now(), keys: signature, refs }
  return { refs, checked }
}

/**
 * The Prisma clause that keeps test bookings out of a booking query, or null
 * when there is nothing to hide. `mode` lets a list opt back in:
 *   'exclude' (default) · 'include' (no clause) · 'only' (just the tests).
 */
export async function testBookingWhere(
  mode: 'exclude' | 'include' | 'only' = 'exclude',
): Promise<{ clause: Record<string, unknown> | null; refs: string[]; checked: boolean }> {
  if (mode === 'include') return { clause: null, refs: [], checked: true }

  try {
    const { refs, checked } = await testBookingRefs()
    if (mode === 'only') return { clause: { bookingRef: { in: refs } }, refs, checked }
    return { clause: refs.length ? { bookingRef: { notIn: refs } } : null, refs, checked }
  } catch (err) {
    console.error('[test-bookings] could not resolve OPS refs, hiding nothing:', err)
    return { clause: mode === 'only' ? { bookingRef: { in: [] } } : null, refs: [], checked: false }
  }
}

/** The active mark behind any of these references, or null. */
export async function findTestBooking(...references: (string | null | undefined)[]): Promise<TestBookingMark | null> {
  const { marks } = await loadTestBookings()
  for (const r of references) {
    const m = marks.get(testBookingKey(r))
    if (m) return m
  }
  return null
}

// ─── Marking and restoring (one statement each, so each is atomic) ────────────

interface CountRow extends RowDataPacket { n: number }
interface MoneyRow extends RowDataPacket { paid: number | string | null; receipts: number }

/** Money recorded in accounts against a booking key — OPS will not hide a booking that took money. */
async function moneyOn(key: string): Promise<{ paid: number; receipts: number }> {
  const [row] = await accountsQuery<MoneyRow>(
    `SELECT COALESCE(SUM(ip.amount), 0) AS paid, COUNT(ip.id) AS receipts
       FROM invoice_payments ip
       JOIN generated_invoices gi ON gi.id = ip.invoice_id
      WHERE ip.deleted_at IS NULL
        AND (ip.status IS NULL OR ip.status <> 'cancelled')
        AND REPLACE(REPLACE(REPLACE(UPPER(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number, '')), ' ', ''), '-', ''), '_', '') = ?`,
    [key],
  )
  return { paid: Number(row?.paid ?? 0), receipts: Number(row?.receipts ?? 0) }
}

export class TestBookingError extends Error {
  constructor(message: string, readonly problem: RegisterProblem | null = null, readonly detail: string | null = null) {
    super(message)
  }
}

/**
 * Run a register statement; any database failure comes back as a
 * TestBookingError saying what is wrong (table missing / DB down), never as a
 * bare server error.
 */
async function onRegister<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof TestBookingError) throw err
    const { problem, detail } = classifyRegisterError(err)
    console.error(`[test-bookings] register ${problem}:`, detail)
    throw new TestBookingError(REGISTER_PROBLEM_MESSAGE[problem], problem, detail)
  }
}

/** Fails with the setup message when test_bookings does not exist yet. */
async function assertRegisterReady(): Promise<void> {
  await onRegister(() => accountsQuery<RowDataPacket>('SELECT 1 FROM test_bookings LIMIT 1'))
}

/**
 * Mark a booking as a test from OPS. Writes one `test_bookings` row.
 * The INSERT … SELECT … WHERE NOT EXISTS makes "already marked" a property of
 * the statement itself, so two people pressing at once leave one active mark.
 */
export async function markTestBooking(input: {
  reference: string
  reason: string
  by: string
  snapshot?: Record<string, unknown>
}): Promise<TestBookingMark> {
  const ref = input.reference.trim().toUpperCase().replace(/_R\d+(\/R\d+)?$/i, '').replace(/-?CXL$/i, '').trim()
  const key = testBookingKey(ref)
  const problem = testBookingProblem(key)
  if (problem) throw new TestBookingError(problem)

  const reason = input.reason.trim()
  if (reason.length < 3) throw new TestBookingError('Say why this is a test booking — the reason is kept with the mark.')

  await assertRegisterReady()

  const money = await onRegister(() => moneyOn(key))
  if (money.receipts > 0) {
    throw new TestBookingError(
      `Accounts has ${money.receipts} payment receipt(s) recorded against ${ref}. ` +
      'A booking that took money can only be marked as a test from Accounts → Test Bookings, by a super admin.',
    )
  }

  const result = await onRegister(() => accountsWrite(
    `INSERT INTO test_bookings
            (booking_key, booking_ref, channel, reason, snapshot, marked_by, marked_from, marked_at, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, 'ops', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM test_bookings t WHERE t.booking_key = ? AND t.released_at IS NULL)`,
    [key, ref, testBookingChannel(key), reason.slice(0, 2000), JSON.stringify(input.snapshot ?? {}), input.by.slice(0, 120), key],
  ))

  flushTestBookings()
  refCache = null

  if (result.affectedRows === 0) throw new TestBookingError(`${ref} is already marked as a test booking.`)

  return {
    id: result.insertId, key, ref, channel: testBookingChannel(key), reason,
    markedBy: input.by, markedFrom: 'ops', markedAt: new Date().toISOString(),
  }
}

/** Release every active mark for a booking. The rows stay, as history. */
export async function releaseTestBooking(input: { reference: string; by: string; note?: string | null }): Promise<number> {
  const key = testBookingKey(input.reference)
  if (!key) throw new TestBookingError('Enter a booking reference.')

  const [{ n } = { n: 0 } as CountRow] = await onRegister(() => accountsQuery<CountRow>(
    'SELECT COUNT(*) AS n FROM test_bookings WHERE booking_key = ? AND released_at IS NULL',
    [key],
  ))
  if (!Number(n)) throw new TestBookingError(`${input.reference} is not marked as a test booking.`)

  const result = await onRegister(() => accountsWrite(
    `UPDATE test_bookings
        SET released_at = UTC_TIMESTAMP(), released_by = ?, release_note = ?, updated_at = UTC_TIMESTAMP()
      WHERE booking_key = ? AND released_at IS NULL`,
    [input.by.slice(0, 120), input.note?.trim() ? input.note.trim().slice(0, 2000) : null, key],
  ))

  flushTestBookings()
  refCache = null

  return result.affectedRows
}
