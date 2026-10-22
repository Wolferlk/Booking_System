/**
 * POST   /api/mobile/push-token  { token, platform }  — register this device for push
 * DELETE /api/mobile/push-token  { token }            — on sign-out
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { actorIdOf, requireActor } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('push-token', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const body = await readJson<{ token?: string; platform?: string }>(req)
  const token = String(body.token ?? '').trim()
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) throw new MobileError('Not an Expo push token.')
  const actorType = actor.kind
  const actorId = actorIdOf(actor)
  await prisma.mobilePushToken.upsert({
    where: { token },
    create: { token, actorType, actorId, platform: body.platform?.slice(0, 16) ?? null },
    update: { actorType, actorId, platform: body.platform?.slice(0, 16) ?? null },
  })
  return buildApiSuccess({ ok: true })
})

export const DELETE = mobileRoute('push-token-delete', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const body = await readJson<{ token?: string }>(req)
  const actorId = actorIdOf(actor)
  if (body.token) await prisma.mobilePushToken.deleteMany({ where: { token: body.token, actorId } })
  return buildApiSuccess({ ok: true })
})
