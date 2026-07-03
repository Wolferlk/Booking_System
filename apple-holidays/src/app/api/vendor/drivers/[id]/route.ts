import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

async function ownsDriver(session: { id: string }, driverId: string) {
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, vehicle: { vendorId: session.id } },
  })
  return !!driver
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(await ownsDriver(session, params.id))) return buildApiError('Not found', 404)

  const { name, phone, email, licenseNo, photoUrl, isActive,
    bankName, bankAccountNo, bankHolder, bankBranch, bankCode } = await req.json()

  const driver = await prisma.driver.update({
    where: { id: params.id },
    data: {
      name: name?.trim() || undefined,
      phone: phone?.trim() || undefined,
      email: email?.trim() || null,
      licenseNo: licenseNo?.trim() || null,
      photoUrl: photoUrl || null,
      isActive: isActive ?? undefined,
      bankName: bankName?.trim() || null,
      bankAccountNo: bankAccountNo?.trim() || null,
      bankHolder: bankHolder?.trim() || null,
      bankBranch: bankBranch?.trim() || null,
      bankCode: bankCode?.trim() || null,
    },
    include: { vehicle: true },
  })

  return buildApiSuccess(driver, 'Driver updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getVendorSession()
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(await ownsDriver(session, params.id))) return buildApiError('Not found', 404)

  await prisma.driver.delete({ where: { id: params.id } })
  return buildApiSuccess(null, 'Driver removed')
}
