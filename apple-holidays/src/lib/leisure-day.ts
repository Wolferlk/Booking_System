/**
 * Leisure-day detection.
 *
 * A "leisure day" is a movement chart row where the guest has no arranged
 * service — a free day, a day at leisure at the hotel, own arrangement. No
 * driver or vehicle is allocated for it, so the agenda screen hides the driver
 * allocation controls and the MC report shows a "Leisure Day" marker instead of
 * an empty driver cell.
 *
 * `isLeisure` is stored on `AgendaItem`, so an operator's explicit toggle always
 * wins. These helpers only supply the *initial* value when an agenda is
 * AI-generated, and act as a read-time fallback for rows saved before the
 * column existed.
 */

/** Positive signals — a free / at-leisure / own-arrangement day. */
const LEISURE_RE = /\b(at leisure|leisure day|leisure time|day at leisure|free day|free time|free at leisure|own arrangement|own arrangements|day free|relax at the hotel|no activit(?:y|ies)|nothing (?:is )?(?:planned|arranged)|rest day)\b/i

/**
 * Negative signals — words that mean a service IS arranged, so the row needs a
 * driver even if the text also mentions "leisure" (e.g. "transfer to the beach,
 * then free time to explore"). Checked before the positive match.
 */
const SERVICED_RE = /\b(transfer|pick[- ]?up|pickup|drop[- ]?off|airport|flight|depart|arrival|guide|driver|vehicle|coach|bus|cruise|excursion|sightseeing tour)\b/i

/**
 * Negated service phrases — "No transport or guide arranged", "no vehicle
 * provided". These *confirm* a leisure day, but they name the very words
 * `SERVICED_RE` looks for, so they are stripped before that check runs.
 */
const NO_SERVICE_RE = /\bno\s+(?:transport(?:ation)?|transfer|vehicle|driver|guide|car|coach|bus)\b[^.;]*/gi

export interface LeisureCandidate {
  location?: string | null
  fromPoint?: string | null
  toPoint?: string | null
  details?: string | null
  serviceType?: string | null
}

/**
 * True when the row reads as a free / at-leisure day with no arranged service.
 *
 * Requires `serviceType === 'OWN_ARRANGEMENT'` — every other service type means
 * a vehicle or ticket is involved. Within own-arrangement rows, the title
 * (`toPoint`) and `location` carry the intent; `details` is only consulted when
 * the title is silent, because AI-written details often mention "leisure" in
 * passing on an otherwise serviced day.
 */
export function detectLeisureDay(item: LeisureCandidate): boolean {
  if (String(item.serviceType ?? '') !== 'OWN_ARRANGEMENT') return false

  const title = `${item.toPoint ?? ''} ${item.location ?? ''}`.trim()
  if (SERVICED_RE.test(title)) return false
  if (LEISURE_RE.test(title)) return true

  // Title was silent — fall back to the description, but only when it does not
  // also describe an arranged service. "No transport or guide arranged" is
  // dropped first: it argues *for* a leisure day despite naming those services.
  const details = String(item.details ?? '')
  if (!details.trim()) return false
  const withoutNegations = details.replace(NO_SERVICE_RE, ' ')
  if (SERVICED_RE.test(withoutNegations)) return false
  return LEISURE_RE.test(withoutNegations)
}

/**
 * Resolved leisure flag for a stored row. `isLeisure` is nullable: `true`/`false`
 * are decisions (AI generation or an operator toggle) and are respected as-is;
 * `null` means the row predates the column, so fall back to text detection.
 */
export function resolveIsLeisure(
  item: LeisureCandidate & { isLeisure?: boolean | null },
): boolean {
  if (item.isLeisure === true)  return true
  if (item.isLeisure === false) return false
  return detectLeisureDay(item)
}
