/**
 * Passenger "Special Note" — a free-text note per passenger on the booking page.
 * See prisma/sql/2026-09-25-passenger-special-notes.sql.
 *
 * Notes are keyed by booking ref + a normalised passenger name, because the
 * passenger rows themselves are deleted and recreated on every edit/re-import.
 *
 * Every function here tolerates the table not existing yet (the SQL has to be
 * run on each database by hand): reads come back empty and a write says what
 * to run.
 */
import { prisma } from '@/lib/prisma'
import { passengerNameKey } from '@/lib/passenger-note-key'

export const PASSENGER_NOTE_MAX = 1000

export const PASSENGER_NOTES_NOT_READY =
  'Passenger special notes are not set up on this database yet — run prisma/sql/apply-passenger-special-notes.sh.'

export type PassengerNote = { note: string; updatedByName: string | null; updatedAt: string }

export function isPassengerNotesMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /passenger_special_notes.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

/** All notes on one booking, keyed by name key. Never throws. */
export async function loadPassengerNotes(bookingRef: string): Promise<Record<string, PassengerNote>> {
  const out: Record<string, PassengerNote> = {}
  try {
    const rows = await prisma.passengerSpecialNote.findMany({
      where: { bookingRef },
      select: { nameKey: true, note: true, updatedByName: true, updatedAt: true },
    })
    for (const r of rows) out[r.nameKey] = { note: r.note, updatedByName: r.updatedByName, updatedAt: r.updatedAt.toISOString() }
  } catch (err) {
    if (!isPassengerNotesMissing(err)) console.error('[passenger-notes] load failed (non-fatal):', err)
  }
  return out
}

/** Set (or, with an empty note, clear) one passenger's note. Throws when the table is missing. */
export async function setPassengerNote(
  bookingRef: string,
  passengerName: string,
  raw: unknown,
  user: { id?: string | null; name?: string | null },
): Promise<PassengerNote | null> {
  const nameKey = passengerNameKey(passengerName)
  const note = String(raw ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, PASSENGER_NOTE_MAX)
  if (!note) {
    await prisma.passengerSpecialNote.deleteMany({ where: { bookingRef, nameKey } })
    return null
  }
  const data = { passengerName: passengerName.slice(0, 191), note, updatedById: user.id ?? null, updatedByName: user.name ?? null }
  const row = await prisma.passengerSpecialNote.upsert({
    where: { bookingRef_nameKey: { bookingRef, nameKey } },
    create: { bookingRef, nameKey, ...data },
    update: data,
  })
  return { note: row.note, updatedByName: row.updatedByName, updatedAt: row.updatedAt.toISOString() }
}
