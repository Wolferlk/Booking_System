/**
 * Put Aahaas B2C guests on AI voice calls automatically.
 *
 * When a B2C booking holds the guest's own WhatsApp number, it is registered
 * with the Traveller-Experience call service (the same `intake` the booking
 * page's Register button sends, with that button's defaults) and the guest is
 * sent the WhatsApp call-permission request, since nothing can be dialled until
 * they tap Allow. The daily WhatsApp briefings and feedback request pick the
 * same bookings up from `customer-whatsapp-automation.ts`.
 *
 * Deliberately conservative, because this contacts real customers:
 *   · B2C only, not cancelled here or in the store, trip not over yet
 *   · the number must be the guest's per the store — never the desk account's
 *   · a booking already known to the call service (registered by staff, paused,
 *     or cancelled) is never touched, and each booking is attempted once: the
 *     ledger row means a cancelled registration stays cancelled
 *   · at most {@link MAX_PER_RUN} per run, so a sweep cannot flood the ops
 *     WhatsApp number with permission requests
 *   · an order later cancelled in the store is withdrawn: its AI calls are
 *     paused and it drops out of the WhatsApp automations
 *   · switchable off with `auto_b2c_guest_engage_enabled = false`
 */
import { prisma } from './prisma'
import { isB2cBooking } from './booking-source'
import { normalizePhone, teGet, tePatch, tePost } from './te/te-api'
import { markApproved, recordApprovalRequest } from './te/call-approvals'

export const ENGAGE_ENABLED = 'auto_b2c_guest_engage_enabled'
/** One row per booking, written once the booking has been handled. */
const LEDGER_PREFIX = 'b2c_guest_engage:'
export const MAX_PER_RUN = 10

/** Same plan the booking page's Register button sends by default. */
const DEFAULT_SCHEDULE = {
  mode: 'agenda',
  call_time: '18:00',
  retry_gap_min: 15,
  reconfirm: { enabled: true, days_before: 5 },
  post_tour: { enabled: true, days_after: 3 },
}

export interface GuestEngageOutcome {
  bookingRef: string
  status: 'registered' | 'would-register' | 'skipped'
  reason?: string
  approval?: 'already-allowed' | 'requested' | 'rate-limited' | 'failed'
}

export async function isGuestEngageEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ENGAGE_ENABLED } })
  return row?.value !== 'false'
}

/**
 * A digits-only international number, or null. A local number ("0703…") has
 * no country code to dial; guessing one could ring a stranger, so it is left
 * for staff.
 */
export function internationalDigits(v: string | null | undefined): string | null {
  const d = normalizePhone(v).replace(/^00/, '')
  return d.length >= 10 && !d.startsWith('0') ? d : null
}

export async function engageB2cGuest(params: {
  bookingRef: string
  /** The guest's own phone per the store; the booking's WhatsApp must match it. */
  guestPhone: string | null | undefined
  /** The store's checkout status, when known — a cancelled order is withdrawn. */
  storeStatus?: string | null
  apply: boolean
  actor: string
}): Promise<GuestEngageOutcome> {
  const { bookingRef, apply, actor } = params
  const skip = (reason: string): GuestEngageOutcome => ({ bookingRef, status: 'skipped', reason })

  if (params.storeStatus && STORE_CANCELLED.test(params.storeStatus)) {
    if (apply) await withdraw(bookingRef, params.storeStatus)
    return skip(`order is "${params.storeStatus}" in the store`)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      agent: true, status: true, departureDate: true, contactWhatsapp: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
    },
  })
  if (!booking || !isB2cBooking(booking.agent)) return skip('not an Aahaas B2C booking')
  if (booking.status === 'CANCELLED' || booking.status === 'PENDING_CANCELLATION') return skip('booking is cancelled')
  if (booking.departureDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) return skip('trip is over')

  const phone = internationalDigits(booking.contactWhatsapp)
  if (!phone) return skip('no WhatsApp number with a country code')
  const guest = internationalDigits(params.guestPhone)
  if (!guest || guest !== phone) return skip("WhatsApp number is not the guest's own per the store")

  if (await prisma.systemSetting.findUnique({ where: { key: LEDGER_PREFIX + bookingRef } })) {
    return skip('already handled once')
  }
  const existing = await prisma.tbl_te_service.findUnique({ where: { booking_ref: bookingRef }, select: { status: true } })
  if (existing) {
    if (apply) await writeLedger(bookingRef, { phone, outcome: `already registered (${existing.status})` })
    return skip(`already registered for AI calls (${existing.status})`)
  }
  if (!apply) return { bookingRef, status: 'would-register' }

  const res = await tePost<{ ok?: boolean; message?: string; service?: unknown }>('intake', {
    bookingRef, phone, schedule: DEFAULT_SCHEDULE,
  })
  if (res?.ok === false && !res.service) throw new Error(res.message ?? 'AI call registration failed')

  const approval = await requestCallPermission(phone, booking.passengers[0]?.name ?? null, bookingRef, actor)
  await writeLedger(bookingRef, { phone, outcome: 'registered', approval })
  return { bookingRef, status: 'registered', approval }
}

/**
 * Ask the guest to allow WhatsApp calls, unless they already have. Never fails
 * the registration: the booking page shows the permission state and can resend.
 */
async function requestCallPermission(
  phone: string, name: string | null, bookingRef: string, actor: string,
): Promise<GuestEngageOutcome['approval']> {
  try {
    const state = await teGet<{ allowed?: boolean | null }>('approval', { to: phone }).catch(() => null)
    if (state?.allowed === true) {
      await markApproved(phone).catch(() => {})
      return 'already-allowed'
    }
    const res = await tePost<{ already_allowed?: boolean; rate_limited?: boolean }>('approval', {
      to: phone, name: name || 'Valued Customer',
    })
    await recordApprovalRequest({ phone, bookingRef, actor, alreadyApproved: !!res.already_allowed })
      .catch((err) => console.warn('[b2c-guest-engage] approval ledger write failed:', err))
    if (res.already_allowed) return 'already-allowed'
    return res.rate_limited ? 'rate-limited' : 'requested'
  } catch (err) {
    console.error(`[b2c-guest-engage] permission request failed for ${bookingRef}:`, err)
    return 'failed'
  }
}

const STORE_CANCELLED = /cancel|refund|reject/i

/**
 * An engaged order the store has since cancelled: pause its AI calls (paused,
 * not cancelled, so staff can resume if the store status was a mistake) and
 * take it out of the WhatsApp automations.
 */
async function withdraw(bookingRef: string, storeStatus: string): Promise<void> {
  const row = await prisma.systemSetting.findUnique({ where: { key: LEDGER_PREFIX + bookingRef } })
  if (parseLedger(row?.value)?.outcome !== 'registered') return
  await tePatch(`services/${encodeURIComponent(bookingRef)}/status`, { status: 'paused' })
    .catch((err) => console.error(`[b2c-guest-engage] could not pause AI calls for ${bookingRef}:`, err))
  await writeLedger(bookingRef, { ...parseLedger(row?.value), outcome: 'store-cancelled', storeStatus })
}

function parseLedger(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try { return JSON.parse(value) as Record<string, unknown> } catch { return null }
}

/**
 * B2C bookings this module registered and has not withdrawn. They are imported
 * as DRAFT, which the WhatsApp automations otherwise skip; these have passed
 * every check above, so their guests get the briefings and feedback request.
 */
export async function engagedB2cRefs(): Promise<string[]> {
  if (!(await isGuestEngageEnabled())) return []
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: LEDGER_PREFIX } } })
  return rows
    .filter((r) => parseLedger(r.value)?.outcome === 'registered')
    .map((r) => r.key.slice(LEDGER_PREFIX.length))
}

async function writeLedger(bookingRef: string, entry: Record<string, unknown>): Promise<void> {
  const value = JSON.stringify({ ...entry, at: new Date().toISOString() })
  await prisma.systemSetting.upsert({
    where: { key: LEDGER_PREFIX + bookingRef },
    update: { value },
    create: { key: LEDGER_PREFIX + bookingRef, value },
  })
}

/**
 * Engage a batch of bookings, capped per run. Failures are reported per
 * booking and never stop the rest.
 */
export async function engageB2cGuests(
  candidates: { bookingRef: string; guestPhone: string | null; storeStatus?: string | null }[],
  opts: { apply: boolean; actor: string; limit?: number },
): Promise<GuestEngageOutcome[]> {
  if (!(await isGuestEngageEnabled())) return []
  const limit = opts.limit ?? MAX_PER_RUN
  const out: GuestEngageOutcome[] = []
  let acted = 0
  for (const c of candidates) {
    if (acted >= limit) break
    try {
      const r = await engageB2cGuest({ ...c, apply: opts.apply, actor: opts.actor })
      if (r.status !== 'skipped') acted += 1
      out.push(r)
    } catch (err) {
      acted += 1
      out.push({ bookingRef: c.bookingRef, status: 'skipped', reason: `failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return out
}
