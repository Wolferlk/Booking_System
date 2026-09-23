import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getCatalogMeta, getSheetConfig, listManualProducts, pushPendingManual, saveSheetConfig, syncCatalog,
} from '@/lib/vn-includes/catalog'
import { isMissingTable } from '@/lib/vn-includes/includes'

export const dynamic = 'force-dynamic'
// A first sync reads ~1,600 rows from SharePoint and writes them in batches.
export const maxDuration = 60

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function admin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!ADMIN_ROLES.includes(session.user.role)) return { error: buildApiError('Forbidden', 403) }
  return { session }
}

async function snapshot() {
  const [config, meta] = await Promise.all([getSheetConfig(), getCatalogMeta()])
  let installed = true
  let counts = { active: 0, manual: 0, pending: 0 }
  let manual: Awaited<ReturnType<typeof listManualProducts>> = []
  try {
    const [active, manualCount, pending, list] = await Promise.all([
      prisma.vnIncludeProduct.count({ where: { isActive: true } }),
      prisma.vnIncludeProduct.count({ where: { source: 'MANUAL' } }),
      prisma.vnIncludeProduct.count({ where: { source: 'MANUAL', syncStatus: { in: ['PENDING', 'FAILED'] } } }),
      listManualProducts(30),
    ])
    counts = { active, manual: manualCount, pending }
    manual = list
  } catch (err) {
    if (!isMissingTable(err)) throw err
    installed = false
  }
  return { config, meta, installed, counts, manual }
}

export async function GET() {
  const { error } = await admin()
  if (error) return error
  return buildApiSuccess(await snapshot())
}

/** Change the sheet link / tab names. */
export async function PUT(req: NextRequest) {
  const { error } = await admin()
  if (error) return error
  const body = await req.json().catch(() => ({})) as { sheetUrl?: string; sheetTab?: string; manualTab?: string }
  try {
    await saveSheetConfig(body)
    return buildApiSuccess(await snapshot(), 'Product sheet settings saved')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}

/** { action: 'sync' } re-reads the sheet; { action: 'push' } retries manual products. */
export async function POST(req: NextRequest) {
  const { error } = await admin()
  if (error) return error
  const { action } = await req.json().catch(() => ({})) as { action?: string }
  try {
    if (action === 'push') {
      const res = await pushPendingManual()
      if (res.error) return buildApiError(`Could not write to the sheet: ${res.error}`, 502)
      return buildApiSuccess(await snapshot(), res.pushed ? `${res.pushed} product(s) written to the sheet` : 'Nothing waiting')
    }
    const meta = await syncCatalog()
    return buildApiSuccess(
      await snapshot(),
      `Synced ${meta.rows.toLocaleString()} products — ${meta.added} new, ${meta.updated} changed, ${meta.retired} no longer on the sheet`,
    )
  } catch (err) {
    if (isMissingTable(err)) {
      return buildApiError('The product tables do not exist yet — run prisma/sql/apply-vn-agenda-includes.sh', 503)
    }
    return buildApiError(err instanceof Error ? err.message : 'Sync failed', 502)
  }
}
