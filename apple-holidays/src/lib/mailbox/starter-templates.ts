/**
 * The templates a fresh Mail Box starts with.
 *
 * Installed on demand from the settings screen, never automatically: seeding on
 * first read would quietly write five rows into a live database the moment
 * somebody opened a page, and the operator should be the one who decides the
 * desk wants these. Installing is upsert-by-code, so pressing it twice restores
 * the originals rather than duplicating them — which also makes it the way back
 * from an edit that went wrong.
 */

export interface StarterTemplate {
  code: string
  name: string
  description: string
  category: string
  audience: string
  subject: string
  bodyHtml: string
  attachPdf: boolean
  sortOrder: number
}

/** Shared chrome so every starter template arrives looking like one system. */
function shell(title: string, accent: string, inner: string): string {
  return `<div style="margin:0;padding:24px;background:#f1f5f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08);">
    <div style="background:#0f172a;padding:26px 32px;">
      <p style="margin:0;color:#ffffff;font-size:19px;font-weight:800;letter-spacing:.3px;">Apple Holidays</p>
      <p style="margin:3px 0 0;color:#94a3b8;font-size:12px;letter-spacing:.4px;">${title}</p>
      <span style="display:inline-block;margin-top:12px;background:${accent};color:#ffffff;font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;letter-spacing:1px;padding:5px 14px;border-radius:6px;">{{bookingRef}}</span>
    </div>
    <div style="padding:28px 32px;color:#334155;font-size:14px;line-height:1.65;">
${inner}
      <p style="margin:24px 0 0;">Kind regards,<br/><strong style="color:#0f172a;">{{senderName}}</strong><br/><span style="color:#64748b;font-size:12px;">Apple Holidays &middot; {{senderEmail}}</span></p>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center;">
      <p style="margin:0;color:#94a3b8;font-size:11px;">Apple Holidays &middot; Booking {{bookingRef}} &middot; {{today}}</p>
    </div>
  </div>
</div>`
}

const factRow = (label: string, value: string) =>
  `      <tr><td style="padding:7px 12px;background:#f8fafc;border-bottom:1px solid #eef2f7;font-size:12px;font-weight:600;color:#475569;width:42%;">${label}</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;font-size:13px;color:#0f172a;">${value}</td></tr>`

const factTable = (rows: string[]) =>
  `      <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">\n${rows.join('\n')}\n      </table>`

const CORE_FACTS = factTable([
  factRow('Agent / Operator', '{{agent}}'),
  factRow('Lead Passenger', '{{leadPassenger}}'),
  factRow('Travel Dates', '{{tripDates}}'),
  factRow('Passengers', '{{paxSummary}}'),
  factRow('File Handler', '{{fileHandler}}'),
])

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    code: 'agent-booking-update',
    name: 'Booking Update — Agent',
    description: 'General progress note to the agent. The everyday default.',
    category: 'Agent',
    audience: 'AGENT',
    subject: 'Booking Update — {{bookingRef}} ({{leadPassenger}})',
    attachPdf: false,
    sortOrder: 10,
    bodyHtml: shell('Booking Update', '#d97706', `      <p style="margin:0 0 4px;">Dear {{agentName}},</p>
      <p style="margin:0;">Here is the latest on booking <strong>{{bookingRef}}</strong> travelling {{tripDates}}.</p>
${CORE_FACTS}
      <p style="margin:0;">[ Write your update here. ]</p>
      <p style="margin:16px 0 0;">Please let us know if anything needs adjusting and we will action it right away.</p>`),
  },
  {
    code: 'agent-info-request',
    name: 'Information Request — Agent',
    description: 'Ask the agent for missing details before the file can move on.',
    category: 'Agent',
    audience: 'AGENT',
    subject: 'Information Needed — {{bookingRef}} ({{tripDates}})',
    attachPdf: false,
    sortOrder: 20,
    bodyHtml: shell('Information Request', '#0ea5e9', `      <p style="margin:0 0 4px;">Dear {{agentName}},</p>
      <p style="margin:0;">Before we can finalise <strong>{{bookingRef}}</strong> we need a little more information from your side.</p>
${CORE_FACTS}
      <div style="margin:18px 0;padding:14px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0ea5e9;border-radius:6px;">
        <p style="margin:0 0 6px;font-weight:700;color:#075985;font-size:13px;">We still need</p>
        <ul style="margin:0;padding-left:18px;color:#0c4a6e;font-size:13px;line-height:1.7;">
          <li>[ item one ]</li>
          <li>[ item two ]</li>
        </ul>
      </div>
      <p style="margin:0;">The trip begins on {{arrivalDate}}, so an early reply would help us hold the arrangements.</p>`),
  },
  {
    code: 'agent-itinerary-confirmation',
    name: 'Itinerary Confirmation — Agent',
    description: 'Confirms hotels and flights as they currently stand. Attaches the booking PDF.',
    category: 'Agent',
    audience: 'AGENT',
    subject: 'Itinerary Confirmed — {{bookingRef}} · {{tripDates}}',
    attachPdf: true,
    sortOrder: 30,
    bodyHtml: shell('Itinerary Confirmation', '#16a34a', `      <p style="margin:0 0 4px;">Dear {{agentName}},</p>
      <div style="margin:14px 0 18px;padding:12px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;">
        <p style="margin:0;color:#166534;font-size:14px;font-weight:700;">&#10003; Confirmed &middot; {{nights}} nights in {{destination}}</p>
      </div>
${CORE_FACTS}
      <p style="margin:0 0 6px;font-weight:700;color:#0f172a;font-size:13px;">Accommodation</p>
      <p style="margin:0 0 18px;color:#475569;font-size:13px;line-height:1.7;">{{hotelList}}</p>
      <p style="margin:0 0 6px;font-weight:700;color:#0f172a;font-size:13px;">Flights</p>
      <p style="margin:0 0 18px;color:#475569;font-size:13px;line-height:1.7;">{{flightList}}</p>
      <p style="margin:0;">The full itinerary is attached. Please review and confirm everything reads correctly.</p>`),
  },
  {
    code: 'agent-payment-reminder',
    name: 'Payment Reminder — Agent',
    description: 'Chases the balance due on a file. Accounts wording.',
    category: 'Accounts',
    audience: 'AGENT',
    subject: 'Payment Reminder — {{bookingRef}} ({{quotedTotal}})',
    attachPdf: false,
    sortOrder: 40,
    bodyHtml: shell('Payment Reminder', '#dc2626', `      <p style="margin:0 0 4px;">Dear {{agentName}},</p>
      <p style="margin:0;">This is a courtesy reminder regarding the balance on booking <strong>{{bookingRef}}</strong>.</p>
${factTable([
  factRow('Booking Value', '{{quotedTotal}}'),
  factRow('Travel Dates', '{{tripDates}}'),
  factRow('Passengers', '{{paxSummary}}'),
])}
      <p style="margin:0;">Guests arrive on {{arrivalDate}}. Settling the balance before then lets us release all vouchers on time.</p>
      <p style="margin:14px 0 0;">If payment has already been sent, please ignore this note and share the remittance advice so we can reconcile it.</p>`),
  },
  {
    code: 'agent-pre-arrival',
    name: 'Pre-Arrival Notice — Agent',
    description: 'Sent a few days out: arrangements are set and guests are ready to travel.',
    category: 'Operations',
    audience: 'AGENT',
    subject: 'Ready for Arrival — {{bookingRef}} on {{arrivalDate}}',
    attachPdf: true,
    sortOrder: 50,
    bodyHtml: shell('Pre-Arrival Notice', '#7c3aed', `      <p style="margin:0 0 4px;">Dear {{agentName}},</p>
      <p style="margin:0;">Everything is in place for <strong>{{leadPassenger}}</strong>, arriving <strong>{{arrivalDate}}</strong>.</p>
${CORE_FACTS}
      <p style="margin:0 0 6px;font-weight:700;color:#0f172a;font-size:13px;">Accommodation</p>
      <p style="margin:0 0 18px;color:#475569;font-size:13px;line-height:1.7;">{{hotelList}}</p>
      <p style="margin:0;">Transfers and the day-by-day programme are confirmed with our ground team. Vouchers are attached.</p>
      <p style="margin:14px 0 0;">Our team is reachable throughout the trip should the guests need anything.</p>`),
  },
]
