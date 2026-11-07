/**
 * Ticket pack — settings and ticket status rules. A ticket pack is a kind of
 * Agent Digest: instead of who is driving today, it sends an agent every ticket
 * of the guests arriving in N days (D-3 by default), with each ticket's status
 * and its files to download.
 *
 * Imports nothing, so shared.ts can use it and the client can too.
 */

export type DigestKind = 'DAILY' | 'TICKETS'

/** Hold a booking back until its tickets reach this point. */
export type TicketHold = 'NONE' | 'ANY_READY' | 'ALL_READY'

export const TICKET_HOLD_META: Record<TicketHold, { label: string; hint: string }> = {
  NONE:      { label: 'Send on the day', hint: 'Goes out on schedule whatever the status, so the agent sees what is still pending.' },
  ANY_READY: { label: 'At least one ready', hint: 'Waits until one ticket can be downloaded, then goes out.' },
  ALL_READY: { label: 'All tickets ready', hint: 'Waits until every ticket can be downloaded, then goes out.' },
}

export interface TicketPackShow {
  status: boolean
  reference: boolean
  ticketDate: boolean
  location: boolean
  qty: boolean
  supplier: boolean
  /** List tickets that cannot be downloaded yet. Off = only ready ones appear. */
  pending: boolean
}

export interface TicketPackConfig {
  /** Days before arrival: 3 = D-3. */
  daysBefore: number
  /** Ticket categories to send. Empty = all. */
  categories: string[]
  hold: TicketHold
  /** Pick up bookings that missed their day: added late, or held back. */
  catchUp: boolean
  /** Send again when a pending ticket becomes downloadable. */
  followUps: boolean
  /** Include a booking that has no tickets entered yet. */
  includeEmpty: boolean
  /** Files only once the ticket is purchased; off = as soon as it is activated. */
  downloadOnlyPurchased: boolean
  /** Share `Ticket.fileUrl`, the ticket's main file. Files under it are always shared. */
  includeMainFile: boolean
  /** The link stops working this many days after the guests leave. */
  linkDaysAfterTrip: number
  show: TicketPackShow
}

export const TICKET_CATEGORIES: { key: string; label: string }[] = [
  { key: 'TICKETS', label: 'Attractions' }, { key: 'CRUISE', label: 'Cruise' }, { key: 'WATER', label: 'Water' },
  { key: 'MEALS', label: 'Meals' }, { key: 'GUIDES', label: 'Guides' }, { key: 'TRANSPORT', label: 'Transport' },
  { key: 'HOTEL', label: 'Hotel' }, { key: 'FLIGHT_TICKETS', label: 'Flights' }, { key: 'OTHER', label: 'Other' },
]

export const TICKET_SHOW_FIELDS: { key: keyof TicketPackShow; label: string }[] = [
  { key: 'status', label: 'Ticket status' }, { key: 'pending', label: 'Tickets not ready yet' },
  { key: 'ticketDate', label: 'Ticket date' }, { key: 'location', label: 'Location' },
  { key: 'reference', label: 'Reference' }, { key: 'qty', label: 'Quantity' }, { key: 'supplier', label: 'Supplier' },
]

export function defaultTicketPack(): TicketPackConfig {
  return {
    daysBefore: 3, categories: [], hold: 'NONE', catchUp: true, followUps: true, includeEmpty: false,
    downloadOnlyPurchased: false, includeMainFile: true, linkDaysAfterTrip: 7,
    show: { status: true, reference: true, ticketDate: true, location: true, qty: true, supplier: false, pending: true },
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? fallback : Math.max(min, Math.min(max, n))
}

export function normaliseTicketPack(raw: unknown): TicketPackConfig {
  const d = defaultTicketPack()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TicketPackConfig>
  const showIn = (r.show && typeof r.show === 'object' ? r.show : {}) as Partial<TicketPackShow>
  const show = { ...d.show }
  for (const k of Object.keys(show) as (keyof TicketPackShow)[]) {
    if (typeof showIn[k] === 'boolean') show[k] = showIn[k] as boolean
  }
  const known = TICKET_CATEGORIES.map(c => c.key)
  return {
    daysBefore: clampInt(r.daysBefore, 0, 30, d.daysBefore),
    categories: Array.isArray(r.categories) ? r.categories.filter(c => known.includes(c)) : [],
    hold: r.hold === 'ANY_READY' || r.hold === 'ALL_READY' ? r.hold : 'NONE',
    catchUp: r.catchUp !== false,
    followUps: r.followUps !== false,
    includeEmpty: r.includeEmpty === true,
    downloadOnlyPurchased: r.downloadOnlyPurchased === true,
    includeMainFile: r.includeMainFile !== false,
    linkDaysAfterTrip: clampInt(r.linkDaysAfterTrip, 1, 60, d.linkDaysAfterTrip),
    show,
  }
}

// ── Ticket status ───────────────────────────────────────────────────────────

export type TicketState = 'READY' | 'FILE_READY' | 'PURCHASED' | 'ACTIVATED' | 'NOT_ACTIVATED'

/** Wording goes to external agents: it says where a ticket is, never why. */
export const TICKET_STATE_META: Record<TicketState, { label: string; emoji: string; bg: string; fg: string; bar: string }> = {
  READY:         { label: 'Ready to download',            emoji: '✅', bg: '#ecfdf5', fg: '#047857', bar: '#10b981' },
  FILE_READY:    { label: 'File ready · purchase pending', emoji: '📄', bg: '#eff6ff', fg: '#1d4ed8', bar: '#3b82f6' },
  PURCHASED:     { label: 'Purchased · file to follow',   emoji: '🟡', bg: '#fffbeb', fg: '#b45309', bar: '#f59e0b' },
  ACTIVATED:     { label: 'Activated · purchase pending', emoji: '🕓', bg: '#f1f5f9', fg: '#475569', bar: '#94a3b8' },
  NOT_ACTIVATED: { label: 'Not activated yet',            emoji: '⏳', bg: '#f1f5f9', fg: '#64748b', bar: '#cbd5e1' },
}

export interface TicketFacts { activated: boolean; status: string }

export const ticketPurchased = (t: TicketFacts) => t.status === 'PURCHASED' || t.status === 'PAID'

/** May an agent have this ticket's files? Never before it is activated, the same line the client portal draws. */
export function ticketFilesAllowed(pack: TicketPackConfig, t: TicketFacts): boolean {
  return t.activated && (!pack.downloadOnlyPurchased || ticketPurchased(t))
}

export function ticketState(t: TicketFacts, downloadableFiles: number): TicketState {
  if (!t.activated) return 'NOT_ACTIVATED'
  if (downloadableFiles > 0) return ticketPurchased(t) ? 'READY' : 'FILE_READY'
  return ticketPurchased(t) ? 'PURCHASED' : 'ACTIVATED'
}

export function ticketInPack(pack: TicketPackConfig, category: string | null | undefined): boolean {
  return !pack.categories.length || pack.categories.includes((category || 'OTHER').toUpperCase())
}
