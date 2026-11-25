/**
 * Agent ID, Sales Person and Guest name from the AI Quotation system (Aahaas
 * Flow, n8n-project) — the values the confirmation voucher actually prints.
 *
 * WHY APPLESYSTEM IS NOT ENOUGH
 *
 * Apple REBUILDS a quotation on every save — new row, nothing carried across —
 * so the agency reference (`agent_id`), the sales person and the client typed
 * on the AI Quotation side are left on the revision the save replaced. The
 * quote OPS imports then says `agent_id: ""`, `sales_person: ""` and the guest
 * as whatever was on the first draft ("teest booking"). Flow keeps its own copy
 * (`tbl_quote_draft.parties` / `tbl_corporate_parties`) and patches the voucher
 * from it before it is mailed — that is why the confirmation shows
 * "Malik" / "Miss Test Booking" while OPS showed blanks (SG40099, 508339).
 *
 * This reads that copy over the existing read-only Flow link
 * (`GET /v1/aahaas-flow/parties/{quotationNo}`, service key, GET only).
 *
 * Rules:
 *   - Flow's value wins when it has one — it is what the voucher says, and it
 *     was typed by a person on purpose. Otherwise AppleSystem's value stays.
 *   - "[NONE]" is Apple's "nobody assigned" placeholder, never a name.
 *   - Never throws and never blocks an import or sync: Flow down, older Flow
 *     build without the feed (404), or nothing on file = behaviour unchanged.
 */

import { flowGet, isFlowConfigured } from '@/lib/aahaas-flow-api'
import type { MappedBookingInput } from '@/lib/as-booking-map'

export interface FlowParties {
  quotationNo: string
  agentName: string | null
  /** The agency's own reference — the voucher's "Agent ID" row. */
  agentReference: string | null
  salesPerson: string | null
  guestTitle: string | null
  guestName: string | null
  /** 'corporate' | 'sme' — which Flow lane held it. */
  source: string | null
}

/** A short wait: this runs inside an import / sync, which must never hang on Flow. */
const FEED_TIMEOUT_MS = Number(process.env.FLOW_PARTIES_TIMEOUT_MS ?? '6000')

const clean = (v: unknown, max = 190): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (!s || /^(na|n\/a|null|-)$/i.test(s) || /^\[?\s*none\s*\]?$/i.test(s)) return null
  return s.slice(0, max)
}

/** The bare Apple quotation number: "508339", "508339CNTL", "CNTL508339" → "508339". */
export function quotationDigits(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const s = String(c ?? '').replace(/^CNTL\s*/i, '').replace(/\s*CNTL$/i, '').trim()
    if (/^\d{1,12}$/.test(s)) return s
  }
  return null
}

/** "Miss Test Booking" — the guest as the voucher prints them. */
export function flowGuestDisplay(p: FlowParties | null | undefined): string | null {
  if (!p?.guestName) return null
  const title = p.guestTitle && !p.guestName.toLowerCase().startsWith(p.guestTitle.toLowerCase())
    ? p.guestTitle
    : null
  return [title, p.guestName].filter(Boolean).join(' ').slice(0, 190)
}

/**
 * What Flow holds for one quotation, or null. Never throws.
 *
 * Several numbers can name the same booking — Apple's stable `quotation_no`,
 * the revision's `reference_id`, and the CNTL digits — and Flow files under
 * the stable one. All are sent (`?also=`) and Flow answers for the first hit.
 */
export async function fetchFlowParties(numbers: (string | null | undefined)[]): Promise<FlowParties | null> {
  const all = Array.from(new Set(numbers.map((n) => quotationDigits(n)).filter((n): n is string => !!n)))
  const no = all[0]
  if (!no || !isFlowConfigured()) return null
  try {
    const also = all.slice(1, 4)
    const data = await flowGet<Record<string, unknown> | null>(
      `parties/${encodeURIComponent(no)}${also.length ? `?also=${also.join(',')}` : ''}`,
      'as-import',
      { timeoutMs: FEED_TIMEOUT_MS },
    )
    if (!data || data.found === false) return null
    const out: FlowParties = {
      quotationNo: clean(data.quotation_no, 12) ?? no,
      agentName: clean(data.agent_name),
      agentReference: clean(data.agent_reference, 190),
      salesPerson: clean(data.sales_person),
      guestTitle: clean(data.guest_title, 40),
      guestName: clean(data.guest_name),
      source: clean(data.source, 40),
    }
    return out.agentReference || out.salesPerson || out.guestName || out.agentName ? out : null
  } catch (err) {
    // A 404 is an older Flow build without the feed — same as "nothing known".
    console.warn(
      `[flow-parties] could not read parties for quotation ${no}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/** Every number the mapped quote can be filed under in Flow, stable one first. */
export function quotationNumbersOf(mapped: Pick<MappedBookingInput, 'source' | 'cntlNumber'>): (string | null)[] {
  return [
    quotationDigits(mapped.source?.quotationNo),
    quotationDigits(mapped.cntlNumber),
    quotationDigits(mapped.source?.referenceId),
  ]
}

/**
 * The mapped quote with Flow's Agent ID, Sales Person and lead guest laid over
 * AppleSystem's. PURE. Marks the result as checked so later steps
 * (`saveAsExtras`) do not ask Flow a second time.
 */
export function applyFlowParties(mapped: MappedBookingInput, flow: FlowParties | null): MappedBookingInput {
  const guest = flowGuestDisplay(flow)
  let passengers = mapped.passengers
  if (guest) {
    const leadIdx = passengers.findIndex((p) => p.isLead)
    passengers = leadIdx >= 0
      ? passengers.map((p, i) => (i === leadIdx ? { ...p, name: guest } : p))
      : [{ name: guest, type: 'ADULT', age: null, isLead: true, passport: '', nationality: '' }, ...passengers]
  }
  return {
    ...mapped,
    agentId: flow?.agentReference ?? mapped.agentId,
    salesPerson: flow?.salesPerson ?? mapped.salesPerson,
    passengers,
    flowParties: { checked: true, parties: flow, appleGuestName: mapped.passengers.find((p) => p.isLead)?.name ?? null },
  }
}

/** Fetch + apply in one step. Never throws. */
export async function withFlowParties(mapped: MappedBookingInput): Promise<MappedBookingInput> {
  if (mapped.flowParties?.checked) return mapped
  try {
    const flow = await fetchFlowParties(quotationNumbersOf(mapped))
    if (flow) {
      console.log(
        `[flow-parties] ${mapped.bookingRef}: from AI Quotation —` +
        ` agentId=${flow.agentReference ? 'yes' : 'no'} salesPerson=${flow.salesPerson ? 'yes' : 'no'} guest=${flow.guestName ? 'yes' : 'no'}`,
      )
    }
    return applyFlowParties(mapped, flow)
  } catch (err) {
    console.warn('[flow-parties] skipped:', err instanceof Error ? err.message : err)
    return mapped
  }
}

const nameKey = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The lead guest on an EXISTING booking, corrected to Flow's — but only while it
 * still holds AppleSystem's own guest name. A name somebody typed in OPS is a
 * decision and is never overwritten. One row, by primary key. Never throws.
 */
export async function correctLeadGuestFromFlow(
  bookingId: string,
  mapped: MappedBookingInput,
): Promise<boolean> {
  try {
    const guest = flowGuestDisplay(mapped.flowParties?.parties)
    const appleName = mapped.flowParties?.appleGuestName
    if (!guest || !appleName) return false
    const { prisma } = await import('@/lib/prisma')
    const lead = await prisma.passenger.findFirst({
      where: { bookingId, isLead: true },
      select: { id: true, name: true },
    })
    if (!lead) return false
    if (nameKey(lead.name) === nameKey(guest)) return false
    if (nameKey(lead.name) !== nameKey(appleName)) return false // edited in OPS — leave it
    await prisma.passenger.update({ where: { id: lead.id }, data: { name: guest } })
    console.log(`[flow-parties] ${mapped.bookingRef}: lead guest set from AI Quotation`)
    return true
  } catch (err) {
    console.warn('[flow-parties] lead guest not corrected:', err instanceof Error ? err.message : err)
    return false
  }
}
