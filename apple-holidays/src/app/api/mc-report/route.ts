import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES: UserRole[] = ['TE_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// Merges optional search + country conditions into a single booking WHERE clause
function buildBookingWhere(
  search: string | null,
  countryWhere: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = []
  if (countryWhere) conditions.push(countryWhere)
  if (search) conditions.push({
    OR: [
      { bookingRef:     { contains: search } },
      { isNumber:       { contains: search } },
      { agentBookingId: { contains: search } },
      { agent:          { contains: search } },
    ],
  })
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { AND: conditions }
}

/**
 * Hotel Only bookings, rendered as movement-chart rows.
 *
 * These files have no agenda by design (see `hotel-only.ts`), so a chart built
 * only from `agendaItem` would show nothing for them — and a guest sleeping in
 * Kandy tonight would be invisible on the one page operations reads to know who
 * is out there. The stays themselves are the movements, so each accommodation
 * becomes a row on its check-in date: same shape as a real chart row, marked so
 * the page can badge it rather than pretend a driver is missing.
 *
 * Deliberately never merged into the agenda query — a Hotel Only booking that
 * still carries a half-built agenda from before it was marked would otherwise
 * appear twice, once as a stay and once as movements nobody will drive.
 */
async function hotelOnlyRows(
  dateFilter: { gte?: Date; lte?: Date },
  bookingWhere: Record<string, unknown> | undefined,
  serviceType: string | null,
) {
  // The chart's Type filter is about transfers. Hotel Only carries none, so any
  // narrowing to a transfer type must exclude these rows rather than coerce them.
  if (serviceType && serviceType !== 'OWN_ARRANGEMENT') return []

  const stays = await prisma.accommodation.findMany({
    where: {
      ...(Object.keys(dateFilter).length > 0 ? { checkIn: dateFilter } : {}),
      booking: {
        ...(bookingWhere ?? {}),
        hotelOnly: true,
        status: { not: 'CANCELLED' },
      },
    } as Prisma.AccommodationWhereInput,
    include: {
      booking: {
        select: {
          bookingRef: true, isNumber: true, agentBookingId: true,
          paxAdults: true, paxChildren: true, agent: true, status: true,
        },
      },
    },
    orderBy: [{ checkIn: 'asc' }, { city: 'asc' }],
  })

  return stays.map(s => {
    const nights = s.nights || Math.max(
      1, Math.round((s.checkOut.getTime() - s.checkIn.getTime()) / 86_400_000),
    )
    const out = s.checkOut.toISOString().slice(0, 10)
    return {
      id:             `hotel-only:${s.id}`,
      date:           s.checkIn.toISOString().slice(0, 10),
      vnCode:         s.booking.bookingRef,
      isNumber:       s.booking.isNumber       ?? null,
      agentBookingId: s.booking.agentBookingId ?? null,
      location:       s.city,
      paxAdults:      s.booking.paxAdults,
      paxChildren:    s.booking.paxChildren,
      fromPoint:      null,
      toPoint:        s.hotel,
      details:        [
        s.hotel,
        `${nights} night${nights === 1 ? '' : 's'} → ${out}`,
        s.roomType || null,
      ].filter(Boolean).join(' · '),
      mealPlan:       s.mealType ?? null,
      meetingTime:    null,
      // Nothing is driven, so the row reads as the guest's own arrangement — the
      // same service type the chart already uses for "we do not move this".
      serviceType:    'OWN_ARRANGEMENT' as const,
      isLeisure:      false,
      isHotelOnly:    true,
      /** The whole booking is Hotel Only, not just this movement. */
      isHotelOnlyBooking: true,
      /** Checkout date, so the chart can show the span without re-deriving it. */
      checkOut:       out,
      nights,
      vendor:         null,
      vendorName:     null,
      driverId:       null,
      vendorId:       null,
      driverPhotoUrl: null,
      driverName:     null,
      driverPhone:    null,
      vehicleType:    null,
      vehiclePlate:   null,
      driverRate:     null,
      rateCurrency:   null,
      // Nothing is driven and no agenda exists, so there is nobody to assign —
      // the chart uses these to keep the guide / tour-vendor cells empty.
      guideId:         null,
      guideName:       null,
      guidePhone:      null,
      tourVendorId:    null,
      tourVendorName:  null,
      tourVendorPhone: null,
      operationCountry: null,
      agent:          s.booking.agent ?? null,
      bookingStatus:  s.booking.status,
    }
  })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const userCountry = (session.user as any).country as string | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  // Admin explicit narrowing: SINGAPORE / MALAYSIA match their own value PLUS any
  // legacy SINGAPORE_MALAYSIA bookings carrying the matching ref prefix.
  function adminCountryWhere(country: string): Record<string, unknown> {
    if (country === 'SINGAPORE') {
      return { OR: [{ operationCountry: 'SINGAPORE' }, { operationCountry: 'SINGAPORE_MALAYSIA', bookingRef: { startsWith: 'SG' } }] }
    }
    if (country === 'MALAYSIA') {
      return { OR: [{ operationCountry: 'MALAYSIA' }, { operationCountry: 'SINGAPORE_MALAYSIA', bookingRef: { startsWith: 'MY' } }] }
    }
    if (country === 'SINGAPORE_MALAYSIA') {
      return { operationCountry: { in: countryScope(country)! } }
    }
    return { operationCountry: country }
  }

  let bookingCountryWhere: Record<string, unknown> | undefined
  if (!canSeeAllCountries(role, userCountry as any)) {
    // Country-scoped users see their whole scope (SG/MY users see the combined group)
    const scope = countryScope(userCountry)
    if (scope) bookingCountryWhere = { operationCountry: { in: scope } }
  } else if (countryOverride && countryOverride !== 'ALL') {
    bookingCountryWhere = adminCountryWhere(countryOverride)
  }

  const { searchParams } = req.nextUrl
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')
  const search   = searchParams.get('search')
  const serviceType = searchParams.get('serviceType')

  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (dateFrom) dateFilter.gte = new Date(dateFrom)
  if (dateTo) {
    const to = new Date(dateTo)
    to.setHours(23, 59, 59, 999)
    dateFilter.lte = to
  }

  const bookingWhere = buildBookingWhere(search, bookingCountryWhere)

  const items = await prisma.agendaItem.findMany({
    where: {
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      ...(serviceType ? { serviceType: serviceType as never } : {}),
      agenda: {
        // Hotel Only files are represented by their stays instead — see
        // `hotelOnlyRows`. Excluding them here is what stops a booking marked
        // after its agenda was built from appearing on the chart twice.
        booking: { ...(bookingWhere ?? {}), hotelOnly: false },
      },
    },
    include: {
      agenda: {
        include: {
          booking: {
            select: {
              bookingRef:     true,
              isNumber:       true,
              agentBookingId: true,
              paxAdults:      true,
              paxChildren:    true,
              agent:          true,
              status:         true,
              // Decides which partner columns the chart shows for this row.
              operationCountry: true,
            },
          },
        },
      },
      assignment: {
        include: {
          driver: {
            include: {
              vehicle: {
                include: { vendor: true },
              },
            },
          },
          vendor: {
            select: { id: true, name: true, phone: true },
          },
          // Guide / tour vendor run the movement alongside the driver — the
          // chart shows them in their own columns and assigns from there.
          guide:      { select: { id: true, name: true, phone: true, whatsappPhone: true } },
          tourVendor: { select: { id: true, name: true, phone: true, whatsappPhone: true } },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
  })

  const data: Record<string, unknown>[] = items.map(item => ({
    id:             item.id,
    date:           item.date.toISOString().slice(0, 10),
    vnCode:         item.agenda.booking.bookingRef,
    isNumber:       item.agenda.booking.isNumber       ?? null,
    agentBookingId: item.agenda.booking.agentBookingId ?? null,
    location:       item.location,
    paxAdults:      item.agenda.booking.paxAdults,
    paxChildren:    item.agenda.booking.paxChildren,
    fromPoint:      item.fromPoint ?? null,
    toPoint:        item.toPoint   ?? null,
    details:        item.details   ?? null,
    mealPlan:       item.mealPlan  ?? null,
    meetingTime:    item.meetingTime ?? null,
    serviceType:    item.serviceType,
    // Free day — shown as a "Leisure Day" marker instead of an empty driver cell.
    isLeisure:      resolveIsLeisure(item),
    // Accommodation / own transport — same "no driver needed" marker.
    isHotelOnly:    resolveIsHotelOnly(item),
    vendor:         item.assignment?.vendor?.name
                      ?? item.assignment?.vendorName
                      ?? item.assignment?.driver?.vehicle?.vendor?.name
                      ?? item.assignment?.driverName
                      ?? null,
    driverId:       item.assignment?.driverId ?? null,
    vendorId:       item.assignment?.vendorId ?? null,
    driverPhotoUrl: item.assignment?.driver?.photoUrl ?? null,
    driverName:     item.assignment?.driverName ?? item.assignment?.driver?.name ?? null,
    driverPhone:    item.assignment?.driverPhone ?? item.assignment?.driver?.phone ?? null,
    vehicleType:    item.assignment?.vehicleType  ?? null,
    vehiclePlate:   item.assignment?.vehiclePlate ?? null,
    // Kept apart from `vendor` above, which falls back to the driver's name for
    // display: the assign dialog needs the transport vendor's real name only.
    vendorName:     item.assignment?.vendor?.name ?? item.assignment?.vendorName ?? null,
    driverRate:     item.assignment?.driverRate != null ? Number(item.assignment.driverRate) : null,
    rateCurrency:   item.assignment?.rateCurrency ?? null,
    // A guide / tour vendor typed by hand has no directory record, so the stored
    // name wins and the linked record only fills the gaps.
    guideId:         item.assignment?.guideId ?? null,
    guideName:       item.assignment?.guideName ?? item.assignment?.guide?.name ?? null,
    guidePhone:      item.assignment?.guidePhone
                       ?? item.assignment?.guide?.whatsappPhone
                       ?? item.assignment?.guide?.phone
                       ?? null,
    tourVendorId:    item.assignment?.tourVendorId ?? null,
    tourVendorName:  item.assignment?.tourVendorName ?? item.assignment?.tourVendor?.name ?? null,
    tourVendorPhone: item.assignment?.tourVendorPhone
                       ?? item.assignment?.tourVendor?.whatsappPhone
                       ?? item.assignment?.tourVendor?.phone
                       ?? null,
    // Which partner kinds this row's country operates with is a Settings
    // question the page answers per row, so it needs the booking's country.
    operationCountry: item.agenda.booking.operationCountry ?? null,
    agent:          item.agenda.booking.agent    ?? null,
    bookingStatus:  item.agenda.booking.status,
    isHotelOnlyBooking: false,
    checkOut:       null,
    nights:         null,
  }))

  const hotelOnly = await hotelOnlyRows(dateFilter, bookingWhere, serviceType)

  // One chart, sorted as one list — a stay must sit on its date beside the
  // transfers happening the same day, not in a block of its own at the end.
  const merged = [...data, ...hotelOnly].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || String(a.vnCode).localeCompare(String(b.vnCode)),
  )

  return buildApiSuccess(merged)
}
