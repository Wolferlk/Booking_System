/**
 * GET /digest/:id/file/:fileId?t= — download one ticket from a pack. Public by
 * design (the agent has no login); the run's token is the key, and the rules in
 * readPackFile are checked on every request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isPackExpired, readPackFile } from '@/lib/agent-digest/tickets-server'
import { loadRun } from '../../run-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const fail = (status: number, text: string) =>
  new NextResponse(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } })

export async function GET(req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  const run = await loadRun(params.id, req.nextUrl.searchParams.get('t'))
  if (!run || run.payload.kind !== 'TICKETS') return fail(404, 'This link is not valid.')
  if (isPackExpired(run.payload, run.config)) return fail(410, 'This link has expired. Please ask AppleHolidays Operations for a new one.')
  const file = await readPackFile(run.payload, run.config, params.fileId).catch(err => {
    console.error('[AgentDigest] ticket download failed:', err instanceof Error ? err.message : err)
    return null
  })
  if (!file) return fail(404, 'This ticket is not available right now. Please ask AppleHolidays Operations.')
  return new NextResponse(file.data as unknown as BodyInit, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}
