/**
 * "Is this actually a query?" — the gate that decides which worksheet a mail
 * lands on.
 *
 * The file handlers' inboxes carry far more than new enquiries: hotel vouchers,
 * on-ground incidents, refund chases, availability checks, bare booking
 * references. Those still belong in the record — the team wants to see them —
 * but they must not sit in the query sheet, whose pivots measure response time
 * on new business.
 *
 * So nothing is dropped: a matching mail is marked EXCLUDED and written to the
 * second tab instead. The pattern list is a SystemSetting, editable from the
 * Configuration tab, because the shapes of this traffic change every month.
 */
import type { MailKind } from './constants'

export interface ExclusionPattern {
  /** The line as the user typed it — shown back in the UI and stored as the reason. */
  raw:     string
  isRegex: boolean
  test:    (subject: string) => boolean
}

/**
 * One pattern per line. `#` comments and blank lines are ignored, `/…/flags` is
 * a regular expression, everything else is a case-insensitive substring.
 *
 * A malformed regex degrades to a literal substring rather than throwing — a bad
 * character in a settings textarea must never take the sweep down.
 */
export function parseExcludePatterns(text: string | null | undefined): ExclusionPattern[] {
  const patterns: ExclusionPattern[] = []

  for (const line of (text ?? '').split('\n')) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) continue

    const delimited = raw.match(/^\/(.+)\/([gimsuy]*)$/)
    if (delimited) {
      try {
        // `g` would make `.test()` stateful across calls — strip it.
        const flags = delimited[2].replace(/g/g, '')
        const re = new RegExp(delimited[1], flags.includes('i') ? flags : `${flags}i`)
        patterns.push({ raw, isRegex: true, test: subject => re.test(subject) })
        continue
      } catch { /* not a valid regex — fall through to substring */ }
    }

    const needle = raw.toLowerCase()
    patterns.push({ raw, isRegex: false, test: subject => subject.toLowerCase().includes(needle) })
  }

  return patterns
}

export interface Classification {
  kind:   MailKind
  /** The pattern that excluded it, for the sheet's Reason column. Null when kept. */
  reason: string | null
}

/**
 * Matched against the subject only. Bodies carry quoted threads and signatures,
 * so a body match would exclude a genuine new query that merely replies below an
 * old voucher mail.
 */
export function classifySubject(subject: string, patterns: ExclusionPattern[]): Classification {
  const clean = (subject ?? '').trim()
  if (!clean) return { kind: 'QUERY', reason: null }

  const hit = patterns.find(p => p.test(clean))
  return hit ? { kind: 'EXCLUDED', reason: hit.raw } : { kind: 'QUERY', reason: null }
}
