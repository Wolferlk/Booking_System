/**
 * Import ledger — created bookings and unimportable quotations.
 *
 *   GET    → the whole ledger (also embedded in the watch status response).
 *   DELETE → dismiss one quotation's failure: `?quotation_no=492574`.
 *
 * Dismissing stops the quotation being re-announced; it does not stop the
 * importer retrying it, and it does not delete the record of what went wrong.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { getImportLedger, dismissFailure } from '@/lib/as-import-ledger'

export const dynamic = 'force-dynamic'

function guardRole(role: UserRole): boolean {
  return role !== 'CLIENT' && hasPermission(role, 'booking:create')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    return buildApiSuccess(await getImportLedger())
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load the import ledger', 500)
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!guardRole(session.user.role)) return buildApiError('Forbidden', 403)

  const quotationNo = (new URL(req.url).searchParams.get('quotation_no') || '').trim()
  if (!quotationNo) return buildApiError('quotation_no is required', 400)

  const by = session.user.name || session.user.email || 'Unknown'
  const changed = await dismissFailure(quotationNo, by)

  return buildApiSuccess(
    { quotationNo, dismissed: changed },
    changed ? `Quotation ${quotationNo} dismissed` : `Quotation ${quotationNo} was already dismissed`,
  )
}
