/**
 * The bad-experience gate.
 *
 * A report only reaches the agent when the trip went well. This grades the
 * dossier, and anything at or above the configured level is held back and sent
 * to the escalation inbox instead — with the hold stated plainly, so nobody
 * mistakes a held report for one the agent has already seen.
 *
 * Scoring is deliberately transparent rather than clever: every signal carries
 * a fixed weight and is shown to the reviewer, because the person deciding
 * whether to release the mail needs to see exactly what tripped it.
 */
import type { RiskAssessment, RiskLevel, RiskSignal, TripDossier } from './types'

/** Score thresholds. Tuned so a single explicit complaint is enough to hold. */
const LEVEL_AT: Record<Exclude<RiskLevel, 'none'>, number> = {
  low: 1,
  medium: 4,
  high: 8,
}

const LEVEL_ORDER: RiskLevel[] = ['none', 'low', 'medium', 'high']

/**
 * Phrases that mean the guest was unhappy, not merely factual. Matched on the
 * free-text fields only — the structured ratings are handled separately.
 */
const COMPLAINT_PATTERNS: { re: RegExp; label: string; weight: number }[] = [
  { re: /\b(complain|complaint|complained)\b/i,                 label: 'Explicit complaint',        weight: 4 },
  { re: /\b(refund|compensat|reimburs)\w*/i,                    label: 'Money back requested',      weight: 6 },
  { re: /\b(unacceptable|appalling|terrible|awful|horrible)\b/i, label: 'Strong negative wording',   weight: 5 },
  { re: /\b(dirty|filthy|unhygienic|smell(?:y|ed)?|bed ?bugs?|cockroach)\w*/i, label: 'Cleanliness problem', weight: 4 },
  { re: /\b(rude|unprofessional|shouted|argued|drunk)\b/i,      label: 'Staff conduct',             weight: 5 },
  { re: /\b(unsafe|accident|injur\w*|hospital|police|theft|stolen|robbed)\b/i, label: 'Safety incident',   weight: 8 },
  { re: /\b(cancel(?:led)?|no ?show|did ?n[o']?t (?:arrive|come|show)|stranded)\b/i, label: 'Service failure', weight: 4 },
  { re: /\b(disappoint\w*|unhappy|upset|frustrat\w*|angry)\b/i, label: 'Guest dissatisfaction',      weight: 3 },
  { re: /\b(broke ?down|breakdown|no (?:ac|a\/c|air ?con)|not working)\b/i, label: 'Equipment failure', weight: 3 },
  { re: /\b(over ?charg\w*|extra (?:charge|payment)|scam)\w*/i, label: 'Billing dispute',            weight: 4 },
]

const BAD_VALUES = new Set(['bad', 'poor'])
const WEAK_VALUES = new Set(['average'])

function ratingSignal(
  value: string | null | undefined,
  what: string,
  channel: RiskSignal['channel'],
  dayNo: number | null = null,
): RiskSignal | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (BAD_VALUES.has(v)) {
    return {
      code: 'poor_rating',
      label: `${what} rated poorly`,
      detail: dayNo ? `${what} was marked "${value}" on day ${dayNo}.` : `${what} was marked "${value}".`,
      weight: 4,
      channel,
      dayNo,
    }
  }
  if (WEAK_VALUES.has(v)) {
    return {
      code: 'weak_rating',
      label: `${what} only average`,
      detail: dayNo ? `${what} was marked "${value}" on day ${dayNo}.` : `${what} was marked "${value}".`,
      weight: 1,
      channel,
      dayNo,
    }
  }
  return null
}

/** First sentence of a free-text field, so the signal detail stays one line. */
function firstSentence(text: string, max = 180) {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const cut = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut
}

function scanText(
  text: string | null | undefined,
  channel: RiskSignal['channel'],
  where: string,
  dayNo: number | null = null,
): RiskSignal[] {
  if (!text?.trim()) return []
  const out: RiskSignal[] = []
  for (const { re, label, weight } of COMPLAINT_PATTERNS) {
    if (re.test(text)) {
      out.push({
        code: 'complaint_language',
        label,
        detail: `${where}: “${firstSentence(text)}”`,
        weight,
        channel,
        dayNo,
      })
    }
  }
  return out
}

export function assessRisk(
  dossier: TripDossier,
  holdAtLevel: Exclude<RiskLevel, 'none'> = 'medium',
): RiskAssessment {
  const signals: RiskSignal[] = []

  // ── AI voice calls ─────────────────────────────────────────────────────────
  for (const call of dossier.calls) {
    const day = call.dayNo ?? null
    const sentiment = call.sentiment?.toLowerCase() ?? ''

    if (['negative', 'sad', 'angry', 'upset'].includes(sentiment)) {
      signals.push({
        code: 'negative_sentiment',
        label: 'Negative call sentiment',
        detail: day ? `The day ${day} call was scored "${call.sentiment}".` : `A call was scored "${call.sentiment}".`,
        weight: 5,
        channel: 'ai_call',
        dayNo: day,
      })
    }

    // An `issues` value at all means the bot heard something worth logging.
    if (call.issues?.trim()) {
      signals.push({
        code: 'issue_logged',
        label: 'Issue logged on call',
        detail: day ? `Day ${day}: “${firstSentence(call.issues)}”` : `“${firstSentence(call.issues)}”`,
        weight: 4,
        channel: 'ai_call',
        dayNo: day,
      })
    }

    for (const [value, what] of [
      [call.hotelOk, 'Hotel'], [call.mealsOk, 'Meals'],
      [call.driverOk, 'Driver'], [call.vehicleOk, 'Vehicle'],
    ] as const) {
      const s = ratingSignal(value, what, 'ai_call', day)
      if (s) signals.push(s)
    }

    signals.push(...scanText(call.issues, 'ai_call', day ? `Day ${day} issue` : 'Call issue', day))
    signals.push(...scanText(call.summary, 'ai_call', day ? `Day ${day} call` : 'Call summary', day))
  }

  // ── Guest feedback form ────────────────────────────────────────────────────
  const form = dossier.form
  if (form) {
    for (const [value, what] of [
      [form.overallExperience, 'Overall experience'],
      [form.accommodationRoom, 'Room'],
      [form.accommodationFood, 'Hotel food'],
      [form.restaurantFood, 'Restaurant food'],
      [form.restaurantAmbience, 'Restaurant ambience'],
      [form.transportVehicle, 'Vehicle'],
      [form.transportDriver, 'Driver'],
    ] as const) {
      const s = ratingSignal(value, what, 'guest_form')
      if (s) signals.push(s)
    }
    // A poor overall score is the guest's own verdict on the whole trip, so it
    // outranks any single service line.
    if (form.overallExperience && BAD_VALUES.has(form.overallExperience.toLowerCase())) {
      signals.push({
        code: 'poor_overall',
        label: 'Guest rated the trip poorly overall',
        detail: `The submitted feedback form scores the overall experience "${form.overallExperience}".`,
        weight: 6,
        channel: 'guest_form',
      })
    }
    signals.push(...scanText(form.remarks, 'guest_form', 'Feedback form remarks'))
  }

  // ── Desk notes ─────────────────────────────────────────────────────────────
  for (const note of dossier.deskNotes) {
    if (note.rating != null && note.rating <= 2) {
      signals.push({
        code: 'low_desk_rating',
        label: 'Low rating recorded by the desk',
        detail: `Saved as ${note.rating}/5${note.savedBy ? ` by ${note.savedBy}` : ''}.`,
        weight: 5,
        channel: 'desk_note',
      })
    }
    signals.push(...scanText(note.comment, 'desk_note', 'Desk note'))
  }

  // ── Collapse duplicates ────────────────────────────────────────────────────
  // The same complaint often shows up in both `issues` and `summary`; count the
  // strongest instance once per code+day so one grumble cannot score twice.
  const strongest = new Map<string, RiskSignal>()
  for (const s of signals) {
    const key = `${s.code}|${s.label}|${s.dayNo ?? '-'}`
    const prev = strongest.get(key)
    if (!prev || s.weight > prev.weight) strongest.set(key, s)
  }
  const deduped = Array.from(strongest.values()).sort((a, b) => b.weight - a.weight)

  const score = deduped.reduce((n, s) => n + s.weight, 0)
  const level: RiskLevel =
    score >= LEVEL_AT.high ? 'high'
    : score >= LEVEL_AT.medium ? 'medium'
    : score >= LEVEL_AT.low ? 'low'
    : 'none'

  const shouldHold = LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(holdAtLevel)

  const top = deduped.slice(0, 2).map(s => s.label.toLowerCase())
  const reason = shouldHold
    ? `Held before sending — ${top.join(' and ')}${deduped.length > 2 ? ` (+${deduped.length - 2} more)` : ''}.`
    : null

  return { level, score, signals: deduped, shouldHold, reason }
}

export const RISK_LEVEL_ORDER = LEVEL_ORDER
