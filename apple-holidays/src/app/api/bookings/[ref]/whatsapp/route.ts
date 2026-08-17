import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  isWithin24hWindow,
  deliverConfirmationNow,
  sendOpenerAndQueue,
  type PdfType,
} from '@/lib/booking-whatsapp-delivery'

export const dynamic = 'force-dynamic'
// Rendering the PDF (Chromium) then uploading it to Meta takes far longer than the
// platform's default function timeout. Without this the request is killed mid-flight
// and the gateway serves its own HTML 502 in place of our JSON. Matches agenda/send.
export const maxDuration = 120

const WHATSAPP_API    = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'
const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

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
  if (!['TE_USER', 'BT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name, message, attachPdf, pdfType } = await req.json() as {
    to:         string
    name:       string
    message:    string
    attachPdf?: boolean
    pdfType?:   PdfType
  }

  if (!to || !message) return buildApiError('Phone number and message are required')

  const type       = pdfType === 'full' ? 'full' : 'confirmation'
  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const baseUrl    = getPublicBaseUrl(req)
  const common = {
    ref: params.ref, to, name: name ?? 'Guest', message,
    attachPdf: Boolean(attachPdf), pdfType: type as PdfType, senderName, baseUrl,
  }

  try {
    // Window OPEN → deliver now. CLOSED → send the opener template + queue the
    // confirmation (flushed automatically when the customer replies).
    if (await isWithin24hWindow(to)) {
      await deliverConfirmationNow(common)
      return buildApiSuccess({ delivered: true }, `WhatsApp ${type === 'full' ? 'Full Details' : 'Tour Confirmation'} sent to ${to}`)
    }

    await sendOpenerAndQueue(common)
    return buildApiSuccess(
      { queued: true },
      `Customer is outside the 24h window — sent them a reply request and QUEUED the ${type === 'full' ? 'Full Details' : 'Tour Confirmation'}. It will send automatically the moment they reply.`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] send failed:', msg)
    return buildApiError(msg, 502)
  }
}
