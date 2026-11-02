/**
 * AAHAAS STORE ORDERS, SPLIT THE WAY AAHAASFLOW SPLITS THEM.
 *
 * The store's order table carries every order: agency packages confirmed on
 * the console or bought on the B2B portal, agency flight tickets, and direct
 * customers. AahaasFlow shows them on separate boards (B2B Packages, B2B
 * Flights, B2C); this counts a period's orders onto those same boards with
 * the same rule (`store-order-segment.ts`), so a report can say "B2C" and mean
 * what the Flow board means.
 *
 * Counted by the date the order was BOOKED in the store, not the date OPS
 * imported it — a back-filled import would otherwise land a month's worth of
 * old orders in whichever month the import ran.
 *
 * Travel orders only (Lifestyle, Hotels, Education, Flights). Shop goods are
 * not bookings and are not on any of these counts. Orders marked in the
 * test-booking register (AHS-<order id>) are counted apart. Orders whose every
 * product was cancelled or refunded are counted apart.
 */
import { prisma } from '@/lib/prisma'
import { fetchOrdersBookedBetween, isB2cConfigured } from '@/lib/b2c-db'
import { readStoreOrderSegments, type StoreBoard } from '@/lib/store-order-segment'
import { loadTestBookings, testBookingKey } from '@/lib/test-bookings'

/** Upper bound for one window. A month runs to a few hundred; hitting this is reported, not hidden. */
const MAX_ORDERS = 10000

export const STORE_BOARD_LABEL: Record<StoreBoard, string> = {
  b2b_packages: 'B2B Packages',
  b2b_flights: 'B2B Flights',
  b2c_packages: 'B2C packages',
  b2c_flights: 'B2C flights',
  cancelled: 'Cancelled',
}

export interface StoreBoardCount {
  board: StoreBoard
  label: string
  orders: number
  /** Same board, previous period. Null when the previous period could not be read. */
  previous: number | null
  /** How many of `orders` exist as a booking in OPS (bookingRef = order id). */
  filedInOps: number
}

export interface StoreOrderMix {
  available: boolean
  error: string | null
  fromDate: string
  toDate: string
  /** Live orders on every board — B2B and B2C, packages and flights. Excludes cancelled and tests. */
  all: number
  previousAll: number | null
  /** The AahaasFlow tabs. */
  b2bPackages: number
  b2bFlights: number
  b2c: number
  previousB2bPackages: number | null
  previousB2bFlights: number | null
  previousB2c: number | null
  /** Every board, including B2C split into packages / flights and the cancelled count. */
  boards: StoreBoardCount[]
  cancelled: number
  tests: { checked: boolean; orders: number }
  /** Live orders that are not (yet) a booking in OPS. */
  notInOps: number
  /** True when MAX_ORDERS was reached, so the counts are a floor. */
  truncated: boolean
}

const BOARDS: StoreBoard[] = ['b2b_packages', 'b2b_flights', 'b2c_packages', 'b2c_flights', 'cancelled']

function emptyMix(fromDate: string, toDate: string, error: string | null): StoreOrderMix {
  return {
    available: false, error, fromDate, toDate,
    all: 0, previousAll: null, b2bPackages: 0, b2bFlights: 0, b2c: 0,
    previousB2bPackages: null, previousB2bFlights: null, previousB2c: null,
    boards: [], cancelled: 0, tests: { checked: false, orders: 0 }, notInOps: 0, truncated: false,
  }
}

async function countBoards(fromDate: string, toDate: string, isTest: (id: number) => boolean) {
  const orders = await fetchOrdersBookedBetween({ from: fromDate, to: toDate, limit: MAX_ORDERS })
  const ids = orders.map(o => Number(o.order_id))
  const real = ids.filter(id => !isTest(id))
  const segments = await readStoreOrderSegments(real)
  const byBoard = new Map<StoreBoard, number[]>(BOARDS.map(b => [b, []]))
  for (const id of real) {
    // Every id was asked for, so a missing one is a bug upstream — never a silent B2C.
    const sg = segments.get(id)
    if (!sg) throw new Error(`order ${id} could not be placed on a board`)
    byBoard.get(sg.board)!.push(id)
  }
  return { byBoard, tests: ids.length - real.length, truncated: orders.length >= MAX_ORDERS }
}

export async function collectStoreOrderMix(window: {
  fromDate: string
  toDate: string
  previous?: { fromDate: string; toDate: string } | null
}): Promise<StoreOrderMix> {
  const { fromDate, toDate } = window
  if (!isB2cConfigured()) return emptyMix(fromDate, toDate, 'The Aahaas store database is not configured.')

  try {
    const register = await loadTestBookings()
    const isTest = (id: number) => register.marks.has(testBookingKey(`AHS-${id}`))

    const [now, prev] = await Promise.all([
      countBoards(fromDate, toDate, isTest),
      window.previous
        ? countBoards(window.previous.fromDate, window.previous.toDate, isTest).catch(err => {
          console.warn('[StoreMix] previous period could not be read:', err instanceof Error ? err.message : err)
          return null
        })
        : Promise.resolve(null),
    ])

    // Which of the period's orders OPS holds — bookingRef is the store order id.
    const liveIds = BOARDS.filter(b => b !== 'cancelled').flatMap(b => now.byBoard.get(b)!)
    const filed = liveIds.length
      ? new Set((await prisma.booking.findMany({
        where: { bookingRef: { in: liveIds.map(String) } },
        select: { bookingRef: true },
      })).map(b => b.bookingRef))
      : new Set<string>()

    const n = (b: StoreBoard) => now.byBoard.get(b)!.length
    const p = (b: StoreBoard) => (prev ? prev.byBoard.get(b)!.length : null)
    const sum = (...xs: Array<number | null>) => (xs.some(x => x === null) ? null : xs.reduce<number>((s, x) => s + (x as number), 0))

    const boards: StoreBoardCount[] = BOARDS.map(board => ({
      board,
      label: STORE_BOARD_LABEL[board],
      orders: n(board),
      previous: p(board),
      filedInOps: board === 'cancelled' ? 0 : now.byBoard.get(board)!.filter(id => filed.has(String(id))).length,
    }))

    const b2c = n('b2c_packages') + n('b2c_flights')
    const all = n('b2b_packages') + n('b2b_flights') + b2c
    return {
      available: true,
      error: null,
      fromDate, toDate,
      all,
      previousAll: sum(p('b2b_packages'), p('b2b_flights'), p('b2c_packages'), p('b2c_flights')),
      b2bPackages: n('b2b_packages'),
      b2bFlights: n('b2b_flights'),
      b2c,
      previousB2bPackages: p('b2b_packages'),
      previousB2bFlights: p('b2b_flights'),
      previousB2c: sum(p('b2c_packages'), p('b2c_flights')),
      boards,
      cancelled: n('cancelled'),
      tests: { checked: register.checked, orders: now.tests },
      notInOps: liveIds.length - filed.size,
      truncated: now.truncated,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[StoreMix] store orders could not be split:', msg)
    return emptyMix(fromDate, toDate, `The Aahaas store orders could not be read (${msg}).`)
  }
}
