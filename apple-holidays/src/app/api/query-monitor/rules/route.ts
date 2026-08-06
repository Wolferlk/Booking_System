/** Query Monitor — sender domain → sales person / agent rules. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { listSenderRules } from '@/lib/query-monitor/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const rules = await listSenderRules()

  // Domains seen in real mail that no rule covers yet — the fastest way for the
  // team to notice a new agency and give it a proper label.
  const unmatched = await prisma.queryMonitorEntry.groupBy({
    by:      ['fromDomain'],
    where:   { salesPerson: 'Others' },
    _count:  { _all: true },
    orderBy: { _count: { fromDomain: 'desc' } },
    take:    25,
  })

  return buildApiSuccess({
    rules,
    unmatchedDomains: unmatched.map(u => ({ domain: u.fromDomain, count: u._count._all })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const body = await req.json() as {
    pattern?: string; matchType?: string; salesPerson?: string; agent?: string
    region?: string; destination?: string; priority?: number; notes?: string
  }

  const pattern     = (body.pattern ?? '').trim().toLowerCase().replace(/^@/, '')
  const matchType   = body.matchType === 'EMAIL' ? 'EMAIL' : 'DOMAIN'
  const salesPerson = (body.salesPerson ?? '').trim()
  const agent       = (body.agent ?? '').trim()

  if (!pattern)     return buildApiError('A domain or email address is required')
  if (!salesPerson) return buildApiError('Sales person label is required')
  if (!agent)       return buildApiError('Agent label is required')
  if (matchType === 'EMAIL' && !pattern.includes('@')) return buildApiError('An EMAIL rule needs a full address')
  if (matchType === 'DOMAIN' && pattern.includes('@')) return buildApiError('A DOMAIN rule must not contain "@"')

  const clash = await prisma.queryMonitorSenderRule.findUnique({ where: { pattern } })
  if (clash) return buildApiError(`A rule for "${pattern}" already exists`, 409)

  const rule = await prisma.queryMonitorSenderRule.create({
    data: {
      pattern, matchType, salesPerson, agent,
      region:      body.region?.trim() || null,
      destination: body.destination?.trim() || null,
      // Exact-address rules must outrank their own domain rule.
      priority:    body.priority ?? (matchType === 'EMAIL' ? 10 : 0),
      notes:       body.notes?.trim() || null,
    },
  })

  return buildApiSuccess({ rule }, 'Sender rule added')
}
