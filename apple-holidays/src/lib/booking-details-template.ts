/**
 * Sending a customer their booking paperwork over WhatsApp — as a TEMPLATE.
 *
 * The booking-details dialog and the movement-chart (agenda) dialog both put a
 * PDF in a customer's hand. Both used to do it as free-form WhatsApp: a text
 * message plus a document. WhatsApp only accepts free-form inside the 24h
 * customer-service window — i.e. when the customer has messaged the ops number
 * in the last day — and a customer who was just quoted a tour has almost never
 * done that. Outside the window Meta takes the request, answers 200, and drops
 * the message; the desk sees "Sent!" and the guest sees nothing. The old
 * workaround was to send a reply-request template and QUEUE the real message
 * until the guest replied, which meant confirmations sat unsent for days.
 *
 * So delivery goes through an APPROVED Meta template with the PDF in its
 * DOCUMENT header — `aahaas_booking_details`. A template delivers cold, so the
 * 24h window stops mattering: press send, the guest gets the document.
 *
 * Register it once with POST /api/whatsapp/templates/bootstrap-booking.
 *
 * ---- What is fixed and what is not ----
 *
 * A template body is fixed at approval time, so the desk cannot rewrite the
 * whole message any more. What it can still say is {{6}} — one line of its own
 * words (a note, a deadline, a "your driver will call you"). Everything else is
 * filled from the booking: guest, reference, dates, party size, and what is
 * attached.
 *
 * ---- PDF only ----
 *
 * Meta accepts only a PDF in a template's document header. The Word twin of the
 * same document can still go out free-form to a guest inside the window, and
 * the callers say so plainly rather than letting Meta reject the send.
 */
import { prisma } from '@/lib/prisma'
import { normalisePhone, sendViaMetaTemplate, uploadMetaMedia } from '@/lib/whatsapp'
import { putUpload } from '@/lib/storage'
import { ensurePdfkitDataFiles, loadPdfDocumentCtor } from '@/lib/pdfkit-boot'

// ── Template ─────────────────────────────────────────────────────────────────

export const TEMPLATE_BOOKING_DETAILS =
  process.env.WHATSAPP_BOOKING_DETAILS_TEMPLATE?.trim() || 'aahaas_booking_details'

export const BOOKING_DETAILS_TEMPLATE_LANG =
  process.env.WHATSAPP_BOOKING_DETAILS_TEMPLATE_LANG?.trim() || 'en'

/** The exact approved body — kept here so the chat log shows what the guest saw. */
export const BOOKING_DETAILS_BODY =
  '*AppleHolidays - Booking Details*\n\n' +
  'Hello {{1}}, please find the attached documents for your booking {{2}}.\n\n' +
  'Travel dates: {{3}}\n' +
  'Passengers: {{4}}\n' +
  'Attached: {{5}}\n\n' +
  '{{6}}\n\n' +
  'Please review the attachment and reply to this message if anything needs to be corrected.'

/** The example values Meta reviews the template against. */
export const BOOKING_DETAILS_EXAMPLES = [
  'Mr. Harre',
  'IS48953',
  '23 Sep 2026 to 27 Sep 2026',
  '2 Adults',
  'Tour Confirmation (PDF)',
  'Your ground operations team in Sri Lanka is looking forward to hosting you.',
]

/** The message log tag. Everything customer-document-facing starts `[BOOKING-DOCS]`. */
export const BOOKING_DOCS_TAG = '[BOOKING-DOCS]'

/** What goes in {{6}} when the desk types nothing. */
export const DEFAULT_NOTE = 'Thank you for booking with AppleHolidays.'

// ── Parameters ───────────────────────────────────────────────────────────────

/**
 * Meta rejects a parameter containing a newline, a tab or four consecutive
 * spaces, and caps the rendered body at 1024 characters. Every value is
 * flattened to one tidy line.
 */
export function param(value: string | null | undefined, fallback = '-'): string {
  const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean
}

/** Fill {{1}}…{{n}} locally, for the chat log and the on-screen preview. */
export function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "23 Sep 2026 to 27 Sep 2026", or the one date there is. */
export function dateSpan(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  const a = fmtDate(from)
  const b = fmtDate(to)
  if (a && b) return a === b ? a : `${a} to ${b}`
  return a || b || '-'
}

/** "2 Adults, 1 Child" — the party as the guest counts it. */
export function paxLabel(adults: number, children: number, infants = 0): string {
  const parts = [
    adults   ? `${adults} Adult${adults === 1 ? '' : 's'}`     : '',
    children ? `${children} Child${children === 1 ? '' : 'ren'}` : '',
    infants  ? `${infants} Infant${infants === 1 ? '' : 's'}`  : '',
  ].filter(Boolean)
  return parts.join(', ') || '-'
}

export interface BookingTemplateFacts {
  /** How the guest is addressed — the lead passenger, normally. */
  guestName:  string
  bookingRef: string
  dates:      string
  pax:        string
}

/**
 * The facts the template needs, read from the booking itself so the guest is
 * never told dates or a party size that disagree with the attached document.
 */
export async function readBookingFacts(bookingRef: string): Promise<BookingTemplateFacts | null> {
  const booking = await prisma.booking.findUnique({
    where:  { bookingRef },
    select: {
      bookingRef: true, isNumber: true,
      arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }], select: { name: true } },
    },
  })
  if (!booking) return null

  return {
    guestName:  booking.passengers[0]?.name ?? 'Guest',
    bookingRef: booking.isNumber || booking.bookingRef,
    dates:      dateSpan(booking.arrivalDate, booking.departureDate),
    pax:        paxLabel(booking.paxAdults, booking.paxChildren, booking.paxInfants),
  }
}

/** The six body parameters, in order. */
export function bookingDetailsParams(
  facts: BookingTemplateFacts,
  attachedLabel: string,
  note?: string | null,
): string[] {
  return [
    param(facts.guestName, 'Guest'),
    param(facts.bookingRef),
    param(facts.dates),
    param(facts.pax),
    param(attachedLabel, 'Booking documents'),
    param(note, DEFAULT_NOTE),
  ]
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Turn a Meta failure into something the desk can act on.
 *
 * Error 132001 ("template name does not exist in the translation") is the one
 * failure an operator sees that is not about this booking at all: the template
 * was never registered on the WhatsApp account, or is still awaiting review, so
 * every send fails identically. The raw Meta JSON says none of that.
 */
export function explainTemplateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (!raw) return 'WhatsApp send failed.'
  if (/132001|template name does not exist|does not exist in .*(translation|locale)/i.test(raw)) {
    return (
      `WhatsApp template "${TEMPLATE_BOOKING_DETAILS}" (${BOOKING_DETAILS_TEMPLATE_LANG}) is not approved on this ` +
      'WhatsApp account yet — register it via POST /api/whatsapp/templates/bootstrap-booking and wait for Meta to ' +
      `approve it, then retry. (${raw})`
    )
  }
  return raw
}

// ── One delivery ─────────────────────────────────────────────────────────────

export interface BookingDocTemplateSend {
  bookingRef: string
  /** Any shape the desk typed; normalised here. */
  to:         string
  document:   { buffer: Buffer; filename: string; mimeType?: string }
  /** What {{5}} says is attached, e.g. "Tour Confirmation (PDF)". */
  attachedLabel: string
  /** {{6}} — the desk's own line. Blank falls back to DEFAULT_NOTE. */
  note?:      string | null
  /** Overrides the facts read from the booking (test sends, agent copies). */
  facts?:     Partial<BookingTemplateFacts>
  senderName: string
  /** Public base URL, so the chat log can link the file that went out. */
  baseUrl?:   string
}

export interface BookingDocTemplateResult {
  /** The message as the guest received it — template body with parameters filled. */
  body:        string
  waMessageId: string | null
  phone:       string
  /** Where the sent file is readable from, when storage accepted it. */
  mediaUrl:    string | null
}

/**
 * Send one booking document to one customer through the approved template.
 *
 * Delivers whether or not the customer's 24h window is open — that is the whole
 * point of the template — so there is no window check and nothing is queued.
 */
export async function sendBookingDocTemplate(
  opts: BookingDocTemplateSend,
): Promise<BookingDocTemplateResult> {
  const phone = normalisePhone(opts.to)
  if (!phone) throw new Error('A valid WhatsApp number is required (country code, no +).')

  const mime = opts.document.mimeType ?? 'application/pdf'
  if (mime !== 'application/pdf') {
    throw new Error(
      'WhatsApp only accepts a PDF in a template attachment. Switch the format to PDF to send this ' +
      'document to the customer.',
    )
  }
  if (!opts.document.buffer.length) throw new Error('The generated PDF is empty.')

  const dbFacts = await readBookingFacts(opts.bookingRef)
  const facts: BookingTemplateFacts = {
    guestName:  opts.facts?.guestName  ?? dbFacts?.guestName  ?? 'Guest',
    bookingRef: opts.facts?.bookingRef ?? dbFacts?.bookingRef ?? opts.bookingRef,
    dates:      opts.facts?.dates      ?? dbFacts?.dates      ?? '-',
    pax:        opts.facts?.pax        ?? dbFacts?.pax        ?? '-',
  }

  const params  = bookingDetailsParams(facts, opts.attachedLabel, opts.note)
  const preview = renderBody(BOOKING_DETAILS_BODY, params)

  // Keep a readable copy alongside the chat log. Best-effort: a storage failure
  // must not stop the guest getting their document.
  let mediaUrl: string | null = null
  if (opts.baseUrl) {
    try {
      const stored = await putUpload(`whatsapp/${opts.document.filename}`, opts.document.buffer, mime)
      mediaUrl = stored.startsWith('http') ? stored : `${opts.baseUrl.replace(/\/+$/, '')}${stored}`
    } catch (err) {
      console.error('[booking-docs] storing the sent PDF failed:', err instanceof Error ? err.message : err)
    }
  }

  let waMessageId: string | null = null
  try {
    const mediaId = await uploadMetaMedia(opts.document.buffer, opts.document.filename)
    const sent = await sendViaMetaTemplate({
      to:             phone,
      templateName:   TEMPLATE_BOOKING_DETAILS,
      lang:           BOOKING_DETAILS_TEMPLATE_LANG,
      bodyParams:     params,
      headerDocument: { id: mediaId, filename: opts.document.filename },
    })
    if (!sent) {
      throw new Error(
        'WhatsApp is not configured on this server — set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
      )
    }
    waMessageId =
      (sent.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null
  } catch (err) {
    throw new Error(explainTemplateError(err))
  }

  // The chat log, so the document appears in the thread the desk chats in.
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef:    opts.bookingRef,
      phone,
      direction:     'outbound',
      body:          preview,
      waMessageId,
      status:        'sent',
      mediaUrl,
      mediaType:     mediaUrl ? 'document' : null,
      mediaMimeType: mediaUrl ? mime : null,
      senderName:    `${BOOKING_DOCS_TAG} ${opts.senderName}`.trim(),
    },
  })

  return { body: preview, waMessageId, phone, mediaUrl }
}

// ── Registration sample ──────────────────────────────────────────────────────

/**
 * The sample PDF Meta reviews the DOCUMENT header against. It is never sent to
 * anyone — it exists so the template can be registered from the API at all.
 */
export async function sampleBookingDetailsPdf(): Promise<Buffer> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new (PDFDocument as unknown as new (o: unknown) => {
      on: (e: string, cb: (c?: Buffer) => void) => void
      fillColor: (c: string) => { font: (f: string) => { fontSize: (n: number) => { text: (t: string, x: number, y: number, o?: unknown) => void } } }
      end: () => void
    })({ size: 'A4', margin: 48 })

    doc.on('data', (c?: Buffer) => { if (c) chunks.push(c) })
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', (e?: unknown) => reject(e))

    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(18)
      .text('Booking Details - sample', 48, 90, { width: 499, align: 'center' })
    doc.fillColor('#64748b').font('Helvetica').fontSize(11)
      .text(
        'Sample document. The live attachment carries one booking: the guests, the flights, the hotels, ' +
        'the day-by-day itinerary and, where relevant, the vouchers and the movement chart.',
        48, 128, { width: 499, align: 'center' },
      )
    doc.end()
  })
}
