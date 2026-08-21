/**
 * The shared entrance rate card.
 *
 * ---- Why it is shared ----
 *
 * Sigiriya costs what Sigiriya costs. Every Tour Settlement sheet in the office
 * carries the same thirty-odd gate prices, and today each handler retypes them
 * from memory or from the last file they happened to open — which is how the
 * same attraction ends up settled at three different rates in one week. This is
 * one row per attraction, edited in the Tour Settlement editor's rate card
 * panel, read by every booking that opens a sheet afterwards.
 *
 * ---- What it is not ----
 *
 * It is not what a tour was charged. A saved pack holds that, per booking, and
 * a later change to the rate card never reaches back into a sheet that has been
 * printed and signed. The card is only where a *new* sheet's figures start.
 *
 * ---- Degrading ----
 *
 * `sl_tour_rates` is created by a hand-applied additive migration
 * (`prisma/sql/2026-08-21-sl-tour-rates.sql`). Until it has been, the card
 * simply reads empty and the sheets fill in from the booking alone, exactly as
 * they did before it existed — the same forgiving treatment
 * `sl_settlement_docs` gets, and for the same reason: a settlement sheet must
 * print on a database nobody has migrated yet.
 */

import { prisma } from './prisma'
import { TOUR_TICKET_CATALOG, TICKET_GROUP_OF, normaliseTicketName } from './sl-tour-tickets'

export interface TourRate {
  name: string
  adultRate: number | null
  childRate: number | null
  note: string
  /** Which editor heading this attraction sits under, when it is a catalogue one. */
  group: string | null
  /** False for a name somebody added that is not in the shipped catalogue. */
  inCatalog: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export interface TourRateCard {
  rates: TourRate[]
  /** Why the card is empty, when the table has not been created yet. */
  notice: string | null
  savedCount: number
}

const MISSING_TABLE =
  'The rate card is not available on this database yet — the sl_tour_rates table has not been created. ' +
  'Rates typed on a sheet still save with that booking.'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/**
 * Every catalogue attraction, priced where the desk has priced it, plus any
 * name the desk added that the shipped catalogue does not know about.
 *
 * Always the full list rather than only the saved rows: the panel is a price
 * list to fill in, and an attraction with no price yet is the most useful thing
 * on it.
 */
export async function loadRateCard(): Promise<TourRateCard> {
  let rows: { name: string; adultRate: unknown; childRate: unknown; note: string | null; updatedAt: Date; updatedBy: string | null }[] = []
  let notice: string | null = null

  try {
    rows = await prisma.slTourRate.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2021') notice = MISSING_TABLE
    else throw err
  }

  const byKey = new Map(rows.map(r => [normaliseTicketName(r.name), r]))

  const rates: TourRate[] = TOUR_TICKET_CATALOG.map(item => {
    const row = byKey.get(normaliseTicketName(item.name))
    byKey.delete(normaliseTicketName(item.name))
    return {
      name: item.name,
      adultRate: num(row?.adultRate),
      childRate: num(row?.childRate),
      note: row?.note ?? '',
      group: TICKET_GROUP_OF[item.name] ?? null,
      inCatalog: true,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    }
  })

  // Anything the desk priced that is not in the shipped catalogue keeps its
  // place on the card — it is a real attraction somebody sells, and dropping it
  // would delete a price the next save would then wipe from the table.
  for (const row of Array.from(byKey.values())) {
    rates.push({
      name: row.name,
      adultRate: num(row.adultRate),
      childRate: num(row.childRate),
      note: row.note ?? '',
      group: null,
      inCatalog: false,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    })
  }

  return { rates, notice, savedCount: rows.length }
}

/** The card as a lookup, for prefilling a sheet. Empty when there is no table. */
export async function rateLookup(): Promise<Map<string, { adultRate: number | null; childRate: number | null }>> {
  const card = await loadRateCard()
  return new Map(
    card.rates
      .filter(r => r.adultRate !== null || r.childRate !== null)
      .map(r => [normaliseTicketName(r.name), { adultRate: r.adultRate, childRate: r.childRate }]),
  )
}

export interface RateInput {
  name: string
  adultRate: number | null
  childRate: number | null
  note?: string
}

const MAX_RATES = 300

/** What the browser sent, clamped to something worth writing. */
export function parseRates(raw: unknown): RateInput[] {
  const list = Array.isArray(raw) ? raw : []
  const out: RateInput[] = []
  const seen = new Set<string>()

  for (const r of list.slice(0, MAX_RATES)) {
    const name = String((r as any)?.name ?? '').trim().slice(0, 180)
    if (!name) continue
    const key = normaliseTicketName(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      adultRate: num((r as any)?.adultRate),
      childRate: num((r as any)?.childRate),
      note: String((r as any)?.note ?? '').trim().slice(0, 400),
    })
  }
  return out
}

/**
 * Write the card.
 *
 * Row by row rather than delete-and-recreate: the card is edited by several
 * people on different days, and a wholesale replacement would let one stale
 * browser tab wipe a price somebody else set an hour ago. A row priced at
 * nothing on both sides is removed instead of stored, so "clear this rate"
 * leaves the attraction unpriced rather than priced at zero — a zero at a gate
 * means free entry, which is a claim we are not making on anybody's behalf.
 */
export async function saveRateCard(rates: RateInput[], savedBy: string | null): Promise<TourRateCard> {
  const order = new Map(TOUR_TICKET_CATALOG.map((i, n) => [normaliseTicketName(i.name), n]))

  for (const r of rates) {
    const sortOrder = order.get(normaliseTicketName(r.name)) ?? 900
    const blank = r.adultRate === null && r.childRate === null && !r.note

    if (blank) {
      await prisma.slTourRate.deleteMany({ where: { name: r.name } })
      continue
    }

    const data = {
      adultRate: r.adultRate, childRate: r.childRate,
      note: r.note || null, sortOrder, updatedBy: savedBy,
    }
    await prisma.slTourRate.upsert({
      where:  { name: r.name },
      create: { name: r.name, ...data },
      update: data,
    })
  }

  return loadRateCard()
}
