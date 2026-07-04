import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const TE_BASE = (
  process.env.TE_BASE_URL ??
  'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')

const TE_SECRET = process.env.TE_WEBHOOK_SECRET ?? ''

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
    const res = await fetch(url, init)
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
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}

export async function GET(req: NextRequest)    { return proxy(req, 'GET') }
export async function POST(req: NextRequest)   { return proxy(req, 'POST') }
export async function PATCH(req: NextRequest)  { return proxy(req, 'PATCH') }
export async function DELETE(req: NextRequest) { return proxy(req, 'DELETE') }
