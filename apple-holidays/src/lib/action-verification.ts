/**
 * Two-step verification for the irreversible things a user can do to a booking.
 *
 * Cancelling and deleting cannot be taken back — a delete drops the passengers,
 * flights, hotels, agenda and PNL with the booking, and a cancellation puts a
 * notice in front of the agent. So neither runs on a single click any more: the
 * user asks for a code, it is mailed to the address they signed in with, and the
 * destructive route refuses to act unless the request carries that code.
 *
 * Three properties matter, and each is enforced here rather than in the routes:
 *
 *   Bound     A code is issued for one user, one action and one target. It
 *             cannot be spent on a different booking, a different selection of
 *             bookings, or by a different account — the target of a bulk delete
 *             is a digest of the exact set of references, so changing the
 *             selection invalidates the code.
 *   Single-use  Consumption is a conditional UPDATE, so two requests racing on
 *             the same code cannot both win and delete twice.
 *   Fails closed  Anything unclear — no table, no code, an expired one, too many
 *             wrong guesses — refuses the action. Nothing destructive ever runs
 *             because verification could not be checked.
 *
 * The code itself is never stored: the row keeps SHA-256 of the code salted with
 * the row's own id, so reading the database does not let anyone approve a
 * cancellation.
 */

import { createHash, randomInt, timingSafeEqual } from 'crypto'
import { prisma } from './prisma'
import { sendMailViaGraph } from './send-mail'

/* ── What can be gated ───────────────────────────────────────────────────── */

export const VERIFY_ACTION = {
  BOOKING_CANCEL:      'BOOKING_CANCEL',
  BOOKING_FULL_CANCEL: 'BOOKING_FULL_CANCEL',
  BOOKING_DELETE:      'BOOKING_DELETE',
  BOOKING_BULK_DELETE: 'BOOKING_BULK_DELETE',
  BOOKING_FILTERED_DELETE: 'BOOKING_FILTERED_DELETE',
} as const

export type VerifyAction = (typeof VERIFY_ACTION)[keyof typeof VERIFY_ACTION]

/** Copy for the mail and the audit trail. Keep the wording plain — this is the
 *  last thing a user reads before something becomes permanent. */
const ACTION_COPY: Record<VerifyAction, { title: string; what: string; undo: string }> = {
  BOOKING_CANCEL: {
    title: 'Cancel a booking',
    what:  'send this booking to the accounts team as a cancellation request',
    undo:  'Once accounts approve it the booking is cancelled and the cancellation notice goes out automatically.',
  },
  BOOKING_FULL_CANCEL: {
    title: 'Full cancel a booking',
    what:  'cancel this booking outright and seal it against recovery',
    undo:  'This skips the accounts queue. No role — not even an admin — will be able to reinstate the booking afterwards.',
  },
  BOOKING_DELETE: {
    title: 'Delete a booking',
    what:  'permanently delete this booking',
    undo:  'The booking and everything attached to it — passengers, flights, hotels, agenda, PNL — are erased. This cannot be undone.',
  },
  BOOKING_BULK_DELETE: {
    title: 'Delete several bookings',
    what:  'permanently delete the selected bookings',
    undo:  'Every selected booking and everything attached to it — passengers, flights, hotels, agenda, PNL — is erased. This cannot be undone.',
  },
  BOOKING_FILTERED_DELETE: {
    title: 'Delete bookings matching a filter',
    what:  'permanently delete every booking matching the filter you set in Bookings Cleanup',
    undo:  'Every matching booking and everything attached to it — passengers, flights, hotels, agenda, PNL — is erased. This cannot be undone, and the match is evaluated again at the moment of deletion.',
  },
}

export function isVerifyAction(value: unknown): value is VerifyAction {
  return typeof value === 'string' && value in VERIFY_ACTION
}

/* ── Tunables ────────────────────────────────────────────────────────────── */

/** Long enough to switch to a mail client and back, short enough that a code
 *  left in an inbox is not a standing key to a delete. */
const TTL_MINUTES     = 10
/** Wrong guesses before the challenge is dead and a new code must be asked for. */
const MAX_ATTEMPTS    = 5
/** Stops the button from being used to mail-bomb the user's own inbox. */
const RESEND_COOLDOWN_SECONDS = 45

/* ── Targets ─────────────────────────────────────────────────────────────── */

/** A single booking is its own target. */
export function bookingTarget(ref: string): string {
  return `booking:${ref.trim().toUpperCase()}`
}

/**
 * A bulk delete is targeted at the exact set of references, order-insensitive.
 * Adding or removing one booking from the selection produces a different digest,
 * so a code approved for six bookings cannot be spent on a seventh.
 */
export function bookingSetTarget(refs: string[]): string {
  const normalised = Array.from(new Set(refs.map(r => r.trim().toUpperCase()))).sort()
  const digest = createHash('sha256').update(normalised.join(',')).digest('hex').slice(0, 40)
  return `bookings:${normalised.length}:${digest}`
}

/**
 * A filtered delete is targeted at the filter itself, canonicalised so that the
 * same filter always produces the same digest and any change to it — one more
 * status, a wider date range — invalidates the code. The rows that match are
 * re-evaluated at deletion time, which is why the confirmation names the filter
 * rather than promising a fixed list.
 */
export function bookingFilterTarget(filters: unknown): string {
  const digest = createHash('sha256').update(canonicalJson(filters)).digest('hex').slice(0, 40)
  return `bookings-filter:${digest}`
}

/** Stable stringify: object keys sorted, empty values dropped, arrays of
 *  primitives sorted — so key order or a re-ordered status list does not read as
 *  a different filter. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'null'
  if (Array.isArray(value)) {
    const parts = value.map(canonicalJson).sort()
    return `[${parts.join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonicalJson(v)] as const)
      .filter(([, v]) => v !== 'null')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/* ── Codes ───────────────────────────────────────────────────────────────── */

function newCode(): string {
  // randomInt is CSPRNG-backed; padded so a leading zero is never dropped.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashCode(id: string, code: string): string {
  return createHash('sha256').update(`${id}:${code}`).digest('hex')
}

/** Constant-time compare so a wrong code cannot be narrowed down by timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** s******u@aahaas.com — enough to recognise the inbox, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  if (user.length <= 2) return `${user[0] ?? ''}***@${domain}`
  return `${user[0]}${'*'.repeat(Math.max(3, user.length - 2))}${user[user.length - 1]}@${domain}`
}

/* ── The missing-table case ──────────────────────────────────────────────── */

/**
 * The table is created by prisma/manual-sql/2026-09-14-action-verification.sql,
 * which is run by hand against live. Until it exists every query below throws —
 * and that throw must stop the cancellation, never wave it through, so callers
 * translate it into a refusal with an instruction rather than a stack trace.
 */
export class VerificationUnavailableError extends Error {
  constructor() {
    super(
      'Two-step verification is not set up on this database yet, so cancelling and deleting are ' +
      'switched off. Run prisma/manual-sql/2026-09-14-action-verification.sql, then try again.',
    )
    this.name = 'VerificationUnavailableError'
  }
}

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  const message = err instanceof Error ? err.message : String(err)
  // P2021 = table does not exist; MySQL/MariaDB 1146 comes through raw on some paths.
  return code === 'P2021' || /doesn'?t exist|Unknown table|1146/i.test(message)
}

/* ── Issuing ─────────────────────────────────────────────────────────────── */

export interface IssueParams {
  userId: string
  email: string
  userName?: string | null
  action: VerifyAction
  target: string
  /** What the user sees in the mail, e.g. "VN20003" or "7 bookings". */
  label?: string | null
  ipAddress?: string | null
}

export interface IssuedChallenge {
  id: string
  maskedEmail: string
  expiresAt: Date
}

/**
 * Mails a fresh code and returns the challenge to quote back on the destructive
 * call. Any earlier unused challenge for the same user/action/target is dropped
 * first, so exactly one code is live at a time and an older mail cannot be used.
 *
 * If the mail cannot be sent the challenge is removed and this throws — a user
 * must never be left staring at a prompt for a code that is not coming.
 */
export async function issueVerification(params: IssueParams): Promise<IssuedChallenge> {
  const email = params.email?.trim()
  if (!email || !email.includes('@')) {
    throw new Error('Your account has no email address on file, so a verification code cannot be sent.')
  }

  try {
    const recent = await prisma.actionVerification.findFirst({
      where: {
        userId: params.userId,
        action: params.action,
        target: params.target,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (recent) {
      const since = (Date.now() - recent.createdAt.getTime()) / 1000
      if (since < RESEND_COOLDOWN_SECONDS) {
        throw new Error(
          `A code was just sent. Check your inbox, or ask for another in ${Math.ceil(RESEND_COOLDOWN_SECONDS - since)}s.`,
        )
      }
    }

    // One live code per user/action/target.
    await prisma.actionVerification.deleteMany({
      where: {
        userId: params.userId,
        action: params.action,
        target: params.target,
        consumedAt: null,
      },
    })

    const code = newCode()
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000)

    // Created first so the row's own id can salt the hash, then the hash is
    // written back. Between the two writes the row cannot approve anything:
    // the placeholder hash matches no code that can be produced.
    const row = await prisma.actionVerification.create({
      data: {
        userId:    params.userId,
        email,
        action:    params.action,
        target:    params.target,
        label:     params.label ?? null,
        codeHash:  'pending',
        expiresAt,
        ipAddress: params.ipAddress ?? null,
      },
      select: { id: true },
    })

    await prisma.actionVerification.update({
      where: { id: row.id },
      data:  { codeHash: hashCode(row.id, code) },
    })

    try {
      await sendMailViaGraph({
        to: email,
        subject: `${code} is your confirmation code — ${ACTION_COPY[params.action].title}`,
        bodyHtml: buildCodeEmail({
          code,
          userName: params.userName ?? null,
          action:   params.action,
          label:    params.label ?? null,
          expiresAt,
        }),
      })
    } catch (mailErr) {
      await prisma.actionVerification.delete({ where: { id: row.id } }).catch(() => {})
      console.error('[action-verification] code email failed:', mailErr)
      throw new Error(
        'The verification code could not be emailed, so this action has been stopped. ' +
        'Nothing was changed. Please try again in a moment.',
      )
    }

    return { id: row.id, maskedEmail: maskEmail(email), expiresAt }
  } catch (err) {
    if (isMissingTable(err)) throw new VerificationUnavailableError()
    throw err
  }
}

/* ── Consuming ───────────────────────────────────────────────────────────── */

export interface ConsumeParams {
  id: unknown
  code: unknown
  userId: string
  action: VerifyAction
  target: string
}

export interface ConsumeResult {
  ok: boolean
  /** User-facing reason the action was refused. Never says which part was wrong
   *  in a way that helps guessing — only whether to retype or start again. */
  error?: string
  status?: number
}

/**
 * Spends a code. Returns ok:false rather than throwing, so a route can refuse
 * the action with a clean message — but it never returns ok:true unless a live,
 * unused, correctly-answered challenge for exactly this user, action and target
 * was atomically marked consumed by this call.
 */
export async function consumeVerification(params: ConsumeParams): Promise<ConsumeResult> {
  const id = typeof params.id === 'string' ? params.id.trim() : ''
  const code = typeof params.code === 'string' ? params.code.replace(/\D/g, '') : ''

  if (!id || code.length !== 6) {
    return { ok: false, status: 403, error: 'Enter the 6-digit code emailed to you to confirm this action.' }
  }

  try {
    const row = await prisma.actionVerification.findUnique({ where: { id } })

    // The challenge must belong to this user and this exact action and target.
    // A mismatch is reported as "not valid" rather than "wrong booking" so a
    // stolen id cannot be used to probe what it was issued for.
    if (
      !row ||
      row.userId !== params.userId ||
      row.action !== params.action ||
      row.target !== params.target
    ) {
      return { ok: false, status: 403, error: 'This confirmation is no longer valid. Start again to get a new code.' }
    }
    if (row.consumedAt) {
      return { ok: false, status: 403, error: 'That code has already been used. Start again to get a new one.' }
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return { ok: false, status: 403, error: 'That code has expired. Start again to get a new one.' }
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return { ok: false, status: 429, error: 'Too many incorrect codes. Start again to get a new one.' }
    }

    if (!hashesMatch(row.codeHash, hashCode(row.id, code))) {
      const used = await prisma.actionVerification.update({
        where: { id: row.id },
        data:  { attempts: { increment: 1 } },
        select: { attempts: true },
      })
      const left = Math.max(0, MAX_ATTEMPTS - used.attempts)
      return {
        ok: false,
        status: 403,
        error: left > 0
          ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many incorrect codes. Start again to get a new one.',
      }
    }

    // Single-use, enforced by the database rather than by the check above: only
    // one caller can move consumedAt from null, so two requests racing on the
    // same code cannot both proceed to delete.
    const claimed = await prisma.actionVerification.updateMany({
      where: { id: row.id, consumedAt: null },
      data:  { consumedAt: new Date() },
    })
    if (claimed.count !== 1) {
      return { ok: false, status: 403, error: 'That code has already been used. Start again to get a new one.' }
    }

    return { ok: true }
  } catch (err) {
    if (isMissingTable(err)) {
      return { ok: false, status: 503, error: new VerificationUnavailableError().message }
    }
    console.error('[action-verification] consume failed:', err)
    // Fail closed: an unreadable verification store must stop the action.
    return { ok: false, status: 503, error: 'Verification could not be checked, so this action was stopped. Nothing was changed.' }
  }
}

/**
 * The one call a destructive route makes. Pulls the code out of the request body
 * and returns either null (verified — carry on) or a ready-made error response.
 */
export async function requireVerification(
  body: unknown,
  params: { userId: string; action: VerifyAction; target: string },
): Promise<Response | null> {
  const b = (body ?? {}) as Record<string, unknown>
  const result = await consumeVerification({
    id:     b.verificationId,
    code:   b.verificationCode,
    userId: params.userId,
    action: params.action,
    target: params.target,
  })
  if (result.ok) return null
  return Response.json(
    { success: false, error: result.error, needsVerification: true },
    { status: result.status ?? 403 },
  )
}

/* ── The mail ────────────────────────────────────────────────────────────── */

function buildCodeEmail(opts: {
  code: string
  userName: string | null
  action: VerifyAction
  label: string | null
  expiresAt: Date
}): string {
  const copy = ACTION_COPY[opts.action]
  const what = opts.label ? `${copy.what} (<strong>${escapeHtml(opts.label)}</strong>)` : copy.what
  const mins = Math.max(1, Math.round((opts.expiresAt.getTime() - Date.now()) / 60_000))

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
  <p style="font-size:14px;margin:0 0 4px">Hello${opts.userName ? ` ${escapeHtml(opts.userName)}` : ''},</p>
  <p style="font-size:14px;line-height:1.6;margin:0 0 18px">
    You asked to ${what}. Enter this code in Apple Holidays OPS to confirm it.
  </p>

  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center;background:#f8fafc">
    <div style="font-size:34px;letter-spacing:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      ${opts.code}
    </div>
    <div style="font-size:12px;color:#64748b;margin-top:8px">Valid for ${mins} minutes · single use</div>
  </div>

  <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:14px;margin-top:18px">
    <p style="font-size:12px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px">
      This cannot be undone
    </p>
    <p style="font-size:13px;line-height:1.6;color:#991b1b;margin:0">${copy.undo}</p>
  </div>

  <p style="font-size:13px;line-height:1.6;margin:18px 0 0;color:#475569">
    <strong>If this was not you, do not enter the code</strong> — nothing has happened yet, and no
    booking changes until the code is entered. Tell the system administrator so the account can be
    checked.
  </p>

  <p style="font-size:11px;color:#94a3b8;margin:22px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">
    Apple Holidays OPS · automated security message, please do not reply.
  </p>
</div>`.trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
