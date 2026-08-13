/**
 * GET  /api/portals   — the portals a ticket can be bought through
 * POST /api/portals   — add one (or bring back one that was turned off)
 *
 * The list is shared with the Accounts system, which reads the same rows when
 * it decides who to pay for a ticket. See src/lib/portals.ts for why it lives
 * in one table rather than two.
 *
 * Query parameters on GET:
 *   country    an OperationCountry (VIETNAM, SINGAPORE…) — normally the
 *              booking's, so a Singapore file offers Singapore's portals
 *   bookingRef read the country off the booking instead of being told it
 *   category   a ticket category, to drop portals that do not serve it
 *   all        include the ones turned off (the management page)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import {
  createPortal, listPortals, portalCountriesFor, portalUsage, portalsForTicket,
  PORTAL_COUNTRIES, PORTAL_KINDS, type PortalCountry, type PortalKind,
} from '@/lib/portals'
import type { OperationCountry, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Which registry countries this request is about. */
async function resolveCountries(req: NextRequest, sessionCountry?: string): Promise<PortalCountry[]> {
  const { searchParams } = req.nextUrl

  const explicit = searchParams.get('portalCountry')
  if (explicit) {
    const codes = explicit.split(',').map(c => c.trim().toUpperCase()).filter(c => c in PORTAL_COUNTRIES)
    if (codes.length) return codes as PortalCountry[]
  }

  const bookingRef = searchParams.get('bookingRef')
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({
      where: { bookingRef },
      select: { operationCountry: true },
    })
    if (booking) return portalCountriesFor(booking.operationCountry)
  }

  const country = (searchParams.get('country') || sessionCountry) as OperationCountry | undefined
  return portalCountriesFor(country ?? null)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:read')) return buildApiError('Forbidden', 403)

  const { searchParams } = req.nextUrl
  const includeInactive = searchParams.get('all') === 'true'
  const category = searchParams.get('category')

  const countries = await resolveCountries(req, session.user.country as string | undefined)
  if (!countries.length) {
    return buildApiSuccess({ countries: [], portals: [], usage: {}, kinds: PORTAL_KINDS })
  }

  try {
    // A ticket's dropdown is filtered by category; the management page is not.
    const portals = category && !includeInactive
      ? await portalsForTicket(
          (searchParams.get('country') as OperationCountry | null) ?? null,
          category,
        )
      : await listPortals(countries, { activeOnly: !includeInactive })

    // Usage is only worth the extra query on the management page.
    const usage = includeInactive ? await portalUsage(countries) : {}

    return buildApiSuccess({ countries, portals, usage, kinds: PORTAL_KINDS })
  } catch (err) {
    console.error('[portals] Accounts DB read failed:', err)
    return buildApiError('Could not reach the Accounts database, so the portal list is unavailable.', 502)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  // Adding a portal decides where money is sent, so it is an admin act — the
  // same permission that guards the other cross-system settings.
  if (!hasPermission(role, 'admin:override')) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  if (!body) return buildApiError('Send a portal to add.')

  const country = String(body.country ?? '').toUpperCase()
  if (!(country in PORTAL_COUNTRIES)) return buildApiError('Pick the country this portal belongs to.')

  const name = String(body.name ?? '').trim()
  if (!name) return buildApiError('A portal needs a name.')
  if (name.length > 120) return buildApiError('That name is too long.')

  const kind = String(body.kind ?? 'portal')
  if (!(kind in PORTAL_KINDS)) return buildApiError('That is not a kind of portal.')

  try {
    const actor = `${session.user.name || session.user.email} (OPS)`
    const { id, revived } = await createPortal({
      country: country as PortalCountry,
      name,
      kind: kind as PortalKind,
      categories: Array.isArray(body.categories) ? body.categories.map(String) : null,
      supplierName: body.supplierName ?? null,
      currency: body.currency ?? null,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null,
      contactEmail: body.contactEmail ?? null,
      notes: body.notes ?? null,
      isActive: body.isActive !== false,
      sortOrder: Number(body.sortOrder ?? 50),
    }, actor)

    return buildApiSuccess(
      { id },
      revived
        ? `“${name}” was already on the list and has been turned back on.`
        : `“${name}” added — it is on the Accounts board too.`,
    )
  } catch (err) {
    console.error('[portals] create failed:', err)
    const detail = err instanceof Error ? err.message : ''
    return buildApiError(detail || 'Could not add that portal.', 502)
  }
}
