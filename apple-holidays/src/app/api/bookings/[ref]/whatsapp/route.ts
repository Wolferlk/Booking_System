import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { generateBookingPdf } from '@/lib/generate-booking-pdf'

const WHATSAPP_API = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

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

  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET
  if (!notifySecret) return buildApiError('WHATSAPP_NOTIFY_SECRET not configured', 500)

  const formData = new FormData()
  formData.append('to', to)
  if (name) formData.append('name', name)
  formData.append('message', message)

  console.log('[WhatsApp] attachPdf:', attachPdf, '| ref:', params.ref)

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

      if (booking) {
        const pdfBuffer = await generateBookingPdf(booking)
        console.log('[WhatsApp] PDF generated, size:', pdfBuffer.length)
        const filename = `AppleHolidays-${params.ref}-TourDetails.pdf`
        formData.append(
          'file',
          new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
          filename,
        )
        console.log('[WhatsApp] file appended to FormData')
      }
    } catch (err) {
      console.error('[WhatsApp] PDF generation failed:', err)
    }
  }

  const res = await fetch(WHATSAPP_API, {
    method:  'POST',
    headers: { 'x-notify-secret': notifySecret },
    body:    formData,
  })

  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    console.error('[WhatsApp] send failed:', res.status, text.slice(0, 500))
    return buildApiError(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`, 502)
  }

  return buildApiSuccess(json, `WhatsApp message sent to ${to}`)
}
