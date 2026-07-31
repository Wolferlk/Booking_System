import { readFileSync } from 'fs'
import path from 'path'

/**
 * Standalone "Booking Update" document rendered by the File-Handler portal.
 * Reuses the FH_BOOKING_SELECT shape from the search route so the PDF always
 * matches exactly what the handler sees on screen (IS/CNTL, agent, handler,
 * arrival, contacts & notes, hotels, flights) plus the generation timestamp
 * and a prominent status banner.
 */

const BRAND = '#0f9d76' // emerald — matches the portal accent
const INK = '#0f172a'

// ── Types (subset of FH_BOOKING_SELECT) ─────────────────────────────────────
export interface FhPdfFlight {
  flightNo: string; date: string | Date; fromApt: string; depTime: string
  toApt: string; arrTime: string; airline: string | null; notes: string | null
}
export interface FhPdfHotel {
  city: string; hotel: string; checkIn: string | Date; checkOut: string | Date
  address: string | null; contact: string | null; nights: number
  roomType: string | null; mealType: string | null
}
export interface FhPdfBooking {
  bookingRef: string; isNumber: string | null; cntlNumber: string | null
  agent: string | null; fileHandler: string | null; status: string
  operationCountry: string | null
  arrivalDate: string | Date; departureDate: string | Date
  paxAdults: number; paxChildren: number; paxInfants: number
  cancelledByName: string | null; cancellationReason: string | null
  agentEmail: string | null; agentPhone: string | null; agentWhatsapp: string | null
  contactEmail: string | null; contactPhone: string | null; contactWhatsapp: string | null
  importantNotes: string | null
  passengers: { name: string }[]; flights: FhPdfFlight[]; accommodations: FhPdfHotel[]
}

const FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾',
  SINGAPORE_MALAYSIA: '🇸🇬 🇲🇾', ALL: '🌐',
}

// Logo embedded as a data URI so the PDF is fully self-contained (no network
// fetch at render time). Read once and cached for the process lifetime.
let LOGO_DATA_URI = ''
function logoDataUri(): string {
  if (LOGO_DATA_URI) return LOGO_DATA_URI
  try {
    const buf = readFileSync(path.join(process.cwd(), 'public', 'png', 'apple-logo.png'))
    LOGO_DATA_URI = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    LOGO_DATA_URI = ''
  }
  return LOGO_DATA_URI
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const fmtDate = (s: string | Date): string => {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtDateTime = (d: Date): string =>
  d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

/** Human status → { label, tone } for the banner. */
function statusMeta(status: string): { label: string; tone: 'danger' | 'warn' | 'ok' } {
  switch (status) {
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' }
    case 'PENDING_CANCELLATION':
      return { label: 'Pending Cancellation Approval', tone: 'warn' }
    default:
      return { label: status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), tone: 'ok' }
  }
}

/**
 * Filename per spec, e.g. `VN40546_57663CNTL_Updates.PDF`.
 * Falls back to bookingRef when IS number is missing, and drops the CNTL
 * segment gracefully when there is no CNTL number.
 */
export function buildFhPdfFileName(b: Pick<FhPdfBooking, 'isNumber' | 'cntlNumber' | 'bookingRef'>): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '')
  const is = clean(b.isNumber || b.bookingRef || 'Booking')
  const cntl = b.cntlNumber ? clean(b.cntlNumber) : ''
  return cntl ? `${is}_${cntl}CNTL_Updates.PDF` : `${is}_Updates.PDF`
}

// ── HTML builder ────────────────────────────────────────────────────────────
export function buildFhBookingHtml(b: FhPdfBooking, opts?: { generatedBy?: string }): string {
  const now = new Date()
  const st = statusMeta(b.status)
  const flag = FLAG[b.operationCountry ?? ''] ?? '🌐'
  const lead = b.passengers[0]?.name ?? '—'
  const logo = logoDataUri()

  const pax = [
    `${b.paxAdults} adult${b.paxAdults === 1 ? '' : 's'}`,
    b.paxChildren ? `${b.paxChildren} child${b.paxChildren === 1 ? '' : 'ren'}` : '',
    b.paxInfants ? `${b.paxInfants} infant${b.paxInfants === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')

  const banner = (() => {
    const tones = {
      danger: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c', dot: '#dc2626' },
      warn: { bg: '#fffbeb', bd: '#fde68a', fg: '#b45309', dot: '#f59e0b' },
      ok: { bg: '#ecfdf5', bd: '#a7f3d0', fg: '#047857', dot: '#10b981' },
    }[st.tone]
    const reason = (b.status === 'PENDING_CANCELLATION' || b.status === 'CANCELLED')
      ? `<div class="banner-sub">Requested by ${esc(b.cancelledByName ?? '—')}${b.cancellationReason ? ` · Reason: ${esc(b.cancellationReason)}` : ''}</div>`
      : ''
    return `<div class="banner" style="background:${tones.bg};border-color:${tones.bd};color:${tones.fg}">
      <span class="banner-dot" style="background:${tones.dot}"></span>
      <div><div class="banner-title">${esc(st.label)}</div>${reason}</div>
    </div>`
  })()

  const contactRows = (title: string, email: string | null, phone: string | null, wa: string | null) => {
    const has = email || phone || wa
    return `<div class="contact">
      <div class="contact-h">${esc(title)}</div>
      ${has ? `
        ${email ? `<div class="contact-r"><span class="contact-k">Email</span><span>${esc(email)}</span></div>` : ''}
        ${phone ? `<div class="contact-r"><span class="contact-k">Phone</span><span>${esc(phone)}</span></div>` : ''}
        ${wa ? `<div class="contact-r"><span class="contact-k">WhatsApp</span><span>${esc(wa)}</span></div>` : ''}
      ` : `<div class="empty">No contact info recorded.</div>`}
    </div>`
  }

  const hotels = b.accommodations.length
    ? b.accommodations.map(h => `
      <div class="card">
        <div class="card-top">
          <div class="card-title">${esc(h.hotel)}</div>
          <div class="card-tag">${esc(h.city)}</div>
        </div>
        <div class="card-meta">
          <span>📅 ${fmtDate(h.checkIn)} → ${fmtDate(h.checkOut)} · ${h.nights} night${h.nights === 1 ? '' : 's'}</span>
          ${h.roomType ? `<span>🛏 ${esc(h.roomType)}</span>` : ''}
          ${h.mealType ? `<span>🍽 ${esc(h.mealType)}</span>` : ''}
        </div>
        ${(h.address || h.contact) ? `<div class="card-sub">${[h.address, h.contact].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
      </div>`).join('')
    : `<div class="empty-block">No hotels recorded.</div>`

  const flights = b.flights.length
    ? b.flights.map(f => `
      <div class="card">
        <div class="card-top">
          <div class="card-title">${esc(f.flightNo)} ${f.airline ? `<span class="muted">· ${esc(f.airline)}</span>` : ''}</div>
          <div class="card-tag">${fmtDate(f.date)}</div>
        </div>
        <div class="leg">
          <div class="leg-side"><div class="leg-apt">${esc(f.fromApt)}</div><div class="leg-time">${esc(f.depTime || '—')}</div></div>
          <div class="leg-arrow">✈</div>
          <div class="leg-side"><div class="leg-apt">${esc(f.toApt)}</div><div class="leg-time">${esc(f.arrTime || '—')}</div></div>
        </div>
        ${f.notes ? `<div class="card-sub">${esc(f.notes)}</div>` : ''}
      </div>`).join('')
    : `<div class="empty-block">No flights recorded.</div>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: ${INK}; margin: 0; padding: 24px 30px; font-size: 12px; line-height: 1.5; }
  .muted { color: #94a3b8; font-weight: 400; }
  .mono { font-family: 'Courier New', monospace; }

  /* Header / cover */
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid ${BRAND}; margin-bottom: 4px; }
  .head-l { display: flex; align-items: center; gap: 12px; }
  .logo { height: 46px; width: auto; }
  .brand-name { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
  .brand-sub { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
  .doc-tag { text-align: right; }
  .doc-kind { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: ${BRAND}; }
  .doc-ref { font-size: 22px; font-weight: 800; font-family: 'Courier New', monospace; color: ${INK}; margin-top: 2px; }

  .subline { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 14px; font-size: 11px; color: #475569; }
  .subline .who { font-size: 13px; font-weight: 700; color: ${INK}; }

  /* Status banner */
  .banner { display: flex; align-items: center; gap: 10px; border: 1px solid; border-radius: 10px; padding: 11px 14px; margin-bottom: 18px; }
  .banner-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .banner-title { font-size: 13px; font-weight: 800; letter-spacing: 0.01em; }
  .banner-sub { font-size: 10.5px; opacity: 0.85; margin-top: 1px; }

  /* Key tiles */
  .tiles { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
  .tile { flex: 1 1 22%; min-width: 120px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #f8fafc; }
  .tile-l { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; font-weight: 700; }
  .tile-v { font-size: 13px; font-weight: 700; margin-top: 3px; word-break: break-word; }
  .tile-v.brand { color: ${BRAND}; }

  /* Sections */
  .section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-size: 12px; font-weight: 800; color: ${INK}; border-left: 4px solid ${BRAND}; padding-left: 9px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.04em; }

  .contacts { display: flex; gap: 12px; }
  .contact { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 13px; background: #fff; }
  .contact-h { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: ${BRAND}; margin-bottom: 7px; }
  .contact-r { display: flex; gap: 8px; font-size: 11px; margin-bottom: 3px; }
  .contact-k { width: 62px; color: #94a3b8; flex-shrink: 0; }
  .empty { color: #cbd5e1; font-size: 11px; font-style: italic; }

  .notes { margin-top: 12px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; padding: 11px 13px; }
  .notes-h { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #b45309; margin-bottom: 5px; }
  .notes-b { font-size: 11px; color: #78350f; white-space: pre-wrap; }

  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 13px; margin-bottom: 9px; background: #fff; page-break-inside: avoid; }
  .card-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .card-title { font-size: 12.5px; font-weight: 700; }
  .card-tag { font-size: 10px; font-weight: 700; background: #f1f5f9; color: #475569; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 10.5px; color: #475569; }
  .card-sub { margin-top: 6px; font-size: 10px; color: #64748b; }

  .leg { display: flex; align-items: center; gap: 14px; margin-top: 8px; }
  .leg-side { text-align: center; }
  .leg-apt { font-size: 13px; font-weight: 800; }
  .leg-time { font-size: 10px; color: #64748b; }
  .leg-arrow { flex: 1; text-align: center; color: ${BRAND}; border-top: 1px dashed #cbd5e1; line-height: 0; }

  .empty-block { border: 1px dashed #cbd5e1; border-radius: 10px; padding: 14px; text-align: center; color: #94a3b8; font-size: 11px; font-style: italic; }

  .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="head">
    <div class="head-l">
      ${logo ? `<img class="logo" src="${logo}" alt="Apple Holidays" />` : ''}
      <div>
        <div class="brand-name">Apple Holidays</div>
        <div class="brand-sub"> Operations</div>
      </div>
    </div>
    <div class="doc-tag">
      <div class="doc-kind">Booking Update</div>
      <div class="doc-ref">${esc(b.bookingRef)}</div>
    </div>
  </div>

  <div class="subline">
    <div><span style="font-size:16px;vertical-align:middle">${flag}</span> <span class="who">${esc(lead)}</span></div>
    <div>Generated ${esc(fmtDateTime(now))}${opts?.generatedBy ? ` · by ${esc(opts.generatedBy)}` : ''}</div>
  </div>

  ${banner}

  <div class="tiles">
    <div class="tile"><div class="tile-l">IS Number</div><div class="tile-v">${esc(b.isNumber ?? '—')}</div></div>
    <div class="tile"><div class="tile-l">CNTL</div><div class="tile-v">${esc(b.cntlNumber ?? '—')}</div></div>
    <div class="tile"><div class="tile-l">Agent</div><div class="tile-v">${esc(b.agent ?? '—')}</div></div>
    <div class="tile"><div class="tile-l">File Handler</div><div class="tile-v brand">${esc(b.fileHandler ?? '—')}</div></div>
  </div>
  <div class="tiles">
    <div class="tile"><div class="tile-l">Arrival</div><div class="tile-v">${fmtDate(b.arrivalDate)}</div></div>
    <div class="tile"><div class="tile-l">Departure</div><div class="tile-v">${fmtDate(b.departureDate)}</div></div>
    <div class="tile"><div class="tile-l">Passengers</div><div class="tile-v">${esc(pax)}</div></div>
    <div class="tile"><div class="tile-l">Country</div><div class="tile-v">${esc((b.operationCountry ?? '—').replace(/_/g, ' / '))}</div></div>
  </div>

  <div class="section">
    <h2>Contacts &amp; Notes</h2>
    <div class="contacts">
      ${contactRows('Agent', b.agentEmail, b.agentPhone, b.agentWhatsapp)}
      ${contactRows('Guest / Tourist', b.contactEmail, b.contactPhone, b.contactWhatsapp)}
    </div>
    <div class="notes">
      <div class="notes-h">Important Notes</div>
      <div class="notes-b">${b.importantNotes ? esc(b.importantNotes) : '<span class="muted">No notes recorded.</span>'}</div>
    </div>
  </div>

  <div class="section">
    <h2>Hotel Details</h2>
    ${hotels}
  </div>

  <div class="section">
    <h2>Flight Details</h2>
    ${flights}
  </div>

  <div class="footer">
    <span>Apple Holidays MMT · Booking Update Document</span>
    <span>${esc(b.bookingRef)}${b.cntlNumber ? ` · CNTL ${esc(b.cntlNumber)}` : ''} · Downloaded ${esc(fmtDateTime(now))}</span>
  </div>
</body>
</html>`
}

// ── Email builder (table layout, inline styles) ─────────────────────────────
// Email clients strip <style> blocks and don't support flexbox, so the mail
// body is built with <table>s and inline styles. All booking details are laid
// out in tables so the recipient sees everything without opening the PDF.
export function buildFhBookingEmailHtml(b: FhPdfBooking, opts?: { generatedBy?: string; note?: string }): string {
  const now = new Date()
  const st = statusMeta(b.status)
  const logo = logoDataUri()
  const tone = {
    danger: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' },
    warn: { bg: '#fffbeb', bd: '#fde68a', fg: '#b45309' },
    ok: { bg: '#ecfdf5', bd: '#a7f3d0', fg: '#047857' },
  }[st.tone]

  const pax = [
    `${b.paxAdults} adult${b.paxAdults === 1 ? '' : 's'}`,
    b.paxChildren ? `${b.paxChildren} child${b.paxChildren === 1 ? '' : 'ren'}` : '',
    b.paxInfants ? `${b.paxInfants} infant${b.paxInfants === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')

  // Section heading bar
  const heading = (t: string) =>
    `<tr><td style="padding:22px 0 8px"><div style="font:700 13px Arial,Helvetica,sans-serif;color:${INK};border-left:4px solid ${BRAND};padding-left:9px;text-transform:uppercase;letter-spacing:0.04em">${esc(t)}</div></td></tr>`

  // Two-column key/value row inside a summary table
  const kv = (k: string, v: string, brand = false) =>
    `<tr>
       <td style="padding:7px 10px;border:1px solid #e2e8f0;background:#f8fafc;font:700 11px Arial;color:#64748b;text-transform:uppercase;letter-spacing:0.03em;width:150px;white-space:nowrap">${esc(k)}</td>
       <td style="padding:7px 12px;border:1px solid #e2e8f0;font:${brand ? 700 : 400} 13px Arial;color:${brand ? BRAND : INK}">${esc(v)}</td>
     </tr>`

  const summary =
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
       ${kv('IS Number', b.isNumber ?? '—')}
       ${kv('CNTL', b.cntlNumber ?? '—')}
       ${kv('Agent', b.agent ?? '—')}
       ${kv('File Handler', b.fileHandler ?? '—', true)}
       ${kv('Arrival', fmtDate(b.arrivalDate))}
       ${kv('Departure', fmtDate(b.departureDate))}
       ${kv('Passengers', pax || '—')}
       ${kv('Country', (b.operationCountry ?? '—').replace(/_/g, ' / '))}
       ${kv('Status', st.label)}
     </table>`

  // Contacts table
  const contactRow = (who: string, email: string | null, phone: string | null, wa: string | null) =>
    `<tr>
       <td style="padding:7px 10px;border:1px solid #e2e8f0;background:#f8fafc;font:700 11px Arial;color:#64748b;white-space:nowrap">${esc(who)}</td>
       <td style="padding:7px 12px;border:1px solid #e2e8f0;font:400 12px Arial;color:${INK}">${esc(email || '—')}</td>
       <td style="padding:7px 12px;border:1px solid #e2e8f0;font:400 12px Arial;color:${INK}">${esc(phone || '—')}</td>
       <td style="padding:7px 12px;border:1px solid #e2e8f0;font:400 12px Arial;color:${INK}">${esc(wa || '—')}</td>
     </tr>`
  const contacts =
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
       <tr>
         <td style="padding:7px 10px;border:1px solid #e2e8f0;background:#eef2f7;font:700 10px Arial;color:#475569;text-transform:uppercase">Party</td>
         <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#eef2f7;font:700 10px Arial;color:#475569;text-transform:uppercase">Email</td>
         <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#eef2f7;font:700 10px Arial;color:#475569;text-transform:uppercase">Phone</td>
         <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#eef2f7;font:700 10px Arial;color:#475569;text-transform:uppercase">WhatsApp</td>
       </tr>
       ${contactRow('Agent', b.agentEmail, b.agentPhone, b.agentWhatsapp)}
       ${contactRow('Guest / Tourist', b.contactEmail, b.contactPhone, b.contactWhatsapp)}
     </table>`

  const th = (t: string, w?: string) =>
    `<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#eef2f7;font:700 10px Arial;color:#475569;text-transform:uppercase${w ? `;width:${w}` : ''}">${esc(t)}</td>`
  const td = (t: string, bold = false) =>
    `<td style="padding:7px 10px;border:1px solid #e2e8f0;font:${bold ? 700 : 400} 12px Arial;color:${INK}">${esc(t)}</td>`

  const hotels = b.accommodations.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
         <tr>${th('Hotel')}${th('City')}${th('Check-in')}${th('Check-out')}${th('Nights')}${th('Room')}${th('Meal')}</tr>
         ${b.accommodations.map(h => `<tr>${td(h.hotel, true)}${td(h.city)}${td(fmtDate(h.checkIn))}${td(fmtDate(h.checkOut))}${td(String(h.nights))}${td(h.roomType || '—')}${td(h.mealType || '—')}</tr>`).join('')}
       </table>`
    : `<div style="border:1px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;font:italic 12px Arial;color:#94a3b8">No hotels recorded.</div>`

  const flights = b.flights.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
         <tr>${th('Flight')}${th('Airline')}${th('Date')}${th('From')}${th('Dep')}${th('To')}${th('Arr')}${th('Notes')}</tr>
         ${b.flights.map(f => `<tr>${td(f.flightNo || '—', true)}${td(f.airline || '—')}${td(fmtDate(f.date))}${td(f.fromApt || '—')}${td(f.depTime || '—')}${td(f.toApt || '—')}${td(f.arrTime || '—')}${td(f.notes || '—')}</tr>`).join('')}
       </table>`
    : `<div style="border:1px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;font:italic 12px Arial;color:#94a3b8">No flights recorded.</div>`

  const isCancel = b.status === 'PENDING_CANCELLATION' || b.status === 'CANCELLED'
  const reason = isCancel
    ? `Requested by ${esc(b.cancelledByName ?? '—')}${b.cancellationReason ? ` · Reason: ${esc(b.cancellationReason)}` : ''}`
    : ''

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        <!-- Header -->
        <tr><td style="padding:18px 24px;border-bottom:3px solid ${BRAND}">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td style="vertical-align:middle">
              ${logo ? `<img src="${logo}" alt="Apple Holidays" height="40" style="height:40px;vertical-align:middle" /> ` : ''}
              <span style="font:800 18px Arial;color:${INK};vertical-align:middle">Apple Holidays</span>
            </td>
            <td align="right" style="vertical-align:middle">
              <div style="font:700 9px Arial;color:${BRAND};letter-spacing:1.5px">BOOKING UPDATE</div>
              <div style="font:800 20px 'Courier New',monospace;color:${INK}">${esc(b.bookingRef)}</div>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:18px 24px 0">
          <!-- Status banner -->
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate">
            <tr><td style="background:${tone.bg};border:1px solid ${tone.bd};border-radius:10px;padding:11px 14px">
              <span style="font:800 13px Arial;color:${tone.fg}">${esc(st.label)}</span>
              ${reason ? `<div style="font:400 11px Arial;color:${tone.fg};opacity:0.85;margin-top:2px">${reason}</div>` : ''}
            </td></tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:14px 0 0;font:400 12px Arial;color:#475569">
              Dear ${esc(b.fileHandler || 'Team')}, please find the latest details for booking
              <strong>${esc(b.bookingRef)}</strong>${b.isNumber ? ` (IS ${esc(b.isNumber)})` : ''} below. The same is attached as a PDF.
            </td></tr>
            ${opts?.note ? `<tr><td style="padding:12px 0 0"><div style="background:#f1f5f9;border-radius:8px;padding:10px 12px;font:400 12px Arial;color:${INK}">${esc(opts.note)}</div></td></tr>` : ''}

            ${heading('Booking Summary')}
            <tr><td>${summary}</td></tr>

            ${heading('Contacts')}
            <tr><td>${contacts}</td></tr>

            ${heading('Important Notes')}
            <tr><td><div style="border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:11px 13px;font:400 12px Arial;color:#78350f;white-space:pre-wrap">${b.importantNotes ? esc(b.importantNotes) : 'No notes recorded.'}</div></td></tr>

            ${heading('Hotel Details')}
            <tr><td>${hotels}</td></tr>

            ${heading('Flight Details')}
            <tr><td>${flights}</td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 24px;border-top:1px solid #e2e8f0">
          <div style="font:400 10px Arial;color:#94a3b8">
            Apple Holidays MMT · Booking Update · Generated ${esc(fmtDateTime(now))}${opts?.generatedBy ? ` by ${esc(opts.generatedBy)}` : ''}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
