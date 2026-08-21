/**
 * Sending a driver the settlement paperwork over WhatsApp.
 *
 * The four sheets travel with the driver: he holds the name board up in the
 * arrivals hall, and he brings the three settlement forms back signed. Getting
 * them to him has meant printing at the desk and handing them over in person,
 * which does not work for a driver who starts from home at 4am.
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
import { packForPrint } from '@/lib/sl-settlement-docs-server'
import {
  DOC_KINDS, DOC_LABEL, docDate,
  type SettlementDocKind, type SettlementDocPack,
} from '@/lib/sl-settlement-docs'

// ── Template ─────────────────────────────────────────────────────────────────

export const TEMPLATE_SETTLEMENT_DOCS =
  process.env.WHATSAPP_DRIVER_DOCS_TEMPLATE?.trim() || 'apple_holidays_driver_settlement_docs'

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

// ── Sending ──────────────────────────────────────────────────────────────────

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

  // Archive copy — useful when a driver says he never got it. Never a delivery
  // dependency: a failed archive must not stop the send.
  await putUpload(`settlement-docs/${pdf.filename}`, pdf.buffer, 'application/pdf').catch(err => {
    console.warn('[SettlementDocs] archive copy failed:', err instanceof Error ? err.message : err)
  })

  // 3. Upload once; the id serves both delivery paths.
  let mediaId: string
  try {
    mediaId = await uploadMetaMedia(pdf.buffer, pdf.filename)
  } catch (err) {
    return { ok: false, phone: phone.msisdn, reason: `WhatsApp media upload failed: ${err instanceof Error ? err.message : err}` }
  }

  const params  = settlementDocsParams(pack, kinds)
  const preview = renderBody(SETTLEMENT_DOCS_BODY, params)

  try {
    const open = await isWithin24hWindow(phone.msisdn).catch(() => false)

    let result: unknown
    let channel: 'template' | 'freeform'

    if (open) {
      const sent = await sendViaMetaApi({
        to: phone.msisdn,
        message: preview,
        media: { buffer: pdf.buffer, filename: pdf.filename, kind: 'document', caption: pdf.filename },
      })
      if (!sent) return { ok: false, phone: phone.msisdn, reason: 'WhatsApp is not configured on this server.' }
      result = sent.media ?? sent.text
      channel = 'freeform'
    } else {
      const sent = await sendViaMetaTemplate({
        to:           phone.msisdn,
        templateName: TEMPLATE_SETTLEMENT_DOCS,
        lang:         SETTLEMENT_DOCS_TEMPLATE_LANG,
        bodyParams:   params,
        headerDocument: { id: mediaId, filename: pdf.filename },
      })
      if (!sent) return { ok: false, phone: phone.msisdn, reason: 'WhatsApp is not configured on this server.' }
      result = sent.template
      channel = 'template'
    }

    await prisma.whatsAppMessage.create({
      data: {
        bookingRef,
        phone:       phone.msisdn,
        direction:   'outbound',
        body:        preview,
        waMessageId: (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
        status:      'sent',
        senderName:  `${SETTLEMENT_TAG} ${pack.header.driverName || 'Driver'}${opts.sentBy ? ` · ${opts.sentBy}` : ''}`,
      },
    }).catch(err => {
      // The driver has the documents; failing the call now would invite a resend.
      console.warn('[SettlementDocs] message log failed:', err instanceof Error ? err.message : err)
    })

    return {
      ok: true,
      phone: phone.msisdn,
      shape: phone.shape,
      channel,
      preview,
      filename: pdf.filename,
    }
  } catch (err) {
    return {
      ok: false,
      phone: phone.msisdn,
      reason: err instanceof Error ? err.message : 'The documents could not be sent.',
    }
  }
}
