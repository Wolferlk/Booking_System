/**
 * POST /api/bookings/[ref]/agenda/send
 *
 * Generates the movement-chart agenda as a PDF or a Word (.docx) file and:
 *   mode = 'download' → returns the file as binary
 *   mode = 'whatsapp' → sends via the approved `aahaas_booking_details` WhatsApp
 *                       template, so it delivers outside the 24h window
 *   mode = 'email'    → sends via Microsoft Graph email
 *
 * Body:
 *   { mode, format, showDrivers, to, message, subject }
 *
 * `format` defaults to 'pdf'; 'word' attaches the .docx built by
 * `lib/generate-agenda-docx.ts` instead.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { generateAgendaPdf } from '@/lib/generate-agenda-pdf'
import { generateAgendaDocx } from '@/lib/generate-agenda-docx'
import { AGENDA_INCLUDE, buildAgendaEmailHtml, buildAgendaFileName } from '@/lib/agenda-mailer'
import { sendMailViaGraph } from '@/lib/send-mail'
import { sendBookingDocTemplate } from '@/lib/booking-details-template'
import { isWithin24hWindow, sendViaMetaApi } from '@/lib/whatsapp'
import { putUpload } from '@/lib/storage'
import { randomBytes } from 'crypto'

/**
 * The template's {{6}} line when a Word file rides along as a link: the desk's
 * own note first, then the link. Meta caps a parameter (and `param()` in
 * booking-details-template cuts at 300 chars), so the NOTE is shortened — never
 * the link, which would stop working.
 */
function wordLinkNote(note: string | undefined, url: string): string {
  const suffix = `Editable Word copy: ${url}`
  const room = 295 - suffix.length
  const clean = String(note ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!clean || room < 20) return suffix
  const head = clean.length > room ? `${clean.slice(0, room - 3).trimEnd()}...` : clean
  return `${head} ${suffix}`
}

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  try {
    return await handleSend(req, params)
  } catch (err) {
    // Guarantee a JSON body on ANY unhandled failure (PDF/puppeteer, storage, Graph, …).
    // Without this, an unhandled throw returns an empty 500 body and the client dies with
    // "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[agenda/send] failed:', err)
    return buildApiError(`Send failed: ${msg}`, 500)
  }
}

async function handleSend(
  req: NextRequest,
  params: { ref: string },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json() as {
    mode:        'download' | 'whatsapp' | 'email'
    format?:     'pdf' | 'word'
    showDrivers?: boolean
    to?:         string
    message?:    string
    subject?:    string
  }

  const { mode, format = 'pdf', showDrivers = true, to, message, subject } = body
  const isWord = format === 'word'

  // ── Load agenda data ──────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: AGENDA_INCLUDE,
  })

  if (!booking) return buildApiError('Booking not found', 404)

  const agendaItems = (booking.tourAgenda as { items: unknown[] } | null)?.items ?? []

  // ── Generate the document (full-detail layout matching the manual downloads) ─
  const senderName  = session.user.name ?? session.user.email ?? 'Staff'
  const filename    = buildAgendaFileName(booking as never, isWord ? 'docx' : 'pdf')
  const contentType = isWord
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf'

  let docBuffer: Buffer
  try {
    docBuffer = isWord
      ? await generateAgendaDocx(params.ref, showDrivers)
      : await generateAgendaPdf(
          params.ref,
          booking as never,
          agendaItems as never,
          showDrivers,
        )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`${isWord ? 'Word' : 'PDF'} generation failed: ${msg}`, 500)
  }

  // ── Download ──────────────────────────────────────────────────────────────
  if (mode === 'download') {
    return new NextResponse(new Uint8Array(docBuffer), {
      status: 200,
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(docBuffer.length),
      },
    })
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  // Through the approved `aahaas_booking_details` template, with the movement
  // chart in its DOCUMENT header, so it delivers whether or not the customer
  // has messaged us in the last 24 hours. Meta accepts only a PDF in a template
  // header, so Word goes as the file inside the 24h window, and outside it as
  // the PDF template plus a download link to the Word file.
  if (mode === 'whatsapp') {
    // Normalise to digits only — "+91 7715805191" → "917715805191".
    const normPhone = (to ?? '').replace(/\D/g, '')
    if (!normPhone) return buildApiError('WhatsApp number required', 400)
    // An international number never starts with 0. "0164…" is a local number
    // with the country code missing — Meta cannot route it, and the 24h-window
    // lookup never matches it (inbound rows are stored as "60164…").
    if (normPhone.startsWith('0')) {
      return buildApiError(
        `The WhatsApp number ${normPhone} starts with 0 — it needs the country code instead of the 0 ` +
        '(e.g. 60… Malaysia, 65… Singapore, 94… Sri Lanka, 84… Vietnam, 91… India).',
        400,
      )
    }
    if (normPhone.length < 8) return buildApiError(`The WhatsApp number ${normPhone} is too short.`, 400)

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      req.nextUrl.origin
    ).replace(/\/+$/, '')

    if (!isWord) {
      try {
        const sent = await sendBookingDocTemplate({
          bookingRef:    params.ref,
          to:            normPhone,
          document:      { buffer: docBuffer, filename, mimeType: contentType },
          attachedLabel: `Movement Chart${showDrivers ? ' with driver allocation' : ''} (PDF)`,
          note:          message,
          senderName,
          baseUrl,
        })
        return buildApiSuccess({ sent: true, via: 'template', waMessageId: sent.waMessageId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // 422, not 5xx — the proxy eats a 5xx body, and this message names the fix.
        return buildApiError(`WhatsApp send failed: ${msg}`, 422)
      }
    }

    // Word: no template can carry a .docx. Inside the guest's 24h window it goes
    // free-form as the file itself (below). Outside it — the usual case, a guest
    // who was just quoted has rarely messaged us — a free-form send is refused
    // by Meta, so the chart goes out on the approved template as the PDF
    // (delivers cold) with a private download link to the Word file in the
    // message. The guest gets both; the desk no longer has to switch to PDF.
    const waMessage = message ?? `📋 Movement Chart — ${params.ref}\n\nPlease find the attached agenda Word document for your reference.`
    if (!(await isWithin24hWindow(normPhone))) {
      const closedError = buildApiError(
        'WhatsApp only accepts a PDF in a template attachment, and this number has not messaged us in the last ' +
        '24 hours, so a Word file cannot be delivered. Switch the format to PDF to send it now.',
        409,
      )

      // The Word copy, at an unguessable path (/api/uploads is public, and the
      // chart carries guest and driver details). No link → no fallback.
      let wordUrl: string | null = null
      try {
        const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_')
        const stored = await putUpload(`whatsapp/${randomBytes(16).toString('hex')}/${safeName}`, docBuffer, contentType)
        wordUrl = stored.startsWith('http') ? stored : `${baseUrl}${stored}`
      } catch (err) {
        console.error('[agenda/send] storing the Word copy failed:', err instanceof Error ? err.message : err)
      }
      if (!wordUrl) return closedError

      let pdfBuffer: Buffer
      try {
        pdfBuffer = await generateAgendaPdf(params.ref, booking as never, agendaItems as never, showDrivers)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return buildApiError(`PDF generation failed (needed to carry the Word link): ${msg}`, 500)
      }

      try {
        const sent = await sendBookingDocTemplate({
          bookingRef:    params.ref,
          to:            normPhone,
          document:      { buffer: pdfBuffer, filename: buildAgendaFileName(booking as never, 'pdf'), mimeType: 'application/pdf' },
          attachedLabel: `Movement Chart${showDrivers ? ' with driver allocation' : ''} (PDF + Word link)`,
          note:          wordLinkNote(message, wordUrl),
          senderName,
          baseUrl,
        })
        return buildApiSuccess({ sent: true, via: 'template-word-link', waMessageId: sent.waMessageId, wordUrl })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return buildApiError(`WhatsApp send failed: ${msg}`, 422)
      }
    }

    try {
      const sent = await sendViaMetaApi({
        to:      normPhone,
        message: waMessage,
        media:   { buffer: docBuffer, filename, kind: 'document', caption: `Agenda — ${params.ref}` },
      })
      if (!sent) return buildApiError('WhatsApp is not configured on this server.', 500)
      return buildApiSuccess({ sent: true, via: 'freeform' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`WhatsApp send failed: ${msg}`, 500)
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  if (mode === 'email') {
    if (!to) return buildApiError('Email address required', 400)

    const emailSubject = subject ?? `Tour Confirmation — ${params.ref}`
    // Standard customer tour-confirmation body; anything typed in the modal is
    // appended as a highlighted note rather than replacing the template.
    const bodyHtml = buildAgendaEmailHtml(booking as never, message)

    try {
      await sendMailViaGraph({
        to: to,
        audience: 'guest',
        subject: emailSubject,
        bodyHtml,
        attachment: {
          name:        filename,
          contentType,
          buffer:      docBuffer,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`Email send failed: ${msg}`, 500)
    }

    return buildApiSuccess({ sent: true, via: 'email' })
  }

  return buildApiError('Invalid mode', 400)
}
