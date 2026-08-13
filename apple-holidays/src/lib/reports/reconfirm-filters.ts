/**
 * The reconfirmation facets — the vocabulary the operations board filters on.
 *
 * Ops asks five questions about reconfirmation, and they sit on **three
 * independent axes** rather than one ladder. Collapsing them into a single
 * dropdown would have made most combinations unreachable, so each axis is its
 * own group and the board ANDs across groups while ORing inside one:
 *
 *   • **Client confirmation** — has the booking status reached "Client
 *     Confirmed"? `CLIENT_CONFIRMED` / `CLIENT_UNCONFIRMED`.
 *   • **Reconfirmation call** — has the pre-tour reconfirmation call actually
 *     happened and been written up? `RECONFIRM_PENDING` selects the ones where
 *     it has not.
 *   • **WhatsApp call request** — the customer must accept a WhatsApp message
 *     before the bot is allowed to place automated calls at all.
 *     `CALL_ACCEPTED` / `CALL_NOT_ACCEPTED`.
 *   • **D-10 breach** — the booking blew its ten-days-before-travel
 *     reconfirmation deadline, and either someone has written down why or nobody
 *     has. `DELAY_EXPLAINED` / `DELAY_UNEXPLAINED`.
 *
 * The last axis is the one the desk works from in the morning:
 * `DELAY_UNEXPLAINED` is the list of files that are late *and* silent, which is
 * a different job from the late ones that are already accounted for. Neither
 * chip matches a booking that is not past its deadline — a file with time left
 * owes nobody an explanation.
 *
 * The third axis is the reason the second one is often stuck: a booking whose
 * customer never accepted the WhatsApp request can never show a completed call,
 * and chasing the call instead of the permission is wasted effort. Selecting
 * "Reconfirmation pending" *and* "Call request not accepted" is the query that
 * separates the two, which is why they are filterable together.
 *
 * Deliberately Prisma-free and pure: the server summary and the client chips
 * both classify with these functions, so a count and a filtered list can never
 * disagree about what a facet means.
 */

/**
 * Whether the customer has accepted automated WhatsApp calls.
 *
 * `unknown` is not a synonym for "no" — it means the approval ledger could not
 * be read, and no facet claims those rows in either direction.
 */
export type CallApprovalState = 'approved' | 'pending' | 'not_requested' | 'unknown'

export const APPROVAL_LABEL: Record<CallApprovalState, string> = {
  approved: 'Accepted',
  pending: 'Awaiting customer',
  not_requested: 'Not sent',
  unknown: 'Unknown',
}

export type ReconfirmFacet =
  | 'CLIENT_CONFIRMED'
  | 'CLIENT_UNCONFIRMED'
  | 'RECONFIRM_PENDING'
  | 'CALL_ACCEPTED'
  | 'CALL_NOT_ACCEPTED'
  | 'HOTEL_ONLY'
  | 'FULL_SERVICE'
  | 'DELAY_EXPLAINED'
  | 'DELAY_UNEXPLAINED'

export type FacetGroup = 'client' | 'call' | 'approval' | 'scope' | 'delay'

/**
 * Display order, and the order groups are ANDed in.
 *
 * `scope` is a fourth axis and sits first because it changes what the other
 * three even mean: a Hotel Only booking has no tour to reconfirm, so it is
 * neither a chase nor a success on the reconfirmation axes — it is simply out of
 * their scope. Ops filters on it both ways: "show me only the room-only files"
 * and, far more often, "hide them so I can work the real tours".
 */
export const FACET_GROUPS: FacetGroup[] = ['scope', 'client', 'call', 'approval', 'delay']

/**
 * The minimum a row must carry to be classified. Both `OpsDayRow` and any
 * lighter projection of it satisfy this, which keeps the summary code on the
 * server free of the full row type.
 */
export interface ReconfirmFacts {
  clientConfirmed: boolean
  /** Null when no reconfirmation call has been logged. */
  preTourCall: unknown | null
  call: { approval: CallApprovalState }
  /** Accommodation-only file — see `src/lib/hotel-only.ts`. */
  hotelOnly?: boolean
  /**
   * Past the D-10 reconfirmation deadline with the guest still unreconfirmed —
   * see `src/lib/reconfirm-delay-shared.ts`.
   */
  reconfirmBreached?: boolean
  /** The recorded explanation for that breach, when one exists. */
  reconfirmDelay?: unknown | null
}

export interface FacetMeta {
  key: ReconfirmFacet
  group: FacetGroup
  /** Chip text. */
  label: string
  /** Column / pill text where space is tight. */
  short: string
  /** Tooltip — says precisely what the facet means, in ops language. */
  hint: string
  /** Chip styling when the facet is on. */
  chip: string
  dot: string
}

export const RECONFIRM_FACETS: FacetMeta[] = [
  {
    key: 'CLIENT_CONFIRMED',
    group: 'client',
    label: 'Client confirmed',
    short: 'Confirmed',
    hint: 'Booking status has reached Client Confirmed or beyond',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  {
    key: 'CLIENT_UNCONFIRMED',
    group: 'client',
    label: 'Client not confirmed',
    short: 'Unconfirmed',
    hint: 'Booking status has not reached Client Confirmed',
    chip: 'bg-rose-50 text-rose-700 border-rose-300',
    dot: 'bg-rose-500',
  },
  {
    key: 'RECONFIRM_PENDING',
    group: 'call',
    label: 'Reconfirmation pending',
    short: 'Not called',
    hint: 'No pre-tour reconfirmation call has been logged for this booking yet',
    chip: 'bg-amber-50 text-amber-700 border-amber-300',
    dot: 'bg-amber-500',
  },
  {
    key: 'CALL_ACCEPTED',
    group: 'approval',
    label: 'Call request accepted',
    short: 'WA accepted',
    hint: 'The customer accepted the WhatsApp request, so the bot may call them',
    chip: 'bg-sky-50 text-sky-700 border-sky-300',
    dot: 'bg-sky-500',
  },
  {
    key: 'HOTEL_ONLY',
    group: 'scope',
    label: 'Hotel Only',
    short: 'Hotel Only',
    hint: 'Accommodation-only bookings — no agenda, drivers, tickets, flights, client reconfirmation or QC',
    chip: 'bg-amber-50 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
  },
  {
    key: 'FULL_SERVICE',
    group: 'scope',
    label: 'Full tours only',
    short: 'Full tours',
    hint: 'Hides Hotel Only bookings, leaving the files that carry an operation',
    chip: 'bg-slate-100 text-slate-700 border-slate-300',
    dot: 'bg-slate-500',
  },
  {
    key: 'DELAY_UNEXPLAINED',
    group: 'delay',
    label: 'D-10 missed, unexplained',
    short: 'No reason',
    hint: 'Past the 10-days-before-travel reconfirmation deadline and nobody has recorded why',
    chip: 'bg-rose-50 text-rose-700 border-rose-300',
    dot: 'bg-rose-500',
  },
  {
    key: 'DELAY_EXPLAINED',
    group: 'delay',
    label: 'D-10 missed, reason on file',
    short: 'Reason given',
    hint: 'Past the deadline, but the desk has recorded why — still late, just accounted for',
    chip: 'bg-amber-50 text-amber-700 border-amber-300',
    dot: 'bg-amber-500',
  },
  {
    key: 'CALL_NOT_ACCEPTED',
    group: 'approval',
    label: 'Call request pending',
    short: 'WA pending',
    hint: 'The WhatsApp call request is unanswered or was never sent — the bot cannot call',
    chip: 'bg-violet-50 text-violet-700 border-violet-300',
    dot: 'bg-violet-500',
  },
]

export const FACET_META: Record<ReconfirmFacet, FacetMeta> =
  Object.fromEntries(RECONFIRM_FACETS.map(f => [f.key, f])) as Record<ReconfirmFacet, FacetMeta>

/** Does a single row answer this one question with "yes"? */
export function matchesFacet(facet: ReconfirmFacet, r: ReconfirmFacts): boolean {
  switch (facet) {
    case 'CLIENT_CONFIRMED':   return r.clientConfirmed
    case 'CLIENT_UNCONFIRMED': return !r.clientConfirmed
    case 'RECONFIRM_PENDING':  return !r.preTourCall
    case 'CALL_ACCEPTED':      return r.call.approval === 'approved'
    // "Unknown" is withheld deliberately: an unreadable ledger must not be
    // reported to ops as a customer who refused.
    case 'CALL_NOT_ACCEPTED':  return r.call.approval === 'pending' || r.call.approval === 'not_requested'
    case 'HOTEL_ONLY':         return r.hotelOnly === true
    case 'FULL_SERVICE':       return r.hotelOnly !== true
    // Both delay facets are conditioned on the breach itself: a booking that is
    // not late is neither "explained" nor "unexplained", it is simply not being
    // asked, and letting it fall into either bucket would drown the real list.
    case 'DELAY_EXPLAINED':    return r.reconfirmBreached === true && !!r.reconfirmDelay
    case 'DELAY_UNEXPLAINED':  return r.reconfirmBreached === true && !r.reconfirmDelay
    default:                   return true
  }
}

/**
 * Apply a whole selection.
 *
 * OR inside a group, AND across groups — so picking both client chips is the
 * same as picking neither (every booking is one or the other), while picking
 * "Client not confirmed" + "Call request pending" narrows to the rows that are
 * both, which is the list ops actually chases.
 */
export function matchesFacets(selected: ReadonlySet<ReconfirmFacet>, r: ReconfirmFacts): boolean {
  if (selected.size === 0) return true
  for (const group of FACET_GROUPS) {
    const chosen = RECONFIRM_FACETS.filter(f => f.group === group && selected.has(f.key))
    if (!chosen.length) continue
    if (!chosen.some(f => matchesFacet(f.key, r))) return false
  }
  return true
}

/** Facet head-counts over a set of rows, for chip badges and summary tiles. */
export function countFacets<T extends ReconfirmFacts>(rows: T[]): Record<ReconfirmFacet, number> {
  const out = {
    CLIENT_CONFIRMED: 0, CLIENT_UNCONFIRMED: 0, RECONFIRM_PENDING: 0,
    CALL_ACCEPTED: 0, CALL_NOT_ACCEPTED: 0,
    HOTEL_ONLY: 0, FULL_SERVICE: 0,
    DELAY_EXPLAINED: 0, DELAY_UNEXPLAINED: 0,
  } satisfies Record<ReconfirmFacet, number>
  for (const r of rows) {
    for (const f of RECONFIRM_FACETS) if (matchesFacet(f.key, r)) out[f.key] += 1
  }
  return out
}
