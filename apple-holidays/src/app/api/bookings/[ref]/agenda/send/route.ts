/**
 * POST /api/bookings/[ref]/agenda/send
 *
 * Generates the movement-chart agenda as a PDF and:
 *   mode = 'download' → returns the PDF as binary
 *   mode = 'whatsapp' → sends via WhatsApp (Meta API / proxy)
 *   mode = 'email'    → sends via Microsoft Graph email
 *
 * Body:
 *   { mode, showDrivers, to, message, subject }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { generateAgendaPdf } from '@/lib/generate-agenda-pdf'
import { PURCHASED_TICKET_STATUSES } from '@/lib/ticket-notes'
import { sendMailViaGraph } from '@/lib/send-mail'
import { putUpload } from '@/lib/storage'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
const WHATSAPP_PROXY   = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

function safeFilePart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildAgendaFileName(booking: {
  bookingRef?: string
  isNumber?: string | null
  passengers?: { name: string; isLead?: boolean }[]
}): string {
  const leadPassenger = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const parts = [
    booking.isNumber?.trim() || null,
    booking.bookingRef?.trim() || null,
    leadPassenger?.name ?? null,
  ].map(safeFilePart).filter(Boolean)

  return `${parts.join('_') || 'agenda'}.pdf`
}

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
    showDrivers?: boolean
    to?:         string
    message?:    string
    subject?:    string
  }

  const { mode, showDrivers = true, to, message, subject } = body

  // ── Load agenda data ──────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      emergencyContacts: true,
      // Purchased/paid only — draft tickets stay internal and never get sent out.
      tickets: {
        where: { activated: true, status: { in: [...PURCHASED_TICKET_STATUSES] } },
        include: {
          pnlLine: { select: { activity: true, paymentRefNumber: true, category: true } },
          agendaItem: { select: { date: true, location: true, toPoint: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: {
              assignment: {
                include: {
                  driver: {
                    include: {
                      vehicle: true,
                    },
                  },
                  vendor: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  const agendaItems = (booking.tourAgenda as { items: unknown[] } | null)?.items ?? []

  // ── Generate PDF (full-detail layout matching "Download with all details") ──
  const driverTag  = showDrivers ? 'WithDrivers' : 'NoDrivers'
  const filename   = buildAgendaFileName(booking as never)

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateAgendaPdf(
      params.ref,
      booking as never,
      agendaItems as never,
      showDrivers,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`PDF generation failed: ${msg}`, 500)
  }

  // ── Download ──────────────────────────────────────────────────────────────
  if (mode === 'download') {
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdfBuffer.length),
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
    const waMessage     = message ?? `📋 Movement Chart — ${params.ref}\n\nPlease find the attached agenda PDF for your reference.`

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
        const pdfBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })
        mediaForm.append('file', pdfBlob, filename)
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
      const storedPath = await putUpload(`whatsapp/${storedName}`, pdfBuffer, 'application/pdf')
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

    const emailSubject = subject ?? `Movement Chart — ${params.ref}`
    const bodyHtml = `
      <div style="font-family:Arial,sans-serif;color:#1e293b;max-width:600px">
        <div style="background:#0f172a;padding:16px 20px;border-radius:8px 8px 0 0">
          <h2 style="color:#f1f5f9;margin:0;font-size:16px">Movement Chart</h2>
          <p style="color:#d97706;margin:4px 0 0;font-family:monospace;font-size:14px">${params.ref}</p>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 12px">${message ?? 'Please find the movement chart (agenda) for this booking in the attached PDF.'}</p>
          <p style="color:#64748b;font-size:12px;margin:0">
            ${showDrivers ? 'This PDF includes driver allocation details.' : 'This PDF does not include driver information.'}
          </p>
        </div>
      </div>`

    try {
      await sendMailViaGraph({
        to: to,
        subject: emailSubject,
        bodyHtml,
        attachment: {
          name:        filename,
          contentType: 'application/pdf',
          buffer:      pdfBuffer,
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
