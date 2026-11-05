import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const TE_BASE = (
  process.env.TE_BASE_URL ??
  'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')

const TE_SECRET = process.env.TE_WEBHOOK_SECRET ?? ''

export const maxDuration = 60
/**
 * Give up on the call server before the hosting platform does, so the browser
 * gets a JSON error it can show instead of a gateway HTML page.
 */
const UPSTREAM_TIMEOUT_MS = 25_000

async function proxy(req: NextRequest, method: string): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const path = sp.get('path') ?? ''
  sp.delete('path')
  const qs = sp.toString()
  const url = `${TE_BASE}/${path}${qs ? `?${qs}` : ''}`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TE_SECRET) headers['x-te-secret'] = TE_SECRET

  const init: RequestInit = { method, headers }
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    try {
      const text = await req.text()
      init.body = text || ''
    } catch {
      init.body = ''
    }
  }

  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
    let data: unknown
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      data = await res.json()
    } else {
      const text = await res.text()
      data = { raw: text }
    }
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({
        success: false,
        error: `The call server did not answer within ${UPSTREAM_TIMEOUT_MS / 1000}s. ` +
          'A call may still go through — check the call history before trying again.',
      }, { status: 504 })
    }
    return NextResponse.json({ success: false, error: `Could not reach the call server: ${String(err)}` }, { status: 502 })
  }
}

export async function GET(req: NextRequest)    { return proxy(req, 'GET') }
export async function POST(req: NextRequest)   { return proxy(req, 'POST') }
export async function PATCH(req: NextRequest)  { return proxy(req, 'PATCH') }
export async function DELETE(req: NextRequest) { return proxy(req, 'DELETE') }
