import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

async function ownsDriver(vendorId: string, driverId: string) {
  const driver = await prisma.driver.findFirst({ where: { id: driverId, vendorId } })
  return !!driver
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getVendorSession()
    if (!session) return buildApiError('Unauthorized', 401)
    if (!(await ownsDriver(session.id, params.id))) return buildApiError('Not found', 404)

    const { name, phone, email, licenseNo, photoUrl, isActive, vehicleId } = await req.json()

    if (vehicleId !== undefined) {
      await prisma.driver.updateMany({
        where: { vehicleId: { not: null }, id: params.id },
        data: { vehicleId: null },
      })
      if (vehicleId) {
        await prisma.driver.updateMany({
          where: { vehicleId, id: { not: params.id } },
          data: { vehicleId: null },
        })
      }
    }

    const driver = await prisma.driver.update({
      where: { id: params.id },
      data: {
        name: name?.trim() || undefined,
        phone: phone?.trim() || undefined,
        email: email?.trim() || null,
        licenseNo: licenseNo?.trim() || null,
        photoUrl: photoUrl || null,
        isActive: isActive ?? undefined,
        ...(vehicleId !== undefined ? { vehicleId: vehicleId || null } : {}),
      },
      include: { vehicle: true },
    })

    return buildApiSuccess(driver, 'Driver updated')
  } catch (err) {
    console.error('[vendor/drivers/:id PUT]', err)
    return buildApiError(err instanceof Error ? err.message : 'Server error', 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getVendorSession()
    if (!session) return buildApiError('Unauthorized', 401)
    if (!(await ownsDriver(session.id, params.id))) return buildApiError('Not found', 404)

    await prisma.driver.delete({ where: { id: params.id } })
    return buildApiSuccess(null, 'Driver removed')
  } catch (err) {
    console.error('[vendor/drivers/:id DELETE]', err)
    return buildApiError(err instanceof Error ? err.message : 'Server error', 500)
  }
}
