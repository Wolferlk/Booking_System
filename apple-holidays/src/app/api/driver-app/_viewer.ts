import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MOBILE_STAFF_ROLES } from '@/lib/mobile/auth'
import { MobileError } from '@/lib/mobile/http'
import { viewerCountry, type OpsViewer } from '@/lib/mobile/ops'
import { MobileAuthError } from '@/lib/mobile/auth'

/** The signed-in web user, if their desk runs drivers. */
export async function webViewer(): Promise<OpsViewer & { role: string }> {
  const session = await getServerSession(authOptions)
  if (!session) throw new MobileAuthError('Unauthorized')
  if (!MOBILE_STAFF_ROLES.includes(session.user.role)) throw new MobileError('Not allowed for your role.', 403)
  return { name: session.user.name, role: session.user.role, country: viewerCountry(session.user.role, session.user.country) }
}
