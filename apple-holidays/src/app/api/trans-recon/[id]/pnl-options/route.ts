import { NextRequest } from 'next/server'
import { buildApiSuccess, buildApiError } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet, pnlOptions } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'

/** A booking's P&L lines with their values, for the line's P&L picker. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('view')
  if (s instanceof Response) return s
  const ref = req.nextUrl.searchParams.get('bookingRef')?.trim()
  if (!ref) return buildApiError('Which booking?')
  try {
    await loadSheet(params.id, s.allowed) // scope check
    return buildApiSuccess(await pnlOptions(ref))
  } catch (err) {
    return reconFailure(err, 'pnl-options')
  }
}
