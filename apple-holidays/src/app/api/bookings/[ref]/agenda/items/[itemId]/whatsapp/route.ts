/**
 * WhatsApp one movement (agenda item) to the people running it.
 *
 *   GET  — the saved movement, its recipients, Settings, template status and
 *          the send history for this movement (the dialog renders the preview
 *          locally from `input` with the same function the send uses)
 *   POST — { recipients: [{ role, name, phone, saveToMovement? }], note?, force? }
 *          → per-recipient results. A recipient sent the identical text within
 *          the duplicate-guard window comes back `reason: 'duplicate'` until
 *          the desk confirms with force=true.
 *
 * See lib/movement-whatsapp.ts.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import {
  loadMovement,
  loadMovementWaConfig,
  movementHistory,
  movementTemplateStatus,
  sendMovementBrief,
  type SendRequestRecipient,
} from '@/lib/movement-whatsapp'

export const dynamic = 'force-dynamic'

/** Same roles that can allocate drivers on the movement chart. */
const SEND_ROLES: UserRole[] = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function authorise(ref: string, forSend: boolean) {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  const allowed = forSend ? SEND_ROLES : (WHATSAPP_STAFF_ROLES as readonly string[])
  if (!allowed.includes(role)) return { error: buildApiError('Forbidden', 403) }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: { operationCountry: true } })
  if (!booking) return { error: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL'
      && !isInCountryScope(booking.operationCountry, userCountry)) {
    return { error: buildApiError('Forbidden', 403) }
  }
  return { session, role }
}

export async function GET(req: NextRequest, { params }: { params: { ref: string; itemId: string } }) {
  const auth = await authorise(params.ref, false)
  if ('error' in auth) return auth.error

  const config = await loadMovementWaConfig()
  const movement = await loadMovement(params.ref, params.itemId, config)
  if (!movement) return buildApiError('Movement not found — save the chart first', 404)

  const fresh = req.nextUrl.searchParams.get('fresh') === '1'
  const [template, history, testMode] = await Promise.all([
    movementTemplateStatus(config, fresh),
    movementHistory(params.ref, params.itemId),
    prisma.systemSetting.findMany({ where: { key: { in: ['use_test_data', 'test_whatsapp'] } } }),
  ])
  const tm = Object.fromEntries(testMode.map(r => [r.key, r.value]))

  return buildApiSuccess({
    config,
    template,
    input: movement.input,
    recipients: movement.recipients,
    history,
    canSend: SEND_ROLES.includes(auth.role),
    testMode: tm.use_test_data === 'true' ? { to: tm.test_whatsapp || '94778231121' } : null,
  })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string; itemId: string } }) {
  const auth = await authorise(params.ref, true)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({})) as {
    recipients?: SendRequestRecipient[]
    note?: string
    force?: boolean
  }
  const recipients = Array.isArray(body.recipients) ? body.recipients.slice(0, 10) : []
  if (!recipients.length) return buildApiError('Pick at least one recipient')

  const config = await loadMovementWaConfig()
  if (!config.enabled) return buildApiError('Movement WhatsApp is switched off in Settings', 409)

  const movement = await loadMovement(params.ref, params.itemId, config)
  if (!movement) return buildApiError('Movement not found — save the chart first', 404)

  const results = await sendMovementBrief({
    movement,
    config,
    recipients,
    note:   typeof body.note === 'string' ? body.note.slice(0, 300) : null,
    force:  body.force === true,
    sentBy: auth.session.user.email ?? auth.session.user.id,
  })

  const ok = results.filter(r => r.ok).length
  return buildApiSuccess(
    { results, history: await movementHistory(params.ref, params.itemId) },
    `${ok}/${results.length} sent`,
  )
}
