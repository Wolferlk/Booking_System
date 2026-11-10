import { ensurePdfkitDataFiles, loadPdfDocumentCtor, loadLogo } from './pdfkit-boot'
import { brandGuard, guardPdfText } from './customer-branding-server'
import { serviceTypeShortLabel } from './service-types'
import { filledPackageNotes } from './booking-package-notes'
import { guestEmergencyContactsFor } from './guest-emergency-contacts'
import type { ResolvedEmergencyContact } from './emergency-contacts'
import { loadVoucherFiles, readStoredUpload, publicFileUrl, sniffFile, type VoucherFile } from './voucher-files'

/**
 * The two customer documents sent from "Send via WhatsApp":
 *   • Send 1 (T-7)  Tour Confirmation          — generateConfirmationPdf()
 *   • Send 2 (T-3)  Full Details + Vouchers    — generateFullDetailsPdf()
 *
 * Both are read by the GUEST, so nothing internal appears: no workflow status,
 * no ticket cost, no driver rate. Layout notes:
 *   • Lead guest and the passenger list are one section.
 *   • Emergency contacts come from Settings → Guest Emergency Contacts (plus
 *     the TC's own rows when that is switched on).
 *   • The itinerary is titles only; in the Full PDF each day carries the
 *     driver / vehicle / guide / tour vendor looking after the guest that day.
 *   • Vouchers: images and PDF e-tickets each get their own page; PDF pages
 *     are stamped in with pdf-lib after PDFKit has laid everything out.
 *   • No blank pages: the footer is written with the bottom margin lifted
 *     (writing below it made PDFKit add a page), and nothing calls addPage()
 *     unless the next block genuinely does not fit.
 *
 * PDFKit's built-in Helvetica only has WinAnsi glyphs, so no ✓ ★ → in text.
 */

// ── Constants ────────────────────────────────────────────────────────────────
const HEADER_BG = '#0F172A'
const BRAND     = '#D97706'
const BRAND_BG  = '#FFF7ED'
const DARK      = '#1E293B'
const MUTED     = '#64748B'
const LINE      = '#E2E8F0'
const GREEN     = '#059669'
const BLUE      = '#2563EB'
const BLUE_BG   = '#EFF6FF'
const PAGE_W    = 595.28
const MARGIN    = 50
const CONTENT_W = PAGE_W - MARGIN * 2
/** Lowest y any body content may reach; the footer lives below it. */
const BODY_BOTTOM = 780
/** Most pages one PDF e-ticket may add — a 40-page brochure is not a ticket. */
const MAX_PAGES_PER_PDF = 8

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Calendar day, used to put a movement under the right itinerary day. */
function dayKey(d: string | Date | null | undefined): string {
  if (!d) return ''
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}

/** Strip characters the standard PDF fonts cannot draw. */
export function safe(s: unknown): string {
  return String(s ?? '')
    .replace(/[→⇒➜]/g, '»')
    .replace(/[★☆]/g, '*')
    .replace(/[✓✔]/g, '')
    .replace(/[✗✘]/g, '')
    // Letters outside Latin-1 (Vietnamese "Phú Quốc" → the ố) are folded to the
    // nearest drawable letter instead of printing as junk; é, ñ, ü stay as-is.
    .replace(/[^\x00-\xFF–—‘’“”•…]/g, ch => {
      if (ch === 'đ') return 'd'
      if (ch === 'Đ') return 'D'
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      // Keep one Latin-1 accent where one exists ("ố" → "ô"), else the bare letter.
      const latin = ch.normalize('NFD').replace(/[̀-ͯ]+$/, m => m[0]).normalize('NFC')
      if (latin.length === 1 && latin.charCodeAt(0) <= 0xff) return latin
      return /^[\x20-\x7E]+$/.test(base) ? base : ''
    })
    .trim()
}

/** "Mr. Vikas Kohli &" → "Mr. Vikas Kohli" — TC extraction leaves joiners behind. */
function cleanName(name: unknown): string {
  return safe(name).replace(/[\s&,/+\-–]+$/g, '').replace(/^[\s&,/+\-–]+/g, '').replace(/\s{2,}/g, ' ')
}

function phoneDigits(p: unknown): string {
  return String(p ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

function paxType(p: any): string {
  const t = p?.type === 'CHILD' ? 'Child' : 'Adult'
  return p?.age != null && p?.type === 'CHILD' ? `${t} (${p.age} yrs)` : t
}

function parseTicketNotes(notes: string | null | undefined): string {
  if (!notes) return ''
  const sepIdx = notes.indexOf('} · ')
  if (sepIdx !== -1) {
    const jsonPart = notes.slice(0, sepIdx + 1)
    const suffix   = notes.slice(sepIdx + 4)
    let remarks = ''
    try {
      const parsed = JSON.parse(jsonPart)
      remarks = typeof parsed?.remarks === 'string' ? parsed.remarks : ''
    } catch { remarks = jsonPart }
    // Drop the internal "Client: … · PNL Item #…" tail — the guest doesn't need it.
    return [remarks, suffix.replace(/(·\s*)?PNL Item #\S+/gi, '').replace(/(^|·\s*)Client:[^·]*/gi, '').trim()]
      .filter(Boolean).join(' · ').replace(/^·\s*|\s*·$/g, '')
  }
  try {
    const parsed = JSON.parse(notes)
    if (parsed && typeof parsed === 'object' && 'remarks' in parsed) return String(parsed.remarks)
  } catch {}
  return notes
}

// ── Crew (who looks after the guest on a given day) ──────────────────────────

interface CrewCard {
  date: string | Date
  locations: string[]
  meetingTime: string | null
  driverName: string | null
  driverPhone: string | null
  vehicle: string | null
  vendorName: string | null
  vendorPhone: string | null
  guideName: string | null
  guidePhone: string | null
  tourVendorName: string | null
  tourVendorPhone: string | null
  driverPhoto: Buffer | null
  vehiclePhoto: Buffer | null
}

/**
 * One card per distinct crew per day. A driver who does the morning transfer
 * and the afternoon tour is one card listing both stops, not two cards.
 * Never the driver rate — that is internal.
 */
async function buildCrewByDay(agendaItems: any[]): Promise<Map<string, CrewCard[]>> {
  const byDay = new Map<string, Map<string, CrewCard & { _driverPhotoUrl?: string; _vehiclePhotoUrl?: string }>>()
  for (const item of agendaItems) {
    const a = item.assignment
    if (!a) continue
    const driverName     = a.driverName ?? a.driver?.name ?? null
    const vehiclePlate   = a.vehiclePlate ?? a.driver?.vehicle?.plateNo ?? null
    const vehicleType    = a.vehicleType ?? a.driver?.vehicle?.type ?? null
    const vendorName     = a.vendorName ?? a.vendor?.name ?? null
    const tourVendorName = a.tourVendorName ?? a.tourVendor?.name ?? null
    const guideName      = a.guideName ?? null
    if (!driverName && !vehiclePlate && !vendorName && !tourVendorName && !guideName) continue

    const day = dayKey(item.date)
    if (!day) continue
    const key = [driverName, vehiclePlate, vendorName, tourVendorName, guideName].map(x => String(x ?? '').toLowerCase()).join('|')
    const dayMap = byDay.get(day) ?? new Map()
    byDay.set(day, dayMap)
    const existing = dayMap.get(key)
    const loc = safe(item.location)
    if (existing) {
      if (loc && !existing.locations.includes(loc)) existing.locations.push(loc)
      if (!existing.meetingTime && item.meetingTime) existing.meetingTime = item.meetingTime
      continue
    }
    dayMap.set(key, {
      date: item.date,
      locations: loc ? [loc] : [],
      meetingTime: item.meetingTime ?? null,
      driverName,
      driverPhone:     a.driverPhone ?? a.driver?.phone ?? null,
      vehicle:         [vehicleType, vehiclePlate].filter(Boolean).join('  ·  ') || null,
      vendorName,
      vendorPhone:     a.vendor?.phone ?? null,
      guideName,
      guidePhone:      a.guidePhone ?? null,
      tourVendorName,
      tourVendorPhone: a.tourVendorPhone ?? a.tourVendor?.phone ?? null,
      driverPhoto: null,
      vehiclePhoto: null,
      _driverPhotoUrl:  a.driver?.photoUrl ?? undefined,
      _vehiclePhotoUrl: a.driver?.vehicle?.photoOutside ?? undefined,
    })
  }

  // Photos come from S3 like everything else uploaded; JPEG/PNG only.
  const photo = new Map<string, Promise<Buffer | null>>()
  const load = (url?: string) => {
    if (!url) return Promise.resolve(null)
    if (!photo.has(url)) {
      photo.set(url, readStoredUpload(url).then(b => {
        if (!b) return null
        const t = sniffFile(b)
        return t === 'jpeg' || t === 'png' ? b : null
      }).catch(() => null))
    }
    return photo.get(url)!
  }

  const out = new Map<string, CrewCard[]>()
  for (const [day, m] of Array.from(byDay.entries())) {
    const cards: CrewCard[] = []
    for (const c of Array.from(m.values())) {
      const [dp, vp] = await Promise.all([load(c._driverPhotoUrl), load(c._vehiclePhotoUrl)])
      const { _driverPhotoUrl, _vehiclePhotoUrl, ...card } = c
      void _driverPhotoUrl; void _vehiclePhotoUrl
      cards.push({ ...card, driverPhoto: dp, vehiclePhoto: vp })
    }
    out.set(day, cards)
  }
  return out
}

/** A PDF e-ticket page to stamp onto a reserved PDFKit page afterwards. */
interface PdfStamp {
  pageIndex: number
  file: VoucherFile
  srcPage: number
  box: { x: number; top: number; w: number; h: number }
}

// ── Core builder ─────────────────────────────────────────────────────────────
async function buildPdf(booking: any, full: boolean): Promise<Buffer> {
  // Everything async happens up front — PDFKit lays out synchronously.
  const emergencyContacts: ResolvedEmergencyContact[] = await guestEmergencyContactsFor(booking)
  const agendaItems: any[] = booking.tourAgenda?.items ?? []
  const crewByDay = full ? await buildCrewByDay(agendaItems) : new Map<string, CrewCard[]>()

  const tickets: any[] = full
    ? (booking.tickets ?? []).filter((t: any) => t.activated === true || t.fileUrl || t.reference)
    : []
  const vouchers = tickets.length ? await loadVoucherFiles(tickets) : new Map<string, VoucherFile[]>()

  const stamps: PdfStamp[] = []

  const laidOut: Buffer = await new Promise((resolve, reject) => {
    void (async () => {
      await ensurePdfkitDataFiles()
      const PDFDocument = await loadPdfDocumentCtor()
      // Guest document: Settings → Customer Branding decides whether our name
      // and mark appear. Hidden → header shows the chosen team name, no logo.
      const brand = await brandGuard('pdf', 'guest')
      const logo = brand.hidden ? null : await loadLogo()

      const chunks: Buffer[] = []
      const doc = guardPdfText(new (PDFDocument as any)({ margin: MARGIN, size: 'A4', bufferPages: true, autoFirstPage: true }), brand)
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── Layout helpers ─────────────────────────────────────────────────
      const newPage = () => { doc.addPage(); doc.y = MARGIN }
      /** Start a new page only when `h` points will not fit. */
      const ensure = (h: number) => { if (doc.y + h > BODY_BOTTOM) newPage() }
      const pageIndex = () => doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1

      function drawPageHeader() {
        doc.rect(0, 0, PAGE_W, 78).fill(HEADER_BG)
        let nameX = 18
        if (logo) {
          try { doc.image(logo, 12, 9, { height: 58, fit: [58, 58] }); nameX = 85 } catch { /* unsupported */ }
        }
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17)
          .text('Apple Holidays', nameX, 17, { lineBreak: false })
        doc.fillColor('#CBD5E1').font('Helvetica').fontSize(8)
          .text('Vietnam  ·  Tour Operations', nameX, 40, { lineBreak: false })
        doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(14)
          .text(booking.bookingRef, MARGIN, 17, { width: CONTENT_W, align: 'right', lineBreak: false })
        // Travel dates, not the workflow status — the guest has no use for "QC1 PASS".
        doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
          .text(`${fmt(booking.arrivalDate)}  –  ${fmt(booking.departureDate)}`, MARGIN, 40,
            { width: CONTENT_W, align: 'right', lineBreak: false })
        doc.rect(0, 78, PAGE_W, 3).fill(BRAND)
        doc.y = 95
      }

      function sectionTitle(title: string, minFollowing = 60) {
        ensure(40 + minFollowing)
        doc.moveDown(0.5)
        const sy = doc.y
        doc.rect(MARGIN, sy, 4, 20).fill(BRAND)
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
          .text(title.toUpperCase(), MARGIN + 10, sy + 4, { width: CONTENT_W - 10, lineBreak: false })
        doc.y = sy + 24
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(LINE).lineWidth(0.5).stroke()
        doc.y += 8
      }

      function infoRow(label: string, value: string | null | undefined, x = MARGIN + 5, w = CONTENT_W - 5) {
        if (value === null || value === undefined || String(value).trim() === '') return
        const text = safe(value)
        doc.font('Helvetica').fontSize(9)
        const h = Math.max(12, doc.heightOfString(text, { width: w - 140 }))
        ensure(h + 4)
        const ry = doc.y
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(label, x, ry, { width: 135, lineBreak: false })
        doc.font('Helvetica').fontSize(9).fillColor(DARK).text(text, x + 140, ry, { width: w - 140 })
        doc.y = ry + h + 4
      }

      function divider() {
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(LINE).lineWidth(0.3).stroke()
        doc.y += 5
      }

      /** Label-over-value cell, used inside the crew and lead-guest cards. */
      function cell(label: string, value: string, sub: string | null, x: number, y: number, w: number) {
        doc.font('Helvetica-Bold').fontSize(6.8).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: w, lineBreak: false })
        doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(safe(value), x, y + 9, { width: w, lineBreak: false, ellipsis: true })
        if (sub) doc.font('Helvetica').fontSize(8.5).fillColor(GREEN).text(safe(sub), x, y + 20, { width: w, lineBreak: false })
      }

      // ── Page 1 ──────────────────────────────────────────────────────────
      drawPageHeader()
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(15)
        .text(full ? 'FULL TOUR DETAILS & VOUCHERS' : 'TOUR CONFIRMATION', MARGIN, doc.y + 4)
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(`${fmt(booking.arrivalDate)} – ${fmt(booking.departureDate)}  ·  `
          + `${booking.paxAdults ?? 0} Adults${booking.paxChildren ? ', ' + booking.paxChildren + ' Children' : ''}`,
        MARGIN, doc.y)
      doc.y += 6
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(BRAND).lineWidth(1.2).stroke()
      doc.y += 8

      // ── 1. Booking Summary ──────────────────────────────────────────────
      sectionTitle('Booking Summary')
      infoRow('Booking Reference', booking.bookingRef)
      infoRow('Arrival', fmt(booking.arrivalDate))
      infoRow('Departure', fmt(booking.departureDate))
      if (booking.arrivalDate && booking.departureDate) {
        const nights = Math.round((new Date(booking.departureDate).getTime() - new Date(booking.arrivalDate).getTime()) / 86_400_000)
        if (nights > 0) infoRow('Duration', `${nights} night${nights === 1 ? '' : 's'} / ${nights + 1} days`)
      }
      infoRow('Passengers', `${booking.paxAdults ?? 0} Adults, ${booking.paxChildren ?? 0} Children`)
      infoRow('Agent Booking ID', booking.agentBookingId)

      // ── 2. Agent / Tour Operator ────────────────────────────────────────
      if (booking.agent || booking.fileHandler || booking.agentEmail || booking.agentPhone || booking.agentWhatsapp) {
        sectionTitle('Agent / Tour Operator')
        infoRow('Agent / Operator', booking.agent)
        infoRow('File Handler', booking.fileHandler)
        infoRow('Agent Email', booking.agentEmail)
        const agentSameWa = phoneDigits(booking.agentPhone) && phoneDigits(booking.agentWhatsapp) === phoneDigits(booking.agentPhone)
        infoRow(agentSameWa ? 'Agent Phone / WhatsApp' : 'Agent Phone', booking.agentPhone)
        if (!agentSameWa) infoRow('Agent WhatsApp', booking.agentWhatsapp)
        infoRow('Agent Country', booking.agentCountry)
      }

      // ── 3. Guests — lead guest contact + passenger list, one section ────
      const passengers: any[] = booking.passengers ?? []
      const hasContact = booking.contactEmail || booking.contactPhone || booking.contactWhatsapp
        || booking.contactCountry || booking.contactAddress
      if (passengers.length || hasContact) {
        sectionTitle('Lead Guest & Passengers', 90)

        const lead = passengers.find(p => p.isLead) ?? passengers[0]
        const sameWa = phoneDigits(booking.contactWhatsapp) && phoneDigits(booking.contactWhatsapp) === phoneDigits(booking.contactPhone)
        const contactCells: [string, string][] = ([
          [sameWa ? 'Phone / WhatsApp' : 'Phone', booking.contactPhone],
          ['WhatsApp', sameWa ? null : booking.contactWhatsapp],
          ['Email', booking.contactEmail],
          ['Country / Nationality', booking.contactCountry ?? lead?.nationality],
        ] as [string, string | null | undefined][])
          .filter((c): c is [string, string] => Boolean(c[1] && String(c[1]).trim()))

        // Lead guest card
        const colW = (CONTENT_W - 24) / 2
        const rows = Math.ceil(contactCells.length / 2)
        doc.font('Helvetica').fontSize(8.5)
        const addrH = booking.contactAddress ? doc.heightOfString(safe(booking.contactAddress), { width: CONTENT_W - 24 }) + 14 : 0
        const cardH = 34 + rows * 24 + addrH + 6
        ensure(cardH + 30)
        const cy = doc.y
        doc.roundedRect(MARGIN, cy, CONTENT_W, cardH, 5).fill(BRAND_BG)
        doc.rect(MARGIN, cy, 3, cardH).fill(BRAND)
        doc.font('Helvetica-Bold').fontSize(6.8).fillColor(BRAND).text('LEAD GUEST', MARGIN + 12, cy + 8, { lineBreak: false })
        doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK)
          .text(lead ? cleanName(lead.name) : 'Lead guest', MARGIN + 12, cy + 17, { width: CONTENT_W - 24, lineBreak: false, ellipsis: true })
        contactCells.forEach(([label, value], i) => {
          const x = MARGIN + 12 + (i % 2) * (colW + 0)
          const y = cy + 36 + Math.floor(i / 2) * 24
          cell(label, String(value), null, x, y, colW - 8)
        })
        if (booking.contactAddress) {
          const ay = cy + 36 + rows * 24
          doc.font('Helvetica-Bold').fontSize(6.8).fillColor(MUTED).text('ADDRESS', MARGIN + 12, ay, { lineBreak: false })
          doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(safe(booking.contactAddress), MARGIN + 12, ay + 9, { width: CONTENT_W - 24 })
        }
        doc.y = cy + cardH + 8

        // Passenger list
        if (passengers.length) {
          ensure(17 + Math.min(passengers.length, 3) * 17)
          const thY = doc.y
          doc.rect(MARGIN, thY, CONTENT_W, 17).fill(DARK)
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#CBD5E1')
          doc.text('#', MARGIN + 6, thY + 5, { width: 18, lineBreak: false })
          doc.text('FULL NAME', MARGIN + 26, thY + 5, { width: 260, lineBreak: false })
          doc.text('TYPE', MARGIN + 300, thY + 5, { width: 90, lineBreak: false })
          doc.text('NATIONALITY', MARGIN + 395, thY + 5, { width: CONTENT_W - 400, lineBreak: false })
          doc.y = thY + 17

          passengers.forEach((p: any, i: number) => {
            if (doc.y + 17 > BODY_BOTTOM) newPage()
            const py = doc.y
            if (i % 2 === 0) doc.rect(MARGIN, py, CONTENT_W, 17).fill('#F8FAFC')
            doc.font(p.isLead ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(DARK)
            doc.text(`${i + 1}`, MARGIN + 6, py + 4, { width: 18, lineBreak: false })
            doc.text(cleanName(p.name) || '—', MARGIN + 26, py + 4, { width: 220, lineBreak: false, ellipsis: true })
            if (p.isLead) {
              const nameW = Math.min(220, doc.widthOfString(cleanName(p.name)))
              doc.roundedRect(MARGIN + 30 + nameW, py + 3.5, 28, 10, 3).fill(BRAND)
              doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFFFFF')
                .text('LEAD', MARGIN + 30 + nameW, py + 5.5, { width: 28, align: 'center', lineBreak: false })
            }
            doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
            doc.text(paxType(p), MARGIN + 300, py + 4, { width: 90, lineBreak: false })
            doc.text(safe(p.nationality) || '—', MARGIN + 395, py + 4, { width: CONTENT_W - 400, lineBreak: false })
            doc.y = py + 17
          })
          doc.y += 6
        }
      }

      // ── 4. Emergency Contacts (Settings + TC) ───────────────────────────
      if (emergencyContacts.length) {
        sectionTitle('Emergency Contacts', 20 * Math.min(emergencyContacts.length, 3))
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
          .text('Available 24 hours a day during your tour. Please call or WhatsApp.', MARGIN + 5, doc.y, { width: CONTENT_W - 10 })
        doc.y += 4
        emergencyContacts.forEach((ec, i) => {
          if (doc.y + 20 > BODY_BOTTOM) newPage()
          const ey = doc.y
          if (i % 2 === 0) doc.rect(MARGIN, ey, CONTENT_W, 20).fill('#F8FAFC')
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
            .text(safe(ec.name), MARGIN + 8, ey + 5.5, { width: 170, lineBreak: false, ellipsis: true })
          if (ec.role) {
            doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
              .text(safe(ec.role), MARGIN + 185, ey + 6, { width: 160, lineBreak: false, ellipsis: true })
          }
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN)
            .text(safe(ec.phone), MARGIN + 350, ey + 5.5, { width: CONTENT_W - 358, align: 'right', lineBreak: false })
          doc.y = ey + 20
        })
        doc.y += 6
      }

      // ── 5. Accommodation ────────────────────────────────────────────────
      const accommodations: any[] = booking.accommodations ?? []
      if (accommodations.length > 0) {
        sectionTitle('Accommodation')
        accommodations.forEach((a: any, idx: number) => {
          ensure(90)
          const ay = doc.y
          doc.rect(MARGIN, ay, CONTENT_W, 18).fill(BRAND_BG)
          doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
            .text(`${idx + 1}.  ${safe(a.hotel)}`, MARGIN + 8, ay + 4, { width: CONTENT_W - 16, lineBreak: false, ellipsis: true })
          doc.y = ay + 22
          infoRow('City', a.city)
          infoRow('Check-in', fmt(a.checkIn))
          infoRow('Check-out', fmt(a.checkOut))
          infoRow('Nights', a.nights != null ? `${a.nights} night${a.nights !== 1 ? 's' : ''}` : undefined)
          infoRow('Room Type', a.roomType)
          infoRow('Meal Plan', a.mealType)
          infoRow('Address', a.address)
          infoRow('Contact', a.contact)
          doc.y += 4
        })
      }

      // ── 6. Flights ──────────────────────────────────────────────────────
      const flights: any[] = booking.flights ?? []
      if (flights.length > 0) {
        sectionTitle('Flights')
        flights.forEach((f: any) => {
          ensure(30)
          const fy = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(safe(f.flightNo), MARGIN + 5, fy, { width: 70, lineBreak: false })
          doc.font('Helvetica').fillColor(DARK).fontSize(9)
            .text(`${safe(f.fromApt)}  ${f.depTime ?? ''}   »   ${safe(f.toApt)}  ${f.arrTime ?? ''}`,
              MARGIN + 80, fy, { width: 265, lineBreak: false })
          doc.fillColor(MUTED).fontSize(8.5)
            .text(fmt(f.date), MARGIN + 80, fy, { width: CONTENT_W - 80, align: 'right', lineBreak: false })
          doc.y = fy + 14
          const note = [f.airline, f.notes].filter(Boolean).map(safe).join('  ·  ')
          if (note) {
            doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(note, MARGIN + 80, doc.y, { width: CONTENT_W - 85 })
            doc.y += 2
          }
          divider()
        })
      }

      // ── 7. Itinerary — day titles, and (Full) who is with the guest ─────
      function crewCard(c: CrewCard, showDate: boolean) {
        const cells: [string, string, string | null][] = []
        if (c.driverName)     cells.push(['Driver', c.driverName, c.driverPhone])
        if (c.vehicle)        cells.push(['Vehicle', c.vehicle, null])
        if (c.guideName)      cells.push(['Guide', c.guideName, c.guidePhone])
        if (c.tourVendorName) cells.push(['Tour Vendor', c.tourVendorName, c.tourVendorPhone])
        if (c.vendorName)     cells.push(['Transport Company', c.vendorName, c.vendorPhone])
        // A vehicle with no driver yet still tells the guest which car to look for.
        if (!cells.length) return

        const left = MARGIN + 14 + (c.driverPhoto ? 44 : 0)
        const right = PAGE_W - MARGIN - 8 - (c.vehiclePhoto ? 92 : 0)
        const cols = 2
        const colW = (right - left) / cols
        const rows = Math.ceil(cells.length / cols)
        const head = safe([showDate ? fmt(c.date) : null, c.locations.join('  ·  ')].filter(Boolean).join('  ·  '))
        const h = Math.max(18 + rows * 32 + 4, c.driverPhoto || c.vehiclePhoto ? 70 : 0)
        ensure(h + 6)
        const y = doc.y

        doc.roundedRect(MARGIN + 6, y, CONTENT_W - 6, h, 4).fill(BLUE_BG)
        doc.rect(MARGIN + 6, y, 2.5, h).fill(BLUE)
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLUE)
          .text(head || 'Your transport & guide', left, y + 6, { width: right - left - 70, lineBreak: false, ellipsis: true })
        if (c.meetingTime) {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(DARK)
            .text(`Pickup ${safe(c.meetingTime)}`, left, y + 6, { width: right - left, align: 'right', lineBreak: false })
        }
        cells.forEach(([label, value, sub], i) => {
          cell(label, value, sub, left + (i % cols) * colW, y + 20 + Math.floor(i / cols) * 32, colW - 10)
        })
        if (c.driverPhoto) {
          try {
            doc.save()
            doc.circle(MARGIN + 34, y + 34, 18).clip()
            doc.image(c.driverPhoto, MARGIN + 16, y + 16, { width: 36, height: 36, fit: [36, 36], align: 'center', valign: 'center' })
            doc.restore()
          } catch { doc.restore() }
        }
        if (c.vehiclePhoto) {
          try {
            doc.image(c.vehiclePhoto, right + 4, y + 8, { fit: [84, h - 16], align: 'center', valign: 'center' })
          } catch { /* unsupported */ }
        }
        doc.y = y + h + 6
      }

      const itineraryItems: any[] = booking.itineraryItems ?? []
      const usedDays = new Set<string>()
      if (itineraryItems.length > 0) {
        sectionTitle('Itinerary — Day by Day')
        itineraryItems.forEach((item: any) => {
          const crew = crewByDay.get(dayKey(item.date)) ?? []
          // Keep the day bar with at least its first crew card.
          ensure(26 + (crew.length ? 70 : 0))
          const iy = doc.y
          doc.rect(MARGIN, iy, CONTENT_W, 20).fill(DARK)
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(`Day ${item.dayNo}`, MARGIN + 7, iy + 6, { width: 48, lineBreak: false })
          doc.fillColor('#FFFFFF')
            .text(safe(item.title), MARGIN + 58, iy + 6, { width: CONTENT_W - 150, lineBreak: false, ellipsis: true })
          doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
            .text(fmt(item.date), MARGIN, iy + 6.5, { width: CONTENT_W - 7, align: 'right', lineBreak: false })
          doc.y = iy + 24

          if (item.inclusions) {
            doc.font('Helvetica').fontSize(8)
            const t = safe(item.inclusions)
            ensure(doc.heightOfString(t, { width: CONTENT_W - 75 }) + 4)
            const y = doc.y
            doc.font('Helvetica-Bold').fillColor(GREEN).text('Included:', MARGIN + 8, y, { width: 60, lineBreak: false })
            doc.font('Helvetica').fillColor(DARK).text(t, MARGIN + 66, y, { width: CONTENT_W - 75 })
            doc.y += 3
          }
          if (item.exclusions) {
            doc.font('Helvetica').fontSize(8)
            const t = safe(item.exclusions)
            ensure(doc.heightOfString(t, { width: CONTENT_W - 75 }) + 4)
            const y = doc.y
            doc.font('Helvetica-Bold').fillColor('#DC2626').text('Excluded:', MARGIN + 8, y, { width: 60, lineBreak: false })
            doc.font('Helvetica').fillColor(DARK).text(t, MARGIN + 66, y, { width: CONTENT_W - 75 })
            doc.y += 3
          }

          if (full) {
            const k = dayKey(item.date)
            if (!usedDays.has(k)) {
              usedDays.add(k)
              crew.forEach(c => crewCard(c, false))
            }
          }
          doc.y += 6
        })
      }

      // Movements on days the itinerary doesn't list (or no itinerary at all).
      if (full) {
        const leftover = Array.from(crewByDay.keys()).filter(k => !usedDays.has(k)).sort()
        if (leftover.length) {
          sectionTitle(itineraryItems.length ? 'Your Drivers & Guides — Other Days' : 'Your Drivers & Guides', 80)
          leftover.forEach(k => (crewByDay.get(k) ?? []).forEach(c => crewCard(c, true)))
        }
      }

      // ── 8. Tour Agenda — Activity Schedule ──────────────────────────────
      if (agendaItems.length > 0) {
        sectionTitle('Tour Agenda — Activity Schedule')
        agendaItems.forEach((item: any) => {
          doc.font('Helvetica').fontSize(8.5)
          const detailsH = item.details ? doc.heightOfString(safe(item.details), { width: CONTENT_W - 105 }) : 0
          ensure(Math.min(18 + detailsH, 120))
          const ay = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(fmt(item.date), MARGIN + 5, ay, { width: 90, lineBreak: false })
          doc.fillColor(DARK)
            .text(safe(item.location), MARGIN + 100, ay, { width: 195, lineBreak: false, ellipsis: true })
          if (item.serviceType && item.serviceType !== 'OWN_ARRANGEMENT') {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
              .text(serviceTypeShortLabel(item.serviceType), MARGIN + 300, ay + 1, { width: 115, lineBreak: false })
          }
          if (item.meetingTime) {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
              .text(`Meet: ${safe(item.meetingTime)}`, MARGIN, ay + 1, { width: CONTENT_W, align: 'right', lineBreak: false })
          }
          doc.y = ay + 13
          if (item.details) {
            doc.font('Helvetica').fontSize(8.5).fillColor('#334155')
              .text(safe(item.details), MARGIN + 100, doc.y, { width: CONTENT_W - 105, lineGap: 1.5 })
            doc.y += 2
          }
          if (item.mealPlan) {
            ensure(12)
            doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN)
              .text(`Meals: ${safe(item.mealPlan)}`, MARGIN + 100, doc.y, { width: CONTENT_W - 105 })
          }
          doc.y += 3
          divider()
        })
      }

      // ── 9. Package details & notes ──────────────────────────────────────
      // Flows on from the agenda; a fresh page only if the heading won't fit.
      for (const n of filledPackageNotes(booking)) {
        sectionTitle(n.label, 30)
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK)
          .text(safe(n.text), MARGIN + 5, doc.y, { width: CONTENT_W - 10, lineGap: 2 })
        doc.y += 6
      }

      // ── 10. Tickets & vouchers (Full only) ──────────────────────────────
      if (full && tickets.length) {
        sectionTitle('Tickets & Vouchers', 40)
        tickets.forEach((t: any, i: number) => {
          const files = vouchers.get(t.id) ?? []
          const attached = files.filter(f => f.kind !== 'unavailable').length
          const missing = files.filter(f => f.kind === 'unavailable')
          const meta = [
            t.supplier ? safe(t.supplier) : null,
            t.reference ? `Ref ${safe(t.reference)}` : null,
            t.qty > 1 ? `Qty ${t.qty}` : null,
            attached ? `${attached} voucher${attached === 1 ? '' : 's'} attached` : null,
          ].filter(Boolean).join('  ·  ')
          ensure(30 + missing.length * 11)
          const y = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(`${i + 1}.`, MARGIN + 5, y, { width: 20, lineBreak: false })
          doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(safe(t.type) || 'Ticket', MARGIN + 26, y, { width: CONTENT_W - 31 })
          if (meta) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(meta, MARGIN + 26, doc.y, { width: CONTENT_W - 31 })
          // A file we could not draw is still the guest's ticket — give them the link.
          for (const f of missing) {
            const url = publicFileUrl(f.url)
            doc.font('Helvetica').fontSize(7.5).fillColor(BLUE)
              .text(`Open ${safe(f.label || f.name) || 'voucher'} online`, MARGIN + 26, doc.y, { width: CONTENT_W - 31, link: url, underline: true })
          }
          doc.y += 3
          divider()
        })

        // Each voucher on its own page, ready to print or show at the gate.
        for (const t of tickets) {
          const files = (vouchers.get(t.id) ?? []).filter(f => f.kind !== 'unavailable')
          const total = files.reduce((n, f) => n + (f.kind === 'pdf' ? Math.min(f.pageCount ?? 1, MAX_PAGES_PER_PDF) : 1), 0)
          let seq = 0
          for (const f of files) {
            const pages = f.kind === 'pdf' ? Math.min(f.pageCount ?? 1, MAX_PAGES_PER_PDF) : 1
            for (let p = 0; p < pages; p++) {
              seq++
              newPage()
              const hy = MARGIN - 10
              doc.rect(MARGIN, hy, CONTENT_W, 30).fill(DARK)
              doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF')
                .text(safe(t.type) || 'Ticket / Voucher', MARGIN + 10, hy + 9, { width: CONTENT_W - 110, lineBreak: false, ellipsis: true })
              if (total > 1) {
                doc.font('Helvetica').fontSize(8.5).fillColor('#CBD5E1')
                  .text(`Voucher ${seq} of ${total}`, MARGIN, hy + 11, { width: CONTENT_W - 10, align: 'right', lineBreak: false })
              }
              doc.rect(MARGIN, hy + 30, CONTENT_W, 3).fill(BRAND)
              doc.y = hy + 40

              const meta = [
                t.supplier ? `Supplier: ${safe(t.supplier)}` : null,
                t.reference ? `Reference: ${safe(t.reference)}` : null,
                `Qty: ${t.qty ?? 1}`,
                f.label ? safe(f.label) : null,
              ].filter(Boolean).join('     ')
              doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(meta, MARGIN + 2, doc.y, { width: CONTENT_W - 4, lineBreak: false, ellipsis: true })
              doc.y += 14
              const notes = parseTicketNotes(t.notes)
              if (notes && seq === 1) {
                doc.font('Helvetica').fontSize(8).fillColor(DARK).text(safe(notes), MARGIN + 2, doc.y, { width: CONTENT_W - 4, height: 36, ellipsis: true })
                doc.y += 4
              }

              const box = { x: MARGIN, top: doc.y + 4, w: CONTENT_W, h: BODY_BOTTOM - doc.y - 8 }
              if (f.kind === 'image' && f.buffer) {
                try {
                  doc.image(f.buffer, box.x, box.top, { fit: [box.w, box.h], align: 'center', valign: 'top' })
                } catch {
                  doc.font('Helvetica').fontSize(9).fillColor(BLUE)
                    .text('Open this voucher online', box.x, box.top, { link: publicFileUrl(f.url), underline: true })
                }
              } else if (f.kind === 'pdf') {
                stamps.push({ pageIndex: pageIndex(), file: f, srcPage: p, box })
              }
            }
          }
        }
      }

      // ── Footer on every page ────────────────────────────────────────────
      // Written below the bottom margin, so lift the margin first: otherwise
      // PDFKit treats the footer as overflow and appends a blank page for it.
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i)
        const prevBottom = doc.page.margins.bottom
        doc.page.margins.bottom = 0
        doc.moveTo(MARGIN, 812).lineTo(PAGE_W - MARGIN, 812).strokeColor(LINE).lineWidth(0.5).stroke()
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(
            `Apple Holidays  ·  Ref: ${booking.bookingRef}  ·  Page ${i - range.start + 1} of ${range.count}`
            + `  ·  Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
            MARGIN, 818, { width: CONTENT_W, align: 'center', lineBreak: false },
          )
        doc.page.margins.bottom = prevBottom
      }

      doc.end()
    })().catch(reject)
  })

  if (!stamps.length) return laidOut
  return stampPdfPages(laidOut, stamps)
}

/** Draw each PDF e-ticket page into the box reserved for it. */
async function stampPdfPages(laidOut: Buffer, stamps: PdfStamp[]): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const out = await PDFDocument.load(laidOut)
  const font = await out.embedFont(StandardFonts.Helvetica)

  const byFile = new Map<VoucherFile, PdfStamp[]>()
  for (const s of stamps) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s])

  for (const [file, list] of Array.from(byFile.entries())) {
    let embedded: Awaited<ReturnType<typeof out.embedPdf>> = []
    try {
      embedded = await out.embedPdf(file.buffer!, list.map(s => s.srcPage))
    } catch (err) {
      console.warn('[booking-pdf] could not embed PDF voucher:', (err as Error)?.message)
    }
    list.forEach((s, i) => {
      const page = out.getPage(s.pageIndex)
      const H = page.getHeight()
      const emb = embedded[i]
      if (!emb) {
        page.drawText(`This voucher could not be shown here. Open it online: ${publicFileUrl(file.url)}`, {
          x: s.box.x, y: H - s.box.top - 12, size: 8, font, color: rgb(0.15, 0.39, 0.92), maxWidth: s.box.w,
        })
        return
      }
      const scale = Math.min(s.box.w / emb.width, s.box.h / emb.height, 1.5)
      const w = emb.width * scale
      const h = emb.height * scale
      const x = s.box.x + (s.box.w - w) / 2
      const y = H - s.box.top - h
      page.drawPage(emb, { x, y, width: w, height: h })
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.886, 0.91, 0.941), borderWidth: 0.5 })
    })
  }
  return Buffer.from(await out.save())
}

// ── Public exports ───────────────────────────────────────────────────────────

/** PDF 1 – Tour Confirmation (no drivers / tickets) */
export async function generateConfirmationPdf(booking: any): Promise<Buffer> {
  return buildPdf(booking, false)
}

/** PDF 2 – Full Tour Details with Drivers & Vouchers */
export async function generateFullDetailsPdf(booking: any): Promise<Buffer> {
  return buildPdf(booking, true)
}

/** Backwards-compatible alias → generates confirmation PDF */
export async function generateBookingPdf(booking: any): Promise<Buffer> {
  return generateConfirmationPdf(booking)
}
