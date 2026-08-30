/**
 * The Feedbacks module — one shared vocabulary for the 360° view of everything
 * a guest ever told us about a booking.
 *
 * Six channels feed a dossier, and they live in six different places:
 *
 *   • `tbl_te_reconfirmation`   → pre-tour reconfirmation call (AI voice)
 *   • `tbl_te_feedback`         → on-ground daily check-in calls (AI voice)
 *   • `tbl_te_post_tour`        → post-tour feedback call (AI voice)
 *   • `guest_feedback_forms`    → the form the guest fills in themselves
 *   • `customer_feedback`       → the rating the desk saved by hand
 *   • `tbl_te_important_alerts` → complaints and urgent asks raised on a call
 *
 * Plus the paper trail around them: `contact_logs` (who called/mailed the guest)
 * and `te_experience_reports` (what we mailed the agent afterwards).
 *
 * Nothing in this module writes. Every query is a read, by design — the module
 * is a lens over live operational data and must never be able to disturb it.
 */

export type CallKind = 'reconfirm' | 'on_ground' | 'post_tour'

export const CALL_KIND_LABEL: Record<CallKind, string> = {
  reconfirm: 'Reconfirmation call',
  on_ground: 'On-ground call',
  post_tour: 'Post-tour call',
}

/** Normalised sentiment — the upstream vocabulary drifts, this does not. */
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown'

/** A yes/no/unclear answer to a structured call check ("was the hotel ok?"). */
export type CheckAnswer = 'good' | 'bad' | 'unclear'

export interface TranscriptLine {
  speaker: 'agent' | 'customer' | 'system'
  text: string
}

/** One structured check inside a call, ready to draw as a chip. */
export interface CallCheck {
  label: string
  raw: string
  answer: CheckAnswer
}

/** One AI voice call, whichever of the three tables it came from. */
export interface CallRecord {
  uid: string
  kind: CallKind
  id: number
  serviceId: number | null
  scheduleId: number | null
  bookingRef: string
  dayNo: number | null
  /** The call date when the table has one, else the row's created_at. */
  at: string | null
  createdAt: string | null
  sentiment: Sentiment
  rawSentiment: string | null
  outcome: string | null
  /** Post-tour only, 0–10 as stored. */
  rating: number | null
  summary: string | null
  /** Free-text fields, already labelled for display. */
  notes: { label: string; text: string }[]
  checks: CallCheck[]
  conversationId: string | null
  transcript: TranscriptLine[]
  /** True once the call actually told us something (not a bare placeholder). */
  hasSubstance: boolean
}

/** A scheduled call, whether or not it ever happened. */
export interface ScheduledCall {
  id: number
  dayNo: number | null
  callDate: string | null
  scheduledAt: string | null
  phase: string | null
  status: string
  attempts: number
  error: string | null
  dayBrief: string | null
}

export interface FormAnswer {
  label: string
  value: string | null
  /** 1 (POOR) … 4 (EXCELLENT), null when unanswered. */
  score: number | null
}

export interface FeedbackFormRecord {
  id: string
  submittedAt: string
  clientName: string | null
  purpose: string | null
  answers: FormAnswer[]
  remarks: string | null
  /** Mean of the answered questions, 0–100. */
  scorePct: number | null
}

export interface DeskNoteRecord {
  id: string
  rating: number | null
  comment: string | null
  savedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ComplaintRecord {
  id: number
  bookingRef: string | null
  customerName: string | null
  callKind: string | null
  category: string | null
  severity: 'high' | 'medium' | 'low'
  status: string
  isOpen: boolean
  title: string | null
  details: string | null
  customerQuote: string | null
  sentiment: Sentiment
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  conversationId: string | null
}

export interface ContactLogRecord {
  id: string
  type: string
  subject: string
  notes: string | null
  contactedAt: string
  by: string | null
}

export interface ExperienceReportRecord {
  id: string
  status: string
  riskLevel: string
  riskScore: number
  holdReason: string | null
  subject: string | null
  toEmail: string | null
  sentAt: string | null
  sentBy: string | null
  createdAt: string
}

/** Trip facts, copied at read time so a dossier reads on its own. */
export interface BookingFacts {
  id: string
  bookingRef: string
  isNumber: string | null
  dealName: string | null
  status: string
  operationCountry: string | null
  tourDestination: string | null
  agent: string | null
  agentEmail: string | null
  fileHandler: string | null
  contactEmail: string | null
  contactPhone: string | null
  clientName: string | null
  leadPassenger: string | null
  passengers: { name: string; type: string; isLead: boolean }[]
  pax: { adults: number; children: number; infants: number; total: number }
  arrivalDate: string | null
  departureDate: string | null
  nights: number | null
  specialOccasions: string | null
  languagePreference: string | null
  /** From `tbl_te_service` — the AI call registration, when there is one. */
  callService: {
    id: number
    status: string
    callPhone: string | null
    callTime: string | null
    reconfirmEnabled: boolean
    postTourEnabled: boolean
    registeredAt: string | null
  } | null
}

export type HealthBand = 'excellent' | 'good' | 'watch' | 'at_risk' | 'unknown'

export const HEALTH_LABEL: Record<HealthBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  watch: 'Needs watching',
  at_risk: 'At risk',
  unknown: 'No feedback yet',
}

/** One named input to the experience score, kept so the number can be explained. */
export interface ScoreComponent {
  key: string
  label: string
  /** 0–100. */
  value: number
  weight: number
  detail: string
}

export interface ExperienceScore {
  /** 0–100, or null when no channel produced anything. */
  value: number | null
  band: HealthBand
  components: ScoreComponent[]
  /** Points deducted for open complaints. */
  complaintPenalty: number
  /** Short human sentences explaining the band. */
  reasons: string[]
}

export interface ChannelCoverage {
  reconfirmCall: boolean
  onGroundCall: boolean
  postTourCall: boolean
  guestForm: boolean
  deskNote: boolean
  complaints: boolean
  /** How many of the six channels produced something. */
  count: number
}

export interface DossierStats {
  callsScheduled: number
  callsCompleted: number
  callsMissed: number
  callsPending: number
  callsLogged: number
  byKind: Record<CallKind, number>
  sentiment: { positive: number; neutral: number; negative: number; unknown: number }
  transcriptTurns: number
  goodChecks: number
  badChecks: number
  complaintsOpen: number
  complaintsTotal: number
  complaintsHigh: number
  /** Post-tour 0–10 rating, when one exists. */
  npsRating: number | null
  wouldRecommend: boolean | null
  reachedHomeSafely: boolean | null
}

/** Everything known about one booking's feedback. The unit of both tabs. */
export interface FeedbackDossier {
  facts: BookingFacts
  score: ExperienceScore
  coverage: ChannelCoverage
  stats: DossierStats
  calls: CallRecord[]
  schedule: ScheduledCall[]
  form: FeedbackFormRecord | null
  deskNotes: DeskNoteRecord[]
  complaints: ComplaintRecord[]
  contactLogs: ContactLogRecord[]
  experienceReports: ExperienceReportRecord[]
  itinerary: { dayNo: number; date: string | null; title: string; description: string | null }[]
  /** Newest-first merge of every dated event, for the timeline view. */
  timeline: TimelineEvent[]
  collectedAt: string
  warnings: string[]
}

export type TimelineKind =
  | 'call'
  | 'form'
  | 'desk_note'
  | 'complaint'
  | 'contact_log'
  | 'experience_report'

export interface TimelineEvent {
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
  sentiment: Sentiment
  severity: 'high' | 'medium' | 'low' | null
  /** `uid` of the underlying record, so the UI can scroll to it. */
  ref: string
}

// ─── Batch report ─────────────────────────────────────────────────────────────

export interface BatchTotals {
  requested: number
  found: number
  missing: string[]
  withAnyFeedback: number
  withNoFeedback: number
  avgScore: number | null
  band: Record<HealthBand, number>
  calls: { logged: number; scheduled: number; completed: number; missed: number }
  byKind: Record<CallKind, number>
  sentiment: { positive: number; neutral: number; negative: number; unknown: number }
  forms: number
  deskNotes: number
  complaints: { total: number; open: number; high: number }
  npsAverage: number | null
  promoters: number
  detractors: number
  recommendYes: number
  recommendNo: number
  coverage: { reconfirmCall: number; onGroundCall: number; postTourCall: number; guestForm: number; deskNote: number }
  /** The most common complaint categories across the batch. */
  topComplaintCategories: { category: string; count: number; open: number }[]
  /** Booking refs ranked worst-first — where the team should look. */
  attention: { bookingRef: string; clientName: string | null; score: number | null; band: HealthBand; reason: string }[]
}

export interface BatchReport {
  totals: BatchTotals
  dossiers: FeedbackDossier[]
  generatedAt: string
  warnings: string[]
}
