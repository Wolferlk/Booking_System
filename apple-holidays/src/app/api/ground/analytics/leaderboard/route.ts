import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { getPartnerLeaderboard, type PartnerKind, type PartnerSummary } from '@/lib/partner-analytics'
import type { OperationCountry, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const KINDS: PartnerKind[] = ['driver', 'vendor', 'guide', 'tourVendor']

interface LeaderRow extends PartnerSummary {
  name: string
  phone: string | null
  photoUrl: string | null
  country: string | null
  isActive: boolean
  /** Drivers only — the vendor they sit under, when they do. */
  vendorName?: string | null
  vehicle?: string | null
  /** Vendors only. */
  fleetSize?: number
  driverCount?: number
}

/**
 * League table across every partner of one kind: trips, guest rating, praise
 * and complaint counts, and the composite score they are ranked on.
 *
 * GET only, read-only. `months` windows the movement history (default 24, `all`
 * for everything) so the aggregate stays bounded on a large database.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const sp = req.nextUrl.searchParams
  const kind = (sp.get('kind') ?? 'driver') as PartnerKind
  if (!KINDS.includes(kind)) return buildApiError('kind must be one of: ' + KINDS.join(', '))

  const monthsParam = sp.get('months')
  const months = monthsParam === 'all' ? null : Math.min(120, Math.max(1, Number(monthsParam) || 24))

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = sp.get('country') as OperationCountry | null
  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride && countryOverride !== 'ALL' ? countryOverride : null)
    : (userCountry && userCountry !== 'ALL' ? userCountry : null)

  // Country scoping is applied to the partner registry rather than to the
  // bookings, so a Sri Lanka driver keeps their whole record even on the rare
  // file that was operated under another country's code.
  const countryWhere = effectiveCountry
    ? { OR: [{ country: { in: countryScope(effectiveCountry)! } }, { country: null }, { country: 'ALL' as OperationCountry }] }
    : {}

  try {
    const partners = await loadPartners(kind, countryWhere)
    if (partners.length === 0) return buildApiSuccess({ kind, months, rows: [] })

    const summaries = await getPartnerLeaderboard(kind, { months, ids: partners.map(p => p.id) })
    const byId = new Map(summaries.map(s => [s.id, s]))

    // Partners with no movements in the window still belong in the table — they
    // are the idle ones, and hiding them is exactly how an unused driver stays
    // unnoticed. They come back with zeroes and sort to the bottom.
    const rows: LeaderRow[] = partners.map(p => {
      const s = byId.get(p.id)
      return {
        kind, id: p.id,
        name: p.name, phone: p.phone ?? null, photoUrl: p.photoUrl ?? null,
        country: p.country ?? null, isActive: p.isActive,
        vendorName: p.vendorName, vehicle: p.vehicle,
        fleetSize: p.fleetSize, driverCount: p.driverCount,
        trips: s?.trips ?? 0,
        bookings: s?.bookings ?? 0,
        trips90d: s?.trips90d ?? 0,
        lastTrip: s?.lastTrip ?? null,
        rating: s?.rating ?? null,
        ratedBookings: s?.ratedBookings ?? 0,
        praiseCount: s?.praiseCount ?? 0,
        complaintCount: s?.complaintCount ?? 0,
        score: s?.score ?? null,
        grade: s?.grade ?? null,
      }
    })

    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.trips - a.trips || a.name.localeCompare(b.name))
    return buildApiSuccess({ kind, months, rows })
  } catch (err) {
    console.error('[ground analytics leaderboard] failed:', err)
    return buildApiError('Failed to build leaderboard', 500)
  }
}

interface PartnerRecord {
  id: string
  name: string
  phone: string | null
  photoUrl: string | null
  country: string | null
  isActive: boolean
  vendorName?: string | null
  vehicle?: string | null
  fleetSize?: number
  driverCount?: number
}

async function loadPartners(kind: PartnerKind, countryWhere: object): Promise<PartnerRecord[]> {
  if (kind === 'driver') {
    const drivers = await prisma.driver.findMany({
      where: countryWhere,
      select: {
        id: true, name: true, phone: true, photoUrl: true, country: true, isActive: true,
        vendorOwner: { select: { name: true } },
        vehicle: { select: { plateNo: true, type: true, brand: true, model: true } },
      },
      orderBy: { name: 'asc' },
    })
    return drivers.map(d => ({
      id: d.id, name: d.name, phone: d.phone, photoUrl: d.photoUrl,
      country: d.country, isActive: d.isActive,
      vendorName: d.vendorOwner?.name ?? null,
      vehicle: d.vehicle
        ? [d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.type
        : null,
    }))
  }

  if (kind === 'vendor') {
    const vendors = await prisma.vehicleVendor.findMany({
      where: countryWhere,
      select: {
        id: true, name: true, phone: true, country: true, isActive: true,
        _count: { select: { vehicles: true, drivers: true } },
      },
      orderBy: { name: 'asc' },
    })
    return vendors.map(v => ({
      id: v.id, name: v.name, phone: v.phone, photoUrl: null,
      country: v.country, isActive: v.isActive,
      fleetSize: v._count.vehicles, driverCount: v._count.drivers,
    }))
  }

  // Guides and tour vendors carry the same shape, but the two delegates are
  // distinct types, so the query is issued per branch rather than through a
  // union that TypeScript refuses to call.
  const select = { id: true, name: true, phone: true, photoUrl: true, country: true, isActive: true } as const
  const rows = kind === 'guide'
    ? await prisma.guide.findMany({ where: countryWhere, select, orderBy: { name: 'asc' } })
    : await prisma.tourVendor.findMany({ where: countryWhere, select, orderBy: { name: 'asc' } })
  return rows.map(r => ({
    id: r.id, name: r.name, phone: r.phone, photoUrl: r.photoUrl,
    country: r.country, isActive: r.isActive,
  }))
}
