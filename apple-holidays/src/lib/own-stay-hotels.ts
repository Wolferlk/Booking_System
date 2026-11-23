/**
 * Own-arrangement hotel names from the AI Quotation system (Aahaas Flow server).
 *
 * AppleSystem is told "no hotel" for an own-arrangement night, so every SME /
 * Corporate booking imported from it arrives with those stays BLANK. The hotel
 * the guest is actually staying at was recorded on the AI Quotation side (the
 * Own Arrangement panel, or the partner's own voucher) and never reached OPS.
 *
 * This reads it over the existing read-only Flow link
 * (`GET /v1/aahaas-flow/own-stays/{quotationNo}`, service key, GET only) and
 * fills it in at import time.
 *
 * Rules — the same on the AI Quotation side's push:
 *   - only a stay flagged own-arrangement AND with a blank hotel is filled;
 *   - an AppleSystem name always wins, and nothing a person typed is replaced;
 *   - nothing is added or removed — only blanks on rows that already exist;
 *   - never throws and never blocks an import: Flow down = import exactly as before.
 */

import { flowGet, isFlowConfigured } from '@/lib/aahaas-flow-api'

export interface OwnStayHotel {
  city: string | null
  check_in: string
  check_out: string | null
  hotel: string
  room_type: string | null
  contact: string | null
  source: string | null
}

/** A short wait: this runs inside an import, which must never hang on Flow. */
const FEED_TIMEOUT_MS = Number(process.env.OWN_STAY_FEED_TIMEOUT_MS ?? '6000')

const cityKey = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '')
const dayOf = (v: unknown): string | null => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** What the AI Quotation system holds for one quotation. [] on any failure. */
export async function fetchOwnStayHotels(quotationNo: string | null | undefined): Promise<OwnStayHotel[]> {
  const no = String(quotationNo ?? '').trim()
  if (!/^\d{1,12}$/.test(no) || !isFlowConfigured()) return []
  try {
    const data = await flowGet<{ stays?: OwnStayHotel[] }>(
      `own-stays/${encodeURIComponent(no)}`,
      'as-import',
      { timeoutMs: FEED_TIMEOUT_MS },
    )
    return (Array.isArray(data?.stays) ? data.stays : []).filter(
      (s) => s && typeof s.hotel === 'string' && s.hotel.trim() && dayOf(s.check_in),
    )
  } catch (err) {
    // A 404 is an older Flow build without the feed — same as "nothing known".
    console.warn(
      `[own-stay-hotels] could not read own-arrangement hotels for quotation ${no}:`,
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

interface FillableStay {
  city: string
  hotel: string
  checkIn: string | Date
  checkOut: string | Date
  ownArrangement: boolean
  roomType: string | null
}

/**
 * Fill blank own-arrangement hotels from the feed. PURE.
 *
 * Paired on the same check-in day and the same city (containment either way —
 * AppleSystem writes "Da Nang( City Center)"). When the city does not compare,
 * a stay is still accepted if it is the only blank one on that check-in with the
 * same check-out, because the dates alone are then unambiguous.
 */
export function fillOwnArrangementHotels<T extends FillableStay>(
  stays: T[],
  feed: OwnStayHotel[],
): { accommodations: T[]; filled: number } {
  const candidates = stays
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.ownArrangement && !s.hotel.trim() && dayOf(s.checkIn))
  const used = new Set<number>()
  const names = new Map<number, OwnStayHotel>()

  for (const h of feed) {
    const sameDay = candidates.filter(({ s, i }) => !used.has(i) && dayOf(s.checkIn) === h.check_in)
    const key = cityKey(h.city)
    let hit = key
      ? sameDay.find(({ s }) => {
          const k = cityKey(s.city)
          return !!k && (k.includes(key) || key.includes(k))
        })
      : undefined
    if (!hit && h.check_out) {
      const sameDates = sameDay.filter(({ s }) => dayOf(s.checkOut) === h.check_out)
      if (sameDates.length === 1) hit = sameDates[0]
    }
    if (!hit) continue
    used.add(hit.i)
    names.set(hit.i, h)
  }

  if (!names.size) return { accommodations: stays, filled: 0 }
  return {
    filled: names.size,
    accommodations: stays.map((s, i) => {
      const h = names.get(i)
      if (!h) return s
      return {
        ...s,
        hotel: h.hotel.trim().slice(0, 190),
        roomType: s.roomType?.trim() ? s.roomType : (h.room_type?.trim() || s.roomType),
      }
    }),
  }
}

/**
 * The import-time entry point: the mapped stays with any blank own-arrangement
 * hotel filled from the AI Quotation system. Skips the network entirely when
 * there is nothing blank to fill. Never throws.
 */
export async function withOwnStayHotels<T extends FillableStay>(
  quotationNo: string | null | undefined,
  stays: T[],
): Promise<T[]> {
  try {
    if (!stays.some((s) => s.ownArrangement && !s.hotel.trim())) return stays
    const feed = await fetchOwnStayHotels(quotationNo)
    if (!feed.length) return stays
    const { accommodations, filled } = fillOwnArrangementHotels(stays, feed)
    if (filled) {
      console.log(`[own-stay-hotels] quotation ${quotationNo}: filled ${filled} own-arrangement hotel name(s) from AI Quotation`)
    }
    return accommodations
  } catch (err) {
    console.warn('[own-stay-hotels] skipped:', err instanceof Error ? err.message : err)
    return stays
  }
}
