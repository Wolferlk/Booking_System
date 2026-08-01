/**
 * Agent / channel name canonicalisation for reports.
 *
 * `Booking.agent` is free text typed by whoever raised the booking, so the same
 * partner arrives spelled several ways — "30 Sundays" / "30 SUNDAYS",
 * "Make My Trip" / "MMT", "Pick your trail" / "Pick Your Trial". Left alone they
 * split into separate rows and the "Top sources" table under-counts every one of
 * them.
 *
 * Two layers:
 *  1. `agentKey()` — a loose fingerprint (case, punctuation and spacing removed)
 *     that already merges the pure-casing variants.
 *  2. `ALIASES` — explicit groups for the cases a fingerprint cannot catch:
 *     abbreviations and known misspellings.
 *
 * Display name: an aliased group uses its canonical spelling; anything else uses
 * the variant that appears most often in the data, so we never invent a spelling
 * the business does not use.
 */

/** Loose fingerprint: lowercase, punctuation stripped, whitespace collapsed. */
function fingerprint(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Fingerprint → canonical display name. Add a row here whenever ops reports two
 * table rows that are really one partner.
 */
const ALIASES: Record<string, string> = {
  // Make My Trip
  'make my trip': 'Make My Trip',
  'makemytrip': 'Make My Trip',
  'mmt': 'Make My Trip',
  'mmt india': 'Make My Trip',
  'make my trip india': 'Make My Trip',
  // Pick Your Trail ("Trial" is a recurring typo)
  'pick your trail': 'Pick Your Trail',
  'pick your trial': 'Pick Your Trail',
  'pickyourtrail': 'Pick Your Trail',
  'pickyourtrial': 'Pick Your Trail',
  'pyt': 'Pick Your Trail',
  // 30 Sundays
  '30 sundays': '30 Sundays',
  '30sundays': '30 Sundays',
  'thirty sundays': '30 Sundays',
}

/** The grouping key: every spelling of one partner maps to the same string. */
export function agentKey(name: string | null | undefined): string {
  const fp = fingerprint(name ?? '')
  if (!fp) return 'unknown agent'
  const alias = ALIASES[fp]
  return alias ? fingerprint(alias) : fp
}

/** Canonical spelling for a known partner, or null when we have no opinion. */
export function canonicalAgentName(name: string | null | undefined): string | null {
  return ALIASES[fingerprint(name ?? '')] ?? null
}

/**
 * Roll rows up into canonical agent groups, counting bookings and pax.
 * Sorted busiest-first, which is the order the "Top sources" table wants.
 */
export function groupByAgent<T>(
  rows: T[],
  agentOf: (row: T) => string | null | undefined,
  paxOf: (row: T) => number,
): { agent: string; bookings: number; pax: number }[] {
  const groups = new Map<string, { bookings: number; pax: number; spellings: Map<string, number> }>()

  for (const row of rows) {
    const raw = (agentOf(row) ?? '').trim()
    const key = agentKey(raw)
    const entry = groups.get(key) ?? { bookings: 0, pax: 0, spellings: new Map<string, number>() }
    entry.bookings += 1
    entry.pax += paxOf(row)
    const label = raw || 'Unknown agent'
    entry.spellings.set(label, (entry.spellings.get(label) ?? 0) + 1)
    groups.set(key, entry)
  }

  return Array.from(groups.entries())
    .map(([key, entry]) => {
      const variants = Array.from(entry.spellings.entries())
      // Canonical spelling wins; otherwise the most-used variant, ties broken alphabetically.
      const display = canonicalAgentName(variants[0][0])
        ?? variants.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
      return { key, agent: display, bookings: entry.bookings, pax: entry.pax }
    })
    .sort((a, b) => b.bookings - a.bookings || a.agent.localeCompare(b.agent))
    .map(({ agent, bookings, pax }) => ({ agent, bookings, pax }))
}
