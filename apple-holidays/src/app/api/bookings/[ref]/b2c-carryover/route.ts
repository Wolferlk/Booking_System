/**
 * Carry the team's work from a replaced Aahaas B2C version onto this (active)
 * booking — see `b2c-carryover.ts`.
 *
 *   GET  ?from=15726                       → preview (nothing written)
 *   POST { fromRef, fingerprint, selection } → apply the ticked items
 *        (Travel Experience / admins only; refused when the preview is stale)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { applyCarryOver, CarryOverError, CARRYOVER_CONFIRM_ROLES, previewCarryOver } from '@/lib/b2c-carryover'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function guard(ref: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: buildApiError('Unauthorized', 401) }
  if (session.user.role === 'CLIENT') return { error: buildApiError('Forbidden', 403) }
  const booking = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: { operationCountry: true } })
  if (!booking) return { error: buildApiError('Booking not found', 404) }
  const c = session.user.country as OperationCountry | undefined
  if (c && c !== 'ALL' && !isInCountryScope(booking.operationCountry as OperationCountry, c)) {
    return { error: buildApiError('Forbidden — this booking belongs to another country.', 403) }
  }
  return { session }
}

function fail(err: unknown) {
  if (err instanceof CarryOverError) return buildApiError(err.message, err.status)
  console.error('[b2c-carryover]', err)
  return buildApiError(err instanceof Error ? err.message : 'Carry-over failed', 500)
}

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const { session, error } = await guard(params.ref)
  if (error) return error
  try {
    const preview = await previewCarryOver(params.ref, req.nextUrl.searchParams.get('from'))
    return buildApiSuccess({
      ...preview,
      canConfirm: (CARRYOVER_CONFIRM_ROLES as readonly string[]).includes(session!.user.role),
    })
  } catch (err) {
    return fail(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const { session, error } = await guard(params.ref)
  if (error) return error
  const body = await req.json().catch(() => null) as { fromRef?: string; fingerprint?: string; selection?: { key: string; value?: string | null }[] } | null
  if (!body?.fromRef || !body.fingerprint || !Array.isArray(body.selection)) {
    return buildApiError('fromRef, fingerprint and selection are required', 400)
  }
  try {
    const state = await applyCarryOver({
      toRef: params.ref,
      fromRef: body.fromRef,
      fingerprint: body.fingerprint,
      selection: body.selection.filter((s) => s && typeof s.key === 'string').map((s) => ({ key: s.key, value: s.value == null ? s.value : String(s.value) })),
      actor: { id: session!.user.id, name: session!.user.name ?? session!.user.email ?? 'Unknown', role: session!.user.role },
    })
    return buildApiSuccess(state)
  } catch (err) {
    return fail(err)
  }
}
