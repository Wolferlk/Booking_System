/**
 * Shared shapes for the Experience Report Centre.
 *
 * One report = one finished trip. It is built from every feedback channel we
 * have (AI voice calls, the guest feedback form, anything the desk typed in),
 * graded for bad experience, and then either mailed to the agent or held back.
 */

/** draft → (held | queued) → sent | failed | cancelled */
export type ReportStatus = 'draft' | 'queued' | 'held' | 'sent' | 'failed' | 'cancelled'

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

export type TriggerSource = 'auto' | 'manual'

/** Where a piece of feedback came from. */
export type FeedbackChannel = 'ai_call' | 'guest_form' | 'desk_note'

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface TranscriptLine {
  speaker: 'agent' | 'customer' | 'system'
  text: string
}

/** One AI voice call on one day of the trip. */
export interface CallEvidence {
  dayNo: number | null
  date: string | null
  status: string | null
  dayBrief: string | null
  sentiment: string | null
  hotelOk: string | null
  mealsOk: string | null
  driverOk: string | null
  vehicleOk: string | null
  summary: string | null
  highlights: string | null
  issues: string | null
  /** Kept in the dossier for the on-screen viewer — never rendered into the mail. */
  transcript: TranscriptLine[]
}

/** The guest-filled feedback form, when one was submitted. */
export interface FormEvidence {
  submittedAt: string
  clientName: string | null
  purpose: string | null
  accommodationRoom: string | null
  accommodationFood: string | null
  restaurantFood: string | null
  restaurantAmbience: string | null
  transportVehicle: string | null
  transportDriver: string | null
  overallExperience: string | null
  remarks: string | null
}

/** A rating/comment the desk saved against the booking by hand. */
export interface DeskNoteEvidence {
  rating: number | null
  comment: string | null
  savedBy: string | null
  createdAt: string
}

/** One day of the sold itinerary — this is where "visit places" comes from. */
export interface ItineraryStop {
  dayNo: number
  date: string
  title: string
  description: string | null
}

export interface TripFacts {
  bookingRef: string
  agentName: string | null
  agentEmail: string | null
  contactEmail: string | null
  clientName: string | null
  leadPassenger: string | null
  passengers: string[]
  pax: { adults: number; children: number; infants: number }
  arrivalDate: string | null
  departureDate: string | null
  nights: number | null
  destination: string | null
  country: string | null
  specialOccasions: string | null
  callPhone: string | null
  serviceStatus: string | null
}

/**
 * Everything the narrative writer and the on-screen viewer need, captured at
 * build time so the report never changes under the reader's feet.
 */
export interface TripDossier {
  facts: TripFacts
  itinerary: ItineraryStop[]
  /** Distinct place names mined from the itinerary titles. */
  places: string[]
  calls: CallEvidence[]
  form: FormEvidence | null
  deskNotes: DeskNoteEvidence[]
  stats: {
    callsScheduled: number
    callsAnswered: number
    positive: number
    neutral: number
    negative: number
    issuesLogged: number
    badRatings: number
  }
  collectedAt: string
  warnings: string[]
}

// ─── Risk gate ────────────────────────────────────────────────────────────────

export interface RiskSignal {
  /** Machine tag, e.g. 'negative_sentiment' — stable enough to filter on. */
  code: string
  label: string
  detail: string
  weight: number
  channel: FeedbackChannel
  /** Where in the trip it happened, when we know. */
  dayNo?: number | null
}

export interface RiskAssessment {
  level: RiskLevel
  score: number
  signals: RiskSignal[]
  /** True when this report must not reach the agent unreviewed. */
  shouldHold: boolean
  /** One line, shown at the top of the hold card and in the escalation mail. */
  reason: string | null
}

// ─── AI narrative ─────────────────────────────────────────────────────────────

export interface ExperienceNarrative {
  headline: string
  opening: string
  /** Flowing prose over the places actually visited. */
  journeyStory: string
  /** What the guest said, in their own words where possible. */
  guestVoice: string
  /** Detailed feedback breakdown — the heart of what the agent asked for. */
  feedbackSummary: string
  serviceNotes: {
    accommodation: string | null
    dining: string | null
    transport: string | null
    guiding: string | null
  }
  issuesSummary: string
  keyThemes: string[]
  overallScore: string
  closingRemark: string
}

// ─── Persisted record ─────────────────────────────────────────────────────────

export interface ReportEvent {
  at: string
  actor: string | null
  action: string
  detail: string | null
}

export interface ExperienceReportRecord {
  id: string
  bookingRef: string
  status: ReportStatus
  triggerSource: TriggerSource
  riskLevel: RiskLevel
  riskScore: number
  riskSignals: RiskSignal[]
  holdReason: string | null
  clientName: string | null
  agentName: string | null
  arrivalDate: string | null
  departureDate: string | null
  sources: FeedbackChannel[]
  dossier: TripDossier | null
  narrative: ExperienceNarrative | null
  subject: string | null
  bodyHtml: string | null
  toEmail: string | null
  ccEmails: string[]
  sentAt: string | null
  sentBy: string | null
  escalationTo: string | null
  escalationHtml: string | null
  escalatedAt: string | null
  releasedAt: string | null
  releasedBy: string | null
  resolutionNote: string | null
  lastError: string | null
  events: ReportEvent[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** The list view never ships `dossier`/`bodyHtml` — they are far too big. */
export type ExperienceReportSummary = Omit<
  ExperienceReportRecord, 'dossier' | 'bodyHtml' | 'escalationHtml' | 'narrative'
> & {
  headline: string | null
  hasNarrative: boolean
  callCount: number
  transcriptCount: number
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ExperienceReportSettings {
  /** Post-departure sweep on/off. */
  autoSend: boolean
  /** Days after departure the sweep looks back. */
  lookbackDays: number
  /** Wait this many days after departure before building — lets late calls land. */
  quietDays: number
  /** Hold at this risk level or above. */
  holdAtLevel: Exclude<RiskLevel, 'none'>
  /** Where a held report goes instead of the agent. */
  escalationEmail: string
  /** Always CC'd on the agent mail. */
  ccEmails: string[]
  /** Never send without a human pressing Send, however good the trip was. */
  requireApproval: boolean
  updatedAt: string | null
  updatedBy: string | null
}
