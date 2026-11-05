import { NextRequest } from 'next/server'
import { buildApiSuccess, buildApiError } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet, updateSheet } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('view')
  if (s instanceof Response) return s
  try {
    return buildApiSuccess({ ...(await loadSheet(params.id, s.allowed)), canEdit: s.canEdit })
  } catch (err) {
    return reconFailure(err, 'load')
  }
}

/** Currency, FX rates, note, and Submit to Accounts / Recall. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('edit')
  if (s instanceof Response) return s
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return buildApiError('Nothing to save')
  try {
    await loadSheet(params.id, s.allowed) // scope check
    const action = body.action === 'SUBMIT' || body.action === 'RECALL' ? body.action : undefined
    await updateSheet(params.id, {
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
      ...(body.fxRates && typeof body.fxRates === 'object' ? { fxRates: body.fxRates as Record<string, unknown> } : {}),
      ...('note' in body ? { note: body.note == null ? null : String(body.note) } : {}),
      ...(action ? { action } : {}),
    }, s.actor)
    return buildApiSuccess(await loadSheet(params.id, s.allowed))
  } catch (err) {
    return reconFailure(err, 'update')
  }
}
