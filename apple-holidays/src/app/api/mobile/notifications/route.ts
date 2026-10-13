/**
 * GET  /api/mobile/notifications           — latest 50 for the signed-in user
 * POST /api/mobile/notifications { ids? }  — mark read (all when ids omitted)
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireActor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'

function who(actor: Awaited<ReturnType<typeof requireActor>>) {
  return { actorType: actor.kind, actorId: actor.kind === 'DRIVER' ? actor.driverId : actor.userId }
}

export const GET = mobileRoute('notifications', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const rows = await prisma.mobileNotification.findMany({
    where: who(actor), orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, kind: true, title: true, body: true, data: true, readAt: true, createdAt: true },
  })
  return buildApiSuccess({ items: rows, unread: rows.filter(r => !r.readAt).length })
})

export const POST = mobileRoute('notifications-read', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const body = await readJson<{ ids?: string[] }>(req).catch(() => ({} as { ids?: string[] }))
  await prisma.mobileNotification.updateMany({
    where: { ...who(actor), readAt: null, ...(Array.isArray(body.ids) && body.ids.length ? { id: { in: body.ids.slice(0, 100) } } : {}) },
    data: { readAt: new Date() },
  })
  return buildApiSuccess({ ok: true })
})
