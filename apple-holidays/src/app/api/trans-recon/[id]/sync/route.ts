import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet, syncSheet } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Refresh from the MC Report — new movements in, typed fields kept. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('edit')
  if (s instanceof Response) return s
  try {
    await loadSheet(params.id, s.allowed) // scope check
    const result = await syncSheet(params.id, s.actor)
    return buildApiSuccess({ result, ...(await loadSheet(params.id, s.allowed)) })
  } catch (err) {
    return reconFailure(err, 'sync')
  }
}
