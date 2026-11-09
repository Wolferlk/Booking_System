/**
 * Tickets straight from the AppleSystem quote — at import time, and on demand
 * from "Create Tickets from API" (POST /api/bookings/[ref]/as-tickets).
 *
 * The Accounts DB only holds the costing once Accounts has pulled the P&L —
 * usually days after the booking lands. The quote template carries the very
 * same `pnl` block, so the costing sheet can be rendered from it the moment the
 * booking is created and the ground team sees what to buy from day one.
 *
 * Safety properties, all inherited from syncTicketsFromDetailed:
 *   - create-only: runs without `resync`, so an existing ticket is never
 *     touched, and nothing is ever deleted;
 *   - DRAFT only: purchase, approval and payment flow exactly as before;
 *   - idempotent: every ticket carries the same "Detailed P&L #<key>" tag the
 *     button writes, so a later button press or the Accounts re-sync updates
 *     these tickets instead of duplicating them;
 *   - default categories only (attractions and other services), never hotels
 *     or transport.
 *
 * The import path is best-effort: any failure is logged and returned, never
 * thrown — a booking import must not fail because its tickets could not be
 * made, and the button is still there to make them by hand.
 *
 * Switch: system_settings `as_auto_tickets_enabled` = 'false' turns off the
 * import path only. No row means on. The button always works.
 */

import { prisma } from '@/lib/prisma'
import { getQuoteTemplateRaw } from '@/lib/applesystem'
import type { MappedBookingInput } from '@/lib/as-booking-map'
import type { OperationCountry } from '@/lib/country-detection'
import { syncTicketsFromDetailed } from '@/lib/detailed-pnl'
import { fetchCatalogues, type DetailedPnlRow } from '@/lib/detailed-pnl/db'
import { buildDetailPayload, extractKeyOrder } from '@/lib/detailed-pnl/derive'
import { renderDetailed } from '@/lib/detailed-pnl/render'
import type { AsPayload } from '@/lib/detailed-pnl/types'

export const SETTING_AUTO_TICKETS = 'as_auto_tickets_enabled'

type SyncResult = Awaited<ReturnType<typeof syncTicketsFromDetailed>>

export type AutoTicketsOutcome =
  | { status: 'created'; created: number; skipped: number }
  | { status: 'skipped'; reason: 'disabled' | 'no_source' | 'no_pnl' | 'nothing_to_buy' }
  | { status: 'error'; message: string }

export async function isAutoTicketsEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_AUTO_TICKETS } })
    return row?.value !== 'false'
  } catch {
    // An unreadable switch is not a reason to skip: the write it guards is
    // create-only DRAFT tickets.
    return true
  }
}

/** The Accounts DB's country_code for a booking, which the renderer keys on. */
function countryCodeFor(ref: string, country: OperationCountry): string | null {
  const prefix = ref.trim().slice(0, 2).toUpperCase()
  if (prefix === 'VN' || prefix === 'SG' || prefix === 'MY') return prefix
  if (prefix === 'IS') return 'LK'
  if (country === 'VIETNAM') return 'VN'
  if (country === 'SRILANKA') return 'LK'
  return null
}

/**
 * Render the quote's costing sheet and create the DRAFT tickets it lists.
 * Create-only. Returns null when the quote carries no P&L. Throws on failure —
 * the callers decide what a failure means.
 *
 * `raw` must be the response text from getQuoteTemplateRaw: only the text keeps
 * the attraction key order.
 */
export async function createTicketsFromQuote(
  booking: { id: string; bookingRef: string },
  mapped: MappedBookingInput,
  operationCountry: OperationCountry,
  quote: { data: unknown; raw: string },
): Promise<SyncResult | null> {
  const { quotationNo, referenceId, revision } = mapped.source

  // Shaped as the Accounts DB row the costing panel reads, so the sheet is
  // rendered by exactly the same code.
  const record: DetailedPnlRow = {
    id: 0,
    is_number: mapped.isNumber || null,
    tour_ref: booking.bookingRef,
    invoice_number: mapped.agentBookingId ?? null,
    agent_name: mapped.agent ?? null,
    country_code: countryCodeFor(booking.bookingRef, operationCountry),
    currency: mapped.currency ?? null,
    total_pax: mapped.paxAdults + mapped.paxChildren,
    as_quotation_no: quotationNo,
    as_reference_id: referenceId,
    as_revision: revision,
    status: null,
    pnl_approval_status: null,
    payload: quote.data as AsPayload,
    rawPayload: quote.raw,
  }

  const catalogues = await fetchCatalogues()
  const detailPayload = buildDetailPayload(record, catalogues, extractKeyOrder(quote.raw))
  if (!detailPayload) return null

  return syncTicketsFromDetailed(booking.id, renderDetailed(detailPayload))
}

/**
 * Create the DRAFT tickets for a booking that has just been imported.
 * Never throws.
 */
export async function autoCreateTicketsOnImport(
  booking: { id: string; bookingRef: string },
  mapped: MappedBookingInput,
  operationCountry: OperationCountry,
): Promise<AutoTicketsOutcome> {
  const tag = `[as-auto-tickets] ${booking.bookingRef}`
  try {
    if (!(await isAutoTicketsEnabled())) return { status: 'skipped', reason: 'disabled' }

    const { quotationNo, referenceId, revision } = mapped.source
    if (!quotationNo || !referenceId) return { status: 'skipped', reason: 'no_source' }

    // Read again rather than reuse the caller's copy: only the response text
    // keeps the attraction key order.
    const quote = await getQuoteTemplateRaw(quotationNo, referenceId)

    const result = await createTicketsFromQuote(booking, mapped, operationCountry, quote)
    if (!result) return { status: 'skipped', reason: 'no_pnl' }

    const { created, skipped } = result
    if (!created && !skipped) return { status: 'skipped', reason: 'nothing_to_buy' }

    console.log(`${tag}: ${created} ticket(s) created from quote ${quotationNo} rev ${revision ?? '—'}`)
    return { status: 'created', created, skipped }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${tag}: auto tickets failed — use "Create Tickets from API" instead.`, err)
    return { status: 'error', message }
  }
}
