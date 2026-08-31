/**
 * Printable documents for an Aahaas B2B booking: the full detail sheet and the
 * invoice. Both are plain HTML strings so they can be either streamed to the
 * browser (`?format=html`, which prints cleanly) or rendered to PDF here.
 *
 * These render from the read model in `b2b-flights.ts` and touch no database of
 * their own — nothing in this file can write anywhere.
 *
 * PDF rendering deliberately does NOT go through `htmlToPdf()`: that helper
 * stamps an "Apple Holidays · MMT Vietnam" band onto every page, which is wrong
 * on an Aahaas B2B document. We reuse its `launchBrowser()` (the part that knows
 * how to find Chromium on every deploy target) and supply our own page chrome.
 */
import { launchBrowser } from './html-to-pdf'
import type {
  B2bBookingDetail, FlightComponent, HotelComponent, InsuranceComponent, LifestyleComponent,
} from './b2b-flights'

// ─── Primitives ───────────────────────────────────────────────────────────────

export function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const DASH = '—'

function money(v: number | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const n = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${n}` : n
}

function date(v: string | null | undefined): string {
  if (!v) return DASH
  const d = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function dateTime(v: string | null | undefined): string {
  if (!v) return DASH
  const d = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

function duration(mins: number | null | undefined): string {
  if (!mins || !Number.isFinite(mins)) return DASH
  const h = Math.floor(mins / 60), m = mins % 60
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`
}

/** `label → value` definition rows; empty values collapse to an em dash. */
function facts(items: [string, unknown][]): string {
  const cells = items
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `
      <div class="fact">
        <div class="fact-k">${esc(k)}</div>
        <div class="fact-v">${v === null || v === '' ? DASH : esc(v)}</div>
      </div>`)
    .join('')
  return `<div class="facts">${cells}</div>`
}

// ─── Shared page chrome ───────────────────────────────────────────────────────

const BASE_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif;
    color: #0f172a; font-size: 11px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { padding: 26px 30px 34px; }
  .brandbar {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 16px 20px; border-radius: 12px; color: #fff;
    background: linear-gradient(120deg, #0f172a 0%, #1e3a8a 55%, #0ea5e9 100%);
  }
  .brand-title { font-size: 17px; font-weight: 800; letter-spacing: -.3px; margin: 0; }
  .brand-sub { font-size: 9.5px; opacity: .82; margin-top: 3px; letter-spacing: .5px; text-transform: uppercase; }
  .brand-ref { text-align: right; }
  .brand-ref .ref { font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; }
  .brand-ref .meta { font-size: 9px; opacity: .8; margin-top: 3px; }
  .chip {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 8.5px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
    background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.35);
  }
  h2.section {
    margin: 20px 0 8px; font-size: 11.5px; font-weight: 800; letter-spacing: .8px;
    text-transform: uppercase; color: #1e3a8a;
    border-bottom: 2px solid #dbeafe; padding-bottom: 5px;
  }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .card-title { font-size: 12.5px; font-weight: 700; }
  .card-amt { font-size: 12px; font-weight: 700; color: #0f766e; white-space: nowrap; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px 12px; }
  .fact-k { font-size: 8px; text-transform: uppercase; letter-spacing: .5px; color: #94a3b8; font-weight: 700; }
  .fact-v { font-size: 10.5px; color: #0f172a; margin-top: 1px; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f1f5f9; font-size: 8.5px; text-transform: uppercase; letter-spacing: .5px; color: #475569;
       text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 10px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .mono { font-family: 'SFMono-Regular', Menlo, Consolas, monospace; }
  .right { text-align: right; }
  .muted { color: #94a3b8; }
  .leg { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
  .leg .pt { text-align: center; min-width: 74px; }
  .leg .code { font-size: 16px; font-weight: 800; letter-spacing: -.5px; }
  .leg .t { font-size: 10px; color: #334155; }
  .leg .d { font-size: 8.5px; color: #94a3b8; }
  .leg .line { flex: 1; position: relative; height: 1px; background: #cbd5e1; }
  .leg .line span {
    position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
    background: #fff; padding: 0 6px; font-size: 8.5px; color: #64748b; white-space: nowrap;
  }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8.5px; color: #94a3b8; }
  .badge { display:inline-block; padding: 1.5px 7px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
           text-transform: uppercase; letter-spacing: .4px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .badge.warn { background: #fffbeb; color: #b45309; border-color: #fde68a; }
  .badge.dim  { background: #f8fafc; color: #64748b; border-color: #e2e8f0; }
  @page { size: A4; margin: 12mm 0; }
`

function doc(title: string, css: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head>
<body><div class="page">${body}</div></body></html>`
}

function statusBadge(value: string | null | undefined): string {
  const v = (value ?? '').toLowerCase()
  const cls = ['confirmed', 'ticketed', 'issued', 'paid', 'success', 'active'].includes(v) ? ''
    : ['pending', 'processing', 'hold'].includes(v) ? 'warn' : 'dim'
  return `<span class="badge ${cls}">${esc(value || 'unknown')}</span>`
}

// ─── Detail sheet ─────────────────────────────────────────────────────────────

function flightBlock(f: FlightComponent): string {
  const legs = f.segments.map((s) => `
    <div class="leg">
      <div class="pt">
        <div class="code">${esc(s.fromAirportCode || DASH)}</div>
        <div class="t">${esc(s.departureTime || '')}</div>
        <div class="d">${esc(date(s.departureDate))}</div>
      </div>
      <div class="line"><span>${esc([
        [s.airlineCode, s.flightNumber].filter(Boolean).join(' '),
        duration(s.durationInMinutes),
        s.cabinTypeName,
        s.bookingClass ? `class ${s.bookingClass}` : null,
      ].filter(Boolean).join(' · '))}</span></div>
      <div class="pt">
        <div class="code">${esc(s.toAirportCode || DASH)}</div>
        <div class="t">${esc(s.arrivalTime || '')}</div>
        <div class="d">${esc(date(s.arrivalDate))}</div>
      </div>
    </div>
    ${facts([
      ['Aircraft', s.aircraftTypeName],
      ['Dep terminal / gate', [s.departureTerminal, s.departureGate].filter(Boolean).join(' / ') || null],
      ['Arr terminal / gate', [s.arrivalTerminal, s.arrivalGate].filter(Boolean).join(' / ') || null],
      ['Baggage', s.baggage
        ? [s.baggage.checkedKg ? `${s.baggage.checkedKg} kg checked` : null,
           s.baggage.cabinKg ? `${s.baggage.cabinKg} kg cabin` : null].filter(Boolean).join(' · ') || null
        : null],
    ])}`).join('')

  const pax = f.travelers.length ? `
    <table>
      <thead><tr><th>Passenger</th><th>Type</th><th>Document</th><th>Nationality</th><th>Contact</th><th>Ticket</th></tr></thead>
      <tbody>${f.travelers.map((t) => `
        <tr>
          <td><strong>${esc(t.fullName || DASH)}</strong></td>
          <td>${esc(t.type || DASH)}</td>
          <td class="mono">${esc(t.documents[0]?.number || DASH)}</td>
          <td>${esc(t.documents[0]?.nationality || DASH)}</td>
          <td>${esc([t.email, t.phone].filter(Boolean).join(' · ') || DASH)}</td>
          <td class="mono">${esc(t.ticketNumber || DASH)}</td>
        </tr>`).join('')}</tbody>
    </table>` : ''

  const tickets = f.tickets.length ? `
    <table>
      <thead><tr><th>Ticket no.</th><th>Issued</th><th>Status</th><th class="right">Amount</th></tr></thead>
      <tbody>${f.tickets.map((t) => `
        <tr>
          <td class="mono">${esc(t.number || DASH)}</td>
          <td>${esc(date(t.date))}</td>
          <td>${statusBadge(t.statusName)}</td>
          <td class="right">${esc(money(t.total, t.currency ?? f.currency))}</td>
        </tr>`).join('')}</tbody>
    </table>` : ''

  return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">
          ${esc(f.airlineName || f.airlineCode || 'Flight')}
          ${f.pnr ? `<span class="mono muted"> · PNR ${esc(f.pnr)}</span>` : ''}
        </div>
        <div class="card-amt">${esc(money(f.total, f.currency))}</div>
      </div>
      ${facts([
        ['Route', [f.departureCity, f.arrivalCity].filter(Boolean).join(' → ') || null],
        ['Trip type', f.tripType],
        ['Departure', date(f.departureDate)],
        ['Return', f.returnDate ? date(f.returnDate) : null],
        ['Cabin', f.cabinClass],
        ['Pax', [f.adults ? `${f.adults} adult` : null, f.children ? `${f.children} child` : null,
                 f.infants ? `${f.infants} infant` : null].filter(Boolean).join(', ') || null],
        ['Booking status', f.status],
        ['Ticket status', f.ticketStatus],
        ['Base fare', money(f.baseFare, f.currency)],
        ['Taxes', money(f.taxes, f.currency)],
        ['Ticketed at', f.ticketedAt ? dateTime(f.ticketedAt) : null],
        ['Aahaas order', f.aahaasOrderId],
      ])}
      ${legs}
      ${pax}
      ${tickets}
    </div>`
}

function hotelBlock(h: HotelComponent): string {
  return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">${esc(h.hotelName || 'Hotel')}${h.starRating ? ` <span class="muted">${'★'.repeat(Math.min(h.starRating, 5))}</span>` : ''}</div>
        <div class="card-amt">${esc(money(h.total, h.currency))}</div>
      </div>
      ${facts([
        ['City', [h.city, h.country].filter(Boolean).join(', ') || null],
        ['Check-in', date(h.checkIn)],
        ['Check-out', date(h.checkOut)],
        ['Nights', h.nights],
        ['Rooms', h.rooms],
        ['Room', [h.roomCategory, h.roomType].filter(Boolean).join(' · ') || null],
        ['Meal plan', h.mealPlan],
        ['Guests', [h.adults ? `${h.adults} adult` : null, h.children ? `${h.children} child` : null].filter(Boolean).join(', ') || null],
        ['Room rate', money(h.roomRate, h.currency)],
        ['Confirmation', h.confirmationNumber],
        ['Status', h.status],
        ['Confirmed at', h.confirmedAt ? dateTime(h.confirmedAt) : null],
      ])}
      ${h.guests.length ? `<table><thead><tr><th>Guest</th><th>Type</th></tr></thead><tbody>
        ${h.guests.map((g) => `<tr><td>${esc(g.name || DASH)}</td><td>${esc(g.type || DASH)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${h.specialRequests ? `<div style="margin-top:8px"><span class="fact-k">Special requests</span><div class="fact-v">${esc(h.specialRequests)}</div></div>` : ''}
    </div>`
}

function insuranceBlock(i: InsuranceComponent): string {
  return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">${esc(i.planName || i.policyType || 'Insurance')} <span class="muted">${esc(i.provider || '')}</span></div>
        <div class="card-amt">${esc(money(i.total ?? i.premium, i.currency))}</div>
      </div>
      ${facts([
        ['Policy no.', i.policyNumber],
        ['Policy type', i.policyType],
        ['Destination', i.destinationCountry],
        ['Cover from', date(i.coverageStart)],
        ['Cover to', date(i.coverageEnd)],
        ['Days', i.coverageDays],
        ['Travellers', i.travelerCount],
        ['Premium', money(i.premium, i.currency)],
        ['Sum insured', money(i.coverageAmount, i.currency)],
        ['Status', i.status],
        ['Issued at', i.issuedAt ? dateTime(i.issuedAt) : null],
        ['Expires', i.expiresAt ? dateTime(i.expiresAt) : null],
      ])}
      ${i.travelers.length ? `<table><thead><tr><th>Traveller</th><th>Passport / NIC</th><th>Date of birth</th></tr></thead><tbody>
        ${i.travelers.map((t) => `<tr><td>${esc(t.name || DASH)}</td><td class="mono">${esc(t.passport || DASH)}</td><td>${esc(t.dob ? date(t.dob) : DASH)}</td></tr>`).join('')}
      </tbody></table>` : ''}
    </div>`
}

function lifestyleBlock(l: LifestyleComponent): string {
  return `
    <div class="card">
      <div class="card-head">
        <div class="card-title">${esc(l.name || 'Experience')}</div>
        <div class="card-amt">${esc(money(l.total, l.currency))}</div>
      </div>
      ${facts([
        ['Category', [l.category, l.subCategory].filter(Boolean).join(' · ') || null],
        ['Service date', date(l.serviceDate)],
        ['Time', l.serviceTime],
        ['Adults', l.adults],
        ['Children', l.children],
        ['Packages', l.packages],
        ['Unit price', money(l.unitPrice, l.currency)],
        ['Discount', money(l.discount, l.currency)],
        ['Paid', money(l.paid, l.currency)],
        ['Confirmation', l.confirmationNumber],
        ['Status', l.status],
        ['Confirmed at', l.confirmedAt ? dateTime(l.confirmedAt) : null],
      ])}
      ${l.participants.length ? `<table><thead><tr><th>Participant</th><th>Type</th></tr></thead><tbody>
        ${l.participants.map((p) => `<tr><td>${esc(p.name || DASH)}</td><td>${esc(p.type || DASH)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${l.specialRequests ? `<div style="margin-top:8px"><span class="fact-k">Special requests</span><div class="fact-v">${esc(l.specialRequests)}</div></div>` : ''}
    </div>`
}

/** The complete booking, every component expanded — the "Download PDF" document. */
export function buildBookingDetailHtml(b: B2bBookingDetail): string {
  const body = `
    <div class="brandbar">
      <div>
        <p class="brand-title">Aahaas B2B · Booking Confirmation</p>
        <div class="brand-sub">${esc(b.agentName || 'Agent booking')}${b.travelDate ? ` · travel from ${esc(date(b.travelDate))}` : ''}</div>
        <div style="margin-top:8px"><span class="chip">${esc(b.status || 'confirmed')}</span>
          <span class="chip">payment ${esc(b.paymentStatus || DASH)}</span>
          ${b.paymentMethod ? `<span class="chip">${esc(b.paymentMethod)}</span>` : ''}</div>
      </div>
      <div class="brand-ref">
        <div class="ref">${esc(b.reference)}</div>
        <div class="meta">Order #${esc(b.orderId ?? DASH)}</div>
        <div class="meta">Booked ${esc(dateTime(b.createdAt))}</div>
      </div>
    </div>

    <h2 class="section">Booking summary</h2>
    ${facts([
      ['Reference', b.reference],
      ['UUID', b.uuid],
      ['Aahaas order', b.orderId],
      ['Booking type', b.type],
      ['Lead traveller', b.leadTraveller],
      ['Agent', b.agentName],
      ['Agent email', b.agentEmail],
      ['Travellers', b.pax],
      ['Total charged', money(b.amount, b.currency)],
      ['Payment method', b.paymentMethod],
      ['Payment reference', b.paymentReference],
      ['Order status', b.orderStatus],
      ['Created', dateTime(b.createdAt)],
      ['Last updated', dateTime(b.updatedAt)],
      ['Components', [
        b.components.flights ? `${b.components.flights} flight` : null,
        b.components.hotels ? `${b.components.hotels} hotel` : null,
        b.components.insurances ? `${b.components.insurances} insurance` : null,
        b.components.lifestyles ? `${b.components.lifestyles} experience` : null,
      ].filter(Boolean).join(', ') || 'none'],
      ['PNR', b.pnrs.join(', ') || null],
    ])}

    ${b.flights.length ? `<h2 class="section">Flights</h2>${b.flights.map(flightBlock).join('')}` : ''}
    ${b.hotels.length ? `<h2 class="section">Hotels</h2>${b.hotels.map(hotelBlock).join('')}` : ''}
    ${b.insurances.length ? `<h2 class="section">Travel insurance</h2>${b.insurances.map(insuranceBlock).join('')}` : ''}
    ${b.lifestyles.length ? `<h2 class="section">Experiences</h2>${b.lifestyles.map(lifestyleBlock).join('')}` : ''}

    <div class="foot">
      Generated ${esc(dateTime(new Date().toISOString()))} from the Aahaas B2B store (read-only).
      This document reflects the booking record as stored at the time of generation.
    </div>`
  return doc(`${b.reference} — Booking details`, '', body)
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export interface InvoiceLine {
  kind: 'Flight' | 'Hotel' | 'Insurance' | 'Experience'
  description: string
  detail: string
  qty: number
  currency: string | null
  amount: number | null
}

/**
 * One invoice line per component. The header `amount` remains the authoritative
 * charged figure — the lines are what makes it up, and when they disagree the
 * invoice says so rather than silently rewriting either number.
 */
export function buildInvoiceLines(b: B2bBookingDetail): InvoiceLine[] {
  const lines: InvoiceLine[] = []

  for (const f of b.flights) {
    const route = f.segments.length
      ? f.segments.map((s) => `${s.fromAirportCode ?? '?'}–${s.toAirportCode ?? '?'}`).join(' / ')
      : [f.departureCity, f.arrivalCity].filter(Boolean).join(' – ')
    lines.push({
      kind: 'Flight',
      description: [f.airlineName || f.airlineCode, route].filter(Boolean).join(' · ') || 'Air ticket',
      detail: [
        f.pnr ? `PNR ${f.pnr}` : null,
        f.cabinClass,
        date(f.departureDate),
        [f.adults ? `${f.adults}A` : null, f.children ? `${f.children}C` : null, f.infants ? `${f.infants}I` : null]
          .filter(Boolean).join('/') || null,
      ].filter(Boolean).join(' · '),
      qty: (f.adults ?? 0) + (f.children ?? 0) + (f.infants ?? 0) || 1,
      currency: f.currency ?? b.currency,
      amount: f.total,
    })
  }
  for (const h of b.hotels) {
    lines.push({
      kind: 'Hotel',
      description: [h.hotelName, h.city].filter(Boolean).join(' · ') || 'Hotel stay',
      detail: [
        `${date(h.checkIn)} → ${date(h.checkOut)}`,
        h.nights ? `${h.nights} night${h.nights === 1 ? '' : 's'}` : null,
        h.roomType, h.mealPlan,
        h.confirmationNumber ? `Conf ${h.confirmationNumber}` : null,
      ].filter(Boolean).join(' · '),
      qty: h.rooms ?? 1,
      currency: h.currency ?? b.currency,
      amount: h.total,
    })
  }
  for (const i of b.insurances) {
    lines.push({
      kind: 'Insurance',
      description: [i.provider, i.planName].filter(Boolean).join(' · ') || 'Travel insurance',
      detail: [
        i.policyNumber ? `Policy ${i.policyNumber}` : null,
        `${date(i.coverageStart)} → ${date(i.coverageEnd)}`,
        i.destinationCountry,
      ].filter(Boolean).join(' · '),
      qty: i.travelerCount ?? 1,
      currency: i.currency ?? b.currency,
      amount: i.total ?? i.premium,
    })
  }
  for (const l of b.lifestyles) {
    lines.push({
      kind: 'Experience',
      description: [l.name, l.category].filter(Boolean).join(' · ') || 'Experience',
      detail: [date(l.serviceDate), l.serviceTime, l.confirmationNumber ? `Conf ${l.confirmationNumber}` : null]
        .filter(Boolean).join(' · '),
      qty: (l.adults ?? 0) + (l.children ?? 0) || l.packages || 1,
      currency: l.currency ?? b.currency,
      amount: l.total,
    })
  }
  return lines
}

export function invoiceNumber(b: B2bBookingDetail): string {
  const created = b.createdAt ? new Date(b.createdAt.replace(' ', 'T') + 'Z') : new Date()
  const yy = Number.isNaN(created.getTime()) ? '0000' : String(created.getUTCFullYear())
  return `INV-B2B-${yy}-${String(b.id).padStart(6, '0')}`
}

export function buildInvoiceHtml(b: B2bBookingDetail): string {
  const lines = buildInvoiceLines(b)
  const linesTotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0)
  const charged = b.amount
  // Components may be priced in their own currency; only claim a summed subtotal
  // when every line agrees with the header currency.
  const mixed = lines.some((l) => l.currency && b.currency && l.currency !== b.currency)
  const variance = charged !== null && !mixed ? Number((charged - linesTotal).toFixed(2)) : null

  const paid = (b.paymentStatus ?? '').toLowerCase() === 'confirmed'
    || (b.paymentStatus ?? '').toLowerCase() === 'paid'

  const css = `
    .inv-head { display:flex; justify-content:space-between; gap:24px; margin-top:18px; }
    .party { font-size:10.5px; line-height:1.55; }
    .party .who { font-size:8px; text-transform:uppercase; letter-spacing:.6px; color:#94a3b8; font-weight:800; margin-bottom:3px; }
    .totals { margin-top:12px; margin-left:auto; width:56%; }
    .totals td { padding:5px 8px; font-size:10.5px; }
    .totals tr.grand td { font-size:13px; font-weight:800; border-top:2px solid #0f172a; border-bottom:none; }
    .stamp {
      float:right; margin-top:14px; border:2.5px solid ${paid ? '#047857' : '#b45309'};
      color:${paid ? '#047857' : '#b45309'}; border-radius:8px; padding:6px 16px;
      font-size:15px; font-weight:900; letter-spacing:2px; text-transform:uppercase;
      transform: rotate(-6deg); opacity:.86;
    }
  `

  const body = `
    <div class="brandbar">
      <div>
        <p class="brand-title">Invoice</p>
        <div class="brand-sub">Aahaas B2B · Agent booking</div>
      </div>
      <div class="brand-ref">
        <div class="ref">${esc(invoiceNumber(b))}</div>
        <div class="meta">Booking ${esc(b.reference)}</div>
        <div class="meta">Issued ${esc(date(b.createdAt))}</div>
      </div>
    </div>

    <div class="inv-head">
      <div class="party">
        <div class="who">Billed to</div>
        <strong>${esc(b.agentName || 'Aahaas B2B agent')}</strong><br>
        ${b.agentEmail ? `${esc(b.agentEmail)}<br>` : ''}
        ${b.leadTraveller ? `<span class="muted">Lead traveller: ${esc(b.leadTraveller)}</span>` : ''}
      </div>
      <div class="party">
        <div class="who">Payment</div>
        Method: <strong>${esc(b.paymentMethod || DASH)}</strong><br>
        Status: ${statusBadge(b.paymentStatus)}<br>
        ${b.paymentReference ? `Reference: <span class="mono">${esc(b.paymentReference)}</span><br>` : ''}
        ${b.transactionId ? `Txn: <span class="mono">${esc(b.transactionId)}</span>` : ''}
      </div>
      <div class="party">
        <div class="who">Order</div>
        Aahaas order: <span class="mono">${esc(b.orderId ?? DASH)}</span><br>
        Order status: ${statusBadge(b.orderStatus)}<br>
        Booking status: ${statusBadge(b.status)}
      </div>
    </div>

    <table>
      <thead>
        <tr><th style="width:74px">Type</th><th>Description</th><th class="right" style="width:44px">Qty</th><th class="right" style="width:110px">Amount</th></tr>
      </thead>
      <tbody>
        ${lines.length ? lines.map((l) => `
          <tr>
            <td><span class="badge dim">${esc(l.kind)}</span></td>
            <td><strong>${esc(l.description)}</strong>${l.detail ? `<div class="muted">${esc(l.detail)}</div>` : ''}</td>
            <td class="right">${esc(l.qty)}</td>
            <td class="right">${esc(money(l.amount, l.currency))}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" class="muted">No component lines are recorded for this booking.</td></tr>`}
      </tbody>
    </table>

    <table class="totals">
      <tbody>
        <tr><td>Components subtotal</td><td class="right">${mixed ? '<span class="muted">mixed currencies</span>' : esc(money(linesTotal, b.currency))}</td></tr>
        ${variance !== null && Math.abs(variance) >= 0.01
          ? `<tr><td>Adjustment / fees</td><td class="right">${esc(money(variance, b.currency))}</td></tr>` : ''}
        <tr class="grand"><td>Total charged</td><td class="right">${esc(money(charged, b.currency))}</td></tr>
      </tbody>
    </table>

    <div class="stamp">${paid ? 'Paid' : esc(b.paymentStatus || 'Unpaid')}</div>
    <div style="clear:both"></div>

    <div class="foot">
      ${esc(invoiceNumber(b))} · generated ${esc(dateTime(new Date().toISOString()))}.
      Figures are read directly from the Aahaas B2B booking record; this system never modifies them.
    </div>`

  return doc(`${invoiceNumber(b)} — Invoice`, css, body)
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

/** Render one of the documents above to a PDF buffer. Own chrome, no archiving. */
export async function renderB2bPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:1px;"> </div>',
      footerTemplate: `
        <div style="width:100%;padding:0 30px;font-family:Arial,Helvetica,sans-serif;
                    font-size:8px;color:#94a3b8;display:flex;justify-content:space-between;">
          <span>Aahaas B2B · read-only export</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '10mm', right: '0', bottom: '14mm', left: '0' },
    })
    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
