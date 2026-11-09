/**
 * Aahaas app — "Delete my account" (App Store guideline 5.1.1(v)).
 *
 * Anyone who can make an account in the app (independent drivers, vehicle
 * vendors) can delete it from the app. Company staff log in with accounts their
 * employer makes on ops.aahaas.com, so they are not covered here.
 *
 * Live-DB safety: no new tables or columns.
 *
 *   Signed-in DRIVER  at once: the app login (`mobile_driver_accounts`), push
 *                     tokens, in-app notifications and sign-in codes are
 *                     deleted and the driver is switched off, so every phone
 *                     is signed out and nobody can sign back in. A
 *                     `mobile_driver_requests` row of kind ACCOUNT_DELETE goes
 *                     to operations. Approve on /dashboard/driver-app erases
 *                     the personal details on the `drivers` row (name, phone,
 *                     e-mail, licence, photo, bank). Decline means "keep" —
 *                     the driver is switched back on and can activate again.
 *   Signed-in VENDOR  at once: the password is removed and the vendor is
 *                     switched off and unregistered (app + web portal sign-in
 *                     both stop). Same ACCOUNT_DELETE row, filed under the
 *                     vendor id with payload.actor = 'VENDOR'.
 *   Waiting sign-up   (registered in the app, not approved yet) — nothing was
 *                     ever used, so the rows this person made are deleted
 *                     outright. If anything already points at them, it falls
 *                     back to the signed-in route above.
 *
 * Trip records (assignments, trip days, km, GPS points) and payments are kept:
 * they are the company's business and tax records. They stop pointing at a
 * named person once the details are erased.
 *
 * The sandbox driver (App Review's demo login) gets a success reply and is
 * signed out on the phone, but nothing on the server changes — the demo
 * account must survive the reviewer trying the button.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { DriverActor, VendorActor } from './auth'
import { MobileError } from './http'
import { notifyStaff } from './notify'
import { isSandboxDriver } from './sandbox'
import { SIGNUP } from './signup'

/** `mobile_driver_requests.kind` of an account deletion. */
export const ACCOUNT_DELETE = 'ACCOUNT_DELETE'

export interface DeleteResult {
  deleted: true
  /** true when the rows themselves are gone (waiting sign-ups). */
  immediate: boolean
  sandbox?: boolean
}

const reasonOf = (r: unknown) => (typeof r === 'string' && r.trim() ? r.trim().slice(0, 500) : null)

async function alreadyFiled(id: string): Promise<boolean> {
  const r = await prisma.mobileDriverRequest.findFirst({ where: { driverId: id, kind: ACCOUNT_DELETE, status: 'PENDING' }, select: { id: true } })
  return !!r
}

// ── Driver ──────────────────────────────────────────────────────────────────

export async function deleteDriverAccount(actor: Pick<DriverActor, 'driverId' | 'name' | 'country'>, reason?: unknown): Promise<DeleteResult> {
  if (await isSandboxDriver(actor.driverId)) return { deleted: true, immediate: false, sandbox: true }
  const note = reasonOf(reason)

  await prisma.$transaction(async tx => {
    if (!(await alreadyFiled(actor.driverId))) {
      await tx.mobileDriverRequest.create({
        data: {
          driverId: actor.driverId, driverName: actor.name, kind: ACCOUNT_DELETE, reason: note,
          payload: { actor: 'DRIVER', requestedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      })
    }
    await tx.driver.update({ where: { id: actor.driverId }, data: { isActive: false } })
    await tx.mobileDriverAccount.deleteMany({ where: { driverId: actor.driverId } })
    await tx.mobileOtp.deleteMany({ where: { driverId: actor.driverId } })
    await tx.mobilePushToken.deleteMany({ where: { actorType: 'DRIVER', actorId: actor.driverId } })
    await tx.mobileNotification.deleteMany({ where: { actorType: 'DRIVER', actorId: actor.driverId } })
  })

  console.log(`[mobile account-delete] driver ${actor.driverId} deleted their app account`)
  await notifyStaff(actor.country, {
    kind: 'ACCOUNT_DELETE',
    title: `Account deleted · ${actor.name}`,
    body: 'The driver deleted their app account and is switched off. Erase their details on Driver App → Requests once trips and payments are settled.',
    data: { driverId: actor.driverId },
    dedupeKey: `acct-del:${actor.driverId}:${new Date().toISOString().slice(0, 10)}`,
  }).catch(err => console.error('[mobile account-delete] notify', err))
  return { deleted: true, immediate: false }
}

/** Ops approval: wipe the personal details. Trips and payments stay, unnamed. */
export async function eraseDriverDetails(driverId: string): Promise<void> {
  // Signed up again (fresh login made after the request)? Then they are back — don't wipe.
  const account = await prisma.mobileDriverAccount.findUnique({ where: { driverId }, select: { id: true } })
  if (account) throw new MobileError('This driver has an app login again, so their details were not erased. Decline this request instead.', 409)
  await prisma.driver.update({
    where: { id: driverId },
    data: {
      name: 'Deleted driver', phone: '', email: null, licenseNo: null, photoUrl: null,
      bankName: null, bankBranch: null, bankCode: null, bankHolder: null, bankAccountNo: null,
      isActive: false,
    },
  })
}

// ── Vendor ──────────────────────────────────────────────────────────────────

export async function deleteVendorAccount(actor: Pick<VendorActor, 'vendorId' | 'name' | 'country'>, reason?: unknown): Promise<DeleteResult> {
  const note = reasonOf(reason)
  await prisma.$transaction(async tx => {
    if (!(await alreadyFiled(actor.vendorId))) {
      await tx.mobileDriverRequest.create({
        data: {
          driverId: actor.vendorId, driverName: actor.name, kind: ACCOUNT_DELETE, reason: note,
          payload: { actor: 'VENDOR', requestedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      })
    }
    // A null password changes the token fingerprint, so every phone is signed out too.
    await tx.vehicleVendor.update({ where: { id: actor.vendorId }, data: { password: null, isActive: false, isRegistered: false } })
    await tx.mobilePushToken.deleteMany({ where: { actorType: 'VENDOR', actorId: actor.vendorId } })
    await tx.mobileNotification.deleteMany({ where: { actorType: 'VENDOR', actorId: actor.vendorId } })
  })

  console.log(`[mobile account-delete] vendor ${actor.vendorId} deleted their account`)
  await notifyStaff(actor.country, {
    kind: 'ACCOUNT_DELETE',
    title: `Vendor account deleted · ${actor.name}`,
    body: 'The vendor deleted their account and can no longer sign in. Erase their details on Driver App → Requests once trips and payments are settled.',
    data: { vendorId: actor.vendorId },
    dedupeKey: `acct-del:${actor.vendorId}:${new Date().toISOString().slice(0, 10)}`,
  }).catch(err => console.error('[mobile account-delete] notify', err))
  return { deleted: true, immediate: false }
}

export async function eraseVendorDetails(vendorId: string): Promise<void> {
  await prisma.vehicleVendor.update({
    where: { id: vendorId },
    data: {
      name: 'Deleted vendor', phone: null, email: null, whatsappPhone: null, address: null,
      bankName: null, bankAccountNo: null, bankHolder: null, bankBranch: null, bankCode: null,
      password: null, isActive: false, isRegistered: false,
    },
  })
}

/** Ops "Decline" on a deletion = keep the account: switch it back on. */
export async function restoreDeletedAccount(id: string, actor: 'DRIVER' | 'VENDOR'): Promise<void> {
  if (actor === 'DRIVER') await prisma.driver.update({ where: { id }, data: { isActive: true } })
  // A vendor has no password any more — ops set a new one on the Vendors page.
}

// ── Waiting sign-ups (the "waiting for approval" screen) ────────────────────

/** Deletes a registration that ops have not approved yet. */
export async function cancelPendingSignup(kind: 'DRIVER' | 'VENDOR', id: string): Promise<DeleteResult> {
  return kind === 'DRIVER' ? cancelDriverSignup(id) : cancelVendorSignup(id)
}

async function cancelDriverSignup(driverId: string): Promise<DeleteResult> {
  const d = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true, name: true, country: true, isActive: true, vehicleId: true,
      _count: { select: { assignments: true, driverPayments: true, slAllocations: true } },
    },
  })
  if (!d) return { deleted: true, immediate: true } // already gone
  if (await isSandboxDriver(driverId)) return { deleted: true, immediate: false, sandbox: true }
  const signup = await prisma.mobileDriverRequest.findFirst({ where: { driverId, kind: SIGNUP }, orderBy: { createdAt: 'desc' }, select: { status: true } })
  const used = d.isActive || signup?.status === 'APPROVED' || d._count.assignments + d._count.driverPayments + d._count.slAllocations > 0
  if (used) return deleteDriverAccount({ driverId, name: d.name, country: d.country ?? null }, 'Deleted from the waiting screen')

  await prisma.$transaction(async tx => {
    await tx.mobileOtp.deleteMany({ where: { driverId } })
    await tx.mobilePushToken.deleteMany({ where: { actorType: 'DRIVER', actorId: driverId } })
    await tx.mobileNotification.deleteMany({ where: { actorType: 'DRIVER', actorId: driverId } })
    await tx.mobileDriverRequest.deleteMany({ where: { driverId } })
    await tx.mobileDriverAccount.deleteMany({ where: { driverId } })
    await tx.driver.delete({ where: { id: driverId } })
    // The vehicle they registered with them — still switched off, and nobody else uses it.
    if (d.vehicleId) {
      const v = await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { isActive: true, vendorId: true } })
      if (v && !v.isActive && !v.vendorId) await tx.vehicle.delete({ where: { id: d.vehicleId } })
    }
  })
  console.log(`[mobile account-delete] waiting driver sign-up ${driverId} deleted by the registrant`)
  return { deleted: true, immediate: true }
}

async function cancelVendorSignup(vendorId: string): Promise<DeleteResult> {
  const v = await prisma.vehicleVendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true, name: true, country: true, isActive: true,
      _count: { select: { drivers: true, vehicles: true, assignments: true, slAllocations: true } },
    },
  })
  if (!v) return { deleted: true, immediate: true }
  const used = v.isActive || v._count.drivers + v._count.vehicles + v._count.assignments + v._count.slAllocations > 0
  if (used) return deleteVendorAccount({ vendorId, name: v.name, country: v.country ?? null }, 'Deleted from the waiting screen')

  await prisma.$transaction(async tx => {
    await tx.mobilePushToken.deleteMany({ where: { actorType: 'VENDOR', actorId: vendorId } })
    await tx.mobileNotification.deleteMany({ where: { actorType: 'VENDOR', actorId: vendorId } })
    await tx.vehicleVendor.delete({ where: { id: vendorId } })
  })
  console.log(`[mobile account-delete] waiting vendor sign-up ${vendorId} deleted by the registrant`)
  return { deleted: true, immediate: true }
}
