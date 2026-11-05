/**
 * Aahaas B2C amendment notices in ops.
 *
 * When the store amends a booking it writes a new version: of the same order
 * (b2c-same-order), or on a chain amended before that mode, as a new order
 * (b2c-order-chain). The importer never makes a second booking of either; it
 * files a notice here instead, against the booking, and Update Booking then
 * reads the new version. The notice is what tells the team the booking moved:
 *
 *   OLD amendments only are shown (the booking was sold on an earlier day and
 *   is being re-opened — drivers, tickets and suppliers may already be set).
 *   A same-day correction is filed silently.
 *
 * Stored as SystemSetting rows `b2c_amendment:{orderId}`, or
 * `b2c_amendment:{orderId}:v{version}` for a same-order version — no schema
 * change on the live ops database. Never deleted: acknowledging stamps it.
 */
import { prisma } from './prisma'
import { B2C_AMENDMENT_PREFIX, amendmentNoticeKey, type B2cAmendmentNotice } from './b2c-order-chain'

function parse(value: string | null | undefined): B2cAmendmentNotice | null {
  try {
    const v = JSON.parse(value ?? '')
    return v && typeof v === 'object' && v.bookingRef ? (v as B2cAmendmentNotice) : null
  } catch {
    return null
  }
}

/** File a notice once per amendment; an existing one keeps its acknowledgement. */
export async function recordAmendmentNotice(n: B2cAmendmentNotice): Promise<'created' | 'exists'> {
  const key = amendmentNoticeKey(n.orderId, n.sameOrder ? n.version : null)
  const existing = await prisma.systemSetting.findUnique({ where: { key } })
  if (existing) {
    // Learn a duplicate found later, never lose an acknowledgement.
    const cur = parse(existing.value)
    if (cur && n.duplicateRef && !cur.duplicateRef) {
      await prisma.systemSetting.update({ where: { key }, data: { value: JSON.stringify({ ...cur, duplicateRef: n.duplicateRef }) } })
    }
    return 'exists'
  }
  try {
    await prisma.systemSetting.create({ data: { key, value: JSON.stringify(n) } })
    return 'created'
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return 'exists'   // raced with another run
    throw err
  }
}

/** Every notice, newest first. `openOnly` = old amendments nobody acknowledged. */
export async function listAmendmentNotices(opts: { openOnly?: boolean; bookingRef?: string; limit?: number } = {}): Promise<B2cAmendmentNotice[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: B2C_AMENDMENT_PREFIX } } })
  return rows
    .map((r) => parse(r.value))
    .filter((n): n is B2cAmendmentNotice => n !== null)
    .filter((n) => !opts.bookingRef || n.bookingRef === opts.bookingRef)
    .filter((n) => !opts.openOnly || (n.isOld && !n.acknowledgedAt))
    .sort((a, b) => String(b.amendedAt ?? b.detectedAt).localeCompare(String(a.amendedAt ?? a.detectedAt)))
    .slice(0, opts.limit ?? 200)
}

async function patch(key: string, fn: (n: B2cAmendmentNotice) => B2cAmendmentNotice): Promise<B2cAmendmentNotice | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  const cur = parse(row?.value)
  if (!cur) return null
  const next = fn(cur)
  await prisma.systemSetting.update({ where: { key }, data: { value: JSON.stringify(next) } })
  return next
}

/** Merge fields into a notice (auto-apply bookkeeping). */
export function updateAmendmentNotice(orderId: number, fields: Partial<B2cAmendmentNotice>, sameOrderVersion?: number | null) {
  return patch(amendmentNoticeKey(orderId, sameOrderVersion), (n) => ({ ...n, ...fields }))
}

export async function getAmendmentNotice(orderId: number, sameOrderVersion?: number | null): Promise<B2cAmendmentNotice | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: amendmentNoticeKey(orderId, sameOrderVersion) } })
  return parse(row?.value)
}

export function acknowledgeAmendmentNotice(orderId: number, by: string, sameOrderVersion?: number | null) {
  return patch(amendmentNoticeKey(orderId, sameOrderVersion), (n) => (n.acknowledgedAt ? n : { ...n, acknowledgedBy: by, acknowledgedAt: new Date().toISOString() }))
}

/** Update Booking applied this version to the booking. */
export async function markAmendmentApplied(bookingRef: string, orderId: number, version: number | null, sameOrderVersion?: number | null) {
  return patch(amendmentNoticeKey(orderId, sameOrderVersion), (n) => (n.bookingRef === bookingRef ? { ...n, appliedAt: new Date().toISOString(), appliedVersion: version } : n))
}
