/**
 * Sending a driver the settlement paperwork over WhatsApp.
 *
 * The whole pack travels with the driver: he holds the name board up in the
 * arrivals hall, hands the guest the QR card and the feedback sheet at the end
 * of the tour, and brings the three settlement forms back signed. Getting them
 * to him has meant printing at the desk and handing them over in person, which
 * does not work for a driver who starts from home at 4am.
 *
 * ---- Why a template ----
 *
 * Delivery goes through an APPROVED Meta TEMPLATE with the PDF in its DOCUMENT
 * header. A driver who has not messaged the ops number in the last 24 hours is
 * outside WhatsApp's customer-service window, where free-form text and media are
 * accepted by our code and then silently dropped by Meta — and drivers never
 * message us, so that is the normal case, not the edge case. Inside the window
 * the richer free-form message is used instead.
 *
 * Register the template once with POST /api/whatsapp/templates/bootstrap-driver.
 *
 * ---- What the driver is told ----
 *
 * The message names the tour, the dates, the guest and the vehicle, and says
 * what is attached. It carries no money: the agreed rate is between the desk and
 * the accounts system. The figures the driver *is* entitled to see — the package
 * cost he signs for, his advances — are on the settlement sheets themselves,
 * which is where they have always been.
 *
 * ---- Did it arrive? ----
 *
 * A 200 from Meta is not a delivery. The number may never have been on
 * WhatsApp; the template may be unapproved; the window may have shut between
 * the check and the send. Meta reports the truth minutes later as a delivery
 * receipt against the message id, so every send writes a `DriverDocSend` row
 * and the webhook moves it through sent → delivered → read, or to failed with
 * Meta's own reason. That row is what the Drive Log shows the desk, and it is
 * why "I sent it" and "he has it" are finally two different statements here.
 *
 * ---- The standing copy ----
 *
 * Every document a driver is sent is shadowed to one configured number — see
 * `sl-driver-doc-copy.ts` for why, and for the notice that keeps a copy from
 * reading as a document addressed to its reader.
 *
 * ---- The PDF ----
 *
 * Rendered with PDFKit (`sl-settlement-docs-pdfkit.ts`), not Chromium: nobody is
 * standing at a screen when this runs, so there is no print dialog to fall back
 * on, and the Sri Lankan host cannot launch a browser at all.
 */
import { prisma } from '@/lib/prisma'
import {
  isWithin24hWindow, sendViaMetaApi, sendViaMetaTemplate, uploadMetaMedia,
} from '@/lib/whatsapp'
import { putUpload } from '@/lib/storage'
import { normaliseSriLankanPhone, type NormalisedPhone } from '@/lib/sl-phone'
import { generateSettlementDocsPdf } from '@/lib/sl-settlement-docs-pdfkit'
import { generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { packForPrint } from '@/lib/sl-settlement-docs-server'
import { copyNotice, readDriverDocCopy, type DriverDocCopyConfig } from '@/lib/sl-driver-doc-copy'
import {
  DOC_KINDS, DOC_LABEL, docDate,
  type SettlementDocKind, type SettlementDocPack,
} from '@/lib/sl-settlement-docs'

// ── Template ─────────────────────────────────────────────────────────────────

export const TEMPLATE_SETTLEMENT_DOCS =
  process.env.WHATSAPP_DRIVER_DOCS_TEMPLATE?.trim() || 'aahaas_driver_settlement_doc'

export const SETTLEMENT_DOCS_TEMPLATE_LANG =
  process.env.WHATSAPP_DRIVER_TEMPLATE_LANG?.trim() || 'en'

/** The exact approved body — kept here so the log shows staff what the driver sees. */
export const SETTLEMENT_DOCS_BODY =
  '*AppleHolidays - Tour Documents*\n\n' +
  'Hi {{1}}, here are the documents for booking {{2}}.\n\n' +
  'Tour dates: {{3}}\n' +
  'Guest: {{4}}\n' +
  'Vehicle: {{5}}\n' +
  'Attached: {{6}}\n\n' +
  'Please print the name board for the arrivals hall and bring the signed settlement sheets back to the office after the tour. Reply CONFIRM once you have received this.'

/** The message log tag. Everything driver-facing starts `[DRIVER`. */
export const SETTLEMENT_TAG = '[DRIVER-DOCS]'

/** Fill {{1}}…{{n}} locally, for the log and the on-screen preview. */
export function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

/**
 * Meta rejects a parameter containing a newline, a tab or four consecutive
 * spaces, and caps the rendered body at 1024 characters. Every value is
 * flattened to one tidy line.
 */
function param(value: string | null | undefined, fallback = '-'): string {
  const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean
}

/** "23-08-2026 to 30-08-2026", or the one date there is. */
function dateSpan(pack: SettlementDocPack): string {
  const from = docDate(pack.header.arrivalDate)
  const to   = docDate(pack.header.departureDate)
  if (from && to) return `${from} to ${to}`
  return from || to || '-'
}

/** The six body parameters, in order. */
export function settlementDocsParams(pack: SettlementDocPack, kinds: SettlementDocKind[]): string[] {
  const guest = [pack.nameBoard.guestName, pack.header.pax ? `${pack.header.pax} pax` : '']
    .filter(Boolean).join(' - ')
  return [
    param(pack.header.driverName, 'Driver'),
    param(pack.header.tourNo || pack.bookingRef),
    param(dateSpan(pack)),
    param(guest),
    param([pack.header.vehicleType, pack.header.vehiclePlate].filter(Boolean).join(' - '), 'TBC'),
    param(kinds.map(k => DOC_LABEL[k]).join(', ')),
  ]
}

/**
 * Turn a Meta failure into something the desk can act on.
 *
 * Error 132001 ("template name does not exist in the translation") is the one
 * failure an operator sees that is not about this booking at all: the template
 * was never registered on the WhatsApp account, or is still awaiting Meta's
 * review, so every send outside the 24h window fails identically. The raw Meta
 * JSON says none of that, so it is spelled out here.
 */
function explainSendError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (!raw) return fallback
  if (/132001|template name does not exist|does not exist in .*(translation|locale)/i.test(raw)) {
    return (
      `WhatsApp template "${TEMPLATE_SETTLEMENT_DOCS}" (${SETTLEMENT_DOCS_TEMPLATE_LANG}) is not approved on this ` +
      'WhatsApp account yet — register it via POST /api/whatsapp/templates/bootstrap-driver and wait for Meta to ' +
      'approve it, then retry. Until then the documents only reach a driver who has messaged us in the last 24 hours. ' +
      `(${raw})`
    )
  }
  return raw
}

// ── The booking details sheet ────────────────────────────────────────────────

/**
 * The booking, as the PDF the office already sends everywhere else.
 *
 * The desk asks for it alongside the settlement pack often enough that it is a
 * tick box on the send dialog: the driver gets the paperwork he signs *and* the
 * file he is driving — guests, flights, hotels, the day-by-day agenda and the
 * vouchers. It is the same `generateFullDetailsPdf` the operations email and
 * the ops-AI download use, so there is one booking sheet in the company and not
 * a second one that drifts.
 *
 * It carries no money. That is a property of the document itself — it prints no
 * rate, no cost and no payment — which is exactly why it is the one that may go
 * to a driver.
 */
async function bookingDetailsPdf(bookingRef: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights:           { orderBy: { date: 'asc' } },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      itineraryItems:    { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
      tickets: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!booking) return null

  const buffer = await generateFullDetailsPdf(booking)
  const stem = (booking.isNumber || booking.bookingRef).replace(/[^A-Za-z0-9_-]+/g, '-')
  return { buffer, filename: `${stem}-booking-details.pdf` }
}

// ── One delivery ─────────────────────────────────────────────────────────────

/** What a document is: the pack the driver signs, or the file he is driving. */
export type DocSendKind = 'settlement' | 'booking'

/** Who it went to: the driver himself, or the standing copy number behind him. */
export type DocSendAudience = 'driver' | 'copy'

/** One WhatsApp message carrying one PDF, and what became of it. */
export interface DeliveryResult {
  ok: boolean
  /** The `DriverDocSend` row — what the Drive Log polls for a delivery receipt. */
  sendId: string | null
  kind: DocSendKind
  audience: DocSendAudience
  phone: string
  channel?: 'template' | 'freeform'
  filename?: string
  /** The message body as the recipient receives it. */
  preview?: string
  reason?: string
}

/**
 * Send one PDF to one number and write down that it happened.
 *
 * Every driver-facing document in this file goes through here — the settlement
 * pack, the booking sheet, and the copies of both — so there is exactly one
 * place that decides template-versus-free-form, one place that writes the chat
 * log, and one place that opens a delivery receipt. A route that skipped it
 * would produce a send nobody could later prove.
 *
 * `mediaId` is Meta's handle for an already-uploaded document. It is passed in
 * rather than uploaded here because the same PDF goes to two numbers and Meta
 * happily reuses one handle — uploading twice would double the latency of every
 * send for nothing.
 *
 * Never throws. A failure is a `DriverDocSend` row with `status: 'failed'` and
 * Meta's reason on it: an undelivered document that left no trace is the exact
 * problem this file exists to end.
 */
async function deliver(opts: {
  bookingRef: string
  kind: DocSendKind
  audience: DocSendAudience
  pdf: { buffer: Buffer; filename: string }
  mediaId: string
  mediaUrl: string | null
  /** The six template parameters, already flattened for Meta. */
  params: string[]
  msisdn: string
  windowOpen: boolean
  docs: SettlementDocKind[]
  driverId: string | null
  driverName: string | null
  copyOfId?: string | null
  copyLabel?: string | null
  sentById: string | null
  sentBy: string | null
}): Promise<DeliveryResult> {
  const preview = renderBody(SETTLEMENT_DOCS_BODY, opts.params)
  const base = {
    bookingRef: opts.bookingRef,
    kind:       opts.kind,
    audience:   opts.audience,
    driverId:   opts.driverId,
    driverName: opts.driverName,
    phone:      opts.msisdn,
    docs:       opts.docs.join(',') || null,
    filename:   opts.pdf.filename,
    mediaUrl:   opts.mediaUrl,
    body:       preview,
    copyOfId:   opts.copyOfId ?? null,
    copyLabel:  opts.copyLabel ?? null,
    sentById:   opts.sentById,
    sentByName: opts.sentBy,
  }

  try {
    let result: unknown
    let channel: 'template' | 'freeform'

    if (opts.windowOpen) {
      const sent = await sendViaMetaApi({
        to: opts.msisdn,
        message: preview,
        media: { buffer: opts.pdf.buffer, filename: opts.pdf.filename, kind: 'document', caption: opts.pdf.filename },
      })
      if (!sent) throw new Error('WhatsApp is not configured on this server.')
      result  = sent.media ?? sent.text
      channel = 'freeform'
    } else {
      const sent = await sendViaMetaTemplate({
        to:             opts.msisdn,
        templateName:   TEMPLATE_SETTLEMENT_DOCS,
        lang:           SETTLEMENT_DOCS_TEMPLATE_LANG,
        bodyParams:     opts.params,
        headerDocument: { id: opts.mediaId, filename: opts.pdf.filename },
      })
      if (!sent) throw new Error('WhatsApp is not configured on this server.')
      result  = sent.template
      channel = 'template'
    }

    const waMessageId =
      (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null

    // The chat log, so the document appears in the thread the desk chats in.
    await prisma.whatsAppMessage.create({
      data: {
        bookingRef:  opts.bookingRef,
        phone:       opts.msisdn,
        direction:   'outbound',
        body:        preview,
        waMessageId,
        status:      'sent',
        mediaUrl:    opts.mediaUrl,
        mediaType:   opts.mediaUrl ? 'document' : null,
        mediaMimeType: opts.mediaUrl ? 'application/pdf' : null,
        senderName:  `${SETTLEMENT_TAG}${opts.audience === 'copy' ? ' Copy' : ''} ${
          opts.driverName || 'Driver'}${opts.sentBy ? ` · ${opts.sentBy}` : ''}`,
      },
    }).catch(err => {
      // The document has arrived; failing the call now would invite a resend.
      console.warn('[SettlementDocs] message log failed:', err instanceof Error ? err.message : err)
    })

    const row = await openReceipt({ ...base, channel, waMessageId, status: 'sent', sentAt: new Date() })
    return { ok: true, sendId: row, kind: opts.kind, audience: opts.audience, phone: opts.msisdn, channel, preview, filename: opts.pdf.filename }
  } catch (err) {
    const reason = explainSendError(err, 'The document could not be sent.')
    const row = await openReceipt({ ...base, status: 'failed', failureReason: reason, failedAt: new Date() })
    return { ok: false, sendId: row, kind: opts.kind, audience: opts.audience, phone: opts.msisdn, reason }
  }
}

/**
 * Write the receipt row, and never let its failure become the send's failure.
 *
 * The table is created by `prisma/sql/2026-08-24-sl-driver-doc-sends.sql`. On a
 * host where that has not been applied yet the document still reaches the
 * driver and the chat log still records it — only the delivery tracking is
 * missing, which is a degraded screen rather than a lost document.
 */
async function openReceipt(
  data: Parameters<typeof prisma.driverDocSend.create>[0]['data'],
): Promise<string | null> {
  try {
    const row = await prisma.driverDocSend.create({ data, select: { id: true } })
    return row.id
  } catch (err) {
    console.warn('[SettlementDocs] delivery receipt failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Archive the PDF. Never a delivery dependency — a failed archive must not stop a send. */
async function archive(filename: string, buffer: Buffer): Promise<string | null> {
  try {
    return await putUpload(`settlement-docs/${filename}`, buffer, 'application/pdf')
  } catch (err) {
    console.warn('[SettlementDocs] archive copy failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** What happened to the second attachment, when one was asked for. */
export interface BookingSheetResult {
  ok: boolean
  filename?: string
  reason?: string
  sendId?: string | null
}

export interface SettlementSendResult {
  ok: boolean
  /** Why nothing was sent. */
  reason?: string
  /** The number the documents actually went to, as WhatsApp took it. */
  phone?: string
  /** How the number was read — shown back to the desk so a swap is visible. */
  shape?: NormalisedPhone['shape']
  /** Template (outside the 24h window) or free-form (inside it). */
  channel?: 'template' | 'freeform'
  /** The message body as the driver receives it. */
  preview?: string
  filename?: string
  /** The receipt to poll for a delivery status. */
  sendId?: string | null
  /**
   * What happened to the booking sheet, when it was ticked.
   *
   * Reported separately and never fatal: the settlement documents are the
   * message that had to arrive, and a driver who has them plus a failed second
   * attachment is in a far better place than one who has neither because the
   * booking sheet would not render.
   */
  bookingSheet?: BookingSheetResult
  /**
   * The shadow sends to the standing copy number, when one is configured.
   *
   * Also never fatal, and for the same reason in reverse: a copy that did not
   * go is a filing problem, and refusing the driver his paperwork over it would
   * be the more expensive mistake.
   */
  copies?: DeliveryResult[]
  /** The configured copy contact, so the desk sees where copies went — or why none did. */
  copyContact?: {
    enabled: boolean
    active: boolean
    label: string
    pretty: string
    msisdn: string
    reason: string | null
  }
}

/**
 * Send one booking's settlement documents to its driver.
 *
 * `pack` is the version on the desk's screen, unsaved edits and all — the same
 * document they were looking at is the one that goes out. Omit it and the saved
 * pack (or the derived draft) is used, which is what the Drive Log row does.
 *
 * Never throws: every failure comes back as `ok: false` with a reason fit to
 * show an operator.
 */
export async function sendSettlementDocs(
  bookingRef: string,
  opts: {
    pack?: SettlementDocPack
    kinds?: SettlementDocKind[]
    /** What the desk typed in the send box, when they corrected the number. */
    phoneOverride?: string | null
    /** Send the booking sheet — guests, flights, hotels, agenda — as a second message. */
    includeBooking?: boolean
    /** The allocated driver, when the caller knows it — for the delivery history. */
    driverId?: string | null
    /**
     * Suppress the standing copy for this send only. There is no tick box for
     * it on the send dialog: a desk that can turn the audit copy off per send
     * is a desk with no audit copy. It exists for the automated paths that
     * already copy elsewhere.
     */
    skipCopy?: boolean
    sentById?: string | null
    sentBy?: string | null
  } = {},
): Promise<SettlementSendResult> {
  const pack = opts.pack ?? (await packForPrint(bookingRef))
  if (!pack) return { ok: false, reason: `Booking ${bookingRef} was not found.` }

  const kinds = opts.kinds?.length ? opts.kinds : [...DOC_KINDS]

  // 1. The number. A wrong one is not rejected by Meta — it is delivered to
  //    nobody — so it is normalised here and reported back exactly as sent.
  const phone = normaliseSriLankanPhone(opts.phoneOverride || pack.header.driverPhone)
  if (!phone.ok) {
    return { ok: false, reason: phone.reason ?? 'The driver has no usable WhatsApp number.' }
  }

  // 2. The document.
  let pdf: { buffer: Buffer; filename: string }
  try {
    pdf = await generateSettlementDocsPdf(pack, kinds)
  } catch (err) {
    return { ok: false, phone: phone.msisdn, reason: `The documents could not be rendered: ${err instanceof Error ? err.message : err}` }
  }

  const mediaUrl = await archive(pdf.filename, pdf.buffer)

  // 3. Upload once; the handle serves both delivery paths and both recipients.
  let mediaId: string
  try {
    mediaId = await uploadMetaMedia(pdf.buffer, pdf.filename)
  } catch (err) {
    return { ok: false, phone: phone.msisdn, reason: `WhatsApp media upload failed: ${err instanceof Error ? err.message : err}` }
  }

  const driverName = pack.header.driverName || null
  const driverId   = opts.driverId ?? null
  const sentBy     = opts.sentBy ?? null
  const sentById   = opts.sentById ?? null

  // One window reading for the whole send, so two attachments a second apart
  // cannot take different routes.
  const open = await isWithin24hWindow(phone.msisdn).catch(() => false)

  const params = settlementDocsParams(pack, kinds)

  const primary = await deliver({
    bookingRef, kind: 'settlement', audience: 'driver',
    pdf, mediaId, mediaUrl, params,
    msisdn: phone.msisdn, windowOpen: open, docs: kinds,
    driverId, driverName, sentById, sentBy,
  })

  if (!primary.ok) {
    return { ok: false, phone: phone.msisdn, shape: phone.shape, reason: primary.reason, sendId: primary.sendId }
  }

  const copyContact = await readDriverDocCopy()
  const copies: DeliveryResult[] = []

  // The copy of the settlement pack.
  if (!opts.skipCopy) {
    const copy = await sendCopy({
      contact: copyContact, bookingRef, kind: 'settlement', pdf, mediaId, mediaUrl,
      params, driverName, driverId, driverMsisdn: phone.msisdn, docs: kinds, sentById, sentBy,
      copyOfId: primary.sendId,
    })
    if (copy) copies.push(copy)
  }

  // The booking sheet, and its own copy.
  let bookingSheet: BookingSheetResult | undefined
  if (opts.includeBooking) {
    const sheet = await sendBookingSheet({
      bookingRef, pack, msisdn: phone.msisdn, windowOpen: open,
      driverId, driverName, sentById, sentBy,
      copyContact: opts.skipCopy ? null : copyContact,
    })
    bookingSheet = sheet.result
    if (sheet.copy) copies.push(sheet.copy)
  }

  return {
    ok: true,
    phone:    phone.msisdn,
    shape:    phone.shape,
    channel:  primary.channel,
    preview:  primary.preview,
    filename: primary.filename,
    sendId:   primary.sendId,
    bookingSheet,
    copies,
    copyContact: {
      enabled: copyContact.enabled,
      active:  copyContact.active,
      label:   copyContact.label,
      pretty:  copyContact.pretty,
      msisdn:  copyContact.msisdn,
      reason:  copyContact.reason,
    },
  }
}

/**
 * The shadow send.
 *
 * The copy is the same PDF under a message that opens by naming the driver and
 * the number the original went to, because a copy nobody can attribute is worse
 * than no copy at all. The notice replaces the greeting parameter rather than
 * being written above it: outside the 24-hour window the body is Meta's
 * approved template and there is nowhere else to put it.
 *
 * Returns `null` when no copy is configured, which is not a failure.
 */
async function sendCopy(opts: {
  contact: DriverDocCopyConfig | null
  bookingRef: string
  kind: DocSendKind
  pdf: { buffer: Buffer; filename: string }
  mediaId: string
  mediaUrl: string | null
  params: string[]
  driverName: string | null
  driverId: string | null
  driverMsisdn: string
  docs: SettlementDocKind[]
  sentById: string | null
  sentBy: string | null
  copyOfId: string | null
}): Promise<DeliveryResult | null> {
  const contact = opts.contact
  if (!contact?.active) return null

  // Never copy a document back to the driver it was addressed to.
  if (contact.msisdn === opts.driverMsisdn) return null

  const params = [...opts.params]
  params[0] = param(copyNotice(opts.driverName, opts.driverMsisdn, opts.bookingRef))

  // The copy number is an office line that has almost certainly not messaged us
  // in the last 24 hours either, so it gets its own window reading rather than
  // inheriting the driver's.
  const open = await isWithin24hWindow(contact.msisdn).catch(() => false)

  return deliver({
    bookingRef: opts.bookingRef,
    kind:       opts.kind,
    audience:   'copy',
    pdf:        opts.pdf,
    mediaId:    opts.mediaId,
    mediaUrl:   opts.mediaUrl,
    params,
    msisdn:     contact.msisdn,
    windowOpen: open,
    docs:       opts.docs,
    driverId:   opts.driverId,
    driverName: opts.driverName,
    copyOfId:   opts.copyOfId,
    copyLabel:  contact.label || null,
    sentById:   opts.sentById,
    sentBy:     opts.sentBy,
  })
}

/**
 * Send the booking sheet as a second message.
 *
 * A second message rather than a second attachment because WhatsApp carries one
 * document per message: a template's header holds exactly one, and even inside
 * the 24-hour window each document is its own send. `windowOpen` is the reading
 * already taken for the settlement pack, reused so the two attachments cannot
 * take different routes a second apart.
 */
async function sendBookingSheet(opts: {
  bookingRef: string
  pack: SettlementDocPack
  msisdn: string
  windowOpen: boolean
  driverId: string | null
  driverName: string | null
  sentById: string | null
  sentBy: string | null
  copyContact: DriverDocCopyConfig | null
}): Promise<{ result: BookingSheetResult; copy: DeliveryResult | null }> {
  let pdf: { buffer: Buffer; filename: string } | null
  try {
    pdf = await bookingDetailsPdf(opts.bookingRef)
  } catch (err) {
    return {
      result: { ok: false, reason: `The booking sheet could not be rendered: ${err instanceof Error ? err.message : err}` },
      copy: null,
    }
  }
  if (!pdf) {
    return {
      result: { ok: false, reason: `Booking ${opts.bookingRef} was not found, so no booking sheet was sent.` },
      copy: null,
    }
  }

  const mediaUrl = await archive(pdf.filename, pdf.buffer)

  let mediaId: string
  try {
    mediaId = await uploadMetaMedia(pdf.buffer, pdf.filename)
  } catch (err) {
    return {
      result: { ok: false, reason: `WhatsApp media upload failed: ${err instanceof Error ? err.message : err}` },
      copy: null,
    }
  }

  // The approved template says what is attached in its last parameter, so the
  // driver is told this is the booking file and not a second copy of the pack.
  const params = settlementDocsParams(opts.pack, [])
  params[5] = param('Booking details')

  const sent = await deliver({
    bookingRef: opts.bookingRef,
    kind:       'booking',
    audience:   'driver',
    pdf, mediaId, mediaUrl, params,
    msisdn:     opts.msisdn,
    windowOpen: opts.windowOpen,
    docs:       [],
    driverId:   opts.driverId,
    driverName: opts.driverName,
    sentById:   opts.sentById,
    sentBy:     opts.sentBy,
  })

  const copy = sent.ok
    ? await sendCopy({
        contact: opts.copyContact, bookingRef: opts.bookingRef, kind: 'booking',
        pdf, mediaId, mediaUrl, params,
        driverName: opts.driverName, driverId: opts.driverId, driverMsisdn: opts.msisdn,
        docs: [], sentById: opts.sentById, sentBy: opts.sentBy, copyOfId: sent.sendId,
      })
    : null

  return {
    result: sent.ok
      ? { ok: true, filename: sent.filename, sendId: sent.sendId }
      : { ok: false, reason: sent.reason, sendId: sent.sendId },
    copy,
  }
}
