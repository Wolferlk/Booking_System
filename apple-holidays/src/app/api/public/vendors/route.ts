import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Public endpoint — returns registered & active vendors for the login page
// No auth required; returns only safe public fields (no passwords, no addresses)
export async function GET() {
  const vendors = await prisma.vehicleVendor.findMany({
    where: { isRegistered: true, isActive: true },
    select: { id: true, name: true, country: true, phone: true },
    orderBy: { name: 'asc' },
  })
  return buildApiSuccess(vendors)
}
