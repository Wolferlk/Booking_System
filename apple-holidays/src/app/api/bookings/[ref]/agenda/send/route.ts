/**
 * POST /api/bookings/[ref]/agenda/send
 *
 * Generates the movement-chart agenda as a PDF or a Word (.docx) file and:
 *   mode = 'download' → returns the file as binary
 *   mode = 'whatsapp' → sends via WhatsApp (Meta API / proxy)
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
import { putUpload } from '@/lib/storage'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
const WHATSAPP_PROXY   = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

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
  const driverTag   = showDrivers ? 'WithDrivers' : 'NoDrivers'
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
  if (mode === 'whatsapp') {
    // Normalise to digits only — "+91 7715805191" → "917715805191".
    const normPhone = (to ?? '').replace(/\D/g, '')
    if (!normPhone) return buildApiError('WhatsApp number required', 400)

    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    const waMessage     = message ?? `📋 Movement Chart — ${params.ref}\n\nPlease find the attached agenda ${isWord ? 'Word document' : 'PDF'} for your reference.`

    // Try Meta API first. Wrapped so a Graph/network failure returns JSON, not an empty body.
    if (accessToken && phoneNumberId) {
      try {
        const baseWaUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
        const headers   = { Authorization: `Bearer ${accessToken}` }

        // Send text
        await fetch(`${baseWaUrl}/messages`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normPhone,
            type: 'text',
            text: { body: waMessage },
          }),
        })

        // Upload PDF and send document
        const mediaForm = new FormData()
        mediaForm.append('messaging_product', 'whatsapp')
        const docBlob = new Blob([new Uint8Array(docBuffer)], { type: contentType })
        mediaForm.append('file', docBlob, filename)
        const uploadRes  = await fetch(`${baseWaUrl}/media`, { method: 'POST', headers, body: mediaForm })
        const uploadJson = await uploadRes.json() as { id?: string }

        if (uploadJson.id) {
          await fetch(`${baseWaUrl}/messages`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: normPhone,
              type: 'document',
              document: { id: uploadJson.id, filename, caption: `Agenda — ${params.ref}` },
            }),
          })
        }

        return buildApiSuccess({ sent: true, via: 'meta' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return buildApiError(`WhatsApp send failed: ${msg}`, 500)
      }
    }

    // Fallback: proxy — needs a public file URL, so store the PDF first (S3 → local disk).
    try {
      const storedName = `${driverTag}-${filename}`
      const storedPath = await putUpload(`whatsapp/${storedName}`, docBuffer, contentType)
      const baseUrl = (
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.APP_URL?.trim() ||
        req.nextUrl.origin
      ).replace(/\/+$/, '')
      const fileUrl = `${baseUrl}${storedPath}`

      const proxyRes = await fetch(WHATSAPP_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: normPhone, message: waMessage, fileUrl, filename }),
      })
      let proxyJson: { success?: boolean } = {}
      try { proxyJson = await proxyRes.json() as { success?: boolean } } catch { /* non-JSON body */ }
      if (!proxyJson.success && !proxyRes.ok) {
        return buildApiError(`WhatsApp proxy failed (${proxyRes.status})`, 500)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`WhatsApp send failed: ${msg}`, 500)
    }

    return buildApiSuccess({ sent: true, via: 'proxy' })
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
