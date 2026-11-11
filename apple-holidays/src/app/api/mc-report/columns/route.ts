/**
 * The MC Report's per-user column layout.
 *
 *   GET — the set of columns this user has switched off.
 *   PUT — replace that set with the one in the body.
 *
 * A column layout is a preference, not a record: it holds no money and hiding
 * a column does not hide the data, so the only gate is a signed-in session —
 * the same gate the report itself runs on. Stored as one JSON row per user in
 * `system_settings` (the same trade `sl_settlement_views` made): it follows
 * the person between the office desktop and a phone at no schema risk on a
 * production database where adding a table is a deliberate, hand-run step.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const keyFor = (userId: string) => `mc_report_cols:${userId}`

/** Keys only, deduplicated, bounded — a retired column key is simply ignored on read. */
function sanitise(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out = new Set<string>()
  for (const k of v) {
    if (typeof k === 'string' && k.length > 0 && k.length <= 40 && out.size < 64) out.add(k)
  }
  return Array.from(out)
}

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  const userId = session.user.id
  if (!userId) return { error: buildApiError('This session carries no user', 401) }
  return { userId }
}

export async function GET() {
  const g = await guard()
  if (g.error) return g.error
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: keyFor(g.userId!) } })
    return buildApiSuccess({ hidden: row?.value ? sanitise(JSON.parse(row.value)) : [] })
  } catch (err) {
    // A row that will not parse costs the user their layout, never the report.
    console.error('[mc-report-columns] read', err)
    return buildApiSuccess({ hidden: [] })
  }
}

export async function PUT(req: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body', 400)
  }

  const hidden = sanitise((body as { hidden?: unknown })?.hidden)
  const value = JSON.stringify(hidden)
  try {
    await prisma.systemSetting.upsert({
      where:  { key: keyFor(g.userId!) },
      update: { value },
      create: { key: keyFor(g.userId!), value },
    })
    return buildApiSuccess({ hidden })
  } catch (err) {
    console.error('[mc-report-columns] write', err)
    return buildApiError('Could not save the column layout', 500)
  }
}
