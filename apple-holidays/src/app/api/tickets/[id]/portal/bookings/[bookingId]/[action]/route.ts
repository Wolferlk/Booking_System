import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { cancel, checkStatus, confirm, DeskError, release, sendCode } from '@/lib/ticket-portal/desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * send-code · confirm · release · cancel · check
 * confirm and cancel need the WhatsApp code; the server checks it, never the screen.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; bookingId: string; action: string } }) {
  const body = (await req.json().catch(() => ({}))) as { code?: string; purpose?: string }
  const { id, bookingId, action } = params
  return deskRoute('ticket:purchase', async user => {
    switch (action) {
      case 'send-code':
        return { data: await sendCode(id, bookingId, body.purpose === 'CANCEL' ? 'CANCEL' : 'CONFIRM', user) }
      case 'confirm':
        return { data: await confirm(id, bookingId, body.code ?? '', user), message: 'Ticket issued.' }
      case 'release':
        return { data: await release(id, bookingId, user), message: 'Hold released.' }
      case 'cancel':
        return { data: await cancel(id, bookingId, body.code ?? '', user), message: 'Ticket cancelled.' }
      case 'check':
        return { data: await checkStatus(id, bookingId, user) }
      default:
        throw new DeskError('Unknown step.', 404)
    }
  })
}
