import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { canEditRecon } from '@/lib/trans-recon/shared'
import {
  SupplierDuplicateError, SupplierInputError, registerSupplier, searchAccountsSuppliers, supplierCountriesFor,
} from '@/lib/accounts-suppliers-db'
import { lastSupplierFor } from '@/lib/mc-supplier'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Every internal desk that reads the MC Report or a Trans-Reconsultation sheet. */
const READ_ROLES = ['TE_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** Whoever can set a supplier on a movement or a sheet line can register a missing one. */
const canRegister = (role: string) => hasPermission(role as UserRole, 'agenda:edit') || canEditRecon(role)

/** `country` is an OPS country (MALAYSIA, SINGAPORE_MALAYSIA…), ISO-2 codes ("SG,MY"), or ALL. */
function countriesParam(raw: string | null): string[] {
  const v = String(raw ?? '').trim().toUpperCase()
  if (!v || v === 'ALL') return []
  const fromOps = supplierCountriesFor(v)
  if (fromOps.length) return fromOps
  return v.split(',').map(c => c.trim()).filter(c => /^[A-Z]{2}$/.test(c))
}

/**
 * Search the Accounts supplier registry (Suppliers Manage).
 * `?q=&country=&hint=` — `hint` is the movement's driver / vendor: its close
 * name matches come back as `suggested`, and the supplier that driver was last
 * paid through on the MC Report as `lastUsed`.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!READ_ROLES.includes(String(session.user.role))) return buildApiError('Forbidden', 403)

  const sp = req.nextUrl.searchParams
  const hint = sp.get('hint')
  try {
    const [found, lastUsed] = await Promise.all([
      searchAccountsSuppliers({
        q: sp.get('q'), countries: countriesParam(sp.get('country')), hint,
        limit: Number(sp.get('limit')) || undefined,
      }),
      lastSupplierFor(hint),
    ])
    return buildApiSuccess({ available: true, ...found, lastUsed, canRegister: canRegister(String(session.user.role)) })
  } catch (err) {
    console.error('[accounts-suppliers] search failed:', err)
    return buildApiSuccess({
      available: false, message: 'Could not reach the Accounts supplier list — try again in a moment.',
      results: [], suggested: [], total: 0, lastUsed: null, canRegister: false,
    })
  }
}

/**
 * Register a supplier in Suppliers Manage (supplier_bank_details) when the one
 * a movement is paid to is not there yet. Name, type, country and contact only
 * — Accounts adds the bank details. A near-duplicate name answers 409 with the
 * candidates; `force: true` registers anyway.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canRegister(String(session.user.role))) return buildApiError('Your role cannot register suppliers', 403)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Nothing to register')
  try {
    const out = await registerSupplier({
      name: String(body.name ?? ''),
      country: String(body.country ?? ''),
      businessType: body.businessType as string | null,
      phone: body.phone as string | null,
      address: body.address as string | null,
      uen: body.uen as string | null,
    }, { force: body.force === true })
    console.info(`[accounts-suppliers] ${out.existed ? 'matched existing' : 'registered'} "${out.supplier.name}" (#${out.supplier.id}) by ${session.user.name ?? session.user.email}`)
    return buildApiSuccess(out, out.existed ? 'Already registered — selected it' : 'Supplier registered in Accounts')
  } catch (err) {
    if (err instanceof SupplierDuplicateError) {
      return Response.json({ success: false, error: err.message, data: { duplicates: err.candidates } }, { status: 409 })
    }
    if (err instanceof SupplierInputError) return buildApiError(err.message, 400)
    console.error('[accounts-suppliers] register failed:', err)
    return buildApiError('Could not register the supplier in Accounts — try again.', 502)
  }
}
