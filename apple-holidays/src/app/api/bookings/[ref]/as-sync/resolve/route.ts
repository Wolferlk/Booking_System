/**
 * Resolve the package/notes conflicts a sync parked.
 *
 * When "Fetch Data from API" finds that AppleSystem disagrees with a field
 * somebody edited by hand, it writes neither value — it parks the upstream text
 * and returns. This route is where the decision lands:
 *
 *   replace → AppleSystem's text is written and the hand-edit mark is dropped,
 *             so later syncs own the field again.
 *   skip    → the hand-edited text stays and keeps its mark, so the next sync
 *             will ask again rather than quietly overwriting it.
 *
 * The values applied are the ones the *server* parked, never text posted by the
 * caller: the request carries a decision per field and nothing else, so this
 * route cannot be used to write arbitrary content into a booking.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { logActivity, ACTION } from '@/lib/activity'
import {
  getPendingConflicts,
  writePendingConflicts,
  clearFieldEdits,
  isPackageNoteField,
  NOTE_FIELD_LABELS,
  type PackageNoteField,
} from '@/lib/booking-field-edits'

export const dynamic = 'force-dynamic'

type Decision = 'replace' | 'skip'

/** GET → what is still waiting for a decision on this booking. */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const country = session.user.country as OperationCountry | undefined
  if (country && country !== 'ALL' && !isInCountryScope(booking.operationCountry as OperationCountry, country)) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  return buildApiSuccess({ pending: await getPendingConflicts(booking.bookingRef) })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, bookingRef: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const country = session.user.country as OperationCountry | undefined
  if (country && country !== 'ALL' && !isInCountryScope(booking.operationCountry as OperationCountry, country)) {
    return buildApiError('Forbidden — this booking belongs to another country.', 403)
  }

  const body = (await req.json().catch(() => ({}))) as { decisions?: Record<string, string> }
  const raw = body.decisions ?? {}

  const decisions: Partial<Record<PackageNoteField, Decision>> = {}
  for (const [field, choice] of Object.entries(raw)) {
    if (!isPackageNoteField(field)) continue
    if (choice === 'replace' || choice === 'skip') decisions[field] = choice
  }
  if (Object.keys(decisions).length === 0) {
    return buildApiError('No replace/skip decisions were sent.', 400)
  }

  const pending = await getPendingConflicts(booking.bookingRef)
  if (!pending) {
    return buildApiError('There is nothing waiting for a decision on this booking — it may have been resolved already.', 409)
  }

  // Only act on fields that are actually parked. A decision for anything else
  // is dropped rather than guessed at.
  const replaced: { field: PackageNoteField; value: string }[] = []
  const skipped: PackageNoteField[] = []
  for (const item of pending.items) {
    const choice = decisions[item.field]
    if (choice === 'replace') replaced.push({ field: item.field, value: item.incoming })
    else if (choice === 'skip') skipped.push(item.field)
  }

  const decided = [...replaced.map((r) => r.field), ...skipped]
  if (decided.length === 0) {
    return buildApiError('None of those fields are waiting for a decision.', 409)
  }

  if (replaced.length > 0) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: Object.fromEntries(replaced.map((r) => [r.field, r.value])),
    })
    // Upstream won, so the field is no longer a hand-edit: later syncs may
    // update it freely again.
    await clearFieldEdits(booking.bookingRef, replaced.map((r) => r.field))
  }

  // Skipped fields keep their mark on purpose — the next sync asks again rather
  // than assuming a one-off "keep mine" holds forever.
  const remaining = pending.items.filter((i) => !decided.includes(i.field))
  await writePendingConflicts(
    booking.bookingRef,
    remaining.length > 0 ? { ...pending, items: remaining } : null,
  )

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'as_sync_conflict_resolve',
      bookingRef: booking.bookingRef,
      quotationNo: pending.quotationNo,
      replaced: replaced.map((r) => r.field),
      skipped,
      stillPending: remaining.map((r) => r.field),
    },
  }).catch((err) => {
    console.error('[as-sync/resolve] activity log failed:', err instanceof Error ? err.message : err)
  })

  const parts: string[] = []
  if (replaced.length) parts.push(`${replaced.map((r) => NOTE_FIELD_LABELS[r.field]).join(', ')} replaced with AppleSystem's version`)
  if (skipped.length) parts.push(`${skipped.map((f) => NOTE_FIELD_LABELS[f]).join(', ')} kept as edited`)

  return buildApiSuccess(
    {
      bookingRef: booking.bookingRef,
      replaced: replaced.map((r) => r.field),
      skipped,
      pending: remaining.length > 0 ? { ...pending, items: remaining } : null,
    },
    parts.join(' · ') || 'Nothing to apply.',
  )
}
