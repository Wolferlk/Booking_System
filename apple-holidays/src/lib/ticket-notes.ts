/**
 * Shared presentation helpers for tickets.
 *
 * Tickets created from the external PNL carry a machine-readable `notes` string
 * built by ext-pnl-tickets.ts, e.g.
 *
 *   {"remarks":"Adult: 2 × 11.80 = 23.60","pax":2,"rate":11.8,"pax_type":"adult"} · Client: Deepak Kumar · PNL Item #4790
 *
 * That is fine for machines and terrible on a customer-facing document, so every
 * renderer (print pages, agenda PDF, agenda Word) parses it into fields here and
 * shows them as labelled values instead of dumping the raw string.
 */

export const PURCHASED_TICKET_STATUSES = ['PURCHASED', 'PAID'] as const

/** Only purchased/paid tickets belong on a customer document — drafts never do. */
export function isPurchasedTicket(status: string | null | undefined): boolean {
  return status === 'PURCHASED' || status === 'PAID'
}

export interface TicketNoteMeta {
  /** Human remarks pulled out of the JSON prefix (e.g. "Adult: 2 × 11.80 = 23.60"). */
  remarks: string | null
  pax: number | null
  rate: number | null
  /** "adult" | "child" | "infant" | … as recorded by the PNL. */
  paxType: string | null
  clientName: string | null
  checkIn: string | null
  checkOut: string | null
  pnlItemNo: string | null
  /** Anything left over that is genuine free text worth showing. */
  details: string[]
}

const EMPTY_META: TicketNoteMeta = {
  remarks: null, pax: null, rate: null, paxType: null,
  clientName: null, checkIn: null, checkOut: null, pnlItemNo: null, details: [],
}

const SEP = '·'
const PNL_TAG = 'PNL Item #'

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseTicketNotes(notes: string | null | undefined): TicketNoteMeta {
  if (!notes || !notes.trim()) return { ...EMPTY_META, details: [] }

  const meta: TicketNoteMeta = { ...EMPTY_META, details: [] }
  let rest = notes.trim()

  // JSON prefix, if present. It is always a flat object, so the first "}" closes it.
  if (rest.startsWith('{')) {
    const end = rest.indexOf('}')
    if (end !== -1) {
      try {
        const parsed = JSON.parse(rest.slice(0, end + 1)) as Record<string, unknown>
        if (typeof parsed.remarks === 'string' && parsed.remarks.trim()) meta.remarks = parsed.remarks.trim()
        meta.pax = num(parsed.pax)
        meta.rate = num(parsed.rate)
        const paxType = parsed.pax_type ?? parsed.paxType
        if (typeof paxType === 'string' && paxType.trim()) meta.paxType = paxType.trim()
        rest = rest.slice(end + 1).replace(new RegExp(`^\\s*${SEP}\\s*`), '').trim()
      } catch {
        // Not JSON after all — fall through and treat the whole thing as free text.
      }
    }
  }

  for (const raw of rest.split(SEP).map(p => p.trim()).filter(Boolean)) {
    if (raw.startsWith(PNL_TAG)) {
      meta.pnlItemNo = raw.slice(PNL_TAG.length).trim() || null
      continue
    }
    const match = /^([A-Za-z][A-Za-z -]*):\s*(.+)$/.exec(raw)
    const key = match?.[1].toLowerCase()
    const value = match?.[2].trim()
    if (key === 'client' && value) meta.clientName = value
    else if (key === 'check-in' && value) meta.checkIn = value
    else if (key === 'check-out' && value) meta.checkOut = value
    else meta.details.push(raw)
  }

  return meta
}

/** "2 Adults", "1 Child", "3 Pax" — never a bare number with no unit. */
export function paxLabel(count: number | null | undefined, paxType?: string | null): string | null {
  if (count === null || count === undefined) return null
  const type = (paxType ?? '').toLowerCase()
  const noun =
    type.startsWith('adult')  ? (count === 1 ? 'Adult'  : 'Adults')  :
    type.startsWith('child')  ? (count === 1 ? 'Child'  : 'Children'):
    type.startsWith('infant') ? (count === 1 ? 'Infant' : 'Infants') :
    'Pax'
  return `${count} ${noun}`
}

export function formatMoney(value: number | string | null | undefined, currency = 'USD'): string | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return `${currency} ${n.toFixed(2)}`
}

// ── Category presentation ─────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<string, string> = {
  HOTEL: 'Hotel Voucher',
  TICKETS: 'Entrance Ticket',
  CRUISE: 'Cruise Ticket',
  WATER: 'Water Activity Ticket',
  GUIDES: 'Guide Service Voucher',
  FLIGHT_TICKETS: 'Flight Ticket',
  TRANSPORT: 'Transfer Voucher',
  MEALS: 'Meal Voucher',
  OTHER: 'Service Voucher',
}

export const CATEGORY_COLOR: Record<string, string> = {
  HOTEL: '#2563eb',
  TICKETS: '#7c3aed',
  CRUISE: '#0891b2',
  WATER: '#0284c7',
  GUIDES: '#16a34a',
  FLIGHT_TICKETS: '#dc2626',
  TRANSPORT: '#ea580c',
  MEALS: '#d97706',
  OTHER: '#64748b',
}

export const CATEGORY_ICON: Record<string, string> = {
  HOTEL: '🏨',
  TICKETS: '🎟️',
  CRUISE: '🛳️',
  WATER: '🌊',
  GUIDES: '🧭',
  FLIGHT_TICKETS: '✈️',
  TRANSPORT: '🚐',
  MEALS: '🍽️',
  OTHER: '🎫',
}

export function categoryLabel(category: string | null | undefined): string {
  return CATEGORY_LABEL[category ?? 'OTHER'] ?? CATEGORY_LABEL.OTHER
}
export function categoryColor(category: string | null | undefined): string {
  return CATEGORY_COLOR[category ?? 'OTHER'] ?? CATEGORY_COLOR.OTHER
}
export function categoryIcon(category: string | null | undefined): string {
  return CATEGORY_ICON[category ?? 'OTHER'] ?? CATEGORY_ICON.OTHER
}

/** Short human code printed on the ticket stub so staff can match paper to record. */
export function ticketCode(id: string): string {
  return `TKT-${id.slice(-8).toUpperCase()}`
}

export function ticketFileKind(
  ticket: { fileUrl?: string | null; fileType?: string | null },
): 'image' | 'pdf' | null {
  if (!ticket.fileUrl) return null
  if (ticket.fileType === 'image') return 'image'
  if (ticket.fileType === 'pdf') return 'pdf'
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(ticket.fileUrl)) return 'image'
  if (/\.pdf(\?|$)/i.test(ticket.fileUrl)) return 'pdf'
  return null
}

/**
 * Deterministic barcode stripe widths, so the same ticket always prints the same
 * pattern (it is decorative — the reference number is the real identifier).
 */
export function barcodeBars(seed: string, count = 44): number[] {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    hash = (hash * 1103515245 + 12345) >>> 0
    bars.push(1 + (hash % 4))
  }
  return bars
}

/**
 * Everything a renderer needs about one ticket, already resolved and labelled.
 * Kept renderer-agnostic so the React print pages, the PDFKit agenda and the
 * docx agenda all show the same facts in the same order.
 */
export interface TicketFactRow { label: string; value: string }

export function ticketFacts(
  ticket: {
    id: string
    qty?: number | null
    supplier?: string | null
    reference?: string | null
    notes?: string | null
    currency?: string | null
    totalCost?: string | number | null
    costPerUnit?: string | number | null
    purchasedAt?: string | Date | null
    driverName?: string | null
    driverPhone?: string | null
    vehicleType?: string | null
    vehicleNumber?: string | null
    agendaItem?: { date?: string | Date | null; location?: string | null; toPoint?: string | null } | null
    pnlLine?: { activity?: string | null; paymentRefNumber?: string | null } | null
  },
  meta: TicketNoteMeta,
  fmtDate: (value: string | Date) => string,
): TicketFactRow[] {
  const rows: TicketFactRow[] = []
  const push = (label: string, value: string | null | undefined) => {
    if (value && String(value).trim()) rows.push({ label, value: String(value).trim() })
  }

  push('Guest', meta.clientName)
  push('Pax', paxLabel(meta.pax ?? ticket.qty ?? null, meta.paxType))
  if (ticket.agendaItem?.date) push('Service Date', fmtDate(ticket.agendaItem.date))
  push('Location', ticket.agendaItem?.location
    ? ticket.agendaItem.location + (ticket.agendaItem.toPoint ? ` → ${ticket.agendaItem.toPoint}` : '')
    : null)
  push('Check-in', meta.checkIn)
  push('Check-out', meta.checkOut)
  push('Supplier', ticket.supplier)
  push('Rate', meta.rate !== null ? formatMoney(meta.rate, ticket.currency ?? 'USD') : null)
  push('Total', formatMoney(ticket.totalCost ?? null, ticket.currency ?? 'USD'))
  push('Vehicle', [ticket.vehicleType, ticket.vehicleNumber].filter(Boolean).join(' ') || null)
  push('Driver', ticket.driverName
    ? `${ticket.driverName}${ticket.driverPhone ? ` · ${ticket.driverPhone}` : ''}`
    : null)
  if (ticket.purchasedAt) push('Purchased', fmtDate(ticket.purchasedAt))
  push('Payment Ref', ticket.pnlLine?.paymentRefNumber)

  return rows
}
