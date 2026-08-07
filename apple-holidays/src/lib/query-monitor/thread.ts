/**
 * Thread identity for the Query Monitor.
 *
 * The sheet is read as one line per *query*, not one line per mail. An agent
 * who chases the same quote three times before lunch produced one query, and
 * the team wants that row rewritten with the latest state — not three rows
 * carrying the same subject, which is what a per-message key gives you.
 *
 * Two mails belong to the same thread when either
 *   1. Graph gives them the same `conversationId` — the reliable case, which
 *      covers every "Re:" of a mail we received, or
 *   2. they carry the same normalised subject *and* come from the same domain,
 *      and that subject contains a reference number — which catches the chaser
 *      sent as a brand-new mail rather than a reply.
 *
 * The reference-number condition on (2) is the whole safety of the fallback.
 * Agencies send dozens of mails a week titled exactly "Urgent quote required";
 * collapsing those into one row would hide real queries, which is far worse
 * than a duplicate. A subject like "Re: URGENT QUOTE | 3501051 | Naga Suresh
 * Naidu" names one specific query and is safe to thread on.
 */

/** Repeated Re:/Fw:/Fwd:/Aw:/Tr: prefixes, including Outlook's "Re[2]:". */
const REPLY_PREFIX = /^(?:\s*(?:re|fw|fwd|aw|tr)\s*(?:\[\d+\])?\s*:)+\s*/i

/**
 * Does the subject name one specific query?
 *
 * A run of 5+ digits is a booking / query / CNTL reference. Exactly four digits
 * counts too, unless it reads as a year: "SRILANKA // 15 ADULTS // JAN 3RD WEEK
 * 2027" is a subject template, not an identifier, and two agents can write it
 * about two different groups.
 */
function hasReference(subject: string): boolean {
  const runs = subject.match(/\d{4,}/g)
  if (!runs) return false
  return runs.some(run => run.length > 4 || Number(run) < 1900 || Number(run) > 2099)
}

/** The subject with reply prefixes, padding and case differences taken out. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(REPLY_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * `fromDomain|subject` — the thread key for mail with no conversationId, and
 * the tie-breaker that catches a chaser sent as a brand-new mail rather than a
 * reply. Null when the subject is too generic to be sure it names one query.
 */
export function subjectKeyFor(message: { subject: string; fromDomain: string }): string | null {
  const subject = normalizeSubject(message.subject)
  if (!subject || !hasReference(subject)) return null
  return `${message.fromDomain}|${subject}`.slice(0, 190)
}

/** What goes in the entry's `threadKey` column. */
export function threadKeyFor(message: {
  subject: string; fromDomain: string; conversationId: string | null
}): string | null {
  return message.conversationId?.slice(0, 190) ?? subjectKeyFor(message)
}
