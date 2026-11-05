/**
 * Aahaas B2C store amendments — found, filed and APPLIED automatically.
 *
 * The store writes an amendment as a version of the same order (b2c-same-order)
 * or, on a chain from before that mode, as a new order (b2c-order-chain). For
 * each one whose booking is already in ops this:
 *
 *   1. files the notice on the booking (b2c-amendments);
 *   2. runs Update Booking by itself — preview, then apply exactly the changes
 *      a person would find pre-ticked. Everything Update Booking protects stays
 *      protected: status, drivers, tickets, agenda, payments, P&L lines Accounts
 *      confirmed or edited, and any field edited here since the last update
 *      (those are left for review and named on the notice);
 *   3. leaves the booking flagged "UPDATED — attention please" until somebody
 *      acknowledges it (old bookings; a same-day correction is applied quietly).
 *
 * Switch: SystemSetting `auto_b2c_amendment_apply` ('false' = file the notice
 * only). A failing booking is tried at most MAX_ATTEMPTS times, then left for a
 * person with the error on the notice. Reads the store only.
 */
import { prisma } from './prisma'
import { isB2cBooking } from './booking-source'
import { syncB2cBooking, type B2cChangeKey } from './b2c-booking-sync'
import { fetchOrderChainFacts, fetchRecentAmendmentIds, isLaterDay, type B2cOrderFact } from './b2c-order-chain'
import { fetchRecentStoreVersions } from './b2c-same-order'
import { getAmendmentNotice, recordAmendmentNotice, updateAmendmentNotice } from './b2c-amendments'

export const SETTING_AUTO_APPLY = 'auto_b2c_amendment_apply'
const MAX_ATTEMPTS = 3
const ACTOR_NAME = 'Auto · store amendment'

/** Why a same-order version is waiting, as the notice shows it. */
const READINESS_NOTE: Record<string, string> = {
  costing: 'Waiting for the store to finish this version\'s costs — applied automatically once it has.',
  stale: 'The store has not finished this version\'s costs. Check it in the store, then use Update Booking.',
  blocked: 'The store did not finish writing this version — somebody must check it in the store first.',
}

/** On unless switched off. */
export async function amendmentAutoApplyOn(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_AUTO_APPLY } }).catch(() => null)
  return row?.value !== 'false'
}

export async function setAmendmentAutoApply(on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_AUTO_APPLY },
    update: { value: on ? 'true' : 'false' },
    create: { key: SETTING_AUTO_APPLY, value: on ? 'true' : 'false' },
  })
}

export interface AmendmentOutcome {
  orderId: number
  bookingRef: string | null
  version: number
  isOld: boolean
  action: 'no-booking' | 'not-b2c' | 'noticed' | 'duplicate' | 'applied' | 'nothing-to-apply' | 'already-applied' | 'failed' | 'gave-up'
  newVersion?: number | null
  error?: string
}

/**
 * File and (when switched on) apply one amendment. Idempotent: a notice that
 * is already applied, or has used up its attempts, is left alone.
 */
export async function handleAmendment(
  f: B2cOrderFact,
  opts: { originAt: string | null; dryRun?: boolean; automationUserId: string; reason?: string | null },
): Promise<AmendmentOutcome> {
  const isOld = isLaterDay(opts.originAt, f.checkoutDate)
  const base = { orderId: f.id, version: f.version, isOld }
  const sameOrderVersion = f.sameOrder ? f.version : null
  const refs = Array.from(new Set([String(f.chainId), f.previousOrderId ? String(f.previousOrderId) : null].filter((r): r is string => !!r)))

  // A same-order version has no booking "of its own" to find: the booking of
  // that order IS the booking, and reading it as a duplicate would settle the
  // notice without applying anything.
  const [own, chainBooking, duplicate] = await Promise.all([
    f.sameOrder ? prisma.booking.findUnique({ where: { bookingRef: String(f.id) }, select: { bookingRef: true, agent: true } }) : null,
    prisma.booking.findFirst({ where: { bookingRef: { in: refs } }, select: { bookingRef: true, agent: true }, orderBy: { createdAt: 'asc' } }),
    f.sameOrder ? null : prisma.booking.findUnique({ where: { bookingRef: String(f.id) }, select: { bookingRef: true } }),
  ])
  const original = own ?? chainBooking
  if (!original) return { ...base, bookingRef: null, action: 'no-booking' }
  // A numeric ref shared with an agent booking is never touched from the store.
  if (!isB2cBooking(original.agent)) return { ...base, bookingRef: original.bookingRef, action: 'not-b2c' }

  const out = { ...base, bookingRef: original.bookingRef }
  if (opts.dryRun) return { ...out, action: duplicate ? 'duplicate' : 'noticed' }

  await recordAmendmentNotice({
    bookingRef: original.bookingRef, orderId: f.id, previousOrderId: f.previousOrderId, version: f.version,
    amendedAt: f.checkoutDate, originAt: opts.originAt, isOld,
    duplicateRef: duplicate?.bookingRef ?? null, detectedAt: new Date().toISOString(),
    ...(f.sameOrder && { sameOrder: true, reason: opts.reason ?? null }),
  })

  const notice = await getAmendmentNotice(f.id, sameOrderVersion)
  if (notice?.appliedAt) return { ...out, action: 'already-applied' }

  // The new version already has a booking of its own (imported before versions
  // were understood): that booking IS the active version (b2c-version-links)
  // and the original is shown as replaced — applying it onto the original too
  // would only keep two live copies in step. Settle the notice instead.
  if (duplicate) {
    const at = new Date().toISOString()
    await updateAmendmentNotice(f.id, {
      appliedAt: at, appliedVersion: null, autoApplied: true, appliedBy: 'Own booking',
      appliedChanges: [], leftForReview: [], lastError: null,
      acknowledgedAt: at, acknowledgedBy: `Auto · active booking ${duplicate.bookingRef}`,
    })
    return { ...out, action: 'duplicate' }
  }
  if ((notice?.autoAttempts ?? 0) >= MAX_ATTEMPTS) return { ...out, action: 'gave-up', error: notice?.lastError ?? undefined }
  if (!(await amendmentAutoApplyOn())) return { ...out, action: duplicate ? 'duplicate' : 'noticed' }

  try {
    const preview = await syncB2cBooking(original.bookingRef, { mode: 'preview', actorId: opts.automationUserId, actorName: ACTOR_NAME })
    // Only this order's version may be applied: the store could have moved on again.
    if (preview.orderId !== f.id) {
      await updateAmendmentNotice(f.id, { lastError: `The store has a newer version (order ${preview.orderId}); that one is applied instead.` })
      return { ...out, action: 'noticed' }
    }
    if (f.sameOrder) {
      const seen = preview.amendment?.storeVersion ?? null
      if (seen !== f.version) {
        await updateAmendmentNotice(f.id, { lastError: `The store has a newer version (version ${seen ?? '?'}); that one is applied instead.` }, sameOrderVersion)
        return { ...out, action: 'noticed' }
      }
      // Never automatic until the store has finished: not an attempt, so the next check simply tries again.
      const readiness = preview.amendment?.readiness ?? 'ready'
      if (readiness !== 'ready') {
        await updateAmendmentNotice(f.id, { lastError: READINESS_NOTE[readiness] ?? null }, sameOrderVersion)
        return { ...out, action: 'noticed' }
      }
    }

    const keys = preview.changes.filter((c) => c.recommended).map((c) => c.key) as B2cChangeKey[]
    const leftForReview = preview.changes.filter((c) => !c.recommended).map((c) => c.label)

    if (keys.length === 0) {
      await updateAmendmentNotice(f.id, {
        appliedAt: new Date().toISOString(), appliedVersion: preview.version, autoApplied: true, appliedBy: ACTOR_NAME,
        appliedChanges: [], leftForReview, lastError: null,
      }, sameOrderVersion)
      return { ...out, action: 'nothing-to-apply', newVersion: preview.version }
    }

    const result = await syncB2cBooking(original.bookingRef, {
      mode: 'apply', keys, expectedVersion: preview.version,
      syncId: crypto.randomUUID(), actorId: opts.automationUserId, actorName: ACTOR_NAME,
    })
    const applied = preview.changes.filter((c) => result.applied.includes(c.key)).map((c) => `${c.label}: ${c.from ?? '—'} → ${c.to ?? '—'}`)
    await updateAmendmentNotice(f.id, {
      appliedAt: new Date().toISOString(), appliedVersion: result.newVersion ?? result.version,
      autoApplied: true, appliedBy: ACTOR_NAME, appliedChanges: applied, leftForReview, lastError: null,
    }, sameOrderVersion)
    return { ...out, action: 'applied', newVersion: result.newVersion }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await updateAmendmentNotice(f.id, { autoAttempts: (notice?.autoAttempts ?? 0) + 1, lastError: error }, sameOrderVersion).catch(() => null)
    return { ...out, action: 'failed', error }
  }
}

/**
 * Every amendment placed in the last `days` days, whatever its travel date —
 * catches bookings amended mid-trip, which the importer (upcoming trips only)
 * never reads. `skip` = order ids the caller already handled this run.
 */
export async function sweepRecentAmendments(opts: {
  days?: number
  dryRun?: boolean
  automationUserId: string
  skip?: Set<number>
}): Promise<AmendmentOutcome[]> {
  const since = new Date(Date.now() - (opts.days ?? 3) * 86_400_000).toISOString().slice(0, 10)
  const [chainIds, sameOrder] = await Promise.all([fetchRecentAmendmentIds(since), fetchRecentStoreVersions(since)])
  const ids = chainIds.filter((id) => !opts.skip?.has(id))
  if (ids.length === 0 && sameOrder.length === 0) return []

  const facts = await fetchOrderChainFacts([...ids, ...sameOrder.map((v) => v.orderId)])
  const live = ids.map((id) => facts.get(id)).filter((f): f is B2cOrderFact => !!f && f.isAmendment && f.supersededBy === null)

  // A same-order version keeps its order id, so the version row is what says it
  // happened and when. `checkoutDate` carries that moment for the old-day test.
  const reasons = new Map<number, string | null>()
  for (const v of sameOrder) {
    const f = facts.get(v.orderId)
    if (!f || f.supersededBy !== null) continue
    reasons.set(v.orderId, v.reason)
    live.push({ ...f, version: v.version, checkoutDate: v.createdAt, sameOrder: true })
  }
  const origins = await fetchOrderChainFacts(live.map((f) => f.chainId))

  const out: AmendmentOutcome[] = []
  for (const f of live) {
    // Skip cheaply when the notice is already settled.
    const n = await getAmendmentNotice(f.id, f.sameOrder ? f.version : null)
    if (n?.appliedAt || (n && (n.autoAttempts ?? 0) >= MAX_ATTEMPTS)) continue
    out.push(await handleAmendment(f, {
      originAt: origins.get(f.chainId)?.checkoutDate ?? null,
      dryRun: opts.dryRun,
      automationUserId: opts.automationUserId,
      reason: f.sameOrder ? reasons.get(f.id) ?? null : null,
    }))
  }
  return out
}
