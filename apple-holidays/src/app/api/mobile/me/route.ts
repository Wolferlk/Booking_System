/**
 * GET   /api/mobile/me  — the signed-in driver's (or staff member's) profile
 * PATCH /api/mobile/me  { language?, changes? }
 *
 * `language` is the app's own setting and saves at once. Anything on the
 * driver record itself — phone, e-mail, licence, photo, bank account — is sent
 * to operations as a PROFILE_CHANGE request and applied from the web once a
 * person approves it. The app never writes to `drivers` directly: a bank
 * account is where the money goes, and a phone/e-mail is where sign-in codes
 * go, so neither changes on the strength of a phone session alone.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireActor, requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { PROFILE_FIELDS, driverProfile, staffProfile } from '@/lib/mobile/profile'
import { notifyStaff } from '@/lib/mobile/notify'
import { refuseForSandbox } from '@/lib/mobile/sandbox'

export const dynamic = 'force-dynamic'

const LANGS = ['en', 'si', 'ta', 'vi']

export const GET = mobileRoute('me', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const profile = actor.kind === 'DRIVER' ? await driverProfile(actor.driverId) : await staffProfile(actor.userId)
  const pending = actor.kind === 'DRIVER'
    ? await prisma.mobileDriverRequest.count({ where: { driverId: actor.driverId, kind: 'PROFILE_CHANGE', status: 'PENDING' } })
    : 0
  return buildApiSuccess({ ...profile, pendingProfileChanges: pending })
})

export const PATCH = mobileRoute('me-update', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const body = await readJson<{ language?: string; changes?: Record<string, unknown>; note?: string }>(req)

  if (body.language) {
    if (!LANGS.includes(body.language)) throw new MobileError('Unknown language.')
    await prisma.mobileDriverAccount.update({ where: { driverId: actor.driverId }, data: { language: body.language } })
  }

  let requestId: string | null = null
  if (body.changes && typeof body.changes === 'object') {
    await refuseForSandbox(actor.driverId, 'a profile change')
    const clean: Record<string, string> = {}
    for (const k of PROFILE_FIELDS) {
      const v = body.changes[k]
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim().slice(0, 300)
    }
    if (k(clean) === 0) throw new MobileError('Nothing to change.')
    if (clean.photoUrl && !clean.photoUrl.startsWith('/api/uploads/')) throw new MobileError('Upload the photo first.')
    const r = await prisma.mobileDriverRequest.create({
      data: {
        driverId: actor.driverId, driverName: actor.name, kind: 'PROFILE_CHANGE',
        payload: clean as Prisma.InputJsonValue, reason: body.note?.slice(0, 500) ?? null,
      },
    })
    requestId = r.id
    await notifyStaff(actor.country, {
      kind: 'DRIVER_REQUEST',
      title: `Profile change · ${actor.name}`,
      body: `Wants to update: ${Object.keys(clean).join(', ')}`,
      data: { requestId: r.id },
      dedupeKey: `req:${r.id}`,
    }).catch(err => console.error('[mobile me notify]', err))
  }

  return buildApiSuccess({ requestId, profile: await driverProfile(actor.driverId) })
})

function k(o: object) { return Object.keys(o).length }
