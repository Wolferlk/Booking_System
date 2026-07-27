import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// PDFKit renders in-process — Node runtime, small time budget, no Chromium.
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/ops-ai/pdf/[ref]
 *
 * Streams the full booking-details PDF (passengers, flights, hotels, agenda,
 * drivers, vouchers, notes) as a download. Called by the OPS_AI `generate_pdf`
 * capability. Re-derives auth and country scope from the live session — the
 * chat never authorises anything on its own.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const ref = params.ref.toUpperCase()
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights:           { orderBy: { date: 'asc' } },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      itineraryItems:    { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
      tickets: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  // Country scope — mirror the executor's actorMaySee check.
  const country = session.user.country as OperationCountry | undefined
  const seesAll = canSeeAllCountries(role, country as never)
  if (!seesAll && country && country !== 'ALL' && !isInCountryScope(booking.operationCountry, country)) {
    return buildApiError('This booking is outside your country scope.', 403)
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await generateFullDetailsPdf(booking as any)
    const filename = `${ref}_FullDetails.pdf`
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OPS_AI] pdf generation failed:', ref, msg)
    return buildApiError(`Could not generate the PDF: ${msg}`, 500)
  }
}
