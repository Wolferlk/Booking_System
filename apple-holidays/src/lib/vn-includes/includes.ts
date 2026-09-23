/**
 * Reading and writing the includes chosen on a booking's movements.
 *
 * The movement chart is deleted and recreated on every save, and rebuilt
 * wholesale when an amendment lands, so an include cannot simply hang off an
 * agenda row id. It is stored against the booking with a snapshot of its
 * movement (date, activity, service type) and re-attached on read:
 *
 *   1. to the row it was saved against, while that row still exists;
 *   2. else to the movement on the same date with the same activity;
 *   3. else to the only movement of the same service type on that date.
 *
 * What none of those place is returned as `unplaced`, so the chart can show it
 * rather than silently losing a supplier payment.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { searchForm, takesIncludes, type AgendaInclude } from './shared'

export interface ChartItemRef {
  id: string
  date: Date | string
  location?: string | null
  toPoint?: string | null
  serviceType?: string | null
  sortOrder?: number | null
}

export interface UnplacedInclude extends AgendaInclude {
  itemDate: string
  itemActivity: string | null
}

/** True when the tables have not been created on this database yet. */
export function isMissingTable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === 'P2021' || err.code === 'P2022'
  return /doesn't exist|does not exist|P2021/i.test(String((err as Error)?.message ?? err))
}

const day = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const activityKey = (s: string | null | undefined) => searchForm(String(s ?? ''))

function toInclude(r: {
  id: string; productId: string | null; productKey: string; code: string; name: string
  unitPriceVnd: Prisma.Decimal | null; quantity: number; note: string | null; source: string
}): AgendaInclude {
  return {
    id: r.id,
    productId: r.productId,
    productKey: r.productKey,
    code: r.code,
    name: r.name,
    unitPriceVnd: r.unitPriceVnd === null ? null : Number(r.unitPriceVnd),
    quantity: r.quantity,
    note: r.note,
    source: r.source === 'MANUAL' ? 'MANUAL' : 'SHEET',
  }
}

export async function loadIncludes(bookingRef: string, items: ChartItemRef[]): Promise<{
  byItem: Record<string, AgendaInclude[]>
  unplaced: UnplacedInclude[]
  installed: boolean
}> {
  let rows
  try {
    rows = await prisma.agendaItemInclude.findMany({
      where: { bookingRef },
      orderBy: [{ itemDate: 'asc' }, { itemSortOrder: 'asc' }, { position: 'asc' }],
    })
  } catch (err) {
    if (isMissingTable(err)) return { byItem: {}, unplaced: [], installed: false }
    throw err
  }

  const byItem: Record<string, AgendaInclude[]> = {}
  const unplaced: UnplacedInclude[] = []
  const ids = new Set(items.map(i => i.id))

  for (const r of rows) {
    let target: string | null = r.agendaItemId && ids.has(r.agendaItemId) ? r.agendaItemId : null

    if (!target) {
      const date = day(r.itemDate)
      const sameDay = items.filter(i => day(i.date) === date)
      const want = activityKey(r.itemActivity)
      target = (want && sameDay.find(i => activityKey(i.toPoint) === want)?.id) || null
      if (!target) {
        const sameType = sameDay.filter(i => i.serviceType && i.serviceType === r.itemServiceType)
        if (sameType.length === 1) target = sameType[0].id
      }
    }

    if (target) {
      (byItem[target] ??= []).push(toInclude(r))
    } else {
      unplaced.push({ ...toInclude(r), itemDate: day(r.itemDate), itemActivity: r.itemActivity })
    }
  }

  return { byItem, unplaced, installed: true }
}

export interface SavedChartItem {
  /** The id the row was just recreated under. */
  id: string
  date: Date
  location?: string | null
  toPoint?: string | null
  serviceType?: string | null
  sortOrder: number
  includes: AgendaInclude[]
}

/**
 * Replace a booking's includes with what the chart just saved.
 *
 * Runs in its own transaction after the chart itself is saved: if these tables
 * are missing, or the write fails, the chart save still stands and the old
 * includes are left exactly as they were (and re-attach on the next read).
 * Who first added each include is carried over, so re-saving the chart does
 * not re-stamp every include with whoever pressed Save last.
 */
export async function saveIncludes(
  bookingRef: string,
  country: string | null,
  items: SavedChartItem[],
  user: { id?: string | null; name?: string | null },
  /**
   * Includes the chart could not place on any movement (see loadIncludes) and
   * the operator has not discarded. They are on no movement, so the operator
   * had no way to remove them — keeping them is the only safe default.
   */
  keepIds: string[] = [],
): Promise<{ ok: true; count: number } | { ok: false; reason: 'not_installed' | 'failed'; error?: string }> {
  try {
    await prisma.$transaction(async tx => {
      const before = await tx.agendaItemInclude.findMany({
        where: { bookingRef },
        select: { productKey: true, itemDate: true, createdById: true, createdByName: true, createdAt: true },
      })
      const author = new Map(before.map(b => [`${day(b.itemDate)}|${b.productKey}`, b]))

      await tx.agendaItemInclude.deleteMany({
        where: { bookingRef, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
      })

      const data: Prisma.AgendaItemIncludeCreateManyInput[] = []
      for (const item of items) {
        // An include left on a movement that has since become, say, a Private
        // Transfer is not something the operator can see or remove any more,
        // so it is not carried into the new chart.
        if (!takesIncludes(item.serviceType, country)) continue
        item.includes.forEach((inc, position) => {
          if (!inc.productKey || !inc.name) return
          const prev = author.get(`${day(item.date)}|${inc.productKey}`)
          data.push({
            bookingRef,
            agendaItemId:    item.id,
            itemDate:        new Date(`${day(item.date)}T00:00:00Z`),
            itemServiceType: item.serviceType ?? null,
            itemLocation:    item.location ? String(item.location).slice(0, 191) : null,
            itemActivity:    item.toPoint ?? null,
            itemSortOrder:   item.sortOrder,
            productId:       inc.productId ?? null,
            productKey:      String(inc.productKey).slice(0, 191),
            code:            String(inc.code || 'Other').slice(0, 64),
            name:            String(inc.name),
            unitPriceVnd:    inc.unitPriceVnd === null || inc.unitPriceVnd === undefined || !Number.isFinite(Number(inc.unitPriceVnd))
              ? null : Number(inc.unitPriceVnd),
            quantity:        Math.max(1, Math.min(999, Math.round(Number(inc.quantity) || 1))),
            note:            inc.note ? String(inc.note).slice(0, 500) : null,
            source:          inc.source === 'MANUAL' ? 'MANUAL' : 'SHEET',
            position,
            createdById:     prev?.createdById ?? user.id ?? null,
            createdByName:   prev?.createdByName ?? user.name ?? null,
            ...(prev ? { createdAt: prev.createdAt } : {}),
          })
        })
      }
      if (data.length) await tx.agendaItemInclude.createMany({ data })
    }, { maxWait: 10_000, timeout: 20_000 })

    const count = items.reduce((n, i) => n + (takesIncludes(i.serviceType, country) ? i.includes.length : 0), 0)
    return { ok: true, count }
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: 'not_installed' }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[vn-includes] saving includes failed:', msg)
    return { ok: false, reason: 'failed', error: msg }
  }
}
