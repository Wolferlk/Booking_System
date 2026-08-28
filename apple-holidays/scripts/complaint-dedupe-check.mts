/**
 * Check complaint de-duplication — `npm run reports:dedupe`.
 *
 * The auto-report used to print the same guest complaint two or three times,
 * because `tbl_te_important_alerts` holds one row per call × category and a
 * guest who repeats himself produces a row each time. `complaint-dedupe` merges
 * those into one issue.
 *
 * Merging is the risky direction: a *missed* merge only repeats a card, but a
 * *wrong* merge hides a real complaint from the people who have to fix it. So
 * the cases below pin both edges — what must collapse, and what must never.
 *
 * No database and no credentials: pure fixtures through a pure function, cheap
 * enough to run on every change to the matching thresholds.
 */
import { dedupeComplaints, type DedupableComplaint } from '../src/lib/reports/complaint-dedupe'

let n = 0, bad = 0
const ok = (name: string, cond: boolean, extra?: unknown) => {
  n++; if (!cond) { bad++; console.log('FAIL:', name, extra ?? '') } else console.log('pass:', name)
}
const c = (o: Partial<DedupableComplaint>): DedupableComplaint => ({
  id: String(Math.random()), bookingRef: 'AH-1001', customerName: 'John Perera',
  category: 'hotel', severity: 'medium', status: 'open', title: null, details: null,
  customerQuote: null, resolutionNote: null, resolvedAt: null,
  createdAt: '2026-08-20T08:00:00.000Z', resolutionHours: null, ...o,
})

// 1. same issue restated on three calls
let r = dedupeComplaints([
  c({ id: '1', title: 'AC not working', details: 'Room AC not cooling', createdAt: '2026-08-20T08:00:00.000Z' }),
  c({ id: '2', title: 'AC not working', details: 'The AC in the room is still not cooling, guest upset', createdAt: '2026-08-20T14:00:00.000Z' }),
  c({ id: '3', title: 'Air conditioner not working', details: 'AC not cooling in room', createdAt: '2026-08-21T09:00:00.000Z', severity: 'high' }),
])
ok('3 repeats collapse to 1', r.length === 1, r.map(x => x.title))
ok('occurrences = 3', r[0]?.occurrences === 3)
ok('worst severity wins', r[0]?.severity === 'high')
ok('first raise kept', r[0]?.createdAt === '2026-08-20T08:00:00.000Z')
ok('last raise tracked', r[0]?.lastRaisedAt === '2026-08-21T09:00:00.000Z')

// 2. different issues on the same booking stay apart
r = dedupeComplaints([
  c({ id: '1', category: 'hotel', title: 'AC not working', details: 'Room AC not cooling' }),
  c({ id: '2', category: 'transport', title: 'Driver late', details: 'Driver arrived one hour late at airport' }),
])
ok('different issues stay separate', r.length === 2, r.map(x => x.title))

// 3. same wording, different bookings — never merge
r = dedupeComplaints([
  c({ id: '1', bookingRef: 'AH-1001', title: 'AC not working', details: 'Room AC not cooling' }),
  c({ id: '2', bookingRef: 'AH-2002', customerName: 'Nimal Silva', title: 'AC not working', details: 'Room AC not cooling' }),
])
ok('different bookings never merge', r.length === 2)

// 4. one open repeat keeps the whole issue open
r = dedupeComplaints([
  c({ id: '1', title: 'Dirty room', details: 'Bathroom not cleaned', status: 'resolved', resolvedAt: '2026-08-20T10:00:00.000Z', resolutionNote: 'Housekeeping sent' }),
  c({ id: '2', title: 'Dirty room again', details: 'Bathroom not cleaned properly', status: 'open', createdAt: '2026-08-21T08:00:00.000Z' }),
])
ok('a live repeat keeps it open', r.length === 1 && r[0].status === 'open', r.map(x => [x.status, x.occurrences]))

// 5. fully resolved: hours run from the FIRST raise
r = dedupeComplaints([
  c({ id: '1', title: 'Dirty room', details: 'Bathroom not cleaned', status: 'resolved', createdAt: '2026-08-20T00:00:00.000Z', resolvedAt: '2026-08-20T02:00:00.000Z' }),
  c({ id: '2', title: 'Dirty room', details: 'Bathroom not cleaned', status: 'resolved', createdAt: '2026-08-20T06:00:00.000Z', resolvedAt: '2026-08-20T10:00:00.000Z', resolutionNote: 'Deep cleaned' }),
])
ok('resolved when all resolved', r[0]?.status === 'resolved')
ok('age from first raise (10h)', r[0]?.resolutionHours === 10, r[0]?.resolutionHours)
ok('latest resolution note kept', r[0]?.resolutionNote === 'Deep cleaned')

// 6. cross-category near-identical text merges; loosely-related does not
r = dedupeComplaints([
  c({ id: '1', category: 'hotel', title: 'AC not working', details: 'AC not cooling in the room' }),
  c({ id: '2', category: 'general', title: 'AC not working', details: 'AC not cooling in the room' }),
])
ok('cross-category identical merges', r.length === 1)
r = dedupeComplaints([
  c({ id: '1', category: 'hotel', title: 'Room too small', details: 'Guest says the room is smaller than the photos' }),
  c({ id: '2', category: 'general', title: 'Breakfast poor', details: 'Very limited breakfast options at the hotel' }),
])
ok('cross-category unrelated stays apart', r.length === 2)

// 7. anonymous rows never merge
r = dedupeComplaints([
  c({ id: '1', bookingRef: null, customerName: null, title: 'AC not working', details: 'AC not cooling' }),
  c({ id: '2', bookingRef: null, customerName: null, title: 'AC not working', details: 'AC not cooling' }),
])
ok('anonymous rows never merge', r.length === 2)

// 8. chained restatement
r = dedupeComplaints([
  c({ id: '1', title: 'AC problem', details: 'AC problem', createdAt: '2026-08-20T01:00:00.000Z' }),
  c({ id: '2', title: 'AC problem room 302', details: 'AC problem in room 302', createdAt: '2026-08-20T02:00:00.000Z' }),
  c({ id: '3', title: 'Room 302 too hot', details: 'Room 302 problem, too hot, AC', createdAt: '2026-08-20T03:00:00.000Z' }),
])
ok('staged restatement chains', r.length === 1, r.map(x => x.title))

// 9. guest name/ref noise does not fake a match
r = dedupeComplaints([
  c({ id: '1', category: 'hotel', title: 'John Perera AH-1001 complaint', details: 'John Perera AH-1001 wifi password never worked' }),
  c({ id: '2', category: 'hotel', title: 'John Perera AH-1001 complaint', details: 'John Perera AH-1001 luggage was left behind at airport' }),
])
ok('name/ref noise stripped before scoring', r.length === 2, r.map(x => x.details))

console.log(`\n${n - bad}/${n} checks passed`)
process.exit(bad ? 1 : 0)
