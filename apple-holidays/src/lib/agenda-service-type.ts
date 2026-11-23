/**
 * Wording rules for the service type of an AI-generated movement-chart row.
 *
 * Both agenda generators — the interactive one in
 * `api/bookings/[ref]/agenda/generate` and the email pipeline in
 * `lib/incoming-mail-automation.ts` — post-process the model's `serviceType`
 * with these, so they classify the same row the same way.
 *
 * Two mistakes these exist to stop (both reported as "shown as Private Transfer"):
 *  - A leisure day turned into a Private Transfer because its details said
 *    "No transport or guide arranged" — the very sentence our own conditions
 *    template tells the model to write — and "transport" read as a vehicle.
 *  - A shared transfer turned into a Private Transfer because only the literal
 *    word "SIC" counted as shared; "Shared Transfers" did not.
 */

/** Wording that marks a shared (seat-in-coach) service. */
export const SHARED_SERVICE_RE = /\b(sic|shared|sharing|seat[\s-]?in[\s-]?coach)\b/i

/** Wording that marks a private service. Beats a shared word in the same title. */
export const PRIVATE_SERVICE_RE = /\b(private|pvt)\b/i

/** Wording that means a vehicle and driver are part of the service. */
export const TRANSFER_WORDING_RE = /\b(transfer|transport|pick[\s-]?up|drop[\s-]?off|by (car|coach|bus|van|vehicle)|private basis|round trip|one way)\b/i

/** A title that says the guest has the day / time to themselves. */
export const LEISURE_TITLE_RE = /\b(leisure|free day|free time|at leisure|own arrangement|own basis|at own pace)\b/i

/**
 * Negated service phrases — "No transport or guide arranged", "without
 * transfer", "transport not included". They argue *against* a vehicle, but name
 * the very words `TRANSFER_WORDING_RE` looks for, so they are removed first.
 */
const NEGATED_SERVICE_RES: RegExp[] = [
  /\b(?:no|without)\s+(?:transport(?:ation)?|transfers?|vehicles?|drivers?|guides?|cars?|coach(?:es)?|bus(?:es)?|pick[\s-]?ups?)\b[^.;]*/gi,
  /\b(?:transport(?:ation)?|transfers?)\s+(?:is\s+|are\s+)?not\s+(?:included|arranged|provided)\b/gi,
]

export function stripNegatedServices(text: unknown): string {
  let s = String(text ?? '')
  for (const re of NEGATED_SERVICE_RES) s = s.replace(re, ' ')
  return s
}

export interface ServiceTypeCandidate {
  fromPoint?: unknown
  toPoint?: unknown
  location?: unknown
  details?: unknown
}

/** The row's own title says leisure / free time / own arrangement. */
export function isLeisureTitle(item: ServiceTypeCandidate): boolean {
  return LEISURE_TITLE_RE.test(String(item.toPoint ?? '')) || LEISURE_TITLE_RE.test(String(item.location ?? ''))
}

/**
 * The row's title says shared / SIC and does not also say private. A title
 * naming both ("Private Transfer + SIC Tour") is left to the model.
 */
export function isSharedTitle(item: ServiceTypeCandidate): boolean {
  const to  = String(item.toPoint ?? '')
  const loc = String(item.location ?? '')
  if (!SHARED_SERVICE_RE.test(to) && !SHARED_SERVICE_RE.test(loc)) return false
  return !PRIVATE_SERVICE_RE.test(to)
}

/** Any shared signal on the row, details included (negations removed). */
export function hasSharedSignal(item: ServiceTypeCandidate): boolean {
  return isSharedTitle(item)
    || SHARED_SERVICE_RE.test(String(item.fromPoint ?? ''))
    || SHARED_SERVICE_RE.test(stripNegatedServices(item.details))
}

/**
 * Something is actually being driven: the wording names a transfer, or there is
 * a pickup and a drop-off. A pickup + drop-off whose title says the day is free
 * ("Hotel" → "Day at leisure") is not a drive — the model fills both fields
 * out of habit.
 */
export function hasVehicleMovement(item: ServiceTypeCandidate): boolean {
  const from = stripNegatedServices(item.fromPoint)
  const to   = stripNegatedServices(item.toPoint)
  const det  = stripNegatedServices(item.details)
  if (TRANSFER_WORDING_RE.test(to) || TRANSFER_WORDING_RE.test(from) || TRANSFER_WORDING_RE.test(det)) return true
  return !!from.trim() && !!to.trim() && !isLeisureTitle(item)
}
