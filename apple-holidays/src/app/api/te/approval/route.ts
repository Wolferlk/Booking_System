/**
 * Send the WhatsApp call-approval message — and remember that we did.
 *
 * Functionally this is the `approval` call the dashboard used to make straight
 * through `/api/te/proxy`. It goes through its own route now because the call
 * report has to answer "has this customer approved automated calls?", and the
 * upstream only reveals that in the response to this request. Recording it here
 * makes the answer available later. See `call-approvals.ts`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { markApproved, recordApprovalRequest } from '@/lib/te/call-approvals'
import { normalizePhone, tePost } from '@/lib/te/te-api'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['TE_USER', 'GT_TE_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

interface ApprovalResponse {
  already_allowed?: boolean
  message?: string
  [key: string]: unknown
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const phone = normalizePhone(body.to as string)
  if (!phone) return buildApiError('A phone number is required')

  const name = String(body.name ?? '').trim() || 'Valued Customer'
  const bookingRef = body.bookingRef ? String(body.bookingRef).toUpperCase() : null
  const actor = session.user.email ?? session.user.name ?? null

  try {
    const res = await tePost<ApprovalResponse>('approval', { to: phone, name })

    // Ledger writes are bookkeeping — never fail the send over them.
    await recordApprovalRequest({ phone, bookingRef, actor, alreadyApproved: !!res.already_allowed })
      .catch(err => console.warn('[TE approvals] ledger write failed:', err))
    if (res.already_allowed) {
      await markApproved(phone).catch(() => {})
    }

    return buildApiSuccess(res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[TE approvals] send failed:', message)
    return buildApiError('Could not send the approval message', 502)
  }
}
