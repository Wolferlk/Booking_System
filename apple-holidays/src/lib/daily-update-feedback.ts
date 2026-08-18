/**
 * The digital Guest Feedback Form, as the Daily Update sheet reports it.
 *
 * The form itself is not new: it is sent to the guest on WhatsApp after
 * departure (`[FEEDBACK-REQUEST]`), filled in at `/feedback/[ref]`, and stored
 * in `guest_feedback_forms`. All this module does is give the sheet a column
 * that answers "did it come back, and what did they say?" — so the desk does
 * not have to leave the sheet for the AI call bot page to find out.
 *
 * Strictly read-only, and strictly existing tables: nothing here writes, and
 * no schema changed to add the column.
 *
 * Prisma-free on purpose — the sheet is a client component and imports these
 * labels and types. The loader lives in `daily-update-calls-data.ts`.
 */

/** The six section ratings, in the order the paper form asks them. */
export const FEEDBACK_RATING_FIELDS = [
  { key: 'accommodationRoom',  label: 'Accommodation — Room' },
  { key: 'accommodationFood',  label: 'Accommodation — Food' },
  { key: 'restaurantFood',     label: 'Restaurant — Food' },
  { key: 'restaurantAmbience', label: 'Restaurant — Ambience' },
  { key: 'transportVehicle',   label: 'Transport — Vehicle' },
  { key: 'transportDriver',    label: 'Transport — Driver' },
] as const

export type FeedbackRatingKey = typeof FEEDBACK_RATING_FIELDS[number]['key']

export const FEEDBACK_RATING_LABELS: Record<string, string> = {
  EXCELLENT: 'Excellent',
  GOOD:      'Good',
  AVERAGE:   'Average',
  POOR:      'Poor',
}

/** Emoji rather than stars: the form itself asks the guest with these faces. */
export const FEEDBACK_RATING_EMOJI: Record<string, string> = {
  EXCELLENT: '🤩',
  GOOD:      '😊',
  AVERAGE:   '😐',
  POOR:      '😞',
}

export const FEEDBACK_PURPOSE_LABELS: Record<string, string> = {
  BUSINESS: 'Only Business',
  LEISURE:  'Only Leisure',
  BOTH:     'Business & Leisure',
}

/** Weakest rating first — the one the desk has to act on. */
const RATING_SEVERITY: Record<string, number> = { POOR: 0, AVERAGE: 1, GOOD: 2, EXCELLENT: 3 }

export type FeedbackForm = {
  submittedAt: string
  clientName:  string | null
  purpose:     string | null
  overall:     string | null
  remarks:     string | null
  ratings:     Partial<Record<FeedbackRatingKey, string | null>>
}

/** What one row's Feedback Form column knows. */
export type FeedbackFormCell = {
  /** The submission, or null while the sheet is still waiting for it. */
  form: FeedbackForm | null
  /**
   * When the form was last sent to the guest on WhatsApp, so a blank column
   * distinguishes "never asked" from "asked and not answered".
   */
  sentAt: string | null
}

export const emptyFeedbackForm = (): FeedbackFormCell => ({ form: null, sentAt: null })

/** The lowest rating anywhere on the form — the sheet's tone for the cell. */
export function worstRating(form: FeedbackForm): string | null {
  const all = [form.overall, ...Object.values(form.ratings)]
    .filter((v): v is string => typeof v === 'string' && v in RATING_SEVERITY)
  if (all.length === 0) return null
  return all.reduce((a, b) => (RATING_SEVERITY[b] < RATING_SEVERITY[a] ? b : a))
}

/** One line for the exports, where there is no room for six badges. */
export function feedbackFormSummary(cell: FeedbackFormCell): string {
  if (!cell.form) return cell.sentAt ? 'Form sent — no response yet' : 'Not sent'
  const f = cell.form
  const filled = FEEDBACK_RATING_FIELDS
    .map(({ key, label }) => {
      const v = f.ratings[key]
      return v ? `${label}: ${FEEDBACK_RATING_LABELS[v] ?? v}` : null
    })
    .filter(Boolean)
  return [
    f.overall ? `Overall: ${FEEDBACK_RATING_LABELS[f.overall] ?? f.overall}` : 'Submitted',
    f.purpose ? `Purpose: ${FEEDBACK_PURPOSE_LABELS[f.purpose] ?? f.purpose}` : null,
    ...filled,
    f.remarks ? `Remarks: ${f.remarks}` : null,
  ].filter(Boolean).join(' · ')
}
