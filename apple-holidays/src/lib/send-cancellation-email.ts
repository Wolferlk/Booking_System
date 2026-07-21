import { sendMailViaGraph } from '@/lib/send-mail'

/**
 * Operations desk that must be told the moment a booking is cancelled.
 * The user who pressed Cancel is added on top of this list (as the "to").
 */
export const CANCELLATION_NOTIFY_LIST = [
  'senthoor.pandian@aahaas.com',
  'venkadesh@aahaas.com',
  'amala.arputha@aahaas.com',
  'mahamood.sallay@aahaas.com',
  'shahila.shiyaz@aahaas.com',
  'shafiya.nasirudeen@aahaas.com',
]

interface CancellationMailInput {
  bookingRef: string
  isNumber?: string | null
  agent?: string | null
  agentBookingId?: string | null
  fileHandler?: string | null
  leadPassenger?: string | null
  arrivalDate: Date | string
  departureDate: Date | string
  paxAdults?: number
  paxChildren?: number
  paxInfants?: number
  quotedTotal?: string | number | null
  currency?: string | null
  operationCountry?: string | null
  previousStatus: string
  cancelledByName: string
  cancelledByEmail: string
  reason: string
  cancelledAt: Date
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:9px 14px;border-bottom:1px solid #f1f5f9;font:600 12px/1.4 Segoe UI,Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.4px;width:190px;vertical-align:top;">${label}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #f1f5f9;font:400 14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a;">${value}</td>
    </tr>`
}

export function buildCancellationEmail(i: CancellationMailInput): string {
  const pax = [
    i.paxAdults ? `${i.paxAdults} adult${i.paxAdults > 1 ? 's' : ''}` : null,
    i.paxChildren ? `${i.paxChildren} child${i.paxChildren > 1 ? 'ren' : ''}` : null,
    i.paxInfants ? `${i.paxInfants} infant${i.paxInfants > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(', ') || '—'

  const value = i.quotedTotal
    ? `${esc(i.currency ?? 'USD')} ${Number(i.quotedTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : '—'

  // Days between the cancellation and the arrival date — how much notice ops has.
  const arrival = new Date(i.arrivalDate)
  const daysToArrival = Math.ceil((arrival.getTime() - i.cancelledAt.getTime()) / 86400000)
  const urgency = daysToArrival <= 21 && daysToArrival > 0
    ? `<div style="margin:0 0 20px;padding:12px 16px;background:#fff7ed;border-left:4px solid #f97316;border-radius:6px;font:600 13px/1.5 Segoe UI,Arial,sans-serif;color:#9a3412;">
         ⚠ Cancelled inside the penalty window — arrival was in ${daysToArrival} day${daysToArrival === 1 ? '' : 's'}. Please review supplier charges and refunds immediately.
       </div>`
    : daysToArrival <= 0
      ? `<div style="margin:0 0 20px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;font:600 13px/1.5 Segoe UI,Arial,sans-serif;color:#991b1b;">
           ⚠ This tour had already started or departed. Confirm what services were consumed before settling accounts.
         </div>`
      : ''

  return `
<div style="background:#f1f5f9;padding:28px 0;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08);">

    <div style="background:linear-gradient(135deg,#b91c1c 0%,#dc2626 55%,#ef4444 100%);padding:26px 30px;">
      <div style="font:600 11px/1 Segoe UI,Arial,sans-serif;color:#fecaca;letter-spacing:2px;text-transform:uppercase;">Apple Holidays — Operations Alert</div>
      <div style="font:700 26px/1.25 Segoe UI,Arial,sans-serif;color:#ffffff;margin-top:8px;">Booking Cancelled</div>
      <div style="font:500 15px/1.4 Segoe UI,Arial,sans-serif;color:#ffe4e6;margin-top:6px;">${esc(i.bookingRef)}${i.isNumber ? ` &nbsp;·&nbsp; ${esc(i.isNumber)}` : ''}</div>
    </div>

    <div style="padding:26px 30px 8px;">
      ${urgency}
      <p style="margin:0 0 20px;font:400 15px/1.65 Segoe UI,Arial,sans-serif;color:#334155;">
        <strong style="color:#0f172a;">${esc(i.cancelledByName)}</strong> has cancelled booking
        <strong style="color:#0f172a;">${esc(i.bookingRef)}</strong>${i.leadPassenger ? ` for <strong style="color:#0f172a;">${esc(i.leadPassenger)}</strong>` : ''}
        on ${esc(fmtDateTime(i.cancelledAt))}. The booking has been moved out of all active operations lists
        and is now shown as cancelled in the system — its records remain available for reference.
      </p>

      <div style="margin:0 0 22px;padding:16px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
        <div style="font:700 11px/1 Segoe UI,Arial,sans-serif;color:#b91c1c;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;">Reason for cancellation</div>
        <div style="font:400 15px/1.6 Segoe UI,Arial,sans-serif;color:#7f1d1d;white-space:pre-wrap;">${esc(i.reason)}</div>
      </div>

      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        ${row('Booking Ref', esc(i.bookingRef))}
        ${i.isNumber ? row('IS Number', esc(i.isNumber)) : ''}
        ${i.agentBookingId ? row('Agent Booking ID', esc(i.agentBookingId)) : ''}
        ${row('Agent', esc(i.agent ?? '—'))}
        ${row('File Handler', esc(i.fileHandler ?? '—'))}
        ${row('Lead Passenger', esc(i.leadPassenger ?? '—'))}
        ${row('Travel Dates', `${esc(fmtDate(i.arrivalDate))} &rarr; ${esc(fmtDate(i.departureDate))}`)}
        ${row('Passengers', esc(pax))}
        ${row('Quoted Value', value)}
        ${i.operationCountry ? row('Operation Country', esc(i.operationCountry.replace(/_/g, ' / '))) : ''}
        ${row('Status Before Cancel', esc(i.previousStatus.replace(/_/g, ' ')))}
        ${row('Cancelled By', `${esc(i.cancelledByName)}<br><a href="mailto:${esc(i.cancelledByEmail)}" style="color:#2563eb;text-decoration:none;">${esc(i.cancelledByEmail)}</a>`)}
        ${row('Cancelled On', esc(fmtDateTime(i.cancelledAt)))}
      </table>

      <p style="margin:22px 0 6px;font:600 13px/1.6 Segoe UI,Arial,sans-serif;color:#475569;">Next steps for the team</p>
      <ul style="margin:0 0 22px;padding-left:20px;font:400 14px/1.7 Segoe UI,Arial,sans-serif;color:#475569;">
        <li>Release hotel, transport and activity bookings with the suppliers.</li>
        <li>Confirm any cancellation charges and update the P&amp;L.</li>
        <li>Inform the agent and process refunds where applicable.</li>
      </ul>
    </div>

    <div style="padding:16px 30px 26px;border-top:1px solid #f1f5f9;">
      <div style="font:400 12px/1.6 Segoe UI,Arial,sans-serif;color:#94a3b8;">
        Automated notification from the Apple Holidays Booking System.
        Reply to <a href="mailto:${esc(i.cancelledByEmail)}" style="color:#64748b;">${esc(i.cancelledByEmail)}</a> for anything about this cancellation.
      </div>
    </div>
  </div>
</div>`
}

/**
 * Sends the cancellation alert to the person who cancelled (to) and the
 * operations desk (cc). Never throws — cancellation must succeed even if
 * Graph is unavailable; the caller logs the failure.
 */
export async function sendCancellationEmail(i: CancellationMailInput): Promise<void> {
  const to = i.cancelledByEmail?.includes('@')
    ? i.cancelledByEmail
    : CANCELLATION_NOTIFY_LIST[0]

  await sendMailViaGraph({
    to,
    cc: CANCELLATION_NOTIFY_LIST,
    subject: `CANCELLED — ${i.bookingRef}${i.leadPassenger ? ` (${i.leadPassenger})` : ''} · ${fmtDate(i.arrivalDate)}`,
    bodyHtml: buildCancellationEmail(i),
  })
}
