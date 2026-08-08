/**
 * Guides & Tour Vendors — shared route handlers.
 *
 * `/api/ground/guides` and `/api/ground/tour-vendors` are the same endpoint over
 * two tables, so both mount the factories below. Auth, RBAC and country scoping
 * follow the same order the rest of `src/app/api` uses.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'
import { logActivity, ACTION } from '@/lib/activity'
import {
  PARTNER_CONFIG, parseCountryList, validatePartnerForm,
  type PartnerKind, type PartnerFormState,
} from '@/lib/partner-directory'
import {
  canWritePartners, findPartner, listPartners, partnerDelegate,
  toPartnerData, toPartnerRecord,
} from '@/lib/partner-directory-server'
import type { OperationCountry } from '@prisma/client'

const ACTIONS: Record<PartnerKind, { created: string; updated: string; deleted: string; entity: string }> = {
  guide: {
    created: ACTION.GUIDE_CREATED, updated: ACTION.GUIDE_UPDATED,
    deleted: ACTION.GUIDE_DELETED, entity: 'Guide',
  },
  tourVendor: {
    created: ACTION.TOUR_VENDOR_CREATED, updated: ACTION.TOUR_VENDOR_UPDATED,
    deleted: ACTION.TOUR_VENDOR_DELETED, entity: 'TourVendor',
  },
}

/**
 * Which country a new/edited record belongs to. Staff scoped to one country can
 * never file a partner under another one, however the request is shaped —
 * matching how `/api/ground/drivers` handles the same decision.
 */
function resolveCountry(
  sessionCountry: OperationCountry | undefined,
  requested: unknown,
): OperationCountry | null {
  const isAllCountry = !sessionCountry || sessionCountry === 'ALL'
  if (!isAllCountry) return sessionCountry
  const value = typeof requested === 'string' ? requested.trim() : ''
  return (value as OperationCountry) || null
}

/** Body → the form shape `validatePartnerForm` expects, with strings guaranteed. */
function asFormState(body: Record<string, unknown>): PartnerFormState {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    name: s(body.name), country: s(body.country), phone: s(body.phone),
    whatsappPhone: s(body.whatsappPhone), email: s(body.email), photoUrl: s(body.photoUrl),
    nicNo: s(body.nicNo), speciality: s(body.speciality),
    additionalInfo: s(body.additionalInfo), specialNote: s(body.specialNote),
    bankName: s(body.bankName), bankAccountNo: s(body.bankAccountNo),
    bankHolder: s(body.bankHolder), bankBranch: s(body.bankBranch),
    bankCode: s(body.bankCode), isActive: body.isActive !== false,
  }
}

// ── /api/ground/{kind} ───────────────────────────────────────────────────────

export function createPartnerCollectionHandlers(kind: PartnerKind) {
  async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)

    const userCountry = session.user.country as OperationCountry | undefined
    const override = req.nextUrl.searchParams.get('country') as OperationCountry | null
    const effectiveCountry = (!userCountry || userCountry === 'ALL') ? override : userCountry

    try {
      const records = await listPartners(kind, {
        country: effectiveCountry,
        activeOnly: req.nextUrl.searchParams.get('activeOnly') === '1',
      })
      return buildApiSuccess(records)
    } catch (err) {
      console.error(`[${kind} GET] Prisma error:`, err)
      return buildApiError(`Failed to load ${PARTNER_CONFIG[kind].labelPlural.toLowerCase()}`, 500)
    }
  }

  async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)
    if (!canWritePartners(session.user.role)) return buildApiError('Forbidden', 403)

    const body = await req.json() as Record<string, unknown>
    const errors = validatePartnerForm(asFormState(body))
    const firstError = Object.values(errors)[0]
    if (firstError) return buildApiError(firstError)

    const country = resolveCountry(session.user.country as OperationCountry | undefined, body.country)

    try {
      const created = await (partnerDelegate(kind) as {
        create: (args: unknown) => Promise<Record<string, unknown>>
      }).create({
        data: { ...toPartnerData(kind, body), country, source: 'STAFF' },
      })

      await logActivity({
        userId: session.user.id,
        action: ACTIONS[kind].created,
        entityType: ACTIONS[kind].entity,
        entityId: String(created.id),
        details: { name: created.name, country },
      })

      return buildApiSuccess(toPartnerRecord(kind, created), `${PARTNER_CONFIG[kind].label} added`)
    } catch (error) {
      return handlePrismaApiError(
        error,
        `Failed to add ${PARTNER_CONFIG[kind].label.toLowerCase()}`,
        `A ${PARTNER_CONFIG[kind].label.toLowerCase()} with these details already exists`,
      )
    }
  }

  return { GET, POST }
}

// ── /api/ground/{kind}/[id] ──────────────────────────────────────────────────

export function createPartnerItemHandlers(kind: PartnerKind) {
  const label = PARTNER_CONFIG[kind].label

  async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)

    const record = await findPartner(kind, params.id)
    if (!record) return buildApiError(`${label} not found`, 404)
    return buildApiSuccess(record)
  }

  async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)
    if (!canWritePartners(session.user.role)) return buildApiError('Forbidden', 403)

    const existing = await findPartner(kind, params.id)
    if (!existing) return buildApiError(`${label} not found`, 404)

    const body = await req.json() as Record<string, unknown>
    // Validate the record as it will be after the merge, so a partial edit is
    // judged on the final state rather than on the handful of keys it sent.
    const errors = validatePartnerForm(asFormState({ ...existing, ...body }))
    const firstError = Object.values(errors)[0]
    if (firstError) return buildApiError(firstError)

    const data = toPartnerData(kind, body, { partial: true }) as Record<string, unknown>
    if ('country' in body) {
      data.country = resolveCountry(session.user.country as OperationCountry | undefined, body.country)
    }

    try {
      const updated = await (partnerDelegate(kind) as {
        update: (args: unknown) => Promise<Record<string, unknown>>
      }).update({ where: { id: params.id }, data })

      await logActivity({
        userId: session.user.id,
        action: ACTIONS[kind].updated,
        entityType: ACTIONS[kind].entity,
        entityId: params.id,
        details: { name: updated.name },
      })

      return buildApiSuccess(toPartnerRecord(kind, updated), `${label} updated`)
    } catch (error) {
      return handlePrismaApiError(error, `Failed to update ${label.toLowerCase()}`, `Those details belong to another ${label.toLowerCase()}`)
    }
  }

  async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)
    if (!canWritePartners(session.user.role)) return buildApiError('Forbidden', 403)

    const existing = await findPartner(kind, params.id)
    if (!existing) return buildApiError(`${label} not found`, 404)

    try {
      // Movements already run with this partner keep the name and phone that
      // were sent out — only the link is cleared, so deleting from the directory
      // never rewrites the history of a tour that already happened.
      const idField = kind === 'guide' ? 'guideId' : 'tourVendorId'
      await prisma.$transaction(async tx => {
        await tx.assignment.updateMany({
          where: { [idField]: params.id },
          data:  { [idField]: null },
        })
        // Branching gives TypeScript one concrete delegate per arm; the union of
        // the two `delete` signatures is not callable on its own.
        if (kind === 'guide') await tx.guide.delete({ where: { id: params.id } })
        else await tx.tourVendor.delete({ where: { id: params.id } })
      })
    } catch (error) {
      return handlePrismaApiError(error, `Failed to delete ${label.toLowerCase()}`, `This ${label.toLowerCase()} is still in use`)
    }

    await logActivity({
      userId: session.user.id,
      action: ACTIONS[kind].deleted,
      entityType: ACTIONS[kind].entity,
      entityId: params.id,
      details: { name: existing.name },
    })

    return buildApiSuccess(null, `${label} deleted`)
  }

  return { GET, PUT, DELETE }
}

// ── /api/public/{kind}-register ──────────────────────────────────────────────

/**
 * Public self-registration. Unauthenticated by design (the link is shared with
 * the guide / vendor over WhatsApp), so it accepts only the whitelisted profile
 * fields and always lands the record inactive for Ground to review — the same
 * contract `/api/public/driver-register` follows.
 */
export function createPartnerRegisterHandler(kind: PartnerKind) {
  const label = PARTNER_CONFIG[kind].label

  return async function POST(req: NextRequest) {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      return buildApiError('Invalid request body')
    }

    const errors = validatePartnerForm(asFormState(body), { requireCountry: true })
    const firstError = Object.values(errors)[0]
    if (firstError) return buildApiError(firstError)

    // A self-registration may only name a country the operations team has
    // switched this partner kind on for — the link cannot be edited into
    // registering a guide against a country that does not use guides.
    const enabled = await prisma.systemSetting.findUnique({
      where: { key: PARTNER_CONFIG[kind].settingKey },
    })
    const allowed = parseCountryList(enabled?.value)
    const country = String(body.country ?? '').toUpperCase()
    if (!allowed.includes(country)) {
      return buildApiError(`${label} registration is not open for this country`, 400)
    }

    try {
      const created = await (partnerDelegate(kind) as {
        create: (args: unknown) => Promise<{ id: string }>
      }).create({
        data: {
          ...toPartnerData(kind, body),
          country: country as OperationCountry,
          isActive: false,        // pending review by Ground
          source: 'SELF_REGISTERED',
        },
      })
      return buildApiSuccess({ id: created.id }, 'Registration submitted successfully')
    } catch (error) {
      return handlePrismaApiError(
        error,
        `Failed to register ${label.toLowerCase()}`,
        `A ${label.toLowerCase()} with these details may already be registered`,
      )
    }
  }
}
