/**
 * The chat itself: contacts, the shared timeline, and turning a group into a real
 * WhatsApp group.
 *
 * Inbox group: each person gets the desk's message on their own WhatsApp, and
 * their replies are read back from whatsapp_messages by phone, so no webhook
 * change is needed. People do not see each other's messages on their phones.
 * A contact who is in another trip too will show those messages here as well.
 *
 * Real group: one send reaches the whole group on Meta, and replies arrive by
 * webhook (handleGroupWebhook), so only those are shown, not private chats.
 */
import { prisma } from '@/lib/prisma'
import { normalisePhone } from '@/lib/whatsapp'
import { deliverToGuest } from '@/lib/customer-whatsapp-automation'
import { syncDeliveryReceipts, syncInboundForPhones } from '@/lib/whatsapp-shared-inbox-sync'
import { createRealGroup, findRealGroupBySubject, getInviteLink, removeRealParticipant, sendRealGroupText } from './meta-groups'
import {
  MAX_INBOX_PARTICIPANTS, MAX_REAL_PARTICIPANTS, isGroupKind,
  type ParticipantRole, type TimelineItem,
} from './shared'

const CHAT_TAG = '[GROUP-CHAT:'
const TIMELINE_LIMIT = 200

async function bookingOf(groupId: string) {
  const row = await prisma.waBookingGroupMember.findFirst({ where: { groupId }, orderBy: { createdAt: 'asc' }, select: { bookingRef: true } })
  return row?.bookingRef ?? null
}

const channelOf = (groupId: string) => prisma.waGroupChannel.findUnique({ where: { groupId } })
const activePeople = (groupId: string) => prisma.waGroupParticipant.findMany({ where: { groupId, removedAt: null } })

// ── Contacts ─────────────────────────────────────────────────────────────────

/** Returns why not, or null once the contact is in. */
export async function addParticipant(groupId: string, p: { phone: string; name?: string | null; role: ParticipantRole }): Promise<string | null> {
  const phone = normalisePhone(p.phone)
  if (phone.length < 7) return 'Enter a full number with the country code'
  const [people, channel] = await Promise.all([activePeople(groupId), channelOf(groupId)])
  const real = channel?.mode === 'whatsapp'
  const limit = real ? MAX_REAL_PARTICIPANTS : MAX_INBOX_PARTICIPANTS
  if (people.some(x => x.phone === phone)) return 'This number is already in the group'
  if (people.length >= limit) return `A${real ? ' real WhatsApp' : 'n inbox'} group holds ${limit} people`
  const data = { name: p.name?.trim() || null, role: p.role, joinState: real ? 'invited' : 'active', removedAt: null }
  await prisma.waGroupParticipant.upsert({
    where: { groupId_phone: { groupId, phone } }, create: { groupId, phone, ...data }, update: data,
  })
  return null
}

export async function removeParticipant(groupId: string, id: string): Promise<void> {
  const person = await prisma.waGroupParticipant.findFirst({ where: { id, groupId } })
  if (!person) return
  const channel = await channelOf(groupId)
  if (channel?.mode === 'whatsapp' && channel.waGroupId && person.joinState === 'joined') {
    await removeRealParticipant(channel.waGroupId, person.phone)
  }
  await prisma.waGroupParticipant.update({ where: { id }, data: { removedAt: new Date(), joinState: 'left' } })
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export async function readTimeline(groupId: string, opts: { markRead?: boolean } = {}): Promise<TimelineItem[]> {
  const [group, people, channel, ref] = await Promise.all([
    prisma.waBookingGroup.findUnique({ where: { id: groupId }, select: { createdAt: true } }),
    activePeople(groupId), channelOf(groupId), bookingOf(groupId),
  ])
  const own = await prisma.waGroupMessage.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: TIMELINE_LIMIT })
  const byPhone = new Map(people.map(p => [p.phone, p]))
  const phones = people.map(p => p.phone)
  const real = channel?.mode === 'whatsapp'

  let replies: { id: string; phone: string; body: string | null; createdAt: Date; mediaType: string | null; mediaUrl: string | null }[] = []
  if (!real && phones.length && group) {
    await syncInboundForPhones(phones).catch(() => 0)
    replies = (await prisma.whatsAppMessage.findMany({
      where:   { phone: { in: phones }, direction: 'inbound', createdAt: { gte: group.createdAt } },
      orderBy: { createdAt: 'desc' }, take: TIMELINE_LIMIT,
      select:  { id: true, phone: true, body: true, createdAt: true, mediaType: true, mediaUrl: true },
    })).filter(m => (byPhone.get(m.phone)?.createdAt ?? m.createdAt) <= m.createdAt)
    if (opts.markRead && replies.length) {
      await prisma.whatsAppMessage.updateMany({ where: { id: { in: replies.map(r => r.id) }, read: false }, data: { read: true } })
    }
  }

  const copies = ref ? await readCopies(ref) : new Map<string, CopyTally>()
  const items: TimelineItem[] = own.map(m => {
    const inboundRole = m.senderPhone ? byPhone.get(m.senderPhone)?.role ?? null : null
    return {
      id: m.id, direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
      senderName: m.senderName, role: inboundRole, body: m.body,
      kind: isGroupKind(m.kind) ? m.kind : null,
      status: m.status, detail: m.detail, delivery: copies.get(m.id) ?? null,
      mediaType: null, mediaUrl: null, createdAt: m.createdAt.toISOString(),
    }
  })
  for (const r of replies) {
    const p = byPhone.get(r.phone)
    items.push({
      id: r.id, direction: 'inbound', senderName: p?.name ?? `+${r.phone}`, role: p?.role ?? null, body: r.body, kind: null,
      status: 'received', detail: null, delivery: null, mediaType: r.mediaType, mediaUrl: r.mediaUrl, createdAt: r.createdAt.toISOString(),
    })
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

type CopyTally = NonNullable<TimelineItem['delivery']>

/** How the per-person copies of each desk message got on, keyed by timeline id. */
async function readCopies(ref: string): Promise<Map<string, CopyTally>> {
  const read = () => prisma.whatsAppMessage.findMany({
    where:  { bookingRef: ref, direction: 'outbound', senderName: { startsWith: CHAT_TAG } },
    orderBy: { createdAt: 'desc' }, take: 400,
    select: { senderName: true, status: true, waMessageId: true },
  })
  let rows = await read()
  const open = rows.filter(r => r.waMessageId && r.status !== 'read' && r.status !== 'failed').map(r => r.waMessageId!)
  if (open.length && await syncDeliveryReceipts(open).catch(() => 0)) rows = await read()
  const out = new Map<string, CopyTally>()
  for (const r of rows) {
    const id = /^\[GROUP-CHAT:([^\]]+)\]/.exec(r.senderName ?? '')?.[1]
    if (!id) continue
    const t = out.get(id) ?? { total: 0, delivered: 0, read: 0, failed: 0 }
    t.total++
    if (r.status === 'failed') t.failed++
    if (r.status === 'read') t.read++
    if (r.status === 'read' || r.status === 'delivered') t.delivered++
    out.set(id, t)
  }
  return out
}

/** The last lines of the chat, labelled by who wrote them, for reply drafts. */
export async function chatForAi(groupId: string): Promise<string[]> {
  const items = await readTimeline(groupId)
  return items.slice(-16).map(m => {
    const who = m.direction === 'inbound' ? `${(m.role ?? 'contact').toUpperCase()} ${m.senderName ?? ''}`.trim() : 'DESK'
    return `[${m.createdAt.slice(0, 16)}] ${who}: ${(m.body ?? '').slice(0, 500)}`
  })
}

// ── Sending ──────────────────────────────────────────────────────────────────

export async function postMessage(groupId: string, body: string, actor: string): Promise<{ error?: string; failed: number; total: number }> {
  const [ref, people, channel] = await Promise.all([bookingOf(groupId), activePeople(groupId), channelOf(groupId)])
  if (!ref) return { error: 'Link a booking first', failed: 0, total: 0 }

  if (channel?.mode === 'whatsapp' && channel.waGroupId) {
    const waMessageId = await sendRealGroupText(channel.waGroupId, body)
    await prisma.waGroupMessage.create({
      data: { groupId, bookingRef: ref, direction: 'outbound', senderName: actor, body, status: 'sent', recipients: 1, waMessageId },
    })
    return { failed: 0, total: 1 }
  }

  if (people.length === 0) return { error: 'Add a contact first', failed: 0, total: 0 }
  const row = await prisma.waGroupMessage.create({
    data: { groupId, bookingRef: ref, direction: 'outbound', senderName: actor, body, status: 'sending', recipients: people.length },
  })
  const tag = `${CHAT_TAG}${row.id}] ${actor}`
  const problems: string[] = []
  for (const p of people) {
    const r = await deliverToGuest({ phone: p.phone, text: body, guestName: p.name, bookingRef: ref, tag })
      .catch(err => ({ ok: false, waMessageId: null, reason: err instanceof Error ? err.message : String(err), unconfirmed: false }))
    await prisma.whatsAppMessage.create({
      data: {
        bookingRef: ref, phone: p.phone, direction: 'outbound', body, waMessageId: r.waMessageId,
        status: r.ok ? 'sent' : 'failed', senderName: tag,
      },
    })
    if (!r.ok) problems.push(`${p.name ?? `+${p.phone}`}: ${r.reason ?? 'Send failed'}`)
    else if (r.unconfirmed) problems.push(`${p.name ?? `+${p.phone}`}: outside the 24h window and the guest template is unavailable, so Meta may drop it.`)
  }
  const failed = problems.filter(x => !x.includes('Meta may drop it')).length
  await prisma.waGroupMessage.update({
    where: { id: row.id },
    data:  { status: failed === people.length ? 'failed' : 'sent', detail: problems.join(' ').slice(0, 800) || null },
  })
  return { failed, total: people.length }
}

// ── Real WhatsApp group ──────────────────────────────────────────────────────

/** Ask Meta for a real group. A refusal is stored and the group stays an inbox group. */
export async function makeRealGroup(groupId: string, name: string): Promise<string | null> {
  const people = await activePeople(groupId)
  if (people.length > MAX_REAL_PARTICIPANTS) return `A real WhatsApp group holds ${MAX_REAL_PARTICIPANTS} people. Remove ${people.length - MAX_REAL_PARTICIPANTS} first.`
  try {
    const { groupId: waGroupId } = await createRealGroup(name)
    const data = waGroupId
      ? { mode: 'whatsapp', waGroupId, inviteLink: await getInviteLink(waGroupId).catch(() => null), lastError: null }
      : { mode: 'pending', lastError: null }
    await prisma.waGroupChannel.upsert({ where: { groupId }, create: { groupId, ...data }, update: data })
    if (waGroupId) await prisma.waGroupParticipant.updateMany({ where: { groupId, removedAt: null }, data: { joinState: 'invited' } })
    return null
  } catch (err) {
    const lastError = err instanceof Error ? err.message.slice(0, 400) : 'Meta refused'
    await prisma.waGroupChannel.upsert({ where: { groupId }, create: { groupId, mode: 'inbox', lastError }, update: { mode: 'inbox', lastError } })
    return lastError
  }
}

/** Finish a create that returned no id, by finding the group on Meta. */
export async function settlePendingGroup(groupId: string, name: string): Promise<void> {
  const channel = await channelOf(groupId)
  if (channel?.mode !== 'pending') return
  const waGroupId = await findRealGroupBySubject(name).catch(() => null)
  if (!waGroupId) return
  await prisma.waGroupChannel.update({
    where: { groupId },
    data:  { mode: 'whatsapp', waGroupId, inviteLink: await getInviteLink(waGroupId).catch(() => null) },
  })
  await prisma.waGroupParticipant.updateMany({ where: { groupId, removedAt: null }, data: { joinState: 'invited' } })
}

/** Send the join link to everyone who has not joined yet, on their private chat. */
export async function sendInvites(groupId: string, groupName: string): Promise<{ sent: number; error?: string }> {
  const [channel, people, ref] = await Promise.all([channelOf(groupId), activePeople(groupId), bookingOf(groupId)])
  if (!channel?.inviteLink || !ref) return { sent: 0, error: 'There is no invite link yet' }
  let sent = 0
  for (const p of people.filter(x => x.joinState !== 'joined')) {
    const text = `You're invited to the WhatsApp group for your trip: *${groupName}*\n\nTap to join: ${channel.inviteLink}`
    const tag = '[GROUP-INVITE]'
    const r = await deliverToGuest({ phone: p.phone, text, guestName: p.name, bookingRef: ref, tag }).catch(() => ({ ok: false, waMessageId: null }))
    if (!r.ok) continue
    await prisma.whatsAppMessage.create({
      data: { bookingRef: ref, phone: p.phone, direction: 'outbound', body: text, waMessageId: r.waMessageId, status: 'sent', senderName: tag },
    })
    sent++
  }
  return { sent }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

interface GroupWebhookValue {
  messages?: { id: string; group_id?: string; from?: string; type?: string; text?: { body?: string } }[]
  contacts?: { profile?: { name?: string }; wa_id?: string }[]
  groups?: {
    type?: string; group_id?: string; invite_link?: string
    added_participants?: { wa_id?: string; input?: string }[]
    removed_participants?: { wa_id?: string; input?: string }[]
  }[]
}

const RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 }

/**
 * Handles anything about real groups in a webhook change, and hands back the
 * ordinary 1:1 messages. A group message must never be filed as a private chat.
 */
export async function handleGroupWebhook<T extends { group_id?: string }>(value: unknown, messages: T[] | undefined): Promise<T[]> {
  const v = (value ?? {}) as GroupWebhookValue
  for (const g of v.groups ?? []) {
    if (!g.group_id) continue
    const channel = await prisma.waGroupChannel.findUnique({ where: { waGroupId: g.group_id } })
    if (!channel) continue
    if (g.invite_link) await prisma.waGroupChannel.update({ where: { groupId: channel.groupId }, data: { inviteLink: g.invite_link } })
    const mark = (list: { wa_id?: string; input?: string }[] | undefined, joinState: string) =>
      Promise.all((list ?? []).map(p => prisma.waGroupParticipant.updateMany({
        where: { groupId: channel.groupId, phone: normalisePhone(p.wa_id ?? p.input ?? '') }, data: { joinState },
      })))
    await mark(g.added_participants, 'joined')
    await mark(g.removed_participants, 'left')
  }

  for (const m of v.messages ?? []) {
    if (!m.group_id) continue
    const channel = await prisma.waGroupChannel.findUnique({ where: { waGroupId: m.group_id } })
    const ref = channel && await bookingOf(channel.groupId)
    if (!channel || !ref) continue
    if (await prisma.waGroupMessage.findFirst({ where: { waMessageId: m.id }, select: { id: true } })) continue
    const phone = normalisePhone(m.from ?? '')
    const person = phone ? await prisma.waGroupParticipant.findFirst({ where: { groupId: channel.groupId, phone } }) : null
    await prisma.waGroupMessage.create({
      data: {
        groupId: channel.groupId, bookingRef: ref, direction: 'inbound', waMessageId: m.id, status: 'received',
        senderPhone: phone || null,
        senderName: person?.name ?? v.contacts?.find(c => c.wa_id === m.from)?.profile?.name ?? (phone ? `+${phone}` : 'Group member'),
        body: m.text?.body ?? `[${m.type ?? 'message'}]`,
      },
    })
  }
  return (messages ?? []).filter(m => !m.group_id)
}

/** A real group's receipts: keep the furthest any member reached. */
export async function applyGroupStatus(statuses: { id?: string; status?: string; recipient_type?: string }[] | undefined): Promise<void> {
  for (const s of statuses ?? []) {
    if (s.recipient_type !== 'group' || !s.id || !s.status) continue
    const row = await prisma.waGroupMessage.findFirst({ where: { waMessageId: s.id }, select: { id: true, status: true } })
    if (row && s.status !== 'failed' && (RANK[s.status] ?? 0) > (RANK[row.status] ?? 0)) {
      await prisma.waGroupMessage.update({ where: { id: row.id }, data: { status: s.status } })
    } else if (row && s.status === 'failed') {
      await prisma.waGroupMessage.update({ where: { id: row.id }, data: { status: 'failed' } })
    }
  }
}
