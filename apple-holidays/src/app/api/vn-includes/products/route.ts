import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { addManualProduct, searchProducts, suggestProducts } from '@/lib/vn-includes/catalog'
import { isMissingTable } from '@/lib/vn-includes/includes'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const NOT_INSTALLED = 'Vietnam includes are not set up on this database yet — run prisma/sql/apply-vn-agenda-includes.sh'

/**
 * GET ?q=halong&code=Ticket   — picker search
 * GET ?suggest=<activity>     — products that look like the parts of a movement
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:read')) return buildApiError('Forbidden', 403)

  const sp = req.nextUrl.searchParams
  try {
    const suggest = sp.get('suggest')
    if (suggest !== null) {
      return buildApiSuccess(await suggestProducts(suggest, { limit: Number(sp.get('limit')) || 8 }))
    }
    return buildApiSuccess(await searchProducts(sp.get('q') ?? '', {
      code:  sp.get('code') ?? undefined,
      limit: Number(sp.get('limit')) || 25,
    }))
  } catch (err) {
    if (isMissingTable(err)) return buildApiError(NOT_INSTALLED, 503)
    return buildApiError(err instanceof Error ? err.message : 'Search failed', 500)
  }
}

/** Add a product the sheet does not carry. It is also appended to the sheet's Manual Products tab. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as {
    code?: string; name?: string; priceVnd?: number | string | null; bookingRef?: string | null
  }
  const rawPrice = body.priceVnd === '' || body.priceVnd === null || body.priceVnd === undefined
    ? null : Number(String(body.priceVnd).replace(/[,\s₫]/g, ''))
  if (rawPrice !== null && (!Number.isFinite(rawPrice) || rawPrice < 0)) {
    return buildApiError('The price must be a number in VND')
  }

  try {
    const { product, existing } = await addManualProduct({
      code: body.code ?? '',
      name: body.name ?? '',
      priceVnd: rawPrice,
      bookingRef: body.bookingRef ?? null,
      userId: session.user.id,
      userName: session.user.name,
    })
    const message = existing
      ? 'That product is already in the list — selected it'
      : product.syncStatus === 'SYNCED'
        ? 'Product added and written to the sheet'
        : 'Product added — the sheet could not be updated yet, it will be retried on the next sync'
    return buildApiSuccess({ product, existing }, message)
  } catch (err) {
    if (isMissingTable(err)) return buildApiError(NOT_INSTALLED, 503)
    return buildApiError(err instanceof Error ? err.message : 'Could not add the product', 400)
  }
}
