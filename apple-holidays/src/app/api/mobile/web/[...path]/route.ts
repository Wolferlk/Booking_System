/**
 * /api/mobile/web/<path>  →  /api/<path>, run as the signed-in company user.
 * See lib/mobile/bridge.ts for the allow-list, the blocked actions and the audit.
 */
import { NextRequest } from 'next/server'
import { requireStaff } from '@/lib/mobile/auth'
import { MobileError, clientIp, mobileRoute } from '@/lib/mobile/http'
import { auditBridgeWrite, bridgeOrigin, checkBridgePath, sessionCookieFor } from '@/lib/mobile/bridge'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Ctx = { params: { path: string[] } }

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control']

async function forward(req: NextRequest, { params }: Ctx): Promise<Response> {
  const actor = await requireStaff(req)
  const method = req.method.toUpperCase()
  const path = params.path.map(encodeURIComponent).join('/')
  const blocked = checkBridgePath(method, decodeURIComponent(path))
  if (blocked) throw new MobileError(blocked, 403, 'blocked')

  const headers: Record<string, string> = { cookie: await sessionCookieFor(actor), accept: req.headers.get('accept') || '*/*' }
  const ct = req.headers.get('content-type')
  if (ct) headers['content-type'] = ct
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer()

  const origin = bridgeOrigin(req)
  const upstream = await fetch(`${origin}/api/${path}${req.nextUrl.search}`, {
    method, headers, body, redirect: 'manual', cache: 'no-store',
  })

  if (method !== 'GET' && method !== 'HEAD') {
    await auditBridgeWrite(actor, method, decodeURIComponent(path), upstream.status, clientIp(req))
  }

  const out = new Headers()
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  // Which deployment answered — lets the app (and us) confirm both halves of a screen read one database.
  out.set('x-aahaas-bridge', new URL(origin).host)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export const GET = mobileRoute<Ctx>('bridge', forward)
export const POST = mobileRoute<Ctx>('bridge', forward)
export const PUT = mobileRoute<Ctx>('bridge', forward)
export const PATCH = mobileRoute<Ctx>('bridge', forward)
export const DELETE = mobileRoute<Ctx>('bridge', forward)
