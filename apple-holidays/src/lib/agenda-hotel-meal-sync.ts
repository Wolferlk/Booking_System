/**
 * Hotel meal plan → movement chart.
 *
 * A hotel's meal plan lives on `Accommodation.mealType` (edited on the booking
 * page). The movement chart keeps its own `AgendaItem.mealPlan`, copied once
 * when the chart is generated, so a meal plan added or changed on the booking
 * page afterwards never reached the agenda, its PDF/Word export or the guest's
 * WhatsApp agenda. This carries the change across when the hotel is saved.
 *
 * Rules (deliberately conservative — the chart is hand-edited):
 *  - Only the days of that stay are touched. A breakfast-only plan starts the
 *    morning after check-in and runs to check-out morning; any other plan
 *    (half board, dinner, all inclusive…) covers check-in to check-out.
 *  - A movement already showing the hotel's OLD plan is moved to the new one
 *    (or cleared, when the plan was removed).
 *  - A day with no meal on any movement gets the new plan on one movement —
 *    the one that names the hotel, otherwise the day's first movement.
 *  - A meal typed on the chart by hand (anything other than the old hotel
 *    plan) is never overwritten.
 */
import { prisma } from '@/lib/prisma'
import { mealPlanFullName } from '@/lib/agenda-suggestions'
import { logMovementEdit } from '@/lib/booking-logs-agenda'

export interface HotelMealChange {
  hotel: string | null
  checkIn: Date | string
  checkOut: Date | string
  before: string | null | undefined
  after: string | null | undefined
}

/**
 * A hotel's meal wording in the agenda's vocabulary: "BB" / "Bed & Breakfast"
 * → "Breakfast", "HB" → "Half Board", "Room Only" → '' (no meal on the chart).
 */
export function hotelMealToAgenda(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const key = text.toLowerCase().replace(/[^a-z&]+/g, ' ').trim()
  if (/^(bb|b ?& ?b|bed (and|&) breakfast|breakfast only|with breakfast)$/.test(key)) return 'Breakfast'
  if (/^(ro|room only|no meals?|room only no meals|ep|european plan)$/.test(key)) return ''
  if (/^(hb|half board)$/.test(key)) return 'Half Board'
  if (/^(fb|full board)$/.test(key)) return 'Full Board'
  if (/^(ai|all inclusive)$/.test(key)) return 'All Inclusive'
  return mealPlanFullName(text)
}

const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The chart days a stay's meal plan covers, as YYYY-MM-DD. */
function stayMealDays(checkIn: string, checkOut: string, plan: string): string[] {
  const breakfastOnly = plan === 'Breakfast'
  const first = breakfastOnly ? addDays(checkIn, 1) : checkIn
  const days: string[] = []
  for (let d = first; d <= checkOut && days.length < 120; d = addDays(d, 1)) days.push(d)
  return days
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  mealPlanFullName(a).toLowerCase() === mealPlanFullName(b).toLowerCase()

/**
 * Apply hotel meal-plan changes to the booking's movement chart. Returns how
 * many movements changed. Never throws — the hotel save already succeeded.
 */
export async function syncHotelMealsToAgenda(
  bookingId: string,
  bookingRef: string,
  changes: HotelMealChange[],
  actor: { id: string; name: string | null },
): Promise<number> {
  try {
    const real = changes.filter(c => hotelMealToAgenda(c.before) !== hotelMealToAgenda(c.after))
    if (real.length === 0) return 0

    const agenda = await prisma.tourAgenda.findUnique({
      where: { bookingId },
      select: {
        items: {
          orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
          select: {
            id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
            mealPlan: true, meetingTime: true, serviceType: true, isLeisure: true, isHotelOnly: true,
          },
        },
      },
    })
    if (!agenda || agenda.items.length === 0) return 0

    // Working copy: later stays see what earlier ones wrote.
    const meal = new Map(agenda.items.map(i => [i.id, i.mealPlan ?? '']))
    const touched = new Set<string>()

    for (const c of real) {
      const checkIn = ymd(c.checkIn)
      const checkOut = ymd(c.checkOut)
      const oldPlan = hotelMealToAgenda(c.before)
      const newPlan = hotelMealToAgenda(c.after)
      const hotelKey = String(c.hotel ?? '').trim().toLowerCase()

      // 1. Movements still carrying the old hotel plan follow it.
      if (oldPlan) {
        for (const d of stayMealDays(checkIn, checkOut, oldPlan)) {
          for (const it of agenda.items) {
            if (ymd(it.date) !== d || !same(meal.get(it.id), oldPlan)) continue
            meal.set(it.id, newPlan)
            touched.add(it.id)
          }
        }
      }

      // 2. Days of the stay with no meal anywhere get the new plan once.
      if (newPlan) {
        for (const d of stayMealDays(checkIn, checkOut, newPlan)) {
          const day = agenda.items.filter(it => ymd(it.date) === d)
          if (day.length === 0) continue
          if (day.some(it => same(meal.get(it.id), newPlan))) continue
          if (day.some(it => String(meal.get(it.id) ?? '').trim())) continue // a hand-typed meal wins
          const namesHotel = hotelKey
            ? day.find(it => [it.fromPoint, it.toPoint, it.location]
                .some(v => String(v ?? '').toLowerCase().includes(hotelKey)))
            : undefined
          const target = namesHotel ?? day[0]
          meal.set(target.id, newPlan)
          touched.add(target.id)
        }
      }
    }

    let changed = 0
    for (const it of agenda.items) {
      if (!touched.has(it.id)) continue
      const next = String(meal.get(it.id) ?? '').trim() || null
      if ((it.mealPlan ?? null) === next) continue
      // Pinned to the movement's primary key.
      await prisma.agendaItem.update({ where: { id: it.id }, data: { mealPlan: next } })
      await logMovementEdit(bookingRef, it as unknown as Record<string, unknown>,
        { ...it, mealPlan: next } as unknown as Record<string, unknown>, actor)
      changed++
    }
    if (changed > 0) {
      await prisma.tourAgenda.update({ where: { bookingId }, data: { updatedAt: new Date() } })
    }
    return changed
  } catch (err) {
    console.error('[hotel meal → agenda] sync failed (non-fatal):', err instanceof Error ? err.message : err)
    return 0
  }
}
