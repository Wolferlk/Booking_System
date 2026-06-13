import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { generateBookingPdf } from '@/lib/generate-booking-pdf'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

const WHATSAPP_API = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'
const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

function getPublicBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/+$/, '')
}

function getMetaCredentials() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  return { accessToken, phoneNumberId }
}

async function sendViaMetaApi(params: {
  to: string
  name?: string
  message: string
  attachPdf?: boolean
  pdfBuffer?: Buffer
  pdfFilename?: string
}) {
  const { accessToken, phoneNumberId } = getMetaCredentials()
  if (!accessToken || !phoneNumberId) return null

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  }

  const textRes = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'text',
      text: { body: params.message },
    }),
  })

  const textBody = await textRes.text()
  if (!textRes.ok) {
    throw new Error(`Meta text send failed ${textRes.status}: ${textBody.slice(0, 300)}`)
  }

  let documentResult: unknown = null
  if (params.attachPdf && params.pdfBuffer && params.pdfFilename) {
    const mediaForm = new FormData()
    mediaForm.append('messaging_product', 'whatsapp')
    const pdfArrayBuffer = params.pdfBuffer.buffer.slice(
      params.pdfBuffer.byteOffset,
      params.pdfBuffer.byteOffset + params.pdfBuffer.byteLength,
    ) as ArrayBuffer
    mediaForm.append('file', new Blob([pdfArrayBuffer], { type: 'application/pdf' }), params.pdfFilename)

    const uploadRes = await fetch(`${baseUrl}/media`, {
      method: 'POST',
      headers,
      body: mediaForm,
    })

    const uploadBody = await uploadRes.text()
    if (!uploadRes.ok) {
      throw new Error(`Meta media upload failed ${uploadRes.status}: ${uploadBody.slice(0, 300)}`)
    }

    const uploadJson = JSON.parse(uploadBody) as { id?: string }
    if (!uploadJson.id) {
      throw new Error('Meta media upload returned no media id')
    }

    const docRes = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'document',
        document: {
          id: uploadJson.id,
          filename: params.pdfFilename,
          caption: 'Tour confirmation PDF',
        },
      }),
    })

    const docBody = await docRes.text()
    if (!docRes.ok) {
      throw new Error(`Meta document send failed ${docRes.status}: ${docBody.slice(0, 300)}`)
    }

    documentResult = JSON.parse(docBody)
  }

  return { channel: 'meta', text: JSON.parse(textBody), document: documentResult }
}

async function sendViaNotifyProxy(params: {
  to: string
  name?: string
  message: string
  files?: Array<{ url: string; filename: string; caption?: string }>
}) {
  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET?.trim()
  if (!notifySecret) return null

  const res = await fetch(WHATSAPP_API, {
    method: 'POST',
    headers: {
      'x-notify-secret': notifySecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`)
  }

  return { channel: 'proxy', response: json }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name, message, attachPdf } = await req.json() as {
    to: string
    name: string
    message: string
    attachPdf?: boolean
  }

  if (!to || !message) return buildApiError('Phone number and message are required')

  const payload: { to: string; message: string; name?: string } = {
    to,
    message,
  }

  if (name) payload.name = name

  console.log('[WhatsApp] attachPdf:', attachPdf, '| ref:', params.ref)

  let pdfBuffer: Buffer | undefined
  let pdfFilename: string | undefined
  if (attachPdf) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { bookingRef: params.ref },
        include: {
          passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
          flights:           { orderBy: { date: 'asc' } },
          accommodations:    { orderBy: { checkIn: 'asc' } },
          emergencyContacts: true,
          tourAgenda: {
            include: {
              items: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] },
            },
          },
        },
      })

      console.log('[WhatsApp] booking found:', !!booking)

      if (!booking) {
        return buildApiError(`Booking ${params.ref} not found for PDF attachment`, 404)
      }

      pdfBuffer = await generateBookingPdf(booking)
      if (!pdfBuffer.length) {
        throw new Error('Generated PDF is empty')
      }

      console.log('[WhatsApp] PDF generated, size:', pdfBuffer.length)
      pdfFilename = `AppleHolidays-${params.ref}-TourDetails-${Date.now()}.pdf`
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
      await mkdir(uploadDir, { recursive: true })
      await writeFile(path.join(uploadDir, pdfFilename), pdfBuffer)

      const baseUrl = getPublicBaseUrl(req)
      const fileUrl = `${baseUrl}/uploads/whatsapp/${encodeURIComponent(pdfFilename)}`
      console.log('[WhatsApp] PDF saved and public URL prepared:', fileUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[WhatsApp] PDF generation failed:', msg)
      return buildApiError(`Unable to attach PDF: ${msg}`, 500)
    }
  }

  try {
    const metaResult = await sendViaMetaApi({
      to,
      name,
      message,
      attachPdf,
      pdfBuffer,
      pdfFilename,
    })

    if (metaResult) {
      return buildApiSuccess(metaResult, `WhatsApp message sent to ${to}`)
    }

    const proxyResult = await sendViaNotifyProxy({
      ...payload,
      ...(attachPdf && pdfFilename
        ? {
            files: [
              {
                url: `${getPublicBaseUrl(req)}/uploads/whatsapp/${encodeURIComponent(pdfFilename)}`,
                filename: pdfFilename,
                caption: 'Tour confirmation PDF',
              },
            ],
          }
        : {}),
    })

    if (proxyResult) {
      return buildApiSuccess(proxyResult, `WhatsApp message sent to ${to}`)
    }

    return buildApiError('No WhatsApp credentials configured', 500)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] send failed:', msg)
    return buildApiError(msg, 502)
  }
}
