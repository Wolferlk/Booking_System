/**
 * GET /api/driver-auto?country=SRILANKA[&horizon=10]
 *
 * Everything the Driver-Auto board shows for one country tab: open trips in
 * the D-N window (with request counts), driver requests, the recipients of the
 * morning message, the settings and the next send time. Read-only.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { listOpenTrips } from '@/lib/driver-auto/open-trips'
import { listClaimsForCountry } from '@/lib/driver-auto/claims'
import { boardMessageParams, nextSendAt, partyViews, renderBody, TEMPLATE_DRIVER_BOARD } from '@/lib/driver-auto/notify'
import { boardUrl, isDaTableMissing, localToday, readSettings, SETUP_MESSAGE } from '@/lib/driver-auto/server'
import { DA_COUNTRIES, isDaCountry, type ClaimView } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  const raw = req.nextUrl.searchParams.get('country') ?? staff.countries[0]
  if (!isDaCountry(raw)) return buildApiError('Unknown country', 400)
  if (!staff.countries.includes(raw)) return buildApiError('This country is outside your account scope', 403)
  const country = raw

  try {
    const settings = await readSettings()
    const horizonParam = Number(req.nextUrl.searchParams.get('horizon'))
    const horizon = Number.isFinite(horizonParam) && horizonParam >= 1 && horizonParam <= 60 ? Math.round(horizonParam) : settings.horizonDays

    const trips = await listOpenTrips(country, horizon)
    const openKeys = new Set(trips.map(t => t.key))

    let claims: ClaimView[] = []
    let setupRequired = false
    try {
      claims = await listClaimsForCountry(country, openKeys)
    } catch (err) {
      if (!isDaTableMissing(err)) throw err
      setupRequired = true
    }

    const requestsByTrip = new Map<string, number>()
    for (const c of claims) if (c.status === 'PENDING') requestsByTrip.set(c.tripKey, (requestsByTrip.get(c.tripKey) ?? 0) + 1)
    for (const t of trips) t.requestCount = requestsByTrip.get(t.key) ?? 0

    const parties = await partyViews(country, settings)

    // Drivers with no country can never receive a tab's link — surface them.
    const [driversNoCountry, vendorsNoCountry] = await Promise.all([
      prisma.driver.count({ where: { isActive: true, country: null } }),
      prisma.vehicleVendor.count({ where: { isActive: true, country: null } }),
    ])

    // Today's send log, for the "this morning" panel.
    let todaySends: { channel: string; status: string; n: number }[] = []
    if (!setupRequired) {
      try {
        const grouped = await prisma.driverBoardSend.groupBy({
          by: ['channel', 'status'],
          where: { country, sendDate: localToday(country) },
          _count: { _all: true },
        })
        todaySends = grouped.map(g => ({ channel: g.channel, status: g.status, n: g._count._all }))
      } catch (err) {
        if (!isDaTableMissing(err)) throw err
        setupRequired = true
      }
    }

    const recipients = parties.filter(p => !p.excluded)
    const sample = recipients[0]
    const preview = sample
      ? renderBody(boardMessageParams(sample.name, trips, country, boardUrl(sample.key, settings)))
      : null

    const pending = claims.filter(c => c.status === 'PENDING')
    const stats = {
      openTrips: trips.length,
      urgent: trips.filter(t => t.daysAway <= 2).length,
      withRequests: trips.filter(t => (t.requestCount ?? 0) > 0).length,
      pending: pending.length,
      pendingStale: pending.filter(c => !c.stillOpen).length,
      wonLast14: claims.filter(c => c.status === 'APPROVED' || c.status === 'AUTO_ASSIGNED').length,
      recipients: recipients.length,
      reachable: recipients.filter(p => p.phone || p.email).length,
      movements: trips.reduce((n, t) => n + t.drivenLegs, 0),
    }

    return buildApiSuccess({
      country,
      allowedCountries: staff.countries.filter(c => DA_COUNTRIES.includes(c)),
      horizon,
      today: localToday(country),
      settings,
      setupRequired,
      setupMessage: setupRequired ? SETUP_MESSAGE : null,
      trips,
      claims,
      parties,
      stats,
      driversNoCountry,
      vendorsNoCountry,
      todaySends,
      nextSendAt: nextSendAt(country, settings),
      templateName: TEMPLATE_DRIVER_BOARD,
      preview,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[driver-auto GET]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to load Driver-Auto', 500)
  }
}
