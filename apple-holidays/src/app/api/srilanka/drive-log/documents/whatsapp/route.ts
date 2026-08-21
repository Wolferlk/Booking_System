/**
 * Sending one booking's settlement documents to its driver over WhatsApp.
 *
 *   GET   ?ref=…  who the documents would go to: the driver on the file, the
 *                 number as it is stored, and that number as WhatsApp will
 *                 actually receive it. The send box shows both, so a desk can
 *                 see "0775622923 → +94 77 562 2923" before committing.
 *   POST  ?ref=…  send them. Body: { pack?, docs?, phone? }.
 *
 * `pack` is the version on screen, so unsaved corrections go out with the
 * documents rather than a stale saved copy. `phone` overrides the number on the
 * file for this send only — nothing is written back to the driver record, which
 * is edited in the driver screen and nowhere else.
 *
 * ---- Who may send ----
 *
 * The same gate as editing the documents: the Sri Lankan ground desk, Accounts
 * and the admins. Reading a settlement sheet and putting one in a driver's hand
 * are different acts, and only the second one is a message the company sends.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'
import { sendSettlementDocs } from '@/lib/sl-settlement-docs-notify'
import { derivePack, packForPrint } from '@/lib/sl-settlement-docs-server'
import { DOC_KINDS, parseDocKinds, parsePack } from '@/lib/sl-settlement-docs'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const canSend = (role: UserRole) =>
  hasPermission(role, 'assignment:edit') || hasPermission(role, 'pnl:view_profit')

function refOf(req: NextRequest): string | null {
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim()
  return ref && ref.length <= 60 ? ref : null
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const ref = refOf(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  try {
    const pack = await packForPrint(ref)
    if (!pack) return buildApiError(`Booking ${ref} was not found.`, 404)

    const stored = pack.header.driverPhone
    const phone  = normaliseSriLankanPhone(stored)

    return buildApiSuccess({
      driverName: pack.header.driverName || null,
      vehicle:    [pack.header.vehicleType, pack.header.vehiclePlate].filter(Boolean).join(' · ') || null,
      /** Exactly as it is written on the driver record — the desk should see the raw value. */
      storedPhone: stored || null,
      phone: {
        ok:     phone.ok,
        msisdn: phone.msisdn,
        pretty: phone.pretty,
        shape:  phone.shape,
        reason: phone.reason ?? null,
      },
      docs:    [...DOC_KINDS],
      canSend: canSend(role),
    })
  } catch (err) {
    console.error('[drive-log/documents/whatsapp GET]', err)
    return buildApiError('The driver contact could not be read.', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!canSend(role)) {
    return buildApiError('Only the operations desk, Accounts and admins may send documents to a driver.', 403)
  }

  const ref = refOf(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  let body: { pack?: unknown; docs?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return buildApiError('The request body was not valid JSON.', 400)
  }

  try {
    // The derived pack supplies the identity fields, so a browser cannot send
    // one booking's paperwork under another's reference.
    const derived = await derivePack(ref)
    if (!derived) return buildApiError(`Booking ${ref} was not found.`, 404)

    const pack  = body.pack ? parsePack(body.pack, derived.pack) : await packForPrint(ref)
    const kinds = parseDocKinds(body.docs ?? null)

    const result = await sendSettlementDocs(ref, {
      pack:          pack ?? derived.pack,
      kinds,
      phoneOverride: typeof body.phone === 'string' ? body.phone : null,
      sentBy:        session.user.name ?? session.user.email ?? null,
    })

    // A refused send is the operator's problem to fix — a bad number, a template
    // not yet approved — so it comes back as a 422 with the reason, not a 500.
    if (!result.ok) return buildApiError(result.reason ?? 'The documents could not be sent.', 422)
    return buildApiSuccess(result)
  } catch (err) {
    console.error('[drive-log/documents/whatsapp POST]', err)
    return buildApiError('The documents could not be sent.', 500)
  }
}
