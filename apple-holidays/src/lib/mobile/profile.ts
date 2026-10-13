/**
 * Driver App — the profile a signed-in user sees ("Me" tab), and the vehicle
 * photo renewal clock (every VEHICLE_CHECK_DAYS days).
 */
import { prisma } from '@/lib/prisma'

export const VEHICLE_CHECK_DAYS = 60

/** Driver-record fields a driver may ask to change (applied by ops on approval). */
export const PROFILE_FIELDS = [
  'phone', 'email', 'licenseNo', 'photoUrl', 'bankName', 'bankBranch', 'bankHolder', 'bankAccountNo', 'bankCode',
] as const

export async function vehicleCheckState(driverId: string) {
  const last = await prisma.mobileVehicleCheck.findFirst({
    where: { driverId, status: { in: ['SUBMITTED', 'APPROVED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, createdAt: true, reviewNote: true },
  })
  const rejected = await prisma.mobileVehicleCheck.findFirst({
    where: { driverId, status: 'REJECTED', createdAt: { gt: last?.createdAt ?? new Date(0) } },
    orderBy: { createdAt: 'desc' },
    select: { reviewNote: true, createdAt: true },
  })
  const dueAt = last ? new Date(last.createdAt.getTime() + VEHICLE_CHECK_DAYS * 86_400_000) : null
  const daysLeft = dueAt ? Math.ceil((dueAt.getTime() - Date.now()) / 86_400_000) : 0
  return {
    lastAt: last?.createdAt.toISOString() ?? null,
    lastStatus: last?.status ?? null,
    dueAt: dueAt?.toISOString() ?? null,
    daysLeft,
    /** true = the driver must send new photos now */
    due: !last || daysLeft <= 0 || !!rejected,
    rejectedNote: rejected?.reviewNote ?? null,
  }
}

function mask(acc: string | null): string | null {
  if (!acc) return null
  const s = acc.replace(/\s+/g, '')
  return s.length <= 4 ? s : `•••• ${s.slice(-4)}`
}

export async function driverProfile(driverId: string) {
  const d = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true, name: true, phone: true, email: true, licenseNo: true, photoUrl: true, country: true,
      bankName: true, bankBranch: true, bankHolder: true, bankAccountNo: true, bankCode: true,
      vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true, capacity: true, photoInside: true, photoOutside: true } },
      vendorOwner: { select: { name: true } },
    },
  })
  if (!d) return null
  const account = await prisma.mobileDriverAccount.findUnique({ where: { driverId }, select: { language: true } })
  return {
    kind: 'DRIVER' as const,
    id: d.id,
    name: d.name,
    phone: d.phone,
    email: d.email,
    licenseNo: d.licenseNo,
    photoUrl: d.photoUrl,
    country: d.country,
    language: account?.language ?? 'en',
    vendor: d.vendorOwner?.name ?? null,
    vehicle: d.vehicle,
    bank: d.bankName || d.bankAccountNo
      ? { bankName: d.bankName, branch: d.bankBranch, holder: d.bankHolder, accountNo: mask(d.bankAccountNo) }
      : null,
    vehicleCheck: await vehicleCheckState(driverId).catch(() => null),
  }
}

export async function staffProfile(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, country: true, avatar: true },
  })
  if (!u) return null
  return { kind: 'STAFF' as const, ...u }
}
