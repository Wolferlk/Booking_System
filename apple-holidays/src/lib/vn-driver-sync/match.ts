/**
 * VN Driver Sync — which sheet row is which system movement.
 *
 * The Movement Chart sheet carries the same fields as the system's chart
 * (Date, Code, Tour Details, Meal Plan, Meeting Time, Service Type), so most
 * rows settle on rules alone:
 *
 *   1. same booking, same date — the only candidates;
 *   2. score each (row, movement) pair: details text 55 %, service type 20 %,
 *      meeting time 17 %, meal plan 8 %;
 *   3. pair them one-to-one, best pair first;
 *   4. HIGH when the pair is clearly best (score and margin), or it is the
 *      only row and the only movement that day and they do not contradict.
 *
 * Whatever is left unsure — two transfers the same day with similar text, a
 * row a day off — goes to OpenAI (gpt-4o-mini, temperature 0), one call per
 * booking, with only that booking's rows and movements. The AI answer is only
 * trusted when it agrees with the evidence (rules score ≥ 0.30) and says it is
 * sure; it is cached by a hash of what it was shown, so an unchanged booking
 * is never asked twice.
 */
import { createHash } from 'crypto'
import openai, { logAiUsage } from '@/lib/openai'
import { tokens, fold, cityOf, isAirportEndpoint } from '@/lib/vn-vendor-sync/match'
import { normaliseServiceType, isSicType, isPrivateTransferType, serviceTypeLabel } from '@/lib/service-types'
import { normTime, type SheetRow } from './sheet'

export interface Movement {
  id: string
  date: string // yyyy-mm-dd
  details: string | null
  location: string | null
  fromPoint: string | null
  toPoint: string | null
  meetingTime: string | null
  mealPlan: string | null
  serviceType: string | null
}

export interface Pick {
  rowId: string
  score: number
  confidence: 'HIGH' | 'MEDIUM'
  method: 'RULES' | 'AI'
  reason: string
}

export interface AiCacheEntry { hash: string; json: string }

export interface BookingMatch {
  /** movement id → the row it took. */
  picks: Map<string, Pick>
  /** Rows (with a number) that no movement took, and why. */
  unmatched: { row: SheetRow; why: string }[]
  aiCalled: boolean
  /** Store with every movement of the booking; hand back next run. */
  ai: AiCacheEntry | null
}

export const HIGH_SCORE = 0.72
const HIGH_MARGIN = 0.12
const MIN_SCORE = 0.3

// ── Pair score ───────────────────────────────────────────────────────────────
//
// What decides a pair, in plain terms:
//   * route   — the sheet's From / To against the movement's from / to point
//               (an airport is an airport on both sides; a hotel name matches
//               its full street address);
//   * details — the sheet's Tour Details against the movement's details;
//   * city    — the sheet's Location against the movement's location;
//   * service type, meeting time and meal plan as tie-breakers.
// Content is the stronger of route and details (a transfer row often carries a
// flight number in Details and nothing else useful), blended with the weaker so
// two rows that agree on both beat one that agrees on one.

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sb = new Set(b)
  const hit = a.filter(t => sb.has(t)).length
  return (2 * hit) / (a.length + b.length)
}

/** How much of the shorter token list the longer one contains (a hotel name inside an address). */
function cover(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  const sl = new Set(long)
  return short.filter(t => sl.has(t)).length / short.length
}

const squash = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()

function textScore(a0: string | null, b0: string | null): number {
  const a = squash(a0), b = squash(b0)
  if (!a || !b) return 0
  if (a === b) return 1
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (short.length >= 24 && long.startsWith(short)) return 0.97
  if (short.length >= 40 && long.includes(short.slice(0, 40))) return 0.9
  const ta = tokens(a0), tb = tokens(b0)
  return Math.max(dice(ta, tb), 0.85 * cover(ta, tb) * Math.min(1, Math.min(ta.length, tb.length) / 3))
}

/** One endpoint against another: 1 = same place. */
function placeScore(a: string | null, b: string | null): number | null {
  if (!a?.trim() || !b?.trim()) return null
  const airA = isAirportEndpoint(a), airB = isAirportEndpoint(b)
  if (airA || airB) {
    if (airA !== airB) return 0.05
    const ca = cityOf(a, { abbr: true }), cb = cityOf(b, { abbr: true })
    return !ca || !cb || ca === cb ? 1 : 0.1
  }
  const sa = squash(a), sb = squash(b)
  if (sa === sb) return 1
  const [short, long] = sa.length < sb.length ? [sa, sb] : [sb, sa]
  if (short.length >= 8 && long.includes(short)) return 0.95
  const ta = tokens(a), tb = tokens(b)
  return Math.max(dice(ta, tb), cover(ta, tb) * (Math.min(ta.length, tb.length) >= 2 ? 0.9 : 0.6))
}

function routeScore(row: SheetRow, m: Movement): number | null {
  const f = placeScore(row.from, m.fromPoint)
  const t = placeScore(row.to, m.toPoint)
  if (f !== null && t !== null) return (f + t) / 2
  // One side missing (or the chart keeps the route in `location`): compare the whole route as text.
  const rowText = [row.from, row.to].filter(Boolean).join(' ')
  const movText = [m.fromPoint, m.toPoint, m.location].filter(Boolean).join(' ')
  if (!rowText.trim() || !movText.trim()) return f ?? t
  const whole = textScore(rowText, movText)
  return f !== null || t !== null ? Math.max(whole, ((f ?? t) as number) * 0.8) : whole
}

function cityScore(row: SheetRow, m: Movement): number {
  const a = cityOf(row.location) ?? cityOf(row.from) ?? cityOf(row.to)
  const b = cityOf(m.location) ?? cityOf(m.fromPoint) ?? cityOf(m.toPoint)
  if (!a || !b) return 0.5
  return a === b ? 1 : 0
}

function serviceScore(row: SheetRow, m: Movement): number {
  const a = row.serviceCode ?? normaliseServiceType(row.service)
  const b = m.serviceType
  if (!a || !b) return 0.4
  if (a === b) return 1
  if (fold(serviceTypeLabel(a)) === fold(serviceTypeLabel(b))) return 1
  if ((isSicType(a) && isSicType(b)) || (isPrivateTransferType(a) && isPrivateTransferType(b))) return 0.6
  return 0
}

function timeScore(row: SheetRow, m: Movement): number {
  const a = row.time
  const b = normTime(m.meetingTime)
  if (!a && !b) return 0.6
  if (!a || !b) return 0.5                         // a blank time is not evidence against
  if (a === b) return 1
  const mins = (t: string) => { const x = t.match(/^(\d{2}):(\d{2})$/); return x ? +x[1] * 60 + +x[2] : null }
  const da = mins(a), db = mins(b)
  if (da !== null && db !== null && Math.abs(da - db) <= 15) return 0.75
  if (da !== null && db !== null && Math.abs(da - db) <= 60) return 0.35
  return 0
}

function mealScore(row: SheetRow, m: Movement): number {
  const a = squash(row.meal), b = squash(m.mealPlan)
  if (!a && !b) return 0.6
  if (!a || !b) return 0.4
  return a === b || a.includes(b) || b.includes(a) ? 1 : 0.2
}

export interface PairParts { route: number | null; details: number; city: number; service: number; time: number; meal: number }

export function pairScore(row: SheetRow, m: Movement): { score: number; why: string; parts: PairParts } {
  const route = routeScore(row, m)
  const details = textScore(row.details, m.details)
  const city = cityScore(row, m), service = serviceScore(row, m), time = timeScore(row, m), meal = mealScore(row, m)
  const strong = Math.max(route ?? 0, details)
  const weak = route === null ? details : Math.min(route, details)
  const content = 0.7 * strong + 0.3 * weak
  let score = 0.5 * content + 0.17 * service + 0.17 * time + 0.08 * city + 0.08 * meal
  if (city === 0) score -= 0.15                    // a Hanoi row is not a Saigon movement
  score = Math.max(0, Math.round(score * 100) / 100)
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const why = [
    route !== null ? `route ${pct(route)}` : null,
    `details ${pct(details)}`,
    service === 1 ? 'same service' : service === 0 ? 'service differs' : null,
    time === 1 ? `time ${row.time}` : time === 0 ? `time ${row.time} ≠ ${normTime(m.meetingTime)}` : null,
    city === 0 ? 'different city' : null,
  ].filter(Boolean).join(' · ')
  return { score, why, parts: { route, details, city, service, time, meal } }
}

// ── Rules ────────────────────────────────────────────────────────────────────

const shiftDay = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

function rulesMatch(rows: SheetRow[], movements: Movement[]): { picks: Map<string, Pick>; unsure: Set<string> } {
  const picks = new Map<string, Pick>()
  const unsure = new Set<string>() // movement ids worth asking about
  const takenRows = new Set<string>()
  const byDate = new Map<string, { rows: SheetRow[]; movs: Movement[] }>()
  for (const m of movements) {
    const g = byDate.get(m.date) ?? { rows: [], movs: [] }
    g.movs.push(m); byDate.set(m.date, g)
  }
  for (const r of rows) {
    if (!r.date) continue
    const g = byDate.get(r.date)
    if (g) g.rows.push(r)
  }

  for (const [, g] of Array.from(byDate)) {
    if (!g.rows.length) continue
    const pairs: { r: SheetRow; m: Movement; score: number; why: string; parts: PairParts }[] = []
    for (const r of g.rows) for (const m of g.movs) pairs.push({ r, m, ...pairScore(r, m) })
    pairs.sort((a, b) => b.score - a.score)
    const bestOfRow = new Map<string, number[]>()
    const bestOfMov = new Map<string, number[]>()
    for (const p of pairs) {
      bestOfRow.set(p.r.id, [...(bestOfRow.get(p.r.id) ?? []), p.score])
      bestOfMov.set(p.m.id, [...(bestOfMov.get(p.m.id) ?? []), p.score])
    }
    const solo = g.rows.length === 1 && g.movs.length === 1
    for (const p of pairs) {
      if (picks.has(p.m.id) || takenRows.has(p.r.id) || p.score < MIN_SCORE) continue
      const rowNext = (bestOfRow.get(p.r.id) ?? [])[1] ?? 0
      const movNext = (bestOfMov.get(p.m.id) ?? [])[1] ?? 0
      const margin = p.score - Math.max(rowNext, movNext)
      const x = p.parts
      // Same route (both ends), same or blank time, not another service — the same trip, even with different wording.
      const sameTrip = (x.route ?? 0) >= 0.85 && x.time >= 0.5 && x.service > 0 && x.city !== 0
      const high = (p.score >= HIGH_SCORE && margin >= HIGH_MARGIN)
        || (p.score >= 0.9 && margin >= 0.05)
        || (sameTrip && margin >= 0.1)
        || (solo && p.score >= 0.45 && x.service > 0 && x.city !== 0)
      picks.set(p.m.id, {
        rowId: p.r.id, score: p.score, confidence: high ? 'HIGH' : 'MEDIUM', method: 'RULES',
        reason: `${solo ? 'Only row and only movement that day · ' : ''}${p.why}${high ? '' : ` · close call (next ${Math.round(Math.max(rowNext, movNext) * 100)}%)`}`,
      })
      takenRows.add(p.r.id)
      if (!high) unsure.add(p.m.id)
    }
    // Same day, rows left over and movements left over: ask.
    if (g.rows.some(r => !takenRows.has(r.id))) for (const m of g.movs) if (!picks.has(m.id)) unsure.add(m.id)
  }

  // A row a day off (the desk moved a pickup past midnight, or the chart did) — never HIGH on rules.
  for (const r of rows) {
    if (takenRows.has(r.id) || !r.date) continue
    let best: { m: Movement; score: number; why: string; parts: PairParts } | null = null
    for (const d of [-1, 1]) {
      for (const m of byDate.get(shiftDay(r.date, d))?.movs ?? []) {
        if (picks.has(m.id)) continue
        const s = pairScore(r, m)
        if (s.score >= 0.75 && (!best || s.score > best.score)) best = { m, ...s }
      }
    }
    if (best) {
      picks.set(best.m.id, { rowId: r.id, score: best.score, confidence: 'MEDIUM', method: 'RULES', reason: `Sheet date ${r.date} is a day off the movement · ${best.why}` })
      takenRows.add(r.id)
      unsure.add(best.m.id)
    }
  }
  return { picks, unsure }
}

// ── AI ───────────────────────────────────────────────────────────────────────

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null)

async function askAi(bookingRef: string, rows: SheetRow[], movements: Movement[]): Promise<{ row: string; movement: string | null; confidence: number; why: string }[]> {
  const rowList = rows.map((r, i) => ({
    row: `R${i + 1}`, date: r.date, city: r.location, from: clip(r.from, 120), to: clip(r.to, 120),
    details: clip(r.details, 260), time: r.time, service: r.service, meal: r.meal,
  }))
  const movList = movements.map((m, i) => ({
    movement: `M${i + 1}`, date: m.date, city: m.location, from: clip(m.fromPoint, 120), to: clip(m.toPoint, 120), details: clip(m.details, 260),
    time: m.meetingTime, service: serviceTypeLabel(m.serviceType), meal: m.mealPlan,
  }))
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You match rows of a Vietnam tour operations sheet to the movements of the same booking in the booking system. '
          + 'A row and a movement are the same service when they describe the same trip on the same day (sometimes a day apart). '
          + 'Weigh, in order: the route (from / to — an airport, a hotel, a tour stop; addresses may be written differently), the details text, '
          + 'the meeting time, the service type, the city and the meal plan. Each movement takes at most one row and each row at most one movement. '
          + 'If no movement fits a row, give null. Never guess: confidence 0.9+ only when it is clearly the same service. '
          + 'Answer JSON: {"matches":[{"row":"R1","movement":"M2"|null,"confidence":0.0-1.0,"why":"short reason"}]}',
      },
      { role: 'user', content: JSON.stringify({ booking: bookingRef, rows: rowList, movements: movList }) },
    ],
  })
  await logAiUsage({ callType: 'vn_driver_sync_match', model: 'gpt-4o-mini', usage: res.usage, bookingRef, source: 'vn-driver-sync' })
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { matches?: { row?: string; movement?: string | null; confidence?: number; why?: string }[] }
  const rowById = new Map(rowList.map((r, i) => [r.row, rows[i].id]))
  const movById = new Map(movList.map((m, i) => [m.movement, movements[i].id]))
  return (parsed.matches ?? [])
    .filter(x => x.row && rowById.has(x.row))
    .map(x => ({
      row: rowById.get(x.row!)!,
      movement: x.movement && movById.has(x.movement) ? movById.get(x.movement)! : null,
      confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
      why: String(x.why ?? '').slice(0, 200),
    }))
}

// ── One booking ──────────────────────────────────────────────────────────────

/**
 * Match one booking's sheet rows to its movements. `rows` should be every row
 * of the booking (with or without a number); only rows WITH a number are
 * reported as unmatched, since only those would ever be written.
 */
export async function matchBooking(opts: {
  bookingRef: string
  rows: SheetRow[]
  movements: Movement[]
  useAi: boolean
  /** The AI answer from the last run for this booking, if any. */
  cached: AiCacheEntry | null
  /** Shared budget across the run; decremented on each real call. */
  budget: { left: number }
}): Promise<BookingMatch> {
  const { rows, movements } = opts
  const { picks, unsure } = rulesMatch(rows, movements)
  let aiCalled = false
  let ai: AiCacheEntry | null = null

  // Only worth asking when an unsure movement could end up with a row that has a number.
  const askMovs = movements.filter(m => unsure.has(m.id))
  const dates = new Set(askMovs.flatMap(m => [m.date, shiftDay(m.date, -1), shiftDay(m.date, 1)]))
  const askRows = rows.filter(r => r.date && dates.has(r.date))
  const worth = askMovs.length > 0 && askRows.some(r => r.phones.length > 0)

  if (opts.useAi && worth) {
    const hash = createHash('sha256').update(JSON.stringify({
      v: 2,
      r: askRows.map(r => [r.date, r.location, r.from, r.to, r.details, r.time, r.service, r.meal]),
      m: askMovs.map(m => [m.id, m.date, m.location, m.fromPoint, m.toPoint, m.details, m.meetingTime, m.serviceType, m.mealPlan]),
    })).digest('hex').slice(0, 32)
    let answer: Awaited<ReturnType<typeof askAi>> | null = null
    if (opts.cached?.hash === hash) {
      try { answer = JSON.parse(opts.cached.json) } catch { answer = null }
      ai = opts.cached
    }
    if (!answer && opts.budget.left > 0) {
      opts.budget.left--
      try {
        answer = await askAi(opts.bookingRef, askRows, askMovs)
        aiCalled = true
        ai = { hash, json: JSON.stringify(answer) }
      } catch (err) {
        console.warn(`[VN Driver Sync] AI match skipped for ${opts.bookingRef}:`, err instanceof Error ? err.message : err)
      }
    }

    if (answer) {
      const rowById = new Map(rows.map(r => [r.id, r]))
      const movById = new Map(movements.map(m => [m.id, m]))
      for (const a of answer) {
        if (!a.movement) continue
        const r = rowById.get(a.row), m = movById.get(a.movement)
        if (!r || !m || !unsure.has(m.id)) continue
        const { score, why } = pairScore(r, m)
        if (score < MIN_SCORE) continue
        // The row may already sit on another unsure movement — move it.
        for (const [mid, p] of Array.from(picks)) if (p.rowId === r.id && mid !== m.id && unsure.has(mid)) picks.delete(mid)
        // Never steal a row the rules were sure about.
        if (Array.from(picks.entries()).some(([mid, p]) => p.rowId === r.id && mid !== m.id)) continue
        const sure = a.confidence >= 0.85 && score >= MIN_SCORE && (r.date === m.date || a.confidence >= 0.92)
        picks.set(m.id, {
          rowId: r.id, score: Math.max(score, Math.round(a.confidence * 100) / 100),
          confidence: sure ? 'HIGH' : 'MEDIUM', method: 'AI',
          reason: `AI ${Math.round(a.confidence * 100)}%: ${a.why || 'same service'} · rules ${why}`,
        })
      }
    }
  }

  const taken = new Set(Array.from(picks.values()).map(p => p.rowId))
  const movDates = new Set(movements.map(m => m.date))
  const unmatched = rows
    .filter(r => r.phones.length && !taken.has(r.id))
    .map(r => ({
      row: r,
      why: !r.date ? 'No date on the sheet row'
        : !movDates.has(r.date) ? `No movement on ${r.date} in the system chart`
          : 'No movement that day looks like this row',
    }))
  return { picks, unmatched, aiCalled, ai }
}
