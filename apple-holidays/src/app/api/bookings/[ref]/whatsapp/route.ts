import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { generateConfirmationPdf, generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { putUpload } from '@/lib/storage'
import { sendViaMetaApi, sendViaNotifyProxy } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

function getPublicBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/+$/, '')
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name, message, attachPdf, pdfType } = await req.json() as {
    to:        string
    name:      string
    message:   string
    attachPdf?: boolean
    pdfType?:  'confirmation' | 'full'
  }

  if (!to || !message) return buildApiError('Phone number and message are required')

  const isFullPdf = pdfType === 'full'
  console.log('[WhatsApp] pdfType:', pdfType, '| attachPdf:', attachPdf, '| ref:', params.ref)

  let pdfBuffer:   Buffer   | undefined
  let pdfFilename: string   | undefined

  if (attachPdf) {
    try {
      const booking = await prisma.booking.findUnique({
        where:   { bookingRef: params.ref },
        include: {
          passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
          flights:           { orderBy: { date: 'asc' } },
          accommodations:    { orderBy: { checkIn: 'asc' } },
          itineraryItems:    { orderBy: [{ dayNo: 'asc' }, { date: 'asc' }] },
          emergencyContacts: true,
          tourAgenda: {
            include: {
              items: {
                orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
                include: {
                  assignment: {
                    include: { driver: { include: { vehicle: true } } },
                  },
                },
              },
            },
          },
          ...(isFullPdf ? {
            tickets: {
              orderBy: { createdAt: 'asc' },
            },
          } : {}),
        },
      })

      if (!booking) {
        return buildApiError(`Booking ${params.ref} not found for PDF attachment`, 404)
      }

      pdfBuffer = isFullPdf
        ? await generateFullDetailsPdf(booking)
        : await generateConfirmationPdf(booking)

      if (!pdfBuffer.length) throw new Error('Generated PDF is empty')

      const typeTag   = isFullPdf ? 'FullDetails' : 'TourConfirmation'
      pdfFilename     = `AppleHolidays-${params.ref}-${typeTag}-${Date.now()}.pdf`
      await putUpload(`whatsapp/${pdfFilename}`, pdfBuffer, 'application/pdf')

      console.log('[WhatsApp] PDF generated, size:', pdfBuffer.length, '| file:', pdfFilename)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[WhatsApp] PDF generation failed:', msg)
      return buildApiError(`Unable to attach PDF: ${msg}`, 500)
    }
  }

  const baseUrl  = getPublicBaseUrl(req)
  const fileUrl  = pdfFilename
    ? `${baseUrl}/api/uploads/whatsapp/${encodeURIComponent(pdfFilename)}`
    : undefined

  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const normPhone  = to.replace(/\D/g, '')

  try {
    const metaResult = await sendViaMetaApi({
      to,
      message,
      ...(attachPdf && pdfBuffer && pdfFilename
        ? {
            media: {
              buffer:   pdfBuffer,
              filename: pdfFilename,
              kind:     'document' as const,
              caption:  isFullPdf ? 'Full tour details & vouchers PDF' : 'Tour confirmation PDF',
            },
          }
        : {}),
    })
    if (metaResult) {
      await prisma.whatsAppMessage.create({
        data: {
          bookingRef: params.ref,
          phone:      normPhone,
          direction:  'outbound',
          body:       message,
          waMessageId: (metaResult.text as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
          status:     'sent',
          senderName,
        },
      })
      return buildApiSuccess(metaResult, `WhatsApp message sent to ${to}`)
    }

    const proxyResult = await sendViaNotifyProxy({
      to, name, message,
      ...(attachPdf && fileUrl && pdfFilename
        ? { files: [{ url: fileUrl, filename: pdfFilename, caption: isFullPdf ? 'Full tour details & vouchers' : 'Tour confirmation' }] }
        : {}),
    })
    if (proxyResult) {
      await prisma.whatsAppMessage.create({
        data: {
          bookingRef: params.ref,
          phone:      normPhone,
          direction:  'outbound',
          body:       message,
          status:     'sent',
          senderName,
        },
      })
      return buildApiSuccess(proxyResult, `WhatsApp message sent to ${to}`)
    }

    return buildApiError('No WhatsApp credentials configured', 500)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] send failed:', msg)
    return buildApiError(msg, 502)
  }
}
