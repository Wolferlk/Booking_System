/**
 * Driver-Auto inside the app — the same open-trip board a driver gets as a
 * WhatsApp link (/driver-board), signed in instead of link-gated.
 *
 *   GET  /api/mobile/open-trips
 *   POST /api/mobile/open-trips  { action: 'request', tripKey, note? } | { action: 'withdraw', claimId }
 *
 * All rules (approval, clashes, seats, max pending) are the Driver-Auto ones
 * in lib/driver-auto/claims.ts — nothing is re-implemented here.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { listOpenTrips, publicTrip } from '@/lib/driver-auto/open-trips'
import { DaError, partyCommitments, requestTrip, toClaimView, withdrawClaim } from '@/lib/driver-auto/claims'
import { addDays, isDaTableMissing, localToday, readSettings, resolveParty, tabsForPartner } from '@/lib/driver-auto/server'
import { DA_COUNTRY_META } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

async function party(req: NextRequest) {
  const actor = await requireDriver(req)
  const p = await resolveParty('DRIVER', actor.driverId)
  if (!p) throw new MobileError('Driver not found.', 404)
  return p
}

export const GET = mobileRoute('open-trips', async (req: NextRequest) => {
  const p = await party(req)
  const settings = await readSettings()
  const tabs = tabsForPartner(p.country)
  const today = tabs[0] ? localToday(tabs[0]) : new Date().toISOString().slice(0, 10)

  let claims: ReturnType<typeof toClaimView>[] = []
  let enabled = true
  try {
    const rows = await prisma.driverTripClaim.findMany({
      where: { partyType: 'DRIVER', partyId: p.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { createdAt: 'desc' }, take: 50,
    })
    claims = rows.map(toClaimView).map(c => ({
      ...c, partyPhone: null, decidedByName: null,
      // The snapshot keeps staff-only fields (agent, lead guest) — not for the driver.
      snapshot: c.snapshot ? { ...c.snapshot, agent: undefined, leadGuest: undefined } : null,
    }))
  } catch (err) {
    if (!isDaTableMissing(err)) throw err
    enabled = false
  }
  if (!enabled) return buildApiSuccess({ enabled: false, today, trips: [], claims: [] })

  const pending = new Map(claims.filter(c => c.status === 'PENDING').map(c => [c.tripKey, c.id]))
  const busy = new Set((await partyCommitments('DRIVER', p.id, today, addDays(today, settings.horizonDays + 30))).map(c => c.date))
  const trips = (await Promise.all(tabs.map(async c => (await listOpenTrips(c, settings.horizonDays)).map(t => {
    const dates = t.legs.filter(l => l.driven).map(l => l.date)
    return {
      ...publicTrip(t),
      countryLabel: DA_COUNTRY_META[c].label,
      requireApproval: settings.countries[c].requireApproval,
      myRequestId: pending.get(t.key) ?? null,
      busy: (dates.length ? dates : [t.startDate]).some(d => busy.has(d)),
      fits: p.capacity ? t.pax <= p.capacity : null,
    }
  })))).flat().sort((a, b) => a.startDate.localeCompare(b.startDate))

  return buildApiSuccess({ enabled: true, today, trips, claims })
})

export const POST = mobileRoute('open-trips-action', async (req: NextRequest) => {
  const p = await party(req)
  const body = await readJson<{ action?: string; tripKey?: string; claimId?: string; note?: string }>(req)
  try {
    if (body.action === 'request') {
      if (!body.tripKey || !/^[BM]:[A-Za-z0-9_-]{6,64}$/.test(body.tripKey)) throw new MobileError('Unknown trip')
      const r = await requestTrip(p, body.tripKey, body.note)
      return buildApiSuccess({ mode: r.mode, claim: { ...r.claim, partyPhone: null } }, r.message)
    }
    if (body.action === 'withdraw') {
      if (!body.claimId) throw new MobileError('Unknown request')
      const claim = await withdrawClaim(p, body.claimId)
      return buildApiSuccess({ claim: { ...claim, partyPhone: null } }, 'Request withdrawn.')
    }
    throw new MobileError('Unknown action')
  } catch (err) {
    if (err instanceof DaError) throw new MobileError(err.message, err.status, err.code)
    if (isDaTableMissing(err)) throw new MobileError('Trip requests are not switched on yet. Please contact operations.', 503)
    throw err
  }
})
