/**
 * Full AppleSystem sync for one already-imported booking.
 *
 *   GET  → when this booking was last synced, and what changed on that run.
 *   POST → re-pull the quotation and refresh the booking's content in place.
 *          Body `{ preview: true }` returns the proposed changes and writes
 *          nothing; `{ selection }` then applies only the ticked ones. An empty
 *          body applies everything (kept for scripts and older clients).
 *
 * All of the "what is safe to overwrite" reasoning lives in `as-booking-sync.ts`.
 * This route only does auth, country scoping, and error-code translation — the
 * sync itself refuses to touch workflow state, so it is safe to run on a live
 * file that is already ticketed, driver-allocated or client-confirmed.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import {
  syncBookingFromAs,
  getSyncState,
  AsSyncError,
  AsSyncStaleError,
  type SyncSection,
  type SyncSelection,
} from '@/lib/as-booking-sync'
import { getPendingConflicts } from '@/lib/booking-field-edits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Booking row + country-scope check shared by both handlers. */
async function loadScoped(ref: string, sessionCountry: OperationCountry | undefined) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, isNumber: true, operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }
  if (
    sessionCountry &&
    sessionCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)
  ) {
    return { error: buildApiError('Forbidden — this booking belongs to another country.', 403) }
  }
  return { booking }
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const { booking, error } = await loadScoped(
    params.ref,
    session.user.country as OperationCountry | undefined,
  )
  if (error) return error

  const [lastSync, pendingConflicts] = await Promise.all([
    getSyncState(booking!.bookingRef),
    getPendingConflicts(booking!.bookingRef),
  ])

  return buildApiSuccess({
    bookingRef: booking!.bookingRef,
    lastSync,
    // Raised by an earlier run — including the automatic pre-arrival one, which
    // has nobody to ask — so the page can prompt for a decision on load.
    pendingConflicts,
  })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const { booking, error } = await loadScoped(
    params.ref,
    session.user.country as OperationCountry | undefined,
  )
  if (error) return error

  const body = (await req.json().catch(() => ({}))) as {
    preview?: boolean
    selection?: Partial<Record<keyof SyncSelection, unknown>>
  }
  const selection = parseSelection(body.selection)
  if (body.selection !== undefined && !selection) {
    return buildApiError('Invalid selection.', 400)
  }

  try {
    const result = await syncBookingFromAs(booking!.bookingRef, {
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || 'Unknown user',
      mode: 'manual',
      preview: body.preview === true,
      selection: selection ?? undefined,
    })

    if (result.preview) {
      const total =
        result.fields.length + result.conflicts.length +
        result.sections.filter((s) => !s.skipped).length
      return buildApiSuccess(
        result,
        result.unchanged ? 'Already up to date — AppleSystem has nothing newer for this booking.' : `${total} change(s) to review.`,
      )
    }

    if (selection && result.unchanged) {
      return buildApiSuccess(result, 'No changes accepted — the booking was left as it was.')
    }

    const changedCount = result.fields.length
    const conflictCount = result.conflicts.length
    const conflictNote = conflictCount
      ? ` ${conflictCount} hand-edited field(s) were left alone and need a replace/skip decision.`
      : ''
    const message = result.unchanged
      ? 'Already up to date — AppleSystem has nothing newer for this booking.'
      : changedCount === 0 && conflictCount > 0
        ? `Nothing was written — ${conflictCount} hand-edited field(s) differ from AppleSystem and need a replace/skip decision.`
        : `Booking updated from AppleSystem — ${changedCount} field(s) changed. Workflow status, tickets, drivers and confirmations were not touched.${conflictNote}`

    return buildApiSuccess(result, message)
  } catch (err) {
    // The fresh preview rides along so the page can re-show it in one step.
    if (err instanceof AsSyncStaleError) {
      return Response.json({ success: false, error: err.message, data: err.fresh }, { status: 409 })
    }
    if (err instanceof AsSyncError) return buildApiError(err.message, err.status)
    return buildApiError(err instanceof Error ? err.message : 'Sync failed', 500)
  }
}

const SECTIONS: readonly SyncSection[] = ['itinerary', 'accommodations', 'passengers', 'emergencyContacts']

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null

/** Validate the posted selection; null when absent or malformed. */
function parseSelection(raw: Partial<Record<keyof SyncSelection, unknown>> | undefined): SyncSelection | null {
  if (!raw || typeof raw !== 'object') return null
  const fields = strings(raw.fields)
  const sections = strings(raw.sections)
  const conflicts = strings(raw.conflicts)
  const keptConflicts = raw.keptConflicts === undefined ? [] : strings(raw.keptConflicts)
  if (!fields || !sections || !conflicts || !keptConflicts || typeof raw.fingerprint !== 'string') return null
  return {
    keptConflicts,
    fields,
    sections: sections.filter((s): s is SyncSection => (SECTIONS as readonly string[]).includes(s)),
    conflicts,
    fingerprint: raw.fingerprint,
  }
}
