import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getPartnerAnalytics, type PartnerKind } from '@/lib/partner-analytics'

export const dynamic = 'force-dynamic'

const KINDS: PartnerKind[] = ['driver', 'vendor', 'guide', 'tourVendor']

/**
 * Performance analytics for a single ground partner.
 *
 * GET only — there is deliberately no POST/PUT/DELETE here. Everything this
 * route touches is read straight out of existing tables and aggregated in
 * memory; nothing is written back.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const kind = req.nextUrl.searchParams.get('kind') as PartnerKind | null
  const id = req.nextUrl.searchParams.get('id')
  if (!kind || !KINDS.includes(kind)) return buildApiError('kind must be one of: ' + KINDS.join(', '))
  if (!id) return buildApiError('id is required')

  // Resolve the partner itself so the panel can head itself properly, and so a
  // bad id 404s instead of returning a convincing-looking empty report.
  let partner: { id: string; name: string; phone?: string | null; country?: string | null } | null = null
  try {
    switch (kind) {
      case 'driver':
        partner = await prisma.driver.findUnique({
          where: { id }, select: { id: true, name: true, phone: true, country: true },
        })
        break
      case 'vendor':
        partner = await prisma.vehicleVendor.findUnique({
          where: { id }, select: { id: true, name: true, phone: true, country: true },
        })
        break
      case 'guide':
        partner = await prisma.guide.findUnique({
          where: { id }, select: { id: true, name: true, phone: true, country: true },
        })
        break
      case 'tourVendor':
        partner = await prisma.tourVendor.findUnique({
          where: { id }, select: { id: true, name: true, phone: true, country: true },
        })
        break
    }
  } catch (err) {
    console.error('[ground analytics partner] lookup failed:', err)
    return buildApiError('Failed to load partner', 500)
  }
  if (!partner) return buildApiError('Partner not found', 404)

  try {
    const analytics = await getPartnerAnalytics(kind, id)
    return buildApiSuccess({ partner, analytics })
  } catch (err) {
    console.error('[ground analytics partner] aggregation failed:', err)
    return buildApiError('Failed to build analytics', 500)
  }
}
