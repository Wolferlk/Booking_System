import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'BT_USER'].includes(role)) return buildApiError('Forbidden', 403)

  const agents = await prisma.creditAgent.findMany({
    orderBy: { name: 'asc' },
    include: {
      payments: {
        select: {
          id: true,
          dueDate: true,
          amountDue: true,
          amountPaid: true,
          status: true,
          periodStart: true,
          periodEnd: true,
        },
        orderBy: { dueDate: 'desc' },
      },
    },
  })

  // Attach computed stats to each agent
  const enriched = agents.map(agent => {
    const cycles = agent.payments
    const totalDue     = cycles.reduce((s, c) => s + Number(c.amountDue), 0)
    const totalPaid    = cycles.reduce((s, c) => s + Number(c.amountPaid), 0)
    const outstanding  = cycles.filter(c => c.status !== 'PAID').reduce((s, c) => s + Number(c.amountDue) - Number(c.amountPaid), 0)
    const overdue      = cycles.filter(c => c.status === 'OVERDUE').reduce((s, c) => s + Number(c.amountDue) - Number(c.amountPaid), 0)
    const lastPayment  = cycles.find(c => c.status === 'PAID') ?? null
    const nextDue      = cycles.find(c => c.status !== 'PAID') ?? null

    return {
      ...agent,
      payments: undefined,   // drop raw cycles from list response
      stats: { totalDue, totalPaid, outstanding, overdue, cycleCount: cycles.length, lastPayment, nextDue },
    }
  })

  return buildApiSuccess(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, aliases, contactName, contactEmail, contactPhone, creditLimit, currency, notes } = body

  if (!name?.trim()) return buildApiError('Agent name is required')

  const existing = await prisma.creditAgent.findFirst({ where: { name: { equals: name.trim() } } })
  if (existing) return buildApiError('An agent with this name already exists')

  const agent = await prisma.creditAgent.create({
    data: {
      name: name.trim(),
      aliases: aliases?.length ? JSON.stringify(aliases) : null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      creditLimit: creditLimit ? Number(creditLimit) : null,
      currency: currency || 'USD',
      notes: notes || null,
    },
  })

  return buildApiSuccess(agent, 201)
}
