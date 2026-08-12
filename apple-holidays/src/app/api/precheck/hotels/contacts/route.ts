import { NextRequest } from 'next/server'
import type { HotelContactKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { addContactChannel, deleteContactChannel, updateContactChannel } from '@/lib/hotel-precheck-write'

export const dynamic = 'force-dynamic'

const KINDS: HotelContactKind[] = ['PHONE', 'MOBILE', 'WHATSAPP', 'EMAIL', 'FAX']

/** Re-read the hotel with channels so the client can replace its copy wholesale. */
async function hotelWithChannels(hotelId: string) {
  return prisma.hotelProfile.findUnique({ where: { id: hotelId }, include: { channels: true } })
}

/** POST — add a contact channel (or refresh an identical one) on a hotel. */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const hotelId = String(body.hotelId ?? '').trim()
  const value = String(body.value ?? '').trim()
  const kind = String(body.kind ?? 'PHONE') as HotelContactKind

  if (!hotelId) return buildApiError('hotelId is required')
  if (!value) return buildApiError('A phone number or email address is required')
  if (!KINDS.includes(kind)) return buildApiError(`Unknown contact kind "${kind}"`)
  if (kind === 'EMAIL' && !value.includes('@')) return buildApiError('That does not look like an email address')

  try {
    await addContactChannel(hotelId, {
      kind,
      label: body.label == null ? null : String(body.label).trim() || null,
      value,
      isPrimary: body.isPrimary === true,
      verified: body.verified === true,
      guessed: body.guessed === true,
      notes: body.notes == null ? null : String(body.notes).trim() || null,
    }, session.actor)

    return buildApiSuccess(await hotelWithChannels(hotelId), 'Contact added')
  } catch (e) {
    console.error('[precheck/contacts POST]', e)
    return buildApiError((e as Error).message, 400)
  }
}

/** PATCH — edit a channel, or mark it verified after somebody actually rang it. */
export async function PATCH(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const channelId = String(body.channelId ?? '').trim()
  if (!channelId) return buildApiError('channelId is required')

  try {
    const channel = await updateContactChannel(channelId, {
      ...(body.label !== undefined ? { label: body.label == null ? null : String(body.label) } : {}),
      ...(body.value !== undefined ? { value: String(body.value) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes == null ? null : String(body.notes) } : {}),
      ...(body.verified !== undefined ? { verified: body.verified === true } : {}),
      ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary === true } : {}),
    }, session.actor)

    return buildApiSuccess(await hotelWithChannels(channel.hotelId), 'Contact updated')
  } catch (e) {
    console.error('[precheck/contacts PATCH]', e)
    return buildApiError((e as Error).message, 400)
  }
}

/**
 * DELETE — remove a contact channel.
 *
 * Scoped strictly to `hotel_contact_channels`, a table this feature owns. It
 * never touches the hotel profile itself or anything in the Accounts master
 * list.
 */
export async function DELETE(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response

  const channelId = (req.nextUrl.searchParams.get('channelId') ?? '').trim()
  if (!channelId) return buildApiError('channelId is required')

  const existing = await prisma.hotelContactChannel.findUnique({
    where: { id: channelId },
    select: { hotelId: true },
  })
  if (!existing) return buildApiError('Contact not found', 404)

  try {
    await deleteContactChannel(channelId)
    return buildApiSuccess(await hotelWithChannels(existing.hotelId), 'Contact removed')
  } catch (e) {
    console.error('[precheck/contacts DELETE]', e)
    return buildApiError((e as Error).message, 400)
  }
}
