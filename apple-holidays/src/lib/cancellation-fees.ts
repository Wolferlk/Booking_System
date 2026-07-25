/**
 * Cancellation fees entered on the cancellation request form.
 *
 * Each line is a free-text note and a numeric amount. The total is always the
 * server-computed sum of the line amounts — never trusted from the client.
 */

export type CancellationFeeLine = { note: string; amount: number }

/**
 * Normalise the raw `fees` array coming off a cancellation request body into a
 * clean list of { note, amount } lines. Blank lines (no note and no amount) and
 * non-finite / negative amounts are dropped. Notes are trimmed and capped so a
 * stray paste cannot bloat the JSON column.
 */
export function sanitizeCancellationFees(raw: unknown): CancellationFeeLine[] {
  if (!Array.isArray(raw)) return []
  const lines: CancellationFeeLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const note = String((item as Record<string, unknown>).note ?? '').trim().slice(0, 500)
    const amountNum = Number((item as Record<string, unknown>).amount)
    const amount = Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : 0
    // Drop lines that carry neither a note nor a charge.
    if (!note && amount === 0) continue
    lines.push({ note, amount })
  }
  return lines
}

/** Sum of the fee line amounts, rounded to 2 decimals. */
export function totalCancellationFee(lines: CancellationFeeLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + (l.amount || 0), 0) * 100) / 100
}
