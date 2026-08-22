/**
 * PATCH /api/reservations/credit-notes/:id — chase, receive, apply, write off.
 *
 * `action: "chase"` is the one the register's bulk button uses; it stamps the
 * chase and increments the counter, which is what the ageing view sorts on.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('creditnote:manage')
  if (!g.ok) return g.response

  const body = await req.json()
  const existing = await prisma.creditNote.findUnique({ where: { id: params.id } })
  if (!existing) return buildApiError('Credit note not found', 404)

  const now = new Date()
  const data: Record<string, unknown> = { updatedBy: g.session.actor.email ?? null }

  if (body.action === 'chase') {
    data.lastChasedAt = now
    data.chaseCount = { increment: 1 }
    if (existing.status === 'PENDING') data.status = 'REQUESTED'
  } else {
    if (body.status) data.status = body.status
    if (body.status === 'RECEIVED') {
      data.receivedAt = now
      data.receivedAmount = body.receivedAmount ?? existing.expectedAmount
    }
    if (body.status === 'APPLIED') {
      data.appliedAt = now
      data.appliedToInvoiceId = body.appliedToInvoiceId ?? null
    }
    if (body.status === 'WRITTEN_OFF' && !body.notes?.trim()) {
      return buildApiError('Writing off a credit note requires a note explaining why', 422)
    }
    for (const f of ['creditNoteNo', 'expectedAmount', 'notes', 'fileUrl', 'reasonNote']) {
      if (body[f] !== undefined) data[f] = body[f]
    }
    if (body.expectedBy !== undefined) {
      data.expectedBy = body.expectedBy ? new Date(body.expectedBy) : null
    }
  }

  const updated = await prisma.creditNote.update({ where: { id: params.id }, data: data as never })

  if (existing.reservationId) {
    await prisma.reservationEvent.create({
      data: {
        reservationId: existing.reservationId,
        action: body.action === 'chase' ? 'credit_note_chased' : 'credit_note_updated',
        toStatus: (data.status as string) ?? null,
        note: body.notes ?? null,
        actorName: g.session.actor.name ?? null,
        actorEmail: g.session.actor.email ?? null,
      },
    })
  }

  return buildApiSuccess(updated)
}
