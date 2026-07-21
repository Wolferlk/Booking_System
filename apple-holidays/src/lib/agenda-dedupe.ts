// Removes duplicate movement-chart items produced by AI generation.
// The TQ/TC often lists the same movement twice — once as a structured transfer
// (e.g. "PQC Airport" → "Night Sea Hotel") and once as an itinerary line
// (e.g. "City Tour Phu Quoc Airport to Hotel city center | Private Transfers").
// Both land in the agenda and the user sees the same trip twice.

/* eslint-disable @typescript-eslint/no-explicit-any */

const AIRPORT_RE = /\b(airport|terminal)\b/i
// "... Airport to ... Hotel" / "... Hotel to ... Airport" written inside a single field
const APT_TO_HOTEL_RE = /airport\b[^|]{0,40}?\b(?:to|→|-|–)\b[^|]{0,60}?\bhotel/i
const HOTEL_TO_APT_RE = /hotel\b[^|]{0,40}?\b(?:to|→|-|–)\b[^|]{0,60}?\bairport/i

type MovementKind = 'ARRIVAL' | 'DEPARTURE' | null

function dateKey(raw: unknown): string {
  if (!raw) return ''
  const d = new Date(raw as string)
  return isNaN(d.getTime()) ? String(raw) : d.toISOString().slice(0, 10)
}

function norm(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Classify an item as the day's airport-arrival or airport-departure transfer.
 * Returns null for tours / activities / inter-city movements.
 */
function movementKind(item: any): MovementKind {
  const from = String(item.fromPoint ?? '')
  const to   = String(item.toPoint   ?? '')
  const blob = `${from} | ${to}`

  if (HOTEL_TO_APT_RE.test(blob)) return 'DEPARTURE'
  if (APT_TO_HOTEL_RE.test(blob)) return 'ARRIVAL'

  const fromIsApt = AIRPORT_RE.test(from)
  const toIsApt   = AIRPORT_RE.test(to)
  if (fromIsApt && !toIsApt) return 'ARRIVAL'
  if (toIsApt && !fromIsApt) return 'DEPARTURE'
  return null
}

/**
 * Higher score = the better-formed version of a duplicated movement.
 * Structured items ("PQC Airport" → "Night Sea Hotel") beat itinerary blobs
 * ("City Tour Phu Quoc Airport to Hotel city center | Private Transfers").
 */
function quality(item: any): number {
  const from = String(item.fromPoint ?? '').trim()
  const to   = String(item.toPoint   ?? '').trim()
  let score = 0
  if (from) score += 3
  if (to)   score += 1
  if (!to.includes('|')) score += 2          // not a raw TQ line with a trailing service label
  if (!APT_TO_HOTEL_RE.test(to) && !HOTEL_TO_APT_RE.test(to)) score += 2 // route not crammed into one field
  if (item.meetingTime) score += 1
  if (item.mealPlan) score += 1
  score += Math.min(String(item.details ?? '').length / 500, 2)
  return score
}

/**
 * Drop duplicate agenda items:
 *  1. identical date + fromPoint + toPoint
 *  2. more than one airport arrival (or departure) transfer on the same date
 * The richest version of each duplicate group is kept, in its original position.
 */
export function dedupeAgendaItems<T extends Record<string, any>>(items: T[]): T[] {
  if (items.length < 2) return items

  const drop = new Set<number>()

  // 1 — exact same movement on the same date
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const key = `${dateKey(item.date)}|${norm(item.fromPoint)}|${norm(item.toPoint)}`
    if (!norm(item.toPoint) && !norm(item.fromPoint)) return
    const prev = seen.get(key)
    if (prev === undefined) { seen.set(key, i); return }
    if (quality(item) > quality(items[prev])) { drop.add(prev); seen.set(key, i) }
    else drop.add(i)
  })

  // 2 — one airport arrival + one airport departure transfer per date, max
  const byMovement = new Map<string, number>()
  items.forEach((item, i) => {
    if (drop.has(i)) return
    const kind = movementKind(item)
    if (!kind) return
    const key = `${dateKey(item.date)}|${kind}`
    const prev = byMovement.get(key)
    if (prev === undefined) { byMovement.set(key, i); return }
    if (quality(item) > quality(items[prev])) { drop.add(prev); byMovement.set(key, i) }
    else drop.add(i)
  })

  return items.filter((_, i) => !drop.has(i))
}
