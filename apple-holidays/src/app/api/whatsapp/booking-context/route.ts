/**
 * The trip panel beside a WhatsApp chat: every booking this number belongs to,
 * and the full picture of one of them.
 *
 *   GET ?phone=<number>[&ref=<bookingRef>]
 *
 * Read-only. `ref` must be a booking linked to `phone`, so the panel cannot be
 * used to read an arbitrary file by changing the ref, and the viewer's country
 * scope applies exactly as it does on the booking page. Rates and costs are
 * never selected — see lib/whatsapp-trip-context.ts.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import {
  WHATSAPP_STAFF_ROLES, canAccessWhatsAppPhone, normalisePhone, whatsappInboxCountry,
} from '@/lib/whatsapp'
import { briefingTimezone, nowInTz } from '@/lib/customer-whatsapp-automation'
import { portalLinkUrl, portalSendStatus } from '@/lib/portal-link-whatsapp'
import {
  buildTripContext, isoDay,
  type ChatRole, type LinkedBooking, type TripContextResponse,
} from '@/lib/whatsapp-trip-context'
import type { OperationCountry, Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const LINKED_LIMIT = 20

const LINKED_SELECT = {
  bookingRef: true, isNumber: true, status: true, operationCountry: true,
  arrivalDate: true, departureDate: true,
  contactWhatsapp: true, contactPhone: true, agentWhatsapp: true, agentPhone: true,
  passengers: { where: { isLead: true }, take: 1, select: { name: true } },
} satisfies Prisma.BookingSelect

const TRIP_SELECT = {
  bookingRef: true, isNumber: true, cntlNumber: true, dealName: true, status: true,
  operationCountry: true, tourDestination: true, agent: true, fileHandler: true,
  languagePreference: true, specialOccasions: true, chauffeurContact: true, hotelOnly: true,
  arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true,
  contactEmail: true, contactPhone: true, contactWhatsapp: true,
  agentEmail: true, agentPhone: true, agentWhatsapp: true,
  valueAddedServices: true, packageIncludes: true, packageExcludes: true, terms: true,
  exclusions: true, policyNotes: true, importantNotes: true, tips: true, otherNote: true,
  clientRequest: true,
  passengers: {
    select: {
      id: true, name: true, type: true, age: true, isLead: true,
      nationality: true, contact: true, mealPreference: true,
    },
  },
  flights: {
    orderBy: { date: 'asc' },
    select: {
      id: true, flightNo: true, airline: true, date: true, fromApt: true, toApt: true,
      depTime: true, arrTime: true, notes: true,
    },
  },
  accommodations: {
    orderBy: { checkIn: 'asc' },
    select: {
      id: true, city: true, hotel: true, checkIn: true, checkOut: true, nights: true,
      roomType: true, mealType: true, address: true, contact: true, ownArrangement: true,
    },
  },
  itineraryItems: {
    orderBy: { dayNo: 'asc' },
    select: {
      id: true, dayNo: true, date: true, title: true,
      description: true, inclusions: true, exclusions: true,
    },
  },
  tourAgenda: {
    select: {
      items: {
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
        select: {
          id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
          mealPlan: true, meetingTime: true, serviceType: true, timeFrom: true, timeTo: true,
          isLeisure: true, isHotelOnly: true,
          // Deliberately not driverRate / rateCurrency.
          assignment: {
            select: {
              driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
              vendorName: true, guideName: true, guidePhone: true,
              tourVendorName: true, tourVendorPhone: true,
            },
          },
        },
      },
    },
  },
  tickets: {
    where: { activated: true },
    orderBy: { createdAt: 'asc' },
    // Deliberately not costPerUnit / totalCost / the portal purchase columns.
    select: {
      id: true, type: true, category: true, qty: true, supplier: true, reference: true,
      status: true, fileUrl: true, fileName: true, fileType: true,
      agendaItem: { select: { date: true, location: true } },
    },
  },
} satisfies Prisma.BookingSelect

/** How this number relates to a booking. `FILED` = only its messages point here. */
function chatRoleOf(
  b: { contactWhatsapp: string | null; contactPhone: string | null; agentWhatsapp: string | null; agentPhone: string | null },
  phone: string,
): ChatRole {
  const is = (raw: string | null) => !!raw && normalisePhone(raw) === phone
  if (is(b.contactWhatsapp) || is(b.contactPhone)) return 'GUEST'
  if (is(b.agentWhatsapp) || is(b.agentPhone)) return 'AGENT'
  return 'FILED'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(role)) return buildApiError('Forbidden', 403)

  const phone = normalisePhone(req.nextUrl.searchParams.get('phone') ?? '')
  if (!phone) return buildApiError('phone is required')
  if (!(await canAccessWhatsAppPhone(role, phone))) {
    return buildApiError('This chat is outside your country scope', 403)
  }

  const wantedRef = req.nextUrl.searchParams.get('ref')?.trim() || null
  const inboxCountry = whatsappInboxCountry(role)
  const userCountry = session.user.country as OperationCountry | undefined
  const inScope = (country: OperationCountry | null) => {
    if (inboxCountry && country !== inboxCountry) return false
    if (!userCountry || (userCountry as string) === 'ALL' || canSeeAllCountries(role, userCountry)) return true
    return isInCountryScope(country, userCountry)
  }

  // The same two routes into a booking the inbox uses: a contact column, or the
  // ref this number's own messages were filed under.
  const filed = await prisma.whatsAppMessage.findMany({
    where:    { phone, NOT: { bookingRef: { startsWith: 'UNKNOWN:' } } },
    distinct: ['bookingRef'],
    select:   { bookingRef: true },
    take:     LINKED_LIMIT,
  })
  const variants = [phone, `+${phone}`]
  const linkedWhere: Prisma.BookingWhereInput = {
    OR: [
      { contactWhatsapp: { in: variants } },
      { contactPhone:    { in: variants } },
      { agentWhatsapp:   { in: variants } },
      { agentPhone:      { in: variants } },
      { bookingRef:      { in: filed.map(f => f.bookingRef) } },
    ],
  }

  const rows = await prisma.booking.findMany({
    where:   linkedWhere,
    orderBy: { createdAt: 'desc' },
    take:    LINKED_LIMIT,
    select:  LINKED_SELECT,
  })
  // An agent's number can sit on hundreds of files; the one the chat is showing
  // must still resolve when it falls outside the newest few.
  if (wantedRef && !rows.some(r => r.bookingRef === wantedRef)) {
    const extra = await prisma.booking.findFirst({
      where:  { AND: [linkedWhere, { bookingRef: wantedRef }] },
      select: LINKED_SELECT,
    })
    if (extra) rows.unshift(extra)
  }

  const visible = rows.filter(r => inScope(r.operationCountry))
  const linked: LinkedBooking[] = visible.map(r => ({
    bookingRef:       r.bookingRef,
    isNumber:         r.isNumber,
    leadName:         r.passengers[0]?.name ?? null,
    status:           r.status,
    operationCountry: r.operationCountry,
    arrivalDate:      isoDay(r.arrivalDate),
    departureDate:    isoDay(r.departureDate),
    chatRole:         chatRoleOf(r, phone),
  }))

  const target = wantedRef ? visible.find(r => r.bookingRef === wantedRef) : visible[0]
  const restricted = !target && rows.length > 0
  if (!target) return buildApiSuccess<TripContextResponse>({ linked, trip: null, restricted })

  const [row, portal] = await Promise.all([
    prisma.booking.findUnique({ where: { bookingRef: target.bookingRef }, select: TRIP_SELECT }),
    portalSendStatus(target.bookingRef),
  ])
  if (!row) return buildApiSuccess<TripContextResponse>({ linked, trip: null, restricted: false })

  // Same roles as /api/bookings/[ref]/whatsapp-customer and /api/te/transcripts.
  const fullDesk = role !== 'AC_USER'
  const trip = buildTripContext(row, {
    today:  nowInTz(briefingTimezone(row.operationCountry, row.bookingRef)).date,
    portal: { url: portalLinkUrl(row.bookingRef), ...portal },
    can:    { sendPortal: fullDesk, viewCalls: fullDesk },
  })

  return buildApiSuccess<TripContextResponse>({ linked, trip, restricted: false })
}
