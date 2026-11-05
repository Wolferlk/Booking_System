/**
 * Driver App — in-app notifications + Expo push.
 *
 * Every notification is first a row in `mobile_notifications` (the app's bell
 * list), then a push to every device token the actor has. A `dedupeKey` makes
 * a notification once-only, so the reminder cron can run as often as it likes.
 *
 * Push goes through Expo's push service (https://exp.host), which fans out to
 * APNs / FCM. Tokens Expo reports as DeviceNotRegistered are removed.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MOBILE_STAFF_ROLES } from './auth'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export type ActorType = 'DRIVER' | 'STAFF' | 'VENDOR'

export interface NotifyInput {
  actorType: ActorType
  actorId: string
  kind: string
  title: string
  body: string
  data?: Record<string, unknown>
  dedupeKey?: string
}

/** Returns false when the dedupeKey was already used (nothing sent). */
export async function notify(input: NotifyInput): Promise<boolean> {
  let row
  try {
    row = await prisma.mobileNotification.create({
      data: {
        actorType: input.actorType, actorId: input.actorId, kind: input.kind,
        title: input.title.slice(0, 190), body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey ?? null,
      },
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
  await pushTo(input.actorType, input.actorId, input.title, input.body, { ...input.data, notificationId: row.id, kind: input.kind })
    .then(() => prisma.mobileNotification.update({ where: { id: row.id }, data: { pushedAt: new Date() } }))
    .catch(err => console.error('[mobile push]', err))
  return true
}

/** Notify every app-using staff member who can see this country. */
export async function notifyStaff(country: string | null, input: Omit<NotifyInput, 'actorType' | 'actorId'>): Promise<void> {
  const tokens = await prisma.mobilePushToken.findMany({ where: { actorType: 'STAFF' }, select: { actorId: true } })
  const ids = Array.from(new Set(tokens.map(t => t.actorId)))
  if (!ids.length) return
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true, role: { in: MOBILE_STAFF_ROLES } },
    select: { id: true, role: true, country: true },
  })
  for (const u of users) {
    if (country && u.role !== 'ULTRA_SUPER_ADMIN' && u.country !== 'ALL' && u.country !== country) continue
    await notify({ ...input, actorType: 'STAFF', actorId: u.id, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${u.id}` : undefined })
  }
}

async function pushTo(actorType: ActorType, actorId: string, title: string, body: string, data: Record<string, unknown>) {
  const tokens = await prisma.mobilePushToken.findMany({ where: { actorType, actorId }, select: { token: true } })
  if (!tokens.length) return
  const messages = tokens.map(t => ({
    to: t.token, title, body, data, sound: 'default', priority: 'high', channelId: 'trips',
  }))
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
  })
  const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null
  const dead = (json?.data ?? [])
    .map((r, i) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? tokens[i].token : null))
    .filter((t): t is string => !!t)
  if (dead.length) await prisma.mobilePushToken.deleteMany({ where: { token: { in: dead } } })
}
