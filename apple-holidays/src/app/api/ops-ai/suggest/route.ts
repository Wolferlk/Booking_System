import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { suggestCommands } from '@/lib/ops-ai/brain'
import { bookingRefFromPath, loadBookingSnapshot, type OpsActor } from '@/lib/ops-ai/context'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Type-ahead for the command bar. Fires on every pause in typing, so it stays on
 * gpt-4o-mini and is strictly advisory — a suggestion is just text that gets
 * submitted as a normal turn if clicked. Nothing here can mutate anything.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const body    = await req.json().catch(() => null)
  const partial = typeof body?.partial === 'string' ? body.partial.trim() : ''
  const pathname = typeof body?.pathname === 'string' ? body.pathname : undefined

  const actor: OpsActor = {
    userId:    session.user.id,
    name:      session.user.name ?? 'Operator',
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const bookingRef = bookingRefFromPath(pathname)
  const snapshot   = bookingRef ? await loadBookingSnapshot(bookingRef, actor) : null

  // Empty input gets deterministic, zero-cost starters tuned to the page.
  if (partial.length < 2) {
    return buildApiSuccess({ suggestions: starters(snapshot?.bookingRef ?? null, pathname), source: 'static' })
  }

  if (!process.env.OPENAI_API_KEY) return buildApiSuccess({ suggestions: [], source: 'disabled' })

  try {
    const suggestions = await suggestCommands({ partial, actor, snapshot, pathname })
    return buildApiSuccess({ suggestions, source: 'model' })
  } catch (err) {
    console.error('[OPS_AI] suggest failed:', err instanceof Error ? err.message : err)
    return buildApiSuccess({ suggestions: [], source: 'error' })
  }
}

function starters(bookingRef: string | null, pathname?: string): string[] {
  if (bookingRef) {
    return [
      `Change the agent name on ${bookingRef}`,
      `Add a full-day sightseeing tour to day 3 of ${bookingRef}`,
      `Summarise ${bookingRef} — dates, pax and agenda gaps`,
      `Set a reminder to reconfirm ${bookingRef} tomorrow morning`,
    ]
  }
  if (pathname?.startsWith('/dashboard/ground')) {
    return [
      'Show bookings arriving today',
      'Which bookings this week have no driver assigned?',
      'Open the driver allocation board',
      'Find bookings arriving on 1 July',
    ]
  }
  if (pathname?.startsWith('/dashboard/accounts')) {
    return [
      'Open P&L management',
      'Show bookings awaiting payment confirmation',
      'Find bookings arriving next month',
      'Open the cancellations queue',
    ]
  }
  return [
    'Find bookings arriving on 1 July',
    'Show me bookings in change-requested status',
    'Open booking IS23492',
    'Show all arrivals this week, soonest first',
  ]
}
