import { NextRequest } from 'next/server'
import { buildApiSuccess, buildApiError } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { assertCountry, createSheet, isMissingTable, listSheets } from '@/lib/trans-recon/server'
import { computeSheet } from '@/lib/trans-recon/shared'

export const dynamic = 'force-dynamic'

/** The month board: every sheet of a month (or year) the user may see, with its totals. */
export async function GET(req: NextRequest) {
  const s = await reconSession('view')
  if (s instanceof Response) return s
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getUTCFullYear()
  const month = Number(req.nextUrl.searchParams.get('month')) || null
  try {
    const rows = await listSheets(year, month, s.allowed)
    return buildApiSuccess({
      installed: true, allowed: s.allowed, canEdit: s.canEdit,
      sheets: rows.map(r => ({ sheet: r.sheet, totals: computeSheet(r.lines, r.sheet.currency, r.sheet.fxRates).totals })),
    })
  } catch (err) {
    // 200 rather than 503: the page shows the set-up notice instead of an error.
    if (isMissingTable(err)) return buildApiSuccess({ installed: false, allowed: s.allowed, canEdit: s.canEdit, sheets: [] })
    return reconFailure(err, 'list')
  }
}

/** Generate a country's half-month sheet from the MC Report (or open the one that exists). */
export async function POST(req: NextRequest) {
  const s = await reconSession('edit')
  if (s instanceof Response) return s
  const body = await req.json().catch(() => ({})) as { country?: string; year?: number; month?: number; half?: number }
  if (body.half !== 1 && body.half !== 2) return buildApiError('Pick the first or second half of the month')
  try {
    const country = assertCountry(String(body.country ?? ''), s.allowed)
    const out = await createSheet(country, Number(body.year), Number(body.month), body.half, s.actor)
    return buildApiSuccess(out, out.created ? 201 : 200)
  } catch (err) {
    return reconFailure(err, 'create')
  }
}
