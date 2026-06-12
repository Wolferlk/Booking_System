/**
 * Generates the same HTML as the print page but as a server-side string.
 * Used by Puppeteer to produce a pixel-perfect PDF for email attachment.
 *
 * Intentionally excludes: quoted total, payments, P&L, tickets.
 */

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function esc(s: unknown): string {
  if (s === null || s === undefined) return '—'
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateBookingHtml(booking: any): string {
  const passengers     = booking.passengers     ?? []
  const flights        = booking.flights        ?? []
  const accommodations = booking.accommodations ?? []
  const itinerary      = booking.itineraryItems ?? []
  const agendaItems    = booking.tourAgenda?.items ?? []
  const drivers        = getDrivers(agendaItems)
  const emergencyContacts = booking.emergencyContacts ?? []

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Booking Confirmation — ${esc(booking.bookingRef)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', Helvetica, sans-serif; font-size: 13px; color: #1e293b; background: #fff; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px 48px 60px; }

  /* Header */
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #e2e8f0; margin-bottom: 28px; }
  .doc-header h1 { font-size: 22px; font-weight: 900; color: #1e293b; margin-bottom: 2px; }
  .doc-header .sub { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
  .doc-header .ref { font-size: 22px; font-weight: 900; font-family: monospace; color: #1e293b; text-align: right; }
  .doc-header .status { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; text-align: right; margin-top: 2px; }

  /* Sections */
  .section { margin-bottom: 24px; page-break-inside: avoid; }
  .section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; }

  /* Grid fields */
  .fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 2px; }
  .field-value { font-size: 13px; font-weight: 600; color: #1e293b; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #f1f5f9; }
  th { text-align: left; padding: 6px 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; }
  td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: top; }
  td.bold { font-weight: 600; color: #1e293b; }
  td.mono { font-family: monospace; }
  td.muted { color: #94a3b8; }

  /* Itinerary */
  .itin-item { display: flex; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 10px; }
  .itin-day { width: 36px; height: 36px; border-radius: 50%; background: #eff6ff; border: 1px solid #bfdbfe; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .itin-day span { font-size: 10px; font-weight: 700; color: #1d4ed8; }
  .itin-body { flex: 1; }
  .itin-title { font-weight: 600; color: #1e293b; font-size: 13px; }
  .itin-date { font-size: 11px; color: #94a3b8; margin-left: 8px; }
  .itin-desc { font-size: 11px; color: #64748b; margin-top: 3px; line-height: 1.5; }

  /* Agenda */
  .agenda-row td { font-size: 11px; }

  /* Amendment banner */
  .amendment { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 11px; color: #92400e; }

  /* Terms/Exclusions */
  .prose { font-size: 11px; color: #64748b; line-height: 1.7; white-space: pre-wrap; }

  /* Footer */
  .doc-footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; }

  @media print {
    body { background: white; }
    .page { padding: 20px 28px 40px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="doc-header">
    <div>
      <h1>Apple Holidays</h1>
      <div class="sub">MMT Vietnam &mdash; Booking Confirmation</div>
    </div>
    <div>
      <div class="ref">${esc(booking.bookingRef)}</div>
      <div class="status">Client Confirmed</div>
      <div class="status" style="margin-top:2px;color:#94a3b8;">Printed: ${fmt(new Date())}</div>
    </div>
  </div>

  <!-- BOOKING SUMMARY -->
  <div class="section">
    <div class="section-title">Booking Summary</div>
    <div class="fields">
      <div><div class="field-label">Agent / Tour Operator</div><div class="field-value">${esc(booking.agent)}</div></div>
      <div><div class="field-label">File Handler</div><div class="field-value">${esc(booking.fileHandler)}</div></div>
      <div><div class="field-label">Agent Booking ID</div><div class="field-value">${esc(booking.agentBookingId)}</div></div>
      <div><div class="field-label">Arrival</div><div class="field-value">${fmt(booking.arrivalDate)}</div></div>
      <div><div class="field-label">Departure</div><div class="field-value">${fmt(booking.departureDate)}</div></div>
      <div><div class="field-label">Currency</div><div class="field-value">${esc(booking.currency)}</div></div>
      <div><div class="field-label">Adults</div><div class="field-value">${esc(booking.paxAdults ?? 0)}</div></div>
      <div><div class="field-label">Children</div><div class="field-value">${esc(booking.paxChildren ?? 0)}</div></div>
    </div>
    ${booking.amendmentNote ? `<div class="amendment"><strong>Amendment:</strong> ${esc(booking.amendmentNote)}</div>` : ''}
  </div>

  <!-- PASSENGERS -->
  ${passengers.length > 0 ? `
  <div class="section">
    <div class="section-title">Passengers</div>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Age</th><th>Passport No.</th><th>Nationality</th><th>Expiry</th></tr></thead>
      <tbody>
        ${passengers.map((p: any) => `
        <tr>
          <td class="bold">${esc(p.name)}${p.isLead ? ' <span style="font-size:9px;background:#eff6ff;color:#1d4ed8;padding:1px 5px;border-radius:3px;font-weight:600;">Lead</span>' : ''}</td>
          <td>${esc(p.type)}</td>
          <td>${esc(p.age)}</td>
          <td class="mono">${esc(p.passportNo)}</td>
          <td>${esc(p.nationality)}</td>
          <td>${p.passportExpiry ? fmt(p.passportExpiry) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- FLIGHTS -->
  ${flights.length > 0 ? `
  <div class="section">
    <div class="section-title">Flights</div>
    <table>
      <thead><tr><th>Flight</th><th>Date</th><th>From</th><th>Dep.</th><th>To</th><th>Arr.</th><th>Class</th></tr></thead>
      <tbody>
        ${flights.map((f: any) => `
        <tr>
          <td class="bold mono">${esc(f.flightNo)}</td>
          <td>${fmt(f.date)}</td>
          <td class="mono">${esc(f.fromApt)}</td>
          <td>${esc(f.depTime)}</td>
          <td class="mono">${esc(f.toApt)}</td>
          <td>${esc(f.arrTime)}</td>
          <td>${esc(f.cabinClass)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- ACCOMMODATION -->
  ${accommodations.length > 0 ? `
  <div class="section">
    <div class="section-title">Accommodation</div>
    <table>
      <thead><tr><th>Hotel</th><th>City</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Room</th></tr></thead>
      <tbody>
        ${accommodations.map((a: any) => `
        <tr>
          <td class="bold">${esc(a.hotel)}</td>
          <td>${esc(a.city)}</td>
          <td>${fmt(a.checkIn)}</td>
          <td>${fmt(a.checkOut)}</td>
          <td>${esc(a.nights)}</td>
          <td>${esc(a.roomType)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- ITINERARY -->
  ${itinerary.length > 0 ? `
  <div class="section">
    <div class="section-title">Itinerary — ${itinerary.length} Days</div>
    ${itinerary.map((item: any) => `
    <div class="itin-item">
      <div class="itin-day"><span>D${esc(item.dayNo)}</span></div>
      <div class="itin-body">
        <div><span class="itin-title">${esc(item.title)}</span><span class="itin-date">${fmt(item.date)}</span></div>
        ${item.description ? `<div class="itin-desc">${esc(item.description)}</div>` : ''}
      </div>
    </div>`).join('')}
  </div>` : ''}

  <!-- TOUR AGENDA -->
  ${agendaItems.length > 0 ? `
  <div class="section">
    <div class="section-title">Tour Agenda</div>
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Meet</th><th>Activity</th><th>Location</th><th>Notes</th></tr></thead>
      <tbody>
        ${agendaItems.map((item: any) => `
        <tr class="agenda-row">
          <td>${fmt(item.date)}</td>
          <td>${esc(item.time)}</td>
          <td>${esc(item.meetingTime)}</td>
          <td class="bold">${esc(item.title)}</td>
          <td>${esc(item.location)}</td>
          <td class="muted">${esc(item.notes)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- DRIVERS -->
  ${drivers.length > 0 ? `
  <div class="section">
    <div class="section-title">Driver Assignments</div>
    <table>
      <thead><tr><th>Driver Name</th><th>Phone</th><th>Vehicle Type</th><th>Plate No.</th></tr></thead>
      <tbody>
        ${drivers.map((d: any) => `
        <tr>
          <td class="bold">${esc(d.driverName)}</td>
          <td class="mono">${esc(d.driverPhone)}</td>
          <td>${esc(d.vehicleType)}</td>
          <td class="mono">${esc(d.vehiclePlate)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- EMERGENCY CONTACTS -->
  ${emergencyContacts.length > 0 ? `
  <div class="section">
    <div class="section-title">Emergency Contacts</div>
    <table>
      <thead><tr><th>Role</th><th>Name</th><th>Phone</th></tr></thead>
      <tbody>
        ${emergencyContacts.map((ec: any) => `
        <tr>
          <td class="muted">${esc(ec.role)}</td>
          <td class="bold">${esc(ec.name)}</td>
          <td class="mono">${esc(ec.phone)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- TERMS & CONDITIONS -->
  ${booking.terms ? `
  <div class="section">
    <div class="section-title">Terms &amp; Conditions</div>
    <p class="prose">${esc(booking.terms)}</p>
  </div>` : ''}

  <!-- EXCLUSIONS -->
  ${booking.exclusions ? `
  <div class="section">
    <div class="section-title">Exclusions</div>
    <p class="prose">${esc(booking.exclusions)}</p>
  </div>` : ''}

  <!-- FOOTER -->
  <div class="doc-footer">
    <span>Apple Holidays &middot; MMT Vietnam &middot; Confidential</span>
    <span>${esc(booking.bookingRef)} &middot; Generated ${new Date().toLocaleString('en-GB')}</span>
  </div>

</div>
</body>
</html>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDrivers(agendaItems: any[]): any[] {
  const map = new Map()
  agendaItems.forEach(item => {
    if (item.assignment?.driverName && !map.has(item.assignment.driverName)) {
      map.set(item.assignment.driverName, item.assignment)
    }
  })
  return Array.from(map.values())
}
