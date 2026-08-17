import type { NextRequest } from 'next/server'
import { currentIdentity, guard, unauthorized } from '@/lib/chat/session'
import { getSettings, saveSettings } from '@/lib/chat/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await currentIdentity()
  if (!me) return unauthorized()
  return guard(async () => ({ settings: await getSettings(me) }))
}

export async function PUT(req: NextRequest) {
  const me = await currentIdentity()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => ({}))
  return guard(async () => { await saveSettings(me, body); return { ok: true } })
}
