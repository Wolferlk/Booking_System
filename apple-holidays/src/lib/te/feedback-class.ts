/**
 * Sorting AI-call feedback into the three buckets ops works from:
 *   • good    — the customer is happy and nothing needs doing
 *   • warning — no real complaint, but something to check or act on
 *   • bad     — the customer is unhappy or something went wrong
 * plus `none` for calls that never reached the customer.
 *
 * The voice service's end-of-call AI writes its own verdict into the row's `raw`
 * JSON (`feedback_class` + `feedback_reason`). Calls made before that existed
 * have no verdict, so the same structured fields the call already stored —
 * sentiment, outcome, ratings, yes/no checks and the alerts it raised — decide
 * instead. Hard evidence (a high-severity complaint, a rating of 4 or less, not
 * home safely, an area rated "bad") always wins over a gentler AI verdict.
 *
 * Pure and dependency-free so the API route and the client components share it.
 */

export type FeedbackClass = 'good' | 'warning' | 'bad' | 'none'
export type CallKind = 'on_tour' | 'reconfirm' | 'post_tour'

export const FEEDBACK_CLASSES: Exclude<FeedbackClass, 'none'>[] = ['bad', 'warning', 'good']

export const FEEDBACK_CLASS_META: Record<FeedbackClass, { label: string; emoji: string; chip: string; darkChip: string; solid: string }> = {
  good:    { label: 'Good',        emoji: '✅', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', darkChip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', solid: 'bg-emerald-500' },
  warning: { label: 'Warning',     emoji: '⚠️', chip: 'bg-amber-50 text-amber-700 border-amber-200',       darkChip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       solid: 'bg-amber-500' },
  bad:     { label: 'Bad',         emoji: '⛔', chip: 'bg-red-50 text-red-600 border-red-200',             darkChip: 'bg-red-500/15 text-red-300 border-red-500/30',             solid: 'bg-red-500' },
  none:    { label: 'No feedback', emoji: '—',  chip: 'bg-slate-50 text-slate-500 border-slate-200',       darkChip: 'bg-slate-700/40 text-slate-400 border-slate-600/40',       solid: 'bg-slate-500' },
}

export interface FeedbackAlert {
  severity: string | null
  category: string | null
  status: string | null
  title: string | null
}

export interface FeedbackInput {
  kind: CallKind
  sentiment: string | null
  /** Column outcome (reconfirm / post-tour) — on-tour keeps it in `raw.outcome`. */
  outcome: string | null
  rating: number | null
  detail: Record<string, unknown>
  raw: unknown
  transcriptTurns: number
  alerts: FeedbackAlert[]
}

export interface FeedbackVerdict {
  cls: FeedbackClass
  reason: string
  /** `ai` = the voice service's verdict; `rules` = derived here. */
  source: 'ai' | 'rules'
}

const RANK: Record<FeedbackClass, number> = { none: 0, good: 1, warning: 2, bad: 3 }

const BAD_SENTIMENTS = new Set(['unhappy', 'negative', 'angry'])
const MIXED_SENTIMENTS = new Set(['mixed'])
const NOT_REACHED = new Set(['not_reached', 'no_answer', 'voicemail', 'declined', 'failed'])
const AREA_LABEL: Record<string, string> = { hotel_ok: 'hotel', meals_ok: 'meals', driver_ok: 'driver', vehicle_ok: 'vehicle' }
const RECONFIRM_LABEL: Record<string, string> = { dates_ok: 'dates', flight_ok: 'flights', pax_ok: 'passengers', contact_ok: 'contact details' }

function rawObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {} } catch { return {} }
  }
  return {}
}

function isNo(v: unknown) { return v === 0 || v === false || v === 'no' || v === '0' }
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.toLowerCase() !== 'none' ? s : null
}

/** What the stored fields say on their own; `hard` marks evidence an AI verdict may not soften. */
function fromRules(f: FeedbackInput, outcome: string | null): FeedbackVerdict & { hard: boolean } {
  const d = f.detail
  // A resolved alert still counts: it says how the call went, not what is left to do.
  const complaints = f.alerts.filter(a => a.category !== 'change_request')
  const verdict = (cls: FeedbackClass, reason: string, hard = false) => ({ cls, reason, source: 'rules' as const, hard })

  // ── bad: hard evidence ──
  if (f.rating != null && f.rating <= 4) return verdict('bad', `Post-tour rating ${f.rating}/10`, true)
  if (isNo(d.reached_home_safely)) return verdict('bad', 'Customer did not get home safely', true)
  const badAreas = Object.keys(AREA_LABEL).filter(k => d[k] === 'bad').map(k => AREA_LABEL[k])
  if (badAreas.length) return verdict('bad', `Unhappy with ${badAreas.join(', ')}`, true)
  const high = complaints.find(a => a.severity === 'high')
  if (high) return verdict('bad', high.title || 'High-severity complaint raised on the call', true)

  // ── bad: softer signals ──
  if (f.sentiment && BAD_SENTIMENTS.has(f.sentiment)) return verdict('bad', text(d.issues) || 'Customer sounded unhappy')
  if (outcome === 'issue_raised') return verdict('bad', text(d.issues) || 'Customer raised an issue')
  if (isNo(d.would_recommend)) return verdict('bad', 'Would not recommend us')

  // No conversation to judge — keep it out of the three buckets.
  const spoke = f.transcriptTurns > 0 || !!f.sentiment || f.rating != null
  if (!spoke && (!outcome || NOT_REACHED.has(outcome))) return verdict('none', outcome ? `Call outcome: ${outcome.replace(/_/g, ' ')}` : 'No feedback captured')

  // ── warning ──
  if (complaints.length) return verdict('warning', complaints[0].title || 'Complaint raised on the call')
  const change = text(d.requested_change)
  if (change || outcome === 'changes_requested' || f.alerts.some(a => a.category === 'change_request')) {
    return verdict('warning', change ? `Change requested: ${change}` : 'Change requested')
  }
  const mismatched = Object.keys(RECONFIRM_LABEL).filter(k => isNo(d[k])).map(k => RECONFIRM_LABEL[k])
  if (mismatched.length) return verdict('warning', `Did not match: ${mismatched.join(', ')}`)
  if (f.rating != null && f.rating <= 7) return verdict('warning', `Post-tour rating ${f.rating}/10`)
  const issues = text(d.issues) || text(d.improvements)
  if (issues) return verdict('warning', issues)
  if (outcome === 'minor_note' || (f.sentiment && MIXED_SENTIMENTS.has(f.sentiment))) return verdict('warning', 'Mixed reaction from the customer')
  if (!spoke) return verdict('none', 'No feedback captured')

  return verdict('good', f.rating != null ? `Post-tour rating ${f.rating}/10` : f.kind === 'reconfirm' ? 'Booking details confirmed' : 'Customer is happy')
}

export function classifyFeedback(f: FeedbackInput): FeedbackVerdict {
  const raw = rawObj(f.raw)
  const outcome = f.outcome || (typeof raw.outcome === 'string' ? raw.outcome : null)
  const rules = fromRules(f, outcome)

  const aiCls = typeof raw.feedback_class === 'string' ? raw.feedback_class.toLowerCase() : ''
  if (aiCls === 'good' || aiCls === 'warning' || aiCls === 'bad') {
    // Hard evidence outranks a gentler AI verdict; otherwise the AI read the whole call.
    if (rules.hard && RANK[rules.cls] > RANK[aiCls]) return { cls: rules.cls, reason: rules.reason, source: 'rules' }
    const reason = text(raw.feedback_reason) || (rules.cls === aiCls ? rules.reason : `Marked ${aiCls} by the call's AI review`)
    return { cls: aiCls, reason, source: 'ai' }
  }
  return { cls: rules.cls, reason: rules.reason, source: 'rules' }
}
