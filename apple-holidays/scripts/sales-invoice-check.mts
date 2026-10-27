// READ-ONLY. Prints the Daily Sales Report's new-invoice figures for one day, per currency and per invoice.
//   npx tsx --env-file=.env scripts/sales-invoice-check.mts 2026-10-26
import { collectActivitySplit } from '../src/lib/reports/activity-split'
import { buildSalesWindow } from '../src/lib/reports/sales-report-data'
const day = process.argv[2] ?? '2026-10-26'
const w = buildSalesWindow('DAILY', 'Asia/Colombo', new Date(), null, null, { fromDate: day, toDate: day })
console.log('window', w.fromDate, w.start.toISOString(), w.end.toISOString())
const s = await collectActivitySplit(w)
if (!s.available) { console.log('ERR', s.error); process.exit(1) }
const by = new Map<string, { n: number; t: number }>()
for (const l of s.today.lines) { const r = by.get(l.currency) ?? { n: 0, t: 0 }; r.n++; r.t += l.amount; by.set(l.currency, r) }
console.log('new count', s.today.count, 'amended', s.old.count)
console.log(Object.fromEntries(by))
const sorted = [...s.today.lines].sort((a, b) => b.amount - a.amount)
for (const l of sorted) console.log([l.ref, l.invoiceNumber, l.type, l.currency, l.amount, l.agent.slice(0, 28), l.guest.slice(0, 22), l.raisedAt.slice(0, 16)].join(' | '))
const ov = new Map<string, number>(); s.old.lines.forEach(l => ov.set(l.currency, (ov.get(l.currency) ?? 0) + l.amount))
console.log('amended value', Object.fromEntries(ov))
process.exit(0)
