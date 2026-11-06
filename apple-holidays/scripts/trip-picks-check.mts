/**
 * The app's daily trip list: vehicle matching, the 5/10 cap, daily rotation.
 * Pure — touches no database and no network.
 *
 *   npx tsx scripts/trip-picks-check.mts
 */
import assert from 'node:assert/strict'
import { DAILY_TRIP_LIMIT, dailyPicks, nextLocalMidnight, vehicleFit } from '../src/lib/mobile/trip-picks'

const car = { type: 'car', seats: 3 }
const flat = { type: 'flatroof-van', seats: 6 }
const high = { type: 'highroof-van', seats: 9 }
const fits = (pax: number, ...fleet: { type: string | null; seats: number }[]) => vehicleFit(pax, fleet)?.vehicle ?? null

// The ground desk's table: 1–3 car, 4–5 flat roof, 6–8 high roof.
for (const pax of [1, 2, 3]) { assert.equal(fits(pax, car), 'Car'); assert.equal(fits(pax, flat), null); assert.equal(fits(pax, high), null) }
for (const pax of [4, 5]) { assert.equal(fits(pax, flat), 'Flat Roof'); assert.equal(fits(pax, car), null); assert.equal(fits(pax, high), null) }
for (const pax of [6, 7, 8]) { assert.equal(fits(pax, high), 'High Roof'); assert.equal(fits(pax, flat), null); assert.equal(fits(pax, car), null) }
assert.equal(fits(9, high), null, 'nine guests are past a high roof')

// Every spelling the system stores for a class.
assert.equal(fits(5, { type: 'flat_roof', seats: 6 }), 'Flat Roof')
assert.equal(fits(7, { type: 'High Roof', seats: 9 }), 'High Roof')
assert.equal(fits(2, { type: 'Toyota Axio', seats: 3 }), 'Car')

// The table never overrides the seats actually on file.
assert.equal(fits(8, { type: 'highroof-van', seats: 7 }), null)
assert.equal(fits(3, { type: 'car', seats: 2 }), null)

// Generic vans, big vehicles, and types that say nothing.
assert.equal(fits(5, { type: 'van', seats: 8 }), 'Van')
assert.equal(fits(2, { type: 'van', seats: 8 }), null)
assert.equal(fits(12, { type: 'minibus', seats: 15 }), 'Mini Bus')
assert.equal(fits(6, { type: 'minibus', seats: 15 }), null, 'a high roof group')
assert.equal(fits(20, { type: 'bus-medium', seats: 25 }), 'Bus')
assert.equal(fits(10, { type: 'bus-high', seats: 40 }), null, 'too few for a big coach')
assert.equal(fits(2, { type: 'other', seats: 4 }), null)
assert.equal(fits(4, { type: 'other', seats: 4 }), '4-seater', 'other goes by its seats')

// A fleet: any vehicle will do, and the one that suits is named.
assert.deepEqual(vehicleFit(5, [high, flat, car]), { vehicle: 'Flat Roof', seats: 6 })
assert.deepEqual(vehicleFit(2, [high, car]), { vehicle: 'Car', seats: 3 })
assert.equal(vehicleFit(5, [car, high]), null)

// Unknowns are not held back.
assert.deepEqual(vehicleFit(5, []), { vehicle: null, seats: null }, 'no vehicle on file')
assert.deepEqual(vehicleFit(5, [{ type: 'car', seats: 0 }]), { vehicle: null, seats: null }, 'no seat count')
assert.deepEqual(vehicleFit(0, [high]), { vehicle: 'High Roof', seats: 9 }, 'pax not recorded')

// Daily picks.
const pool = Array.from({ length: 60 }, (_, i) => ({ key: `B:trip${i}`, daysAway: i % 10 }))
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
