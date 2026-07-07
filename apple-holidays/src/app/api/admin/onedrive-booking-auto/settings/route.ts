import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAutoCreateSettings, saveAutoCreateSettings } from '@/lib/auto-booking-create'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const settings = await getAutoCreateSettings()
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  await saveAutoCreateSettings({
    enabled:   Boolean(body.enabled),
    daysAhead: Math.max(1, Math.min(90, Number(body.daysAhead) || 10)),
    hour:      Math.max(0, Math.min(23, Number(body.hour) ?? 6)),
    minute:    Math.max(0, Math.min(59, Number(body.minute) ?? 0)),
  })
  return NextResponse.json({ ok: true })
}
