/**
 * The driver / vendor behind a WhatsApp chat — profile, vehicles, driver-app
 * status, the trip they are on now, upcoming trips, and past trips with the
 * guests' feedback.
 *
 *   GET ?phone=<number>   →  { profiles: PartnerProfile[] }  (empty when the
 *                            number is neither a driver nor a vendor)
 *
 * Read-only, same gate as /api/whatsapp/booking-context: inbox roles only, the
 * phone must be reachable by the viewer, and trips in countries the viewer
 * cannot open are left out. No rates, advances or bank details — see
 * lib/whatsapp-partner-context.ts.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { WHATSAPP_STAFF_ROLES, canAccessWhatsAppPhone, normalisePhone, whatsappInboxCountry } from '@/lib/whatsapp'
import { loadPartnerProfiles, type PartnerResponse } from '@/lib/whatsapp-partner-context'
import type { OperationCountry, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(role)) return buildApiError('Forbidden', 403)

  const phone = normalisePhone(req.nextUrl.searchParams.get('phone') ?? '')
  if (!phone || phone.length < 7) return buildApiError('phone is required')
  if (!(await canAccessWhatsAppPhone(role, phone))) {
    return buildApiError('This chat is outside your country scope', 403)
  }

  const inboxCountry = whatsappInboxCountry(role)
  const userCountry = session.user.country as OperationCountry | undefined
  const inScope = (country: string | null) => {
    if (inboxCountry && country !== inboxCountry) return false
    if (!userCountry || (userCountry as string) === 'ALL' || canSeeAllCountries(role, userCountry)) return true
    // Singapore / Malaysia files carry either code; let the scope helper decide.
    return isInCountryScope(country, userCountry)
  }

  try {
    const data = await loadPartnerProfiles(phone, inScope)
    return buildApiSuccess<PartnerResponse>(data)
  } catch (err) {
    console.error('[whatsapp partner]', err)
    return buildApiError('Could not load this driver / vendor', 500)
  }
}
