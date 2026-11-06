/**
 * The rule every add-a-vehicle form shares. Pure — no database, no network.
 *
 *   npx tsx scripts/vehicle-details-check.mts
 */
import assert from 'node:assert/strict'
import { guestRange, guestRangeLabel, vehicleProblem } from '../src/lib/vehicle-details'

const good = { type: 'flatroof-van', brand: 'Toyota', model: 'KDH', capacity: 5 }
assert.equal(vehicleProblem(good), null)
assert.equal(vehicleProblem({ ...good, capacity: '4' }), null, 'forms send text')

// Adding: everything is required, and nothing falls back to a default.
assert.match(vehicleProblem({ ...good, type: 'spaceship' })!, /type/)
assert.match(vehicleProblem({ ...good, type: undefined })!, /type/)
assert.match(vehicleProblem({ ...good, brand: '  ' })!, /brand/)
assert.match(vehicleProblem({ ...good, model: undefined })!, /model/)
for (const capacity of [undefined, null, '', 0, -1, 2.5, 'abc']) assert.match(vehicleProblem({ ...good, capacity })!, /pax count/i, String(capacity))

// The ground desk's table.
const range = (type: string, ok: number[], bad: number[]) => {
  for (const capacity of ok) assert.equal(vehicleProblem({ ...good, type, capacity }), null, `${type} ${capacity}`)
  for (const capacity of bad) assert.match(vehicleProblem({ ...good, type, capacity })!, /must be/, `${type} ${capacity}`)
}
range('car', [1, 2, 3], [4, 8])
range('flatroof-van', [4, 5], [3, 6])
range('highroof-van', [6, 7, 8], [5, 9])
range('van', [4, 8], [3, 9])
range('minibus', [9, 15], [8])
range('bus-high', [40], [8, 81])
range('motorbike', [1], [2])
range('other', [1, 50], [81])
assert.equal(guestRangeLabel('car'), '1–3'); assert.equal(guestRangeLabel('motorbike'), '1')
assert.deepEqual(guestRange('flat_roof'), [4, 5], 'allocation board spelling')

// Editing a vehicle saved before the rule.
const old = { type: 'flatroof-van', capacity: 6 }
assert.equal(vehicleProblem({ ...good, capacity: 6 }, old), null, 'an unchanged pax count is kept')
assert.equal(vehicleProblem({ capacity: '6' }, old), null, 'same number sent as text')
assert.equal(vehicleProblem({}, old), null, 'a change of driver only')
assert.equal(vehicleProblem({ isActive: false } as object, old), null, 'switching off')
assert.match(vehicleProblem({ capacity: 7 }, old)!, /must be/, 'a change must be valid')
assert.match(vehicleProblem({ type: 'car' }, old)!, /must be/, 'a new type is checked against the old pax')
assert.equal(vehicleProblem({ type: 'car', capacity: 3 }, old), null)
assert.match(vehicleProblem({ brand: '' }, old)!, /brand/, 'details cannot be blanked')
assert.equal(vehicleProblem({ capacity: 9 }, { type: 'Luxury Coach Legacy', capacity: 40 }), null, 'a legacy type label stays')

console.log('ok')
