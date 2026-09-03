/**
 * Template tokens — the `{{placeholder}}` vocabulary a Mail Box template may use.
 *
 * Rendering is deliberately dumb: a flat string map, substituted literally. No
 * expressions, no conditionals, no loops. A template is written by an operations
 * desk in a rich-text box, not by a developer, and every clever templating
 * feature is a new way for a half-typed brace to reach an agent's inbox.
 *
 * An unknown token is left standing rather than blanked, so a typo is visible in
 * the preview instead of silently deleting a sentence.
 */

export interface TokenSpec {
  token: string
  label: string
  group: string
  example: string
}

/** The catalogue the settings editor shows, and the only tokens `buildTokens` fills. */
export const TOKEN_CATALOGUE: TokenSpec[] = [
  { token: 'bookingRef',      label: 'Booking reference',   group: 'Booking',   example: 'VN25-0412' },
  { token: 'agent',           label: 'Agent / operator',    group: 'Booking',   example: 'Make My Trip' },
  { token: 'agentName',       label: 'Agent contact name',  group: 'Agent',     example: 'Priya' },
  { token: 'agentEmail',      label: 'Agent email',         group: 'Agent',     example: 'ops@agent.com' },
  { token: 'fileHandler',     label: 'File handler',        group: 'Booking',   example: 'Nadeesha' },
  { token: 'leadPassenger',   label: 'Lead passenger',      group: 'Guests',    example: 'Mr A Perera' },
  { token: 'paxAdults',       label: 'Adults',              group: 'Guests',    example: '2' },
  { token: 'paxChildren',     label: 'Children',            group: 'Guests',    example: '1' },
  { token: 'paxInfants',      label: 'Infants',             group: 'Guests',    example: '0' },
  { token: 'paxSummary',      label: 'Pax summary',         group: 'Guests',    example: '2 Adults, 1 Child' },
  { token: 'arrivalDate',     label: 'Arrival date',        group: 'Dates',     example: '12 Apr 2026' },
  { token: 'departureDate',   label: 'Departure date',      group: 'Dates',     example: '18 Apr 2026' },
  { token: 'tripDates',       label: 'Trip date range',     group: 'Dates',     example: '12 Apr – 18 Apr 2026' },
  { token: 'nights',          label: 'Number of nights',    group: 'Dates',     example: '6' },
  { token: 'destination',     label: 'Tour destination',    group: 'Booking',   example: 'Vietnam' },
  { token: 'country',         label: 'Operation country',   group: 'Booking',   example: 'Vietnam' },
  { token: 'status',          label: 'Booking status',      group: 'Booking',   example: 'Client Confirmed' },
  { token: 'quotedTotal',     label: 'Quoted total',        group: 'Money',     example: 'USD 1,850.00' },
  { token: 'currency',        label: 'Currency',            group: 'Money',     example: 'USD' },
  { token: 'hotelList',       label: 'Hotels (one per line)', group: 'Booking', example: 'Hanoi — Sofitel Legend' },
  { token: 'flightList',      label: 'Flights (one per line)', group: 'Booking', example: 'VN123 CMB→HAN 12 Apr' },
  { token: 'senderName',      label: 'Your name',           group: 'Sender',    example: 'Sasindu' },
  { token: 'senderEmail',     label: 'Your email',          group: 'Sender',    example: 'you@aahaas.com' },
  { token: 'today',           label: "Today's date",        group: 'Sender',    example: '03 Sep 2026' },
]

export const TOKEN_NAMES: string[] = TOKEN_CATALOGUE.map(t => t.token)

const fmtDate = (d: unknown): string =>
  d ? new Date(d as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Flattens a booking (with whatever relations happen to be loaded) into the
 * token map. Missing data becomes an em dash rather than the word "undefined" —
 * a blank that reads as deliberate is far better in front of an agent than a
 * JavaScript artefact.
 */
export function buildTokens(
  booking: any,
  sender?: { name?: string | null; email?: string | null },
  agent?: { name?: string | null; primaryEmail?: string | null } | null,
): Record<string, string> {
  const dash = '—'
  const a = Number(booking?.paxAdults ?? 0)
  const c = Number(booking?.paxChildren ?? 0)
  const i = Number(booking?.paxInfants ?? 0)

  const paxSummary = [
    a ? `${a} Adult${a === 1 ? '' : 's'}` : '',
    c ? `${c} Child${c === 1 ? '' : 'ren'}` : '',
    i ? `${i} Infant${i === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ') || dash

  const arrival   = fmtDate(booking?.arrivalDate)
  const departure = fmtDate(booking?.departureDate)
  const nights = booking?.arrivalDate && booking?.departureDate
    ? Math.max(0, Math.round(
        (new Date(booking.departureDate).getTime() - new Date(booking.arrivalDate).getTime()) / 86_400_000,
      ))
    : 0

  const lead = (booking?.passengers ?? []).find((p: any) => p?.isLead) ?? (booking?.passengers ?? [])[0]

  const hotelList = (booking?.accommodations ?? [])
    .map((h: any) => `${h?.city ? `${h.city} — ` : ''}${h?.hotelName ?? dash}${h?.checkIn ? ` (${fmtDate(h.checkIn)})` : ''}`)
    .join('<br/>') || dash

  const flightList = (booking?.flights ?? [])
    .map((f: any) => [f?.flightNo, [f?.from, f?.to].filter(Boolean).join('→'), fmtDate(f?.date)].filter(Boolean).join(' '))
    .join('<br/>') || dash

  const total = booking?.quotedTotal != null
    ? `${booking?.currency ?? 'USD'} ${Number(booking.quotedTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    : dash

  const raw: Record<string, string> = {
    bookingRef:    booking?.bookingRef ?? dash,
    agent:         booking?.agent ?? dash,
    agentName:     agent?.name ?? booking?.agent ?? dash,
    agentEmail:    agent?.primaryEmail ?? booking?.agentEmail ?? dash,
    fileHandler:   booking?.fileHandler ?? dash,
    leadPassenger: lead?.name ?? dash,
    paxAdults:     String(a),
    paxChildren:   String(c),
    paxInfants:    String(i),
    paxSummary,
    arrivalDate:   arrival || dash,
    departureDate: departure || dash,
    tripDates:     arrival && departure ? (arrival === departure ? arrival : `${arrival} – ${departure}`) : (arrival || departure || dash),
    nights:        String(nights),
    destination:   booking?.tourDestination ?? dash,
    country:       booking?.operationCountry ?? dash,
    status:        booking?.status ?? dash,
    quotedTotal:   total,
    currency:      booking?.currency ?? 'USD',
    senderName:    sender?.name ?? 'Apple Holidays',
    senderEmail:   sender?.email ?? '',
    today:         fmtDate(new Date()),
  }

  // Everything above is plain text and must not be able to inject markup. The
  // two list tokens are built here from our own data and carry deliberate <br/>,
  // so they are escaped per-field before being joined instead.
  const tokens: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) tokens[k] = escapeHtml(v)
  tokens.hotelList  = hotelList  === dash ? dash : hotelList.split('<br/>').map(escapeHtml).join('<br/>')
  tokens.flightList = flightList === dash ? dash : flightList.split('<br/>').map(escapeHtml).join('<br/>')
  return tokens
}

/**
 * Substitutes `{{token}}` (whitespace-tolerant) from the map. Unknown tokens are
 * returned untouched so they show up in the preview.
 */
export function renderTemplate(source: string, tokens: Record<string, string>): string {
  if (!source) return ''
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : whole,
  )
}

/** Which `{{tokens}}` a template actually uses, and which of those are unknown. */
export function inspectTokens(source: string): { used: string[]; unknown: string[] } {
  const used = Array.from(new Set(
    Array.from((source ?? '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g), m => m[1]),
  ))
  return { used, unknown: used.filter(t => !TOKEN_NAMES.includes(t)) }
}
