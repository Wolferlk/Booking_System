import { NextRequest } from 'next/server'
import { buildApiSuccess, buildApiError } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet, saveLines, type LineInput } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'

/** One Save: edited rows, new rows, rows removed and rows restored. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('edit')
  if (s instanceof Response) return s
  const body = await req.json().catch(() => null) as { lines?: LineInput[]; remove?: string[]; restore?: string[] } | null
  if (!body) return buildApiError('Nothing to save')
  if ((body.lines?.length ?? 0) > 1000) return buildApiError('Too many lines in one save')
  try {
    await loadSheet(params.id, s.allowed) // scope check
    const out = await saveLines(params.id, {
      lines: Array.isArray(body.lines) ? body.lines : [],
      remove: Array.isArray(body.remove) ? body.remove.map(String) : [],
      restore: Array.isArray(body.restore) ? body.restore.map(String) : [],
    }, s.actor)
    return buildApiSuccess({ ...out, ...(await loadSheet(params.id, s.allowed)) })
  } catch (err) {
    return reconFailure(err, 'save')
  }
}
