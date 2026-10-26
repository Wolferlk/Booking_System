/**
 * Send the WhatsApp call-approval message — and remember that we did.
 *
 * Functionally this is the `approval` call the dashboard used to make straight
 * through `/api/te/proxy`. It goes through its own route now because the call
 * report has to answer "has this customer approved automated calls?", and the
 * upstream only reveals that in the response to this request. Recording it here
 * makes the answer available later. See `call-approvals.ts`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { countryCodeGuesses, getApprovalEntry, markApproved, recordApprovalRequest } from '@/lib/te/call-approvals'
import { normalizePhone, teGet, tePost } from '@/lib/te/te-api'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['TE_USER', 'GT_TE_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

interface ApprovalResponse {
  already_allowed?: boolean
  message?: string
  [key: string]: unknown
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const phone = normalizePhone(body.to as string)
  if (!phone) return buildApiError('A phone number is required')

  const name = String(body.name ?? '').trim() || 'Valued Customer'
  const bookingRef = body.bookingRef ? String(body.bookingRef).toUpperCase() : null
  const actor = session.user.email ?? session.user.name ?? null

  try {
    const res = await tePost<ApprovalResponse>('approval', { to: phone, name })

    // Ledger writes are bookkeeping — never fail the send over them.
    await recordApprovalRequest({ phone, bookingRef, actor, alreadyApproved: !!res.already_allowed })
      .catch(err => console.warn('[TE approvals] ledger write failed:', err))
    if (res.already_allowed) {
      await markApproved(phone).catch(() => {})
    }

    return buildApiSuccess(res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[TE approvals] send failed:', message)
    return buildApiError('Could not send the approval message', 502)
  }
}

// ─── Live permission state, explained ──────────────────────────────────────────
//
// The booking page used to ask the upstream `GET approval` about the one number
// in the box and print allowed / not allowed. That answer is correct for that
// exact number, but it left staff staring at "Not allowed" for customers they
// knew had allowed calls. On live data the gap had three causes, all fixed here
// without changing what the upstream reports:
//   - the number was saved without its country code (Meta has `91…` allowed),
//   - the customer allowed calls once and the temporary permission expired,
//   - a different number on the same booking is the one that allowed calls.
// So this answers with the upstream verdict unchanged, plus the ledger history,
// a country-code fix, and the state of the booking's other numbers.

interface PermissionStatus {
  ok?: boolean
  checked?: boolean
  allowed?: boolean | null
  status?: string | null
  expiration_time?: number | null
  can_request?: boolean
  message?: string
}

/** Extra lookups must not hold the chip up the way the primary one may. */
const SIDE_LOOKUP_TIMEOUT_MS = 6_000
const MAX_ALTERNATES = 5

async function lookup(phone: string, timeoutMs?: number): Promise<PermissionStatus | null> {
  const req = teGet<PermissionStatus>('approval', { to: phone })
  try {
    if (!timeoutMs) return await req
    return await Promise.race([
      req,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ])
  } catch {
    return null
  }
}

/** The number as typed, or the country-code form of it that Meta knows as allowed. */
async function resolveNumber(phone: string, primary?: PermissionStatus | null) {
  const state = primary === undefined ? await lookup(phone, SIDE_LOOKUP_TIMEOUT_MS) : primary
  const guesses = state?.allowed === true ? [] : countryCodeGuesses(phone)
  let fix: { phone: string; allowed: boolean | null; status: string | null } | null = null
  if (guesses.length) {
    const checked = await Promise.all(guesses.map(async g => ({ g, s: await lookup(g, SIDE_LOOKUP_TIMEOUT_MS) })))
    const best = checked.find(c => c.s?.allowed === true) ?? checked[0]
    fix = { phone: best.g, allowed: best.s?.allowed ?? null, status: best.s?.status ?? null }
  }
  return { state, fix }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const sp = new URL(req.url).searchParams
  const phone = normalizePhone(sp.get('to'))
  if (phone.length < 8) return buildApiError('A phone number is required')
  const alternates = Array.from(new Set(
    (sp.get('alts') ?? '').split(',').map(normalizePhone).filter(p => p.length >= 8 && p !== phone),
  )).slice(0, MAX_ALTERNATES)

  // The primary lookup keeps the upstream's own timeout — it is the answer the
  // panel has always shown, so it must not be cut shorter than before.
  const primary = await lookup(phone)
  const [main, others, ledger] = await Promise.all([
    resolveNumber(phone, primary),
    Promise.all(alternates.map(async alt => ({ phone: alt, ...(await resolveNumber(alt)) }))),
    getApprovalEntry(phone).catch(() => null),
  ])

  // Anything Meta confirms as allowed is evidence for the call report too.
  const confirmed = [
    ...(primary?.allowed === true ? [phone] : []),
    ...(main.fix?.allowed === true ? [main.fix.phone] : []),
    ...others.flatMap(o => [
      ...(o.state?.allowed === true ? [o.phone] : []),
      ...(o.fix?.allowed === true ? [o.fix.phone] : []),
    ]),
  ]
  const bookingRef = sp.get('bookingRef')?.toUpperCase() || null
  await Promise.all(confirmed.map(p => markApproved(p, undefined, bookingRef).catch(() => {})))

  return buildApiSuccess({
    to: phone,
    // Unchanged upstream verdict — the panel's fallback shape.
    checked: Boolean(primary?.checked),
    allowed: primary?.allowed ?? null,
    status: primary?.status ?? null,
    expiration_time: primary?.expiration_time ?? null,
    can_request: primary?.can_request,
    message: primary?.message ?? (primary ? undefined : 'Could not reach the call service — permission state unknown.'),
    ledger: ledger ? { requestedAt: ledger.requestedAt, requestedBy: ledger.requestedBy, approvedAt: ledger.approvedAt } : null,
    fix: main.fix,
    alternates: others.map(o => ({
      phone: o.phone,
      allowed: o.state?.allowed ?? null,
      status: o.state?.status ?? null,
      fix: o.fix,
    })),
  })
}
