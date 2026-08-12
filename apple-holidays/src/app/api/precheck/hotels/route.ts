import { NextRequest } from 'next/server'
import type { HotelProfileSource } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { saveHotelProfile } from '@/lib/hotel-precheck-write'
import { matchAccountsHotels, searchAccountsHotels } from '@/lib/accounts-hotels-db'
import { rankHotelCandidates } from '@/lib/hotel-match'
import { contactHealth } from '@/lib/hotel-contact'

export const dynamic = 'force-dynamic'

const SOURCES: HotelProfileSource[] = ['ACCOUNTS', 'MANUAL', 'AI']

/**
 * GET /api/precheck/hotels — find a hotel, in both places it can live.
 *
 * Returns two ranked lists: `profiles` (this system's overlay, which carries
 * WhatsApp numbers and verification) and `master` (the Accounts
 * `hotel_details` list, read-only). Staff pick from either — choosing a master
 * row creates a linked profile on save.
 *
 * `?match=1` scores candidates against the query instead of plain LIKE
 * ordering, which is what the "suggest a match for this booking's hotel" UI
 * wants; `?city=` corroborates the ranking.
 */
export async function GET(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const city = sp.get('city')
  const countryCode = sp.get('countryCode')?.toUpperCase() || null
  const useMatching = sp.get('match') === '1'

  if (!q) return buildApiError('A search term is required')

  // ── This system's overlay
  const localRows = await prisma.hotelProfile.findMany({
    where: {
      ...(countryCode ? { countryCode } : {}),
      OR: [
        { name: { contains: q } },
        { accountsHotelName: { contains: q } },
      ],
    },
    include: { channels: true },
    orderBy: { name: 'asc' },
    take: 50,
  })

  const localShaped = localRows.map(h => ({
    id: h.id,
    name: h.name,
    city: h.city,
    countryCode: h.countryCode,
    accountsHotelId: h.accountsHotelId,
    phone: h.phone,
    whatsapp: h.whatsapp,
    whatsappVerified: h.whatsappVerified,
    email: h.email,
    address: h.address,
    website: h.website,
    source: h.source,
    channelCount: h.channels.length,
    health: contactHealth({
      phone: h.phone, whatsapp: h.whatsapp, whatsappVerified: h.whatsappVerified,
      email: h.email, channelCount: h.channels.length,
    }),
  }))

  const profiles = useMatching
    ? rankHotelCandidates(q, city, localShaped).map(r => ({ ...r.candidate, confidence: r.confidence, signals: r.signals }))
    : localShaped.map(c => ({ ...c, confidence: null as number | null, signals: [] as string[] }))

  // ── Accounts master list. A failure here must not break the local search:
  // adding a hotel by hand is exactly what staff need when the Accounts DB is
  // unreachable, so the route degrades instead of erroring.
  let master: unknown[] = []
  let masterError: string | null = null
  try {
    master = useMatching
      ? (await matchAccountsHotels(q, city, countryCode))
          .map(r => ({ ...r.candidate, confidence: r.confidence, signals: r.signals }))
      : (await searchAccountsHotels(q, { countryCode, limit: 25 }))
          .map(h => ({ ...h, confidence: null, signals: [] }))
  } catch (e) {
    masterError = (e as Error).message
    console.warn('[precheck/hotels] Accounts master list unavailable:', masterError)
  }

  return buildApiSuccess({ profiles, master, masterError })
}

/**
 * POST /api/precheck/hotels — create or update a hotel profile.
 *
 * Writes only to this system's `hotel_profiles` overlay. The Accounts
 * `hotel_details` master list is never modified from the booking system;
 * linking to it stores its id and name, nothing more.
 */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const name = String(body.name ?? '').trim()
  if (!name) return buildApiError('A hotel name is required')

  const source = body.source ? String(body.source) as HotelProfileSource : 'MANUAL'
  if (!SOURCES.includes(source)) return buildApiError(`Unknown source "${source}"`)

  const accountsHotelId = body.accountsHotelId == null || body.accountsHotelId === ''
    ? null
    : Number(body.accountsHotelId)
  if (accountsHotelId !== null && !Number.isFinite(accountsHotelId)) {
    return buildApiError('accountsHotelId must be a number')
  }

  const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

  try {
    const hotel = await saveHotelProfile({
      name,
      city: s(body.city),
      countryCode: s(body.countryCode) ?? 'LK',
      accountsHotelId,
      accountsHotelName: s(body.accountsHotelName),
      address: s(body.address),
      website: s(body.website),
      phone: s(body.phone),
      email: s(body.email),
      whatsapp: s(body.whatsapp),
      whatsappVerified: body.whatsappVerified === true,
      googleMapsUrl: s(body.googleMapsUrl),
      notes: s(body.notes),
      source,
      ...(body.aiResearch !== undefined
        ? { aiResearch: body.aiResearch as Parameters<typeof saveHotelProfile>[0]['aiResearch'] }
        : {}),
    }, session.actor)

    return buildApiSuccess(hotel, 'Hotel saved')
  } catch (e) {
    console.error('[precheck/hotels POST]', e)
    return buildApiError((e as Error).message, 400)
  }
}
