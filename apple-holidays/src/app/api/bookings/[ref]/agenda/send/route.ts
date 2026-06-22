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
import { htmlToPdf } from '@/lib/html-to-pdf'
import { sendMailViaGraph } from '@/lib/send-mail'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
const WHATSAPP_PROXY   = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

// ── HTML builder ──────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function buildAgendaHtml(
  ref: string,
  booking: {
    agent?: string | null
    arrivalDate?: string | null
    departureDate?: string | null
    paxAdults?: number | null
    paxChildren?: number | null
    passengers?: { name: string; isLead?: boolean }[]
  },
  items: {
    date: string
    location?: string | null
    fromPoint?: string | null
    toPoint?: string | null
    details?: string | null
    mealPlan?: string | null
    meetingTime?: string | null
    serviceType?: string | null
    assignment?: {
      vendorId?: string | null
      vendorName?: string | null
      driverName?: string | null
      driverPhone?: string | null
      vehicleType?: string | null
      vehiclePlate?: string | null
    } | null
  }[],
  showDrivers: boolean,
): string {
  const SVC_LABEL: Record<string, string> = {
    PVT_TRANSFER: 'Private Transfer',
    SIC_TRANSFER: 'SIC Transfer',
    OWN_ARRANGEMENT: 'Own Arrangement',
  }
  const SVC_COLOR: Record<string, string> = {
    PVT_TRANSFER: '#2563eb',
    SIC_TRANSFER: '#16a34a',
    OWN_ARRANGEMENT: '#94a3b8',
  }

  const lead = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const totalPax = (booking.paxAdults ?? 0) + (booking.paxChildren ?? 0)

  const rows = items.map((item, idx) => {
    const a   = item.assignment
    const svc = item.serviceType ?? 'OWN_ARRANGEMENT'
    const clr = SVC_COLOR[svc] ?? '#94a3b8'

    const driverCell = showDrivers
      ? `<td style="padding:5px 6px;font-size:8px;color:#374151;border-bottom:1px solid #e2e8f0;">${
          a?.vendorId
            ? `<b style="color:#7c3aed">${a.vendorName ?? ''}</b>${a.driverName ? `<br/>${a.driverName}${a.driverPhone ? ' · ' + a.driverPhone : ''}` : ''}${a.vehiclePlate ? `<br/><span style="font-family:monospace;color:#64748b">${a.vehicleType ?? ''} ${a.vehiclePlate}</span>` : ''}`
            : a?.driverName
              ? `<b style="color:#1d4ed8">${a.driverName}</b>${a.driverPhone ? `<br/>${a.driverPhone}` : ''}${a.vehiclePlate ? `<br/><span style="font-family:monospace;color:#64748b">${a.vehicleType ?? ''} ${a.vehiclePlate}</span>` : ''}`
              : `<span style="color:#cbd5e1;font-style:italic">Not assigned</span>`
        }</td>`
      : ''

    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:5px 6px;font-size:8.5px;font-weight:700;color:#374151;white-space:nowrap;border-bottom:1px solid #e2e8f0">${fmtDate(item.date)}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${item.location ?? '—'}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${
        item.fromPoint && item.toPoint
          ? `<span style="color:#64748b">${item.fromPoint}</span> → ${item.toPoint}`
          : item.toPoint ?? item.fromPoint ?? '—'
      }</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${item.mealPlan ?? '—'}</td>
      <td style="padding:5px 6px;font-size:8.5px;font-weight:${item.meetingTime ? '700' : '400'};color:#374151;border-bottom:1px solid #e2e8f0">${item.meetingTime ?? '—'}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e2e8f0">
        <span style="display:inline-block;padding:2px 5px;border-radius:3px;font-size:7.5px;font-weight:700;color:${clr};background:${clr}18;border:1px solid ${clr}35">
          ${SVC_LABEL[svc] ?? svc}
        </span>
      </td>
      <td style="padding:5px 6px;font-size:8px;color:#374151;line-height:1.4;border-bottom:1px solid #e2e8f0">${item.details ?? '—'}</td>
      ${driverCell}
    </tr>`
  }).join('')

  const thStyle = 'padding:5px 7px;text-align:left;font-size:8px;font-weight:700;color:#f1f5f9;text-transform:uppercase;letter-spacing:0.4px;background:#0f172a;'

  const driverTh = showDrivers
    ? `<th style="${thStyle}width:18%">Driver / Vehicle</th>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;background:#fff;font-size:10px}
  table{width:100%;border-collapse:collapse}
</style>
</head>
<body style="padding:20px 22px">
  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #d97706;padding-bottom:10px;margin-bottom:14px">
    <div>
      <p style="font-weight:800;font-size:14px;color:#0f172a">Apple Holidays</p>
      <p style="font-size:9px;color:#64748b">MMT Vietnam · Movement Chart</p>
    </div>
    <div style="text-align:right">
      <p style="font-weight:800;font-size:15px;font-family:monospace;color:#d97706">${ref}</p>
      ${booking.agent ? `<p style="font-size:9px;color:#64748b;margin-top:2px">${booking.agent}</p>` : ''}
      <p style="font-size:8px;color:#94a3b8;margin-top:2px">${fmtDate(booking.arrivalDate)} – ${fmtDate(booking.departureDate)} · ${totalPax} pax</p>
      ${!showDrivers ? '<p style="font-size:8px;color:#94a3b8;font-style:italic">Driver info hidden</p>' : ''}
    </div>
  </div>

  ${lead ? `<div style="margin-bottom:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:5px 10px;display:inline-block">
    <span style="font-size:8.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Lead Passenger: </span>
    <span style="font-size:9.5px;font-weight:700;color:#1e293b">${lead.name}</span>
  </div>` : ''}

  <!-- TABLE -->
  <table style="margin-top:8px">
    <thead>
      <tr>
        <th style="${thStyle}width:9%">Date</th>
        <th style="${thStyle}width:10%">Location</th>
        <th style="${thStyle}width:${showDrivers ? '17%' : '26%'}">From → To</th>
        <th style="${thStyle}width:7%">Meal</th>
        <th style="${thStyle}width:6%">Meet</th>
        <th style="${thStyle}width:10%">Service</th>
        <th style="${thStyle}width:${showDrivers ? '21%' : '32%'}">Details</th>
        ${driverTh}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- FOOTER -->
  <div style="margin-top:18px;border-top:1px solid #e2e8f0;padding-top:7px;display:flex;justify-content:space-between">
    <p style="font-size:7.5px;color:#94a3b8">Generated by Apple Holidays Booking System</p>
    <p style="font-size:7.5px;color:#94a3b8">
      Printed: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </p>
  </div>
</body>
</html>`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
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
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  const agendaItems = (booking.tourAgenda as { items: unknown[] } | null)?.items ?? []

  // ── Generate PDF ──────────────────────────────────────────────────────────
  const html = buildAgendaHtml(
    params.ref,
    booking as never,
    agendaItems as never,
    showDrivers,
  )

  const driverTag  = showDrivers ? 'WithDrivers' : 'NoDrivers'
  const filename   = `${params.ref}-Agenda-${driverTag}-${Date.now()}.pdf`

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await htmlToPdf(html, filename, { bookingRef: params.ref })
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
    if (!to) return buildApiError('Phone number required', 400)
    const normPhone = to.replace(/\D/g, '')

    // Save PDF to public dir for URL-based delivery
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, filename), pdfBuffer)

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      req.nextUrl.origin
    ).replace(/\/+$/, '')
    const fileUrl = `${baseUrl}/uploads/whatsapp/${encodeURIComponent(filename)}`

    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    const waMessage     = message ?? `📋 Movement Chart — ${params.ref}\n\nPlease find the attached agenda PDF for your reference.`

    // Try Meta API first
    if (accessToken && phoneNumberId) {
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
    }

    // Fallback: proxy
    const proxyRes = await fetch(WHATSAPP_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: normPhone, message: waMessage, fileUrl, filename }),
    })
    const proxyJson = await proxyRes.json() as { success?: boolean }
    if (!proxyJson.success && !proxyRes.ok) {
      return buildApiError('WhatsApp send failed', 500)
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

    return buildApiSuccess({ sent: true, via: 'email' })
  }

  return buildApiError('Invalid mode', 400)
}
