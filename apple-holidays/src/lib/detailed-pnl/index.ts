/**
 * Detailed P&L — the entry point.
 *
 * Ties the three stages together for a booking: read the stored Apple System
 * payload out of the Accounts DB (read-only), derive the detail payload the
 * Accounts endpoint answers with, and render the costing sheet from it.
 *
 * The link between the two systems is the IS number, compared with spaces
 * stripped on both sides — the Booking system writes "VN41054" and the Accounts
 * DB writes "VN 41054" for the same tour.
 */
import { fetchCatalogues, fetchStoredPnl, type DetailedPnlRow } from './db'
import { buildDetailPayload, extractKeyOrder } from './derive'
import { renderDetailed, type DetailedPnl } from './render'
import type { DetailPayload } from './types'

export type { DetailedPnl } from './render'
export type { DetailPayload } from './types'
export { syncTicketsFromDetailed, ticketSpecsFromDetailed, DETAILED_TAG_PREFIX } from './tickets'
export { DETAILED_PNL_CSS } from './styles'
export { fetchDetailedPnlAvailability, normaliseRef } from './db'

export interface LoadedDetailedPnl {
  record: DetailedPnlRow
  payload: DetailPayload
  detail: DetailedPnl
  matchedBy: string
}

/** Why a booking has no costing sheet to show — each states a different fix. */
export type DetailedPnlMiss =
  | { reason: 'no_identifier' }   // the booking carries no IS number or tour ref
  | { reason: 'not_found' }       // nothing in the Accounts DB matches it
  | { reason: 'no_payload' }      // matched, but the row stores no Apple System P&L

/**
 * The costing sheet for one booking, or the reason there isn't one.
 *
 * Throws only if the Accounts DB is unreachable — callers surface that as a
 * connectivity problem rather than "this booking has no P&L", because the two
 * mean very different things to whoever is looking at the page.
 */
export async function loadDetailedPnl(opts: {
  isNumber?: string | null
  tourRef?: string | null
  invoiceNumber?: string | null
}): Promise<LoadedDetailedPnl | DetailedPnlMiss> {
  if (!opts.isNumber?.trim() && !opts.tourRef?.trim() && !opts.invoiceNumber?.trim()) {
    return { reason: 'no_identifier' }
  }

  const match = await fetchStoredPnl(opts)
  if (!match) return { reason: 'not_found' }

  const { record } = match
  const catalogues = await fetchCatalogues()
  // The rate maps have to be read in the order the API wrote them; JSON.parse
  // does not preserve it for integer-like keys. See derive.ts::extractKeyOrder.
  const keyOrder = record.rawPayload ? extractKeyOrder(record.rawPayload) : undefined

  const payload = buildDetailPayload(record, catalogues, keyOrder)
  if (!payload) return { reason: 'no_payload' }

  return { record, payload, detail: renderDetailed(payload), matchedBy: match.matchedBy }
}

/** Is this a loaded sheet, or a reason there isn't one? */
export function isLoaded(r: LoadedDetailedPnl | DetailedPnlMiss): r is LoadedDetailedPnl {
  return 'detail' in r
}

/** The message the UI shows for each miss. */
export function missMessage(miss: DetailedPnlMiss): string {
  switch (miss.reason) {
    case 'no_identifier':
      return 'This booking has no IS number yet, so it cannot be matched to an Accounts P&L.'
    case 'not_found':
      return 'No Accounts P&L is stored for this booking’s IS number.'
    case 'no_payload':
      return 'The Accounts P&L for this booking has no Apple System costing stored against it.'
  }
}
