/**
 * GET  /api/reservations/contracts — contracts and their rate cards
 * POST /api/reservations/contracts — create one, with its season rate lines
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'

export async function GET(req: NextRequest) {
  const g = await guardReservation('contract:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const rows = await prisma.hotelContract.findMany({
    where: {
      ...(p.get('hotelProfileId') ? { hotelProfileId: p.get('hotelProfileId')! } : {}),
      ...(p.get('status') ? { status: p.get('status') as never } : {}),
      // "Live" means covering today, which is what the desk almost always wants.
      ...(p.get('live') === '1'
        ? { status: 'ACTIVE' as never, validFrom: { lte: new Date() }, validTo: { gte: new Date() } }
        : {}),
    },
    include: { rates: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ validFrom: 'desc' }],
    take: Math.min(Number(p.get('take') ?? 200), 500),
  })

  return buildApiSuccess({ rows, total: rows.length })
}

export async function POST(req: NextRequest) {
  const g = await guardReservation('contract:edit')
  if (!g.ok) return g.response

  const body = await req.json()
  if (!body.hotelProfileId || !body.validFrom || !body.validTo) {
    return buildApiError('hotelProfileId, validFrom and validTo are required', 422)
  }
  const validFrom = new Date(body.validFrom)
  const validTo = new Date(body.validTo)
  if (validTo <= validFrom) return buildApiError('validTo must be after validFrom', 422)

  const created = await prisma.hotelContract.create({
    data: {
      hotelProfileId: body.hotelProfileId,
      contractCode: body.contractCode ?? null,
      validFrom,
      validTo,
      currency: body.currency ?? 'USD',
      policyText: body.policyText ?? null,
      penaltyTiers: body.penaltyTiers ?? undefined,
      freeCancelDays: body.freeCancelDays ?? null,
      childPolicy: body.childPolicy ?? null,
      paymentTerms: body.paymentTerms ?? null,
      paymentDueDays: body.paymentDueDays ?? null,
      commissionPct: body.commissionPct ?? null,
      contractDocUrl: body.contractDocUrl ?? null,
      status: body.status ?? 'ACTIVE',
      notes: body.notes ?? null,
      createdBy: g.session.actor.email ?? null,
      rates: Array.isArray(body.rates) && body.rates.length
        ? {
            create: body.rates.map((r: Record<string, unknown>, i: number) => ({
              seasonName: (r.seasonName as string) ?? null,
              seasonFrom: r.seasonFrom ? new Date(r.seasonFrom as string) : null,
              seasonTo: r.seasonTo ? new Date(r.seasonTo as string) : null,
              roomType: String(r.roomType ?? 'Standard'),
              mealPlan: (r.mealPlan as never) ?? 'BB',
              singleRate: (r.singleRate as never) ?? null,
              doubleRate: (r.doubleRate as never) ?? null,
              tripleRate: (r.tripleRate as never) ?? null,
              extraBedRate: (r.extraBedRate as never) ?? null,
              cwbRate: (r.cwbRate as never) ?? null,
              cnbRate: (r.cnbRate as never) ?? null,
              minNights: (r.minNights as number) ?? null,
              sortOrder: i,
            })),
          }
        : undefined,
    },
    include: { rates: true },
  })

  return buildApiSuccess(created, 201)
}
