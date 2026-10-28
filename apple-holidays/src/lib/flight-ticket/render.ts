/**
 * The printed B2C flight ticket — A4, double-sided, three tickets a sheet,
 * cut apart on the crop marks.
 *
 * GEOMETRY (all mm). A ticket is 190 × 88, centred across the 210 mm page, so
 * its x is 10 on BOTH sides of the paper. Rows sit at the same y on both sides.
 * The back is designed as the front's mirror — the front stub is on the right,
 * the back stub on the left — so when the printer turns the sheet on its LONG
 * edge (the duplex default), every panel lands behind its partner:
 *
 *      front:  [ art 62 | details 83 | stub 45 ]
 *      back:   [ stub 45 | info 83   | art 62  ]   ← seen through the paper
 *
 * A SHORT-edge printer turns the back upside down, so that page is rotated
 * 180°. Any printer drifts a little in duplex, so the back can be nudged by
 * a few mm (TicketPrintOptions.backOffsetX/Y), measured once on a test print.
 *
 * Nothing invented: no gate, seat or boarding time (the airline assigns those
 * at check-in) — the ticket says so, and says it is not a boarding pass.
 */
import QRCode from 'qrcode'
import type { FlightTicketData, TicketPassenger, TicketPrintOptions, TicketSegment } from './types'

export const SHEET = { w: 210, h: 297 }
export const TICKET = { w: 190, h: 88, gap: 8, perSheet: 3 }
const LEFT = (SHEET.w - TICKET.w) / 2
const TOP = (SHEET.h - TICKET.perSheet * TICKET.h - (TICKET.perSheet - 1) * TICKET.gap) / 2
const ART = 62
const STUB = 45

export const AAHAAS_CONTACT = {
  address: '27th Floor, East Tower, World Trade Center, Colombo 01, Sri Lanka',
  phone: '+94 70 722 4227',
  email: 'info@aahaas.com',
  web: 'www.aahaas.com',
}

export interface TicketAssets {
  front: string
  back: string
  logo: string
  /** The round "A" mark, for the faint watermark on the stubs. */
  mark: string
}

interface OneTicket {
  passenger: TicketPassenger
  segment: TicketSegment
  /** "1 of 2" when a trip has several flights. */
  leg: string | null
  qr: string
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dash = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? '—' : esc(v))

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
/** '2026-11-10' → "10 NOV 2026"; with weekday → "TUE 10 NOV 2026". */
function dayLabel(iso: string | null, weekday = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return `${weekday ? DOW[d.getUTCDay()] + ' ' : ''}${m[3]} ${MON[+m[2] - 1]} ${m[1]}`
}

/** Big city lettering that still fits "Ho Chi Minh City" in the column. */
function citySize(name: string): number {
  const n = name.length
  return n <= 8 ? 27 : n <= 10 ? 23 : n <= 13 ? 19 : n <= 16 ? 15.5 : 13
}

function cityOf(p: TicketSegment['from']): string {
  return (p.city || p.airport?.split(/[-–,]/)[0]?.trim() || p.code || '—').toUpperCase()
}

const ICON = {
  plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  passport: '<rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 17h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  bag: '<rect x="3" y="7" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5" fill="#fff"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3 7 9 6 9-6" fill="none" stroke="currentColor" stroke-width="2"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  hotel: '<path d="M3 18V7M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-8v1" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="10.5" r="1.8"/>',
  star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="2"/>',
}
const icon = (name: keyof typeof ICON, size = 3.4) =>
  `<svg viewBox="0 0 24 24" style="width:${size}mm;height:${size}mm" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`

/** What the QR code says — readable by any phone camera, no app needed. */
function qrText(data: FlightTicketData, t: Pick<OneTicket, 'passenger' | 'segment'>): string {
  const s = t.segment
  return [
    'AAHAAS E-TICKET ITINERARY',
    data.orderId ? `Order ${data.orderId}` : null,
    data.bookingRef ? `Booking ref ${data.bookingRef}` : null,
    data.airlinePnr ? `Airline PNR ${data.airlinePnr}` : null,
    `${s.flightNo ?? ''} ${s.from.code}-${s.to.code} ${s.from.date ?? ''} ${s.from.time ?? ''}`.trim(),
    `Passenger ${t.passenger.name}`,
    t.passenger.eticket ? `E-ticket ${t.passenger.eticket}` : null,
  ].filter(Boolean).join('\n')
}

export async function buildTickets(data: FlightTicketData, perSegment: boolean): Promise<OneTicket[]> {
  const segments = perSegment ? data.segments : data.segments.slice(0, 1)
  const out: OneTicket[] = []
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    for (const passenger of data.passengers) {
      const base = { passenger, segment }
      out.push({
        ...base,
        leg: perSegment && data.segments.length > 1 ? `Flight ${i + 1} of ${data.segments.length}` : null,
        qr: await QRCode.toDataURL(qrText(data, base), { errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: '#0f1f3a', light: '#ffffff' } }),
      })
    }
  }
  return out
}

function front(data: FlightTicketData, t: OneTicket, a: TicketAssets): string {
  const s = t.segment
  const fromCity = cityOf(s.from)
  const toCity = cityOf(s.to)
  const route = `${fromCity} ✈ ${toCity}`
  const moreFlights = !t.leg && data.segments.length > 1 ? `+ ${data.segments.length - 1} more flight${data.segments.length > 2 ? 's' : ''} on this booking` : null

  return `
  <div class="art" style="background-image:url('${a.front}')">
    <div class="art-veil"></div>
    <img class="logo" src="${a.logo}" alt="Aahaas">
    <div class="script">Your next<br>destination awaits</div>
    <svg class="swoosh" viewBox="0 0 200 40" aria-hidden="true"><path d="M2 34 C 60 30, 120 22, 178 8" fill="none" stroke="#e3262f" stroke-width="2.2" stroke-linecap="round"/><g transform="translate(176 2) rotate(-18) scale(.55)" fill="#e3262f">${ICON.plane}</g></svg>
    <div class="services">
      <span>${icon('plane', 2.6)}Flights</span><span>${icon('hotel', 2.6)}Hotels</span><span>${icon('star', 2.6)}Activities</span><span>${icon('shield', 2.6)}Visa</span>
    </div>
  </div>

  <div class="mid">
    <div class="route">
      <div class="end">
        <div class="lbl">From</div>
        <div class="city" style="font-size:${citySize(fromCity)}pt">${esc(fromCity)}</div>
        <div class="code">${esc(s.from.code)}${s.from.airport && s.from.airport !== s.from.code ? ` · <span>${esc(s.from.airport)}</span>` : ''}</div>
      </div>
      <div class="hop">
        <span class="dashline"></span><span class="hop-plane">${icon('plane', 6)}</span><span class="dashline"></span>
        ${s.duration ? `<div class="dur">${esc(s.duration)}</div>` : ''}
      </div>
      <div class="end right">
        <div class="lbl">To</div>
        <div class="city" style="font-size:${citySize(toCity)}pt">${esc(toCity)}</div>
        <div class="code">${esc(s.to.code)}${s.to.airport && s.to.airport !== s.to.code ? ` · <span>${esc(s.to.airport)}</span>` : ''}</div>
      </div>
    </div>

    <div class="grid">
      <div><div class="lbl">Flight</div><div class="val">${dash(s.flightNo)}</div><div class="sub">${dash(s.airline)}</div></div>
      <div><div class="lbl">Date</div><div class="val">${dash(dayLabel(s.from.date))}</div><div class="sub">${dash(dayLabel(s.from.date, true)?.slice(0, 3))}</div></div>
      <div><div class="lbl">Departs</div><div class="val">${dash(s.from.time)}</div><div class="sub">Local time</div></div>
      <div><div class="lbl">Arrives</div><div class="val">${dash(s.to.time)}</div><div class="sub">${s.to.date && s.to.date !== s.from.date ? esc(dayLabel(s.to.date)) : 'Local time'}</div></div>
    </div>
    <div class="grid g2">
      <div><div class="lbl">Class</div><div class="val sm">${dash(s.cabin)}</div></div>
      <div><div class="lbl">Baggage</div><div class="val sm">${dash(s.checkedBaggage)}${s.cabinBaggage ? `<span class="soft"> + ${esc(s.cabinBaggage)} cabin</span>` : ''}</div></div>
      <div><div class="lbl">Seat</div><div class="val sm soft">At check-in</div></div>
    </div>

    <div class="refbox">
      <div><div class="lbl">Airline PNR</div><div class="rval">${dash(data.airlinePnr)}</div><div class="sub">For web check-in</div></div>
      <div><div class="lbl">Booking ref</div><div class="rval">${dash(data.bookingRef)}</div><div class="sub">${data.orderId ? `Order #${esc(data.orderId)}` : 'Quote to Aahaas'}</div></div>
      <div><div class="lbl">E-ticket no.</div><div class="rval">${dash(t.passenger.eticket)}</div><div class="sub">${esc(t.passenger.name)}</div></div>
    </div>
    <div class="fine">${t.leg ? `${esc(t.leg)} · ` : ''}${moreFlights ? `${esc(moreFlights)} · ` : ''}Check-in closes 60 minutes before departure · This is an e-ticket itinerary, not a boarding pass</div>
  </div>

  <div class="stub front-stub">
    <div class="perf"></div>
    <div class="stub-body">
      <img class="qr" src="${t.qr}" alt="">
      <div class="lbl w">Passenger</div>
      <div class="pax">${esc(t.passenger.name.toUpperCase())}</div>
      <div class="pax-type">${dash(t.passenger.type)}</div>
      <div class="pair">
        <div><div class="lbl w">Flight</div><div class="sval">${dash(s.flightNo)}</div></div>
        <div><div class="lbl w">Departs</div><div class="sval">${dash(s.from.time)}</div></div>
      </div>
      <div class="lbl w">Date</div>
      <div class="sval">${dash(dayLabel(s.from.date))}</div>
    </div>
    <div class="vroute">${esc(route)}</div>
    <img class="mark" src="${a.mark}" alt="">
  </div>`
}

function back(data: FlightTicketData, t: OneTicket, a: TicketAssets): string {
  const s = t.segment
  const items = [
    ['clock', `Check-in counters close <b>60 minutes</b> before departure. Be at the airport at least <b>3 hours</b> before an international flight.`],
    ['passport', 'Carry a valid passport (at least <b>6 months</b> validity) and any visas your destination needs.'],
    ['phone', `Check in online on the airline's website with your airline PNR${data.airlinePnr ? ` <b>${esc(data.airlinePnr)}</b>` : ''}.`],
    ['bag', `Baggage: ${s.checkedBaggage ? `<b>${esc(s.checkedBaggage)}</b> checked` : 'as per airline'}${s.cabinBaggage ? `, <b>${esc(s.cabinBaggage)}</b> cabin` : ''}. Reconfirm flight times 24 hours before departure.`],
  ] as const

  return `
  <div class="stub back-stub">
    <div class="stub-body back-stub-body">
      <img class="vlogo" src="${a.logo}" alt="Aahaas">
    </div>
    <div class="perf right"></div>
    <img class="mark mark-back" src="${a.mark}" alt="">
  </div>

  <div class="mid info">
    <div class="info-title">Important information</div>
    ${items.map(([ic, text]) => `<div class="info-row"><span class="info-ic">${icon(ic as keyof typeof ICON, 4.6)}</span><span>${text}</span></div>`).join('')}
    <div class="chips">
      ${data.status ? `<span class="chip ok">${esc(data.status)}</span>` : ''}
      ${data.refundable ? `<span class="chip">Refundable: <b>${esc(data.refundable)}</b></span>` : ''}
      ${data.dateChange ? `<span class="chip">Date change: <b>${esc(data.dateChange)}</b></span>` : ''}
      ${s.meal ? `<span class="chip">Meal: <b>${esc(s.meal)}</b></span>` : ''}
    </div>
    <div class="info-ref">${esc(t.passenger.name)} · ${dash(s.flightNo)} · ${esc(s.from.code)} → ${esc(s.to.code)}${data.bookingRef ? ` · Ref ${esc(data.bookingRef)}` : ''}</div>
  </div>

  <div class="art back-art" style="background-image:url('${a.back}')">
    <div class="back-veil"></div>
    <img class="logo logo-right" src="${a.logo}" alt="Aahaas">
    <div class="script script-back">Explore<br>the world</div>
    <svg class="swoosh swoosh-back" viewBox="0 0 200 40" aria-hidden="true"><path d="M2 36 C 70 34, 130 24, 178 8" fill="none" stroke="#e3262f" stroke-width="2.2" stroke-linecap="round"/><g transform="translate(176 2) rotate(-18) scale(.55)" fill="#e3262f">${ICON.plane}</g></svg>
  </div>

  <div class="contact">
    <span>${icon('pin', 2.8)}${esc(AAHAAS_CONTACT.address)}</span>
    <span>${icon('phone', 2.8)}${esc(AAHAAS_CONTACT.phone)}</span>
    <span>${icon('mail', 2.8)}${esc(AAHAAS_CONTACT.email)}</span>
    <span>${icon('globe', 2.8)}${esc(AAHAAS_CONTACT.web)}</span>
  </div>`
}

function cropMarks(rows: number): string {
  // Corner ticks just outside every ticket, so the cut lines are the same on both sides.
  const marks: string[] = []
  for (let r = 0; r < rows; r++) {
    const y0 = TOP + r * (TICKET.h + TICKET.gap)
    for (const y of [y0, y0 + TICKET.h]) {
      for (const x of [LEFT, LEFT + TICKET.w]) {
        const dx = x === LEFT ? -1 : 1
        const dy = y === y0 ? -1 : 1
        marks.push(`<i class="cm h" style="left:${x + (dx < 0 ? -6 : 1)}mm;top:${y}mm"></i>`)
        marks.push(`<i class="cm v" style="left:${x}mm;top:${y + (dy < 0 ? -Math.min(3.5, TICKET.gap / 2 - 0.5) : 1)}mm"></i>`)
      }
    }
  }
  return marks.join('')
}

export async function renderTicketSheets(data: FlightTicketData, opts: TicketPrintOptions, assets: TicketAssets): Promise<string> {
  const tickets = await buildTickets(data, opts.perSegment)
  const sheets: string[] = []

  for (let i = 0; i < tickets.length; i += TICKET.perSheet) {
    const group = tickets.slice(i, i + TICKET.perSheet)
    const slot = (r: number) => `left:${LEFT}mm;top:${TOP + r * (TICKET.h + TICKET.gap)}mm`
    const sheetNo = i / TICKET.perSheet + 1

    sheets.push(`<section class="sheet">
      ${opts.cropMarks ? cropMarks(group.length) : ''}
      ${group.map((t, r) => `<article class="ticket front" style="${slot(r)}">${front(data, t, assets)}</article>`).join('')}
      <div class="sheet-note">Sheet ${sheetNo} · FRONT · print double-sided, actual size (100%), flip on ${opts.flip} edge</div>
    </section>`)

    const backTransform = [
      opts.flip === 'short' ? 'rotate(180deg)' : '',
      opts.backOffsetX || opts.backOffsetY ? `translate(${opts.backOffsetX}mm, ${opts.backOffsetY}mm)` : '',
    ].filter(Boolean).join(' ')

    sheets.push(`<section class="sheet">
      <div class="back-frame" style="${backTransform ? `transform:${backTransform};` : ''}">
        ${opts.cropMarks ? cropMarks(group.length) : ''}
        ${group.map((t, r) => `<article class="ticket back" style="${slot(r)}">${back(data, t, assets)}</article>`).join('')}
        <div class="sheet-note">Sheet ${sheetNo} · BACK</div>
      </div>
    </section>`)
  }

  const title = `Aahaas tickets ${data.bookingRef ?? data.orderId ?? ''}`.trim()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Great+Vibes&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${sheets.join('\n')}</body></html>`
}

const CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #e5e7eb; }
body { font-family: Inter, 'Helvetica Neue', Arial, sans-serif; color: #0f1f3a; }
.sheet { position: relative; width: ${SHEET.w}mm; height: ${SHEET.h}mm; overflow: hidden; background: #fff; page-break-after: always; break-after: page; margin: 0 auto; }
@media screen { .sheet { margin: 8mm auto; box-shadow: 0 4px 24px rgba(0,0,0,.15); } }
.back-frame { position: absolute; inset: 0; transform-origin: 50% 50%; }
.sheet-note { position: absolute; left: 0; right: 0; bottom: 2.2mm; text-align: center; font-size: 6pt; color: #b0b7c3; letter-spacing: .3px; }
.cm { position: absolute; background: #9aa3af; }
.cm.h { width: 5mm; height: .2mm; }
.cm.v { width: .2mm; height: 3mm; }

.ticket { position: absolute; width: ${TICKET.w}mm; height: ${TICKET.h}mm; display: flex; border-radius: 3.5mm; overflow: hidden; background: #fbfbfc; }
.lbl { font-size: 5.6pt; font-weight: 700; letter-spacing: .9px; text-transform: uppercase; color: #e3262f; }
.lbl.w { color: rgba(255,255,255,.78); }

/* ── art panels ─────────────────────────────── */
.art { position: relative; width: ${ART}mm; height: 100%; background-size: cover; background-position: 30% center; flex: none; }
.art-veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,.72) 0%, rgba(255,255,255,0) 34%, rgba(0,0,0,0) 62%, rgba(10,20,40,.62) 100%), linear-gradient(90deg, rgba(255,255,255,0) 55%, rgba(251,251,252,1) 100%); }
.logo { position: absolute; left: 4.5mm; top: 3.6mm; width: 30mm; }
.script { position: absolute; left: 5mm; top: 25mm; font-family: 'Great Vibes', cursive; font-size: 19pt; line-height: .95; color: #0f1f3a; transform: rotate(-8deg); transform-origin: left top; text-shadow: 0 0 6px rgba(255,255,255,.85); }
.swoosh { position: absolute; left: 10mm; top: 42mm; width: 40mm; }
.services { position: absolute; left: 3.5mm; right: 3mm; bottom: 3.2mm; display: flex; gap: 2.2mm; color: #fff; font-size: 5.6pt; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.services span { display: inline-flex; align-items: center; gap: .8mm; }

/* ── front middle ───────────────────────────── */
.mid { position: relative; width: ${TICKET.w - ART - STUB}mm; padding: 5mm 4mm 3.5mm 3mm; display: flex; flex-direction: column; background: radial-gradient(circle at 80% 20%, #fff 0, #f6f7f9 70%); }
.route { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5mm; }
.end { width: 34mm; min-width: 0; }
.end.right { text-align: right; }
.city { font-family: 'Bebas Neue', Impact, sans-serif; line-height: .92; color: #0f1f3a; letter-spacing: .2px; margin-top: .8mm; white-space: nowrap; }
.code { font-size: 6.4pt; font-weight: 700; color: #334155; margin-top: .6mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.code span { font-weight: 400; color: #64748b; }
.hop { flex: 1; display: flex; align-items: center; justify-content: center; gap: .6mm; margin-top: 6mm; position: relative; color: #0f1f3a; }
.dashline { flex: 1; border-top: .35mm dashed #e3262f; }
.dur { position: absolute; top: 6.6mm; left: 0; right: 0; text-align: center; font-size: 5.6pt; color: #64748b; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1.05fr 1.25fr .8fr .8fr; margin-top: 4.2mm; border-top: .25mm solid #e5e7eb; padding-top: 2.4mm; }
.grid > div { padding: 0 1.6mm; border-left: .25mm solid #e5e7eb; }
.grid > div:first-child { padding-left: 0; border-left: 0; }
.grid.g2 { grid-template-columns: .9fr 1.7fr .9fr; margin-top: 2.4mm; padding-top: 2mm; }
.val { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 15pt; line-height: 1.02; margin-top: .4mm; white-space: nowrap; }
.val.sm { font-family: Inter, Arial, sans-serif; font-size: 7.4pt; font-weight: 700; margin-top: .8mm; }
.soft { color: #64748b; font-weight: 500; }
.sub { font-size: 5.6pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.refbox { margin-top: auto; display: grid; grid-template-columns: .9fr .9fr 1.35fr; gap: 0; background: #fff4f4; border: .25mm solid #fbd5d7; border-radius: 2mm; padding: 2mm 2.4mm; }
.refbox > div { padding: 0 2mm; border-left: .25mm solid #f6c3c6; min-width: 0; }
.refbox > div:first-child { padding-left: 0; border-left: 0; }
.refbox .lbl { white-space: nowrap; }
.rval { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 13pt; line-height: 1.05; letter-spacing: .4px; white-space: nowrap; }
.fine { font-size: 5.1pt; color: #8a94a6; margin-top: 1.2mm; }

/* ── stubs ──────────────────────────────────── */
.stub { position: relative; width: ${STUB}mm; height: 100%; flex: none; color: #fff; background: linear-gradient(160deg, #ec3540 0%, #d81f2a 55%, #b9151f 100%); overflow: hidden; }
.perf { position: absolute; top: 0; bottom: 0; left: -1.6mm; width: 3.2mm; background: radial-gradient(circle, #fbfbfc 0 1.05mm, transparent 1.15mm) 0 0 / 3.2mm 3.6mm repeat-y; z-index: 2; }
.perf.right { left: auto; right: -1.6mm; }
.stub-body { position: relative; z-index: 1; padding: 4mm 9.5mm 3mm 4.6mm; }
.qr { width: 19mm; height: 19mm; border-radius: 1.6mm; background: #fff; padding: .6mm; display: block; margin-bottom: 2.4mm; }
.pax { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 13.5pt; line-height: .98; margin: .5mm 0 .3mm; word-break: break-word; }
.pax-type { font-size: 5.6pt; color: rgba(255,255,255,.8); margin-bottom: 2mm; text-transform: uppercase; letter-spacing: .6px; }
.pair { display: flex; gap: 3mm; margin-bottom: 1.6mm; }
.sval { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 12.5pt; line-height: 1.02; }
.vroute { position: absolute; right: 6mm; top: 50%; transform: translateY(-50%) rotate(-90deg) translateX(50%); transform-origin: right center; white-space: nowrap; font-family: 'Bebas Neue', Impact, sans-serif; font-size: 11pt; letter-spacing: 1.2px; z-index: 1; }
.mark { position: absolute; right: -12mm; bottom: -12mm; width: 40mm; opacity: .13; filter: brightness(0) invert(1); z-index: 0; }

/* ── back ───────────────────────────────────── */
.back-stub-body { height: 100%; display: flex; align-items: center; justify-content: center; padding: 0; }
.vlogo { width: 62mm; transform: rotate(-90deg); filter: brightness(0) invert(1); flex: none; }
.mark-back { right: auto; left: -12mm; top: -12mm; bottom: auto; }
.info { padding: 6mm 4.5mm 11mm 5mm; }
.info-title { font-size: 7.4pt; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: #0f1f3a; margin-bottom: 2.2mm; }
.info-row { display: flex; gap: 2.6mm; align-items: flex-start; font-size: 6.9pt; line-height: 1.35; color: #1f2a3d; padding: 1.7mm 0; border-bottom: .25mm solid #eceff3; }
.info-row:last-of-type { border-bottom: 0; }
.info-ic { color: #0f1f3a; flex: none; margin-top: .2mm; }
.chips { display: flex; flex-wrap: wrap; gap: 1.2mm; margin-top: 2mm; }
.chip { font-size: 5.8pt; padding: .7mm 2mm; border-radius: 5mm; background: #f1f5f9; color: #334155; }
.chip.ok { background: #dcfce7; color: #15803d; font-weight: 700; letter-spacing: .5px; }
.info-ref { margin-top: 1.6mm; font-size: 5.4pt; color: #8a94a6; }
.back-art { border-left: .25mm solid #e5e7eb; background-position: center 60%; }
.back-veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.55) 32%, rgba(255,255,255,0) 55%), linear-gradient(90deg, rgba(251,251,252,1) 0%, rgba(251,251,252,0) 22%); }
.logo-right { left: auto; right: 4mm; top: 4mm; width: 25mm; }
.script-back { left: 6mm; top: 15mm; font-size: 22pt; }
.swoosh-back { left: 14mm; top: 34mm; width: 38mm; }
.contact { position: absolute; left: ${STUB}mm; right: 0; bottom: 0; height: 8.5mm; display: flex; align-items: center; justify-content: space-between; gap: 2mm; padding: 0 4mm; background: #fff; border-top: .25mm solid #e5e7eb; font-size: 5.6pt; color: #1f2a3d; z-index: 3; }
.contact span { display: inline-flex; align-items: center; gap: .9mm; white-space: nowrap; }
.contact svg { color: #0f1f3a; }
`
