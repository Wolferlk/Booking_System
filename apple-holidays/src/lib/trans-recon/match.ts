/**
 * Which P&L line pays for this movement?
 *
 * Agenda items and P&L lines are written by different people from different
 * documents and carry no link to each other, so the pairing is a judgement.
 * It is made here once, shown to the desk with its confidence, and can always
 * be overruled from the line's P&L picker — a pick by hand is never re-guessed.
 *
 * Signals, strongest first:
 *  • words the two descriptions share, after synonyms ("KLIA" = airport,
 *    "H/D" = half day, "PVT" = private) and with filler words dropped;
 *  • the P&L category — TRANSPORT pays for movements, HOTEL never does;
 *  • a day number in the P&L text ("Day 3") that agrees with the movement's day;
 *  • arrival / departure wording on the airport legs.
 *
 * Assignment is greedy on the best score, one movement per P&L line first;
 * movements left over may then share a line that clearly covers them
 * ("Private transfers as per itinerary"). Pure — no database.
 */

export interface MatchMovement {
  key: string
  date: string            // YYYY-MM-DD
  dayNumber: number | null
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  location: string | null
  serviceType: string | null
}

export interface MatchPnlLine {
  id: string
  activity: string
  category: string
}

export interface MatchResult { pnlLineId: string; score: number }

const NEVER = new Set(['HOTEL', 'FLIGHT_TICKETS', 'TAX_FEES'])
const MIN_SCORE = 0.16
const SHARE_SCORE = 0.3

const SYNONYMS: [RegExp, string][] = [
  [/\bklia\s*2?\b|\bkul\b|\bchangi\b|\bsin\b(?= airport)|\bapt\b|\bairport\b|\bcmb\b|\bbia\b|\bsgn\b|\bhan\b|\bdad\b|\bpqc\b/g, ' airport '],
  [/\bh\s*\/\s*d\b|\bhalf[\s-]*day\b/g, ' halfday '],
  [/\bf\s*\/\s*d\b|\bfull[\s-]*day\b/g, ' fullday '],
  [/\bpvt\b|\bprivate\b/g, ' private '],
  [/\bsic\b|\bseat[\s-]*in[\s-]*coach\b|\bshared\b/g, ' sic '],
  [/\barr(?:ival)?\b|\barrive\b|\bpick\s*up\b|\bpickup\b|\beta\b/g, ' arrival '],
  [/\bdep(?:arture)?\b|\bdepart\b|\bdrop\s*off\b|\bdropoff\b|\betd\b/g, ' departure '],
  [/\btrf\b|\btransfers?\b|\btransport(?:ation)?\b/g, ' transfer '],
  [/\bkl\b/g, ' kuala lumpur '],
  [/\bcity\s*tour\b|\bsightseeing\b|\borientation\b/g, ' citytour '],
  [/\bcable\s*car\b/g, ' cablecar '],
  [/\btwin\s*towers?\b|\bpetronas\b|\bklcc\b/g, ' petronas '],
]

const STOP = new Set([
  'the', 'and', 'to', 'from', 'with', 'in', 'at', 'of', 'for', 'on', 'by', 'a', 'an', 'via', 'hrs', 'hr', 'hours',
  'hour', 'mins', 'min', 'stop', 'photo', 'day', 'tour', 'trip', 'visit', 'hotel', 'resort', 'inn', 'suites', 'per',
  'pax', 'person', 'vehicle', 'car', 'van', 'enroute', 'en', 'route', 'then', 'back', 'return', 'including',
  'includes', 'include', 'entrance', 'ticket', 'tickets', 'flight', 'as', 'itinerary', 'service', 'services',
  'guest', 'guests', 'one', 'two', 'way', 'only', 'basis', 'adult', 'child', 'drop', 'pick',
])

function tokens(text: string): Set<string> {
  let s = ` ${text.toLowerCase()} `
  for (const [re, rep] of SYNONYMS) s = s.replace(re, rep)
  s = s.replace(/[^a-z0-9 ]+/g, ' ')
  const out = new Set<string>()
  for (const w of s.split(/\s+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w.length > 4 ? w.replace(/(ies|es|s)$/, '') : w)
  }
  return out
}

function dayInText(text: string): number | null {
  const m = text.match(/\bday\s*0?(\d{1,2})\b/i) ?? text.match(/\bd\s*0?(\d{1,2})\b/i)
  return m ? Number(m[1]) : null
}

const isAirportLeg = (s: string | null) => /airport|klia|changi|\bapt\b|terminal/i.test(s ?? '')

export function scorePair(m: MatchMovement, p: MatchPnlLine): number {
  if (NEVER.has(p.category)) return 0
  const mText = [m.details, m.fromPoint, m.toPoint, m.location].filter(Boolean).join(' ')
  const a = tokens(mText)
  const b = tokens(p.activity)
  if (!b.size) return 0

  let shared = 0
  b.forEach(w => { if (a.has(w)) shared++ })
  // Overlap against the shorter side: a P&L line is usually terse ("Airport
  // transfer"), and a long movement description should not dilute it.
  let score = shared / Math.max(1, Math.min(a.size || 1, b.size))

  if (p.category === 'TRANSPORT') score += 0.18
  else if (p.category === 'OTHER') score += 0.04

  const pDay = dayInText(p.activity)
  if (pDay != null && m.dayNumber != null) score += pDay === m.dayNumber ? 0.3 : -0.2

  const airportMove = isAirportLeg(m.fromPoint) || isAirportLeg(m.toPoint)
  if (airportMove && b.has('airport')) score += 0.2
  if (isAirportLeg(m.fromPoint) && b.has('arrival')) score += 0.12
  if (isAirportLeg(m.toPoint) && b.has('departure')) score += 0.12
  if (!airportMove && b.has('airport') && !b.has('citytour')) score -= 0.15

  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000))
}

/** Best P&L line per movement key; a movement with no convincing line is left out. */
export function matchMovements(movements: MatchMovement[], pnl: MatchPnlLine[]): Map<string, MatchResult> {
  const out = new Map<string, MatchResult>()
  if (!movements.length || !pnl.length) return out

  const pairs: { m: string; p: string; s: number }[] = []
  for (const m of movements) for (const p of pnl) {
    const s = scorePair(m, p)
    if (s >= MIN_SCORE) pairs.push({ m: m.key, p: p.id, s })
  }
  pairs.sort((x, y) => y.s - x.s)

  const usedP = new Set<string>()
  for (const { m, p, s } of pairs) {
    if (out.has(m) || usedP.has(p)) continue
    out.set(m, { pnlLineId: p, score: s }); usedP.add(p)
  }
  // Second pass: movements still unpaired may share an already-used line when
  // the fit is clearly good (a single P&L line for all the transfers).
  for (const { m, p, s } of pairs) {
    if (out.has(m) || s < SHARE_SCORE) continue
    out.set(m, { pnlLineId: p, score: s })
  }
  return out
}
