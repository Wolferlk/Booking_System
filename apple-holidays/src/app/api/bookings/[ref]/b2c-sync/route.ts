/**
 * "Update Booking" for an Aahaas B2C store order.
 *
 *   GET  → is this a B2C booking, and when was it last updated from the store.
 *   POST { mode: 'preview' }                                → proposed changes here AND in Accounts, nothing written
 *   POST { mode: 'apply', keys: [...], expectedVersion: n,
 *          accounts: { pnl: bool, invoice: bool } | false } → write the ticked changes as a new version,
 *                                                            then update the Accounts P&L / invoice
 *
 * One press updates both systems, tied together by a shared sync id: OPS
 * writes first (it is the half the user is looking at), then Accounts is told
 * the new OPS version number. An Accounts failure is reported on the result
 * and the version note — it never undoes the OPS update.
 *
 * All of the merge / protection reasoning lives in `b2c-booking-sync.ts`. This
 * route only does auth, country scoping and error-code translation.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import {
  B2cSyncError,
  getB2cSyncState,
  isB2cOriginBooking,
  recordAccountsOutcome,
  syncB2cBooking,
  type B2cChangeKey,
} from '@/lib/b2c-booking-sync'
import { applyAccountsB2c, previewAccountsB2c } from '@/lib/accounts-b2c-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function loadScoped(ref: string, sessionCountry: OperationCountry | undefined) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, agent: true, operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }
  if (
    sessionCountry &&
    sessionCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)
  ) {
    return { error: buildApiError('Forbidden — this booking belongs to another country.', 403) }
  }
  return { booking }
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const { booking, error } = await loadScoped(params.ref, session.user.country as OperationCountry | undefined)
  if (error) return error

  const isB2c = await isB2cOriginBooking(booking!.id, booking!.agent)
  const state = isB2c ? await getB2cSyncState(booking!.bookingRef) : null
  return buildApiSuccess({
    bookingRef: booking!.bookingRef,
    isB2c,
    lastUpdate: state ? { at: state.at, by: state.by, version: state.version, changed: state.changed, accounts: state.accounts ?? null } : null,
  })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) return buildApiError('Forbidden', 403)

  const { booking, error } = await loadScoped(params.ref, session.user.country as OperationCountry | undefined)
  if (error) return error

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string
    keys?: unknown
    expectedVersion?: unknown
    accounts?: unknown
  }
  const mode = body.mode === 'apply' ? 'apply' : 'preview'
  const keys = Array.isArray(body.keys) ? (body.keys.filter((k) => typeof k === 'string') as B2cChangeKey[]) : []
  const expectedVersion = Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : undefined
  if (mode === 'apply' && expectedVersion === undefined) {
    return buildApiError('expectedVersion is required to apply an update.', 400)
  }

  const actorName = session.user.name || session.user.email || 'Unknown user'
  const orderId = Number(booking!.bookingRef)
  const hasOrderId = Number.isInteger(orderId) && orderId > 0

  try {
    if (mode === 'preview') {
      // Both sides read the store independently and in parallel.
      const [result, accounts] = await Promise.all([
        syncB2cBooking(booking!.bookingRef, { mode, actorId: session.user.id, actorName }),
        hasOrderId
          ? previewAccountsB2c(orderId)
          : Promise.resolve({ status: 'skipped' as const, message: 'No store order id on this booking.', data: null }),
      ])
      return buildApiSuccess(
        { ...result, accounts },
        result.unchanged ? 'Already up to date with the store.' : `${result.changes.length} change(s) found in the store.`,
      )
    }

    const syncId = crypto.randomUUID()
    const result = await syncB2cBooking(booking!.bookingRef, {
      mode,
      keys,
      expectedVersion,
      syncId,
      actorId: session.user.id,
      actorName,
    })

    const wantAccounts = body.accounts && typeof body.accounts === 'object'
      ? (body.accounts as { pnl?: unknown; invoice?: unknown })
      : null
    let accounts: Awaited<ReturnType<typeof applyAccountsB2c>> | null = null
    if (wantAccounts && hasOrderId && (wantAccounts.pnl || wantAccounts.invoice)) {
      accounts = await applyAccountsB2c(orderId, {
        syncId,
        opsVersion: result.newVersion,
        actor: `OPS: ${actorName}`,
        pnl: Boolean(wantAccounts.pnl),
        invoice: Boolean(wantAccounts.invoice),
      })
      await recordAccountsOutcome(booking!.bookingRef, result.newVersion, {
        status: accounts.status,
        message: accounts.message,
        versionNo: accounts.data?.version_no ?? null,
        invoice: accounts.data?.invoice?.invoice_number ?? null,
      }).catch((err) => console.error('[b2c-sync] could not record the Accounts outcome:', err))
    }

    const opsPart = result.newVersion
      ? `Booking updated to V${result.newVersion} — ${result.applied.length} change(s).`
      : 'OPS booking unchanged.'
    const accountsPart = !accounts
      ? ''
      : accounts.status === 'ok'
        ? ` Accounts: ${accounts.message ?? 'updated'}`
        : ` Accounts NOT updated — ${accounts.message}`
    return buildApiSuccess({ ...result, syncId, accounts }, `${opsPart}${accountsPart}`)
  } catch (err) {
    if (err instanceof B2cSyncError) return buildApiError(err.message, err.status)
    return buildApiError(err instanceof Error ? err.message : 'Update failed', 500)
  }
}
