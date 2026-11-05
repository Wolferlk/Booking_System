import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet, suggestFx } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'

/** Today's rate from a P&L currency into this sheet's currency — a suggestion; the desk saves it. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('view')
  if (s instanceof Response) return s
  const from = String(req.nextUrl.searchParams.get('from') ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(from)) return buildApiError('Which currency?')
  try {
    const { sheet } = await loadSheet(params.id, s.allowed)
    return buildApiSuccess({ from, to: sheet.currency, suggestion: await suggestFx(from, sheet.currency) })
  } catch (err) {
    return reconFailure(err, 'fx')
  }
}
