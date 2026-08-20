/**
 * The small derivations every sheet row shares.
 *
 * These lived in run.ts, next to the row builders that use them. They moved here
 * when a second tab needed the same four answers: the all-mail ledger is written
 * *by* the sweep, so a module it imports cannot import the sweep back. Nothing
 * in here touches the database or the network — it is arithmetic on an entry.
 */

/**
 * How long the team took to answer, in hours to two decimals.
 *
 * A number, not "2h 15m": the column exists so the team can average it and sort
 * on it, which text cannot do. Blank while the query is still open — a zero
 * there would drag every average down and read as "answered instantly".
 */
export function responseHours(receivedAt: Date, repliedAt: Date | null): number | '' {
  if (!repliedAt) return ''
  const hours = (repliedAt.getTime() - receivedAt.getTime()) / 3_600_000
  // Clock skew between Graph's received and sent stamps can put a fast reply a
  // hair before the mail it answers; floor at zero rather than show a negative.
  return Number(Math.max(0, hours).toFixed(2))
}

/**
 * Met / Missed, which the Status column cannot say.
 *
 * Status is where the query stands *now* — Replied, Pending, Overdue. This is
 * whether the SLA was honoured, and the two come apart on exactly the row that
 * matters: a query answered six hours late reads "Replied" forever, and only
 * this column remembers that it was late.
 */
export function slaOutcome(
  receivedAt: Date, repliedAt: Date | null, slaHours: number,
): string {
  if (!repliedAt) return ''
  return repliedAt.getTime() - receivedAt.getTime() <= slaHours * 3_600_000 ? 'Met' : 'Missed'
}

/**
 * How many mails a row stands for — theirs and ours.
 *
 * Rows written before the ledger existed have an empty one, and `inboundCount`
 * defaults to 1 on every one of them. So the old counter is kept as a floor: a
 * row that folded in four chasers last week still says five, not one, and starts
 * counting our side of the conversation from the next mail that lands.
 */
export function threadMailCount(entry: {
  inboundCount: number; outboundCount: number; followUpCount: number
}): number {
  return Math.max(entry.inboundCount + entry.outboundCount, entry.followUpCount + 1)
}

/** The Reply Type column, in the team's words rather than the database's. */
export const REPLY_TYPE_SHEET_LABEL: Record<string, string> = {
  DIRECT:   'Direct reply',
  FORWARD:  'Forwarded on',
  INTERNAL: 'Internal only',
}
