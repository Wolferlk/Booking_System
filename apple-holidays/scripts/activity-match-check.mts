/**
 * Activity Check — keyword matcher check.
 *
 * The matcher is the one part of this feature with no visible failure mode: a
 * keyword that silently matches nothing looks exactly like a week with no Ba Na
 * Hills in it. These cases pin down the behaviour that makes it useful (missing
 * spaces, dropped letters, Vietnamese diacritics) and, just as importantly, the
 * precision that keeps it trustworthy — a loose matcher is worse than none.
 *
 * Pure functions only: no database, no network.
 *
 *   npm run activity:match
 */

import { normalise, termHits, parseTerms, snippetFor, resolvePreset } from '@/lib/activity-check'

const TITLES = [
  'Full-Day Ba Na Hill & Golden Hands Bridge with Cable Car Ride & Free Indian Lunch- Shared Transfers',
  'SIC Tour Bana Hills Cable Car',
  'Da Nang Airport to Danang Hotel Hotel Transfer on private basis',
  'Full-Day 5-Star Cruise with Kayaking, Sung Sot & Titop Islands, and Indian Lunch - Shared Transfers',
  'SIC Ninh Binh Full-day Tour (Bai Dinh - Trang An - Mua Cave)',
  'Đà Nẵng City Tour',
  'Hanoi Airport to Hanoi Hotel Transfer on private basis',
]

let failures = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { failures++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) }
  else console.log(`ok   ${label}`)
}

const hits = (term: string, fuzzy = true) =>
  TITLES.filter(t => termHits(normalise(t), term, fuzzy)).length

check('exact "Ba Na Hills" (fuzzy off) -> 1', hits('Ba Na Hills', false), 1)
check('typo "Bana hils" -> 2 (both Ba Na variants)', hits('Bana hils'), 2)
check('"bana hills" no-space -> 2', hits('bana hills'), 2)
check('diacritics "Da Nang" finds "Đà Nẵng" + others -> 2', hits('Da Nang', false), 2)
check('"ninh binh" -> 1', hits('ninh binh'), 1)
check('"cruise" -> 1', hits('cruise'), 1)
check('"transfer" -> 4', hits('transfer', false), 4)
check('nonsense "zzzqqq" -> 0', hits('zzzqqq'), 0)

check('parseTerms splits on comma', parseTerms('Ba Na Hills, Ninh Binh'), ['Ba Na Hills', 'Ninh Binh'])
check('parseTerms honours quotes', parseTerms('"Hue, Imperial City", Halong'), ['Hue, Imperial City', 'Halong'])
check('parseTerms dedupes case-insensitively', parseTerms('bana, BANA'), ['bana'])

const snip = snippetFor(TITLES[0], 'golden bridge')
check('snippet is non-empty and bounded', snip.length > 0 && snip.length <= 160, true)

// Monday-based weeks: "last week" must be a full Mon–Sun block strictly before this week.
const now = new Date('2026-09-10T12:00:00')  // a Thursday
const lw = resolvePreset('lastWeek', now)!
check('lastWeek starts Monday', lw.from.getDay(), 1)
check("lastWeek spans Mon 00:00 to Sun 23:59", Math.round((lw.to.getTime() - lw.from.getTime()) / 86400000), 7)
check('lastWeek from = 31 Aug 2026', lw.from.toDateString(), 'Mon Aug 31 2026')

// Precision guards for the loosened 4-char slack.
check('short "hue" does not match "the" in titles', hits('hue'), 0)
check('"cave" matches Mua Cave only', hits('cave'), 1)
check('"halong" (no space) finds nothing here, "kayaking" does', [hits('halong'), hits('kayaking')], [0, 1])
check('multi-word AND semantics: "golden bridge" -> 1', hits('golden bridge'), 1)
check('"golden lunch" also 1 (both words present)', hits('golden lunch'), 1)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
