/**
 * The app's daily trip list: seat matching, the 5/10 cap, daily rotation.
 * Pure — touches no database and no network.
 *
 *   npx tsx scripts/trip-picks-check.mts
 */
import assert from 'node:assert/strict'
import { DAILY_TRIP_LIMIT, dailyPicks, nextLocalMidnight, seatFit, type SeatMatch } from '../src/lib/mobile/trip-picks'

// Seats: too many guests never fits, nor does a near-empty big vehicle.
assert.equal(seatFit(4, [3]), null, 'four guests do not fit a car')
assert.equal(seatFit(2, [40]), null, 'a couple is not a coach job')
assert.equal(seatFit(2, [9]), null, 'a couple is not a high-roof van job')
assert.deepEqual(seatFit(2, [3]), { match: 'PERFECT', seats: 3 })
assert.deepEqual(seatFit(1, [3]), { match: 'GOOD', seats: 3 })
assert.deepEqual(seatFit(2, [6]), { match: 'GOOD', seats: 6 })
assert.deepEqual(seatFit(5, [9]), { match: 'PERFECT', seats: 9 })
assert.deepEqual(seatFit(13, [40]), { match: 'GOOD', seats: 40 })
assert.deepEqual(seatFit(1, [1]), { match: 'PERFECT', seats: 1 })

// A fleet: any vehicle will do, and the smallest suitable one is named.
assert.deepEqual(seatFit(5, [40, 9, 6]), { match: 'PERFECT', seats: 6 })
assert.deepEqual(seatFit(20, [40, 25, 3]), { match: 'PERFECT', seats: 25 })
assert.equal(seatFit(16, [3, 15]), null)

// Unknowns are not held back.
assert.deepEqual(seatFit(5, []), { match: null, seats: null }, 'no vehicle on file')
assert.deepEqual(seatFit(5, [0]), { match: null, seats: null }, 'vehicle with no seat count')
assert.deepEqual(seatFit(0, [9]), { match: 'GOOD', seats: 9 }, 'pax not recorded')

// Daily picks.
const pool = Array.from({ length: 60 }, (_, i) => ({ key: `B:trip${i}`, daysAway: i % 10, match: (i % 2 ? 'PERFECT' : 'GOOD') as SeatMatch }))
const keys = (seed: string, list = pool, n = 5) => dailyPicks(list, seed, n).map(t => t.key)

assert.equal(keys('D:1|2026-11-06').length, DAILY_TRIP_LIMIT.DRIVER)
assert.equal(keys('V:1|2026-11-06', pool, DAILY_TRIP_LIMIT.VENDOR).length, 10)
assert.equal(dailyPicks(pool.slice(0, 3), 'x', 5).length, 3, 'fewer trips than the cap')
assert.deepEqual(keys('D:1|2026-11-06'), keys('D:1|2026-11-06'), 'stable through the day')
assert.deepEqual(keys('D:1|2026-11-06'), keys('D:1|2026-11-06', [...pool].reverse()), 'database order does not matter')
assert.notDeepEqual(keys('D:1|2026-11-06'), keys('D:1|2026-11-07'), 'changes the next day')
assert.notDeepEqual(keys('D:1|2026-11-06'), keys('D:2|2026-11-06'), 'differs between drivers')

// Taking a trip moves the next one up without disturbing the others.
const today = keys('D:1|2026-11-06')
const after = keys('D:1|2026-11-06', pool.filter(t => t.key !== today[1]))
assert.deepEqual(after.slice(0, 4), today.filter(k => k !== today[1]), 'the rest keep their places')

// Over many drivers and days: all trips get seen, and soon ones more often.
const seen = new Map<string, number>()
for (let d = 0; d < 400; d++) for (const k of keys(`D:${d}|2026-11-06`)) seen.set(k, (seen.get(k) ?? 0) + 1)
assert.equal(seen.size, pool.length, 'every trip reaches somebody')
const avg = (test: (t: (typeof pool)[number]) => boolean) => {
  const hit = pool.filter(test)
  return hit.reduce((n, t) => n + (seen.get(t.key) ?? 0), 0) / hit.length
}
const soon = avg(t => t.daysAway <= 1), far = avg(t => t.daysAway >= 7)
assert.ok(soon > far * 2, `soon ${soon} should clearly beat far ${far}`)

// The list changes at the country's own midnight.
assert.equal(nextLocalMidnight('Asia/Colombo', new Date('2026-11-06T10:00:00Z')).toISOString(), '2026-11-06T18:30:00.000Z')
assert.equal(nextLocalMidnight('Asia/Colombo', new Date('2026-11-06T18:30:00Z')).toISOString(), '2026-11-07T18:30:00.000Z')
assert.equal(nextLocalMidnight('Asia/Ho_Chi_Minh', new Date('2026-11-06T16:59:59Z')).toISOString(), '2026-11-06T17:00:00.000Z')

console.log(`ok — soon trips shown ${(soon / far).toFixed(1)}× as often as far ones`)
