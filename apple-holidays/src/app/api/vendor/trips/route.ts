import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)

  const assignments = await prisma.assignment.findMany({
    where: { vendorId: session.id },
    include: {
      agendaItem: {
        include: {
          agenda: {
            include: {
              booking: {
                select: {
                  bookingRef: true,
                  isNumber: true,
                  dealName: true,
                  paxAdults: true,
                  paxChildren: true,
                  operationCountry: true,
                },
              },
            },
          },
        },
      },
      driver: { select: { id: true, name: true, phone: true, photoUrl: true } },
    },
    orderBy: { agendaItem: { date: 'asc' } },
  })

  return buildApiSuccess(assignments)
}
