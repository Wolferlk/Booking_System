import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { buildDriverLogView, saveSnapshot } from '@/lib/driver-log-server'
import { clampPct, type DriverLogLine, type DriverLogSnapshot, type LineDetailMeta } from '@/lib/driver-log'

export const dynamic = 'force-dynamic'

// Roles that may view / edit the Driver Advance Sheet (operations + finance + admin).
const READ_ROLES  = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const WRITE_ROLES = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** GET — effective Driver Log view (saved snapshot merged with PNL + settings). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!READ_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const view = await buildDriverLogView(params.ref)
  if (!view) return buildApiError(`Booking ${params.ref} not found`, 404)

  return buildApiSuccess(view)
}

/** Keep only known, finite/string fields of an incoming detail meta object. */
function sanitizeMeta(raw: unknown): LineDetailMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const numKeys: (keyof LineDetailMeta)[] = [
    'km', 'rate', 'distance_days', 'nights', 'adult_count', 'child_count',
    'adult_rate', 'child_rate', 'adult_entrance', 'child_entrance', 'pax', 'day', 'transfer_amount',
  ]
  const strKeys: (keyof LineDetailMeta)[] = ['remarks', 'calculation_type', 'unit_type', 'package']
  const meta: LineDetailMeta = {}
  for (const k of numKeys) {
    const n = Number(o[k])
    if (o[k] != null && o[k] !== '' && Number.isFinite(n)) (meta as Record<string, unknown>)[k] = n
  }
  for (const k of strKeys) {
    if (typeof o[k] === 'string' && (o[k] as string).trim()) (meta as Record<string, unknown>)[k] = (o[k] as string).slice(0, 300)
  }
  return Object.keys(meta).length ? meta : undefined
}

/** Coerce an incoming line payload into a safe DriverLogLine. */
function sanitizeLine(raw: unknown, i: number): DriverLogLine | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const amount = Number(o.amount)
  return {
    id:       String(o.id ?? `line-${i}`),
    category: (typeof o.category === 'string' ? o.category : 'OTHER') as DriverLogLine['category'],
    label:    String(o.label ?? '').slice(0, 200),
    detail:   String(o.detail ?? '').slice(0, 500),
    amount:   Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    source:   o.source === 'pnl' ? 'pnl' : 'manual',
    meta:     sanitizeMeta(o.meta),
  }
}

/** PUT — save an edited Driver Log snapshot for this booking. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!WRITE_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const view = await buildDriverLogView(params.ref)
  if (!view) return buildApiError(`Booking ${params.ref} not found`, 404)

  const body = await req.json() as {
    tourPct?: number
    fuelPct?: number
    currency?: string
    driverPhone?: string | null
    lines?: unknown[]
    notes?: string
    autoSend?: boolean
  }

  const lines = Array.isArray(body.lines)
    ? body.lines.map(sanitizeLine).filter((l): l is DriverLogLine => l !== null)
    : view.computation.lines

  const snapshot: DriverLogSnapshot = {
    currency:    (body.currency || view.computation.currency || 'USD').slice(0, 8),
    tourPct:     clampPct(Number(body.tourPct ?? view.computation.tourPct)),
    fuelPct:     clampPct(Number(body.fuelPct ?? view.computation.fuelPct)),
    driverPhone: body.driverPhone === undefined ? view.driverPhone : (body.driverPhone || null),
    lines,
    notes:       String(body.notes ?? view.notes ?? '').slice(0, 2000),
    autoSend:    body.autoSend === undefined ? view.autoSend : !!body.autoSend,
    waSentAt:    view.waSentAt,
    updatedBy:   session.user.email ?? session.user.name ?? null,
    updatedAt:   new Date().toISOString(),
  }

  await saveSnapshot(params.ref, snapshot)

  const updated = await buildDriverLogView(params.ref)
  return buildApiSuccess(updated, 'Driver Log saved')
}
