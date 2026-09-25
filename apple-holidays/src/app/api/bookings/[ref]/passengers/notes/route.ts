import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  loadPassengerNotes, setPassengerNote, isPassengerNotesMissing,
  PASSENGER_NOTES_NOT_READY, PASSENGER_NOTE_MAX,
} from '@/lib/passenger-notes'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Same set as the booking page's canEditPassengers.
const EDIT_ROLES: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// GET /api/bookings/[ref]/passengers/notes → { [nameKey]: { note, updatedByName, updatedAt } }
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  return buildApiSuccess(await loadPassengerNotes(params.ref))
}

// PUT /api/bookings/[ref]/passengers/notes
// Body: { passengerId: string, note: string } — an empty note clears it.
export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!EDIT_ROLES.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const { passengerId, note } = await req.json() as { passengerId?: string; note?: string }
  if (!passengerId || typeof passengerId !== 'string') return buildApiError('passengerId is required')
  if (typeof note === 'string' && note.trim().length > PASSENGER_NOTE_MAX) {
    return buildApiError(`Note is too long — keep it under ${PASSENGER_NOTE_MAX} characters`)
  }

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { name: true, booking: { select: { bookingRef: true } } },
  })
  if (!passenger || passenger.booking.bookingRef !== params.ref) {
    return buildApiError('Passenger not found — reload the booking', 404)
  }

  try {
    const saved = await setPassengerNote(params.ref, passenger.name, note, {
      id: session.user.id, name: session.user.name ?? session.user.email ?? null,
    })
    return buildApiSuccess(saved, saved ? 'Special note saved' : 'Special note removed')
  } catch (err) {
    if (isPassengerNotesMissing(err)) return buildApiError(PASSENGER_NOTES_NOT_READY, 503)
    throw err
  }
}
