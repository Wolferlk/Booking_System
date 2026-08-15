/**
 * The thread ledger — every mail of a conversation, in both directions.
 *
 * A query's sheet row used to know two things about its own history: how many
 * *inbound* mails had folded into it, and the first name of whoever's Sent Items
 * a reply turned up in. Neither answers what the team was still opening Outlook
 * to find out — who wrote in, who answered them and when, who passed the thread
 * on to whom, and, over a thread that ran to a dozen mails, what actually
 * happened in it.
 *
 * So every mail of a thread is written down as an event, and everything the
 * workbook shows about the conversation is a roll-up of those events. Three
 * things follow from doing it this way rather than by widening the entry row:
 *
 * - **A forward stops being invisible.** A sent mail on the query's conversation
 *   that never went to the agent is a real event with a real recipient, and it
 *   is recorded as one — instead of being discarded because it was not a reply.
 * - **"Mails in Thread" can be honest.** It counts ours as well as theirs.
 * - **The summary can be rewritten.** A one-line reading of the *opening* mail
 *   can be written once and left alone; a reading of the *thread* is wrong the
 *   moment the next mail lands, so it is regenerated from the ledger whenever
 *   the ledger grows. See `threadSummaryInput`.
 *
 * Recording is idempotent on `eventKey`. Every sweep deliberately re-reads an
 * overlapping window of mail, so the same message is offered here over and over
 * and must land exactly once.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { INTERNAL_DOMAINS } from './constants'
import { domainOf } from './collect'

/** IN — from the agent to us. OUT — from one of the monitored mailboxes. */
export type EventDirection = 'IN' | 'OUT'

/**
 * What a message was, in thread terms.
 *
 * The three OUT kinds are the distinction the whole feature turns on: only a
 * REPLY answers the person who asked, and only a REPLY stops the SLA clock. A
 * FORWARD and an INTERNAL note both look identical to a reply from the
 * conversation id alone, which is exactly how "we replied at 09:12" used to get
 * recorded for a thread the agent did not hear back on until 14:40.
 */
export type EventKind = 'QUERY' | 'FOLLOW_UP' | 'REPLY' | 'FORWARD' | 'INTERNAL'

export interface ThreadEventInput {
  direction:    EventDirection
  kind:         EventKind
  actorName:    string
  actorAddress: string
  toAddresses:  string[]
  occurredAt:   Date
  subject:      string
  snippet?:     string | null
  /** internetMessageId when Graph gives one; the Graph id is the fallback key. */
  messageId?:   string | null
  graphId?:     string | null
}

/** An address book of our own people: lower-cased address → the name we show. */
export type Directory = ReadonlyMap<string, string>

/**
 * Build the directory from the monitored mailboxes, alias addresses included.
 *
 * A distribution group is in here too, and on purpose: "forwarded to Availcheck"
 * is a far more useful cell than "forwarded to availcheck@aahaas.com".
 */
export function buildDirectory(
  mailboxes: { email: string; displayName: string; aliasAddresses?: string }[],
): Directory {
  const dir = new Map<string, string>()
  for (const box of mailboxes) {
    dir.set(box.email.toLowerCase().trim(), box.displayName)
    for (const alias of (box.aliasAddresses ?? '').split(',')) {
      const address = alias.toLowerCase().trim()
      if (address) dir.set(address, box.displayName)
    }
  }
  return dir
}

/** Is this one of ours? */
export function isInternalAddress(address: string): boolean {
  return INTERNAL_DOMAINS.includes(domainOf(address))
}

/**
 * The name to print for an address.
 *
 * A monitored mailbox gives its own display name. Anyone else inside the tenant
 * — a colleague who is not on the monitor list, which is most of the company —
 * gets their local part tidied into something readable, because "Forwarded to
 * nuwan.perera@aahaas.com" in a spreadsheet cell is noise where "Nuwan Perera"
 * is information. An outside address is left exactly as it is: shortening an
 * agent's address would make the cell ambiguous.
 */
export function nameForAddress(address: string, directory: Directory): string {
  const lower = address.toLowerCase().trim()
  const known = directory.get(lower)
  if (known) return known
  if (!isInternalAddress(lower)) return lower

  const local = lower.slice(0, lower.indexOf('@'))
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || lower
}

/** Recipient addresses as names, de-duplicated, in the order they were on the mail. */
export function namesForAddresses(addresses: string[], directory: Directory): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const address of addresses) {
    const name = nameForAddress(address, directory)
    if (name && !seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}

/**
 * What a mail we sent on this thread actually was.
 *
 * The agent's own address on TO or CC is the only positive evidence that they
 * were answered, so it is tested first and nothing outranks it — a mail that
 * reaches the person who asked is a reply even if half the office is copied on
 * it. Everything else is ours-only traffic, split by whether it left the person
 * who sent it: something addressed to another human inside the tenant is a
 * hand-off, and a mail addressed to nobody we can name is a note.
 */
export function classifyOutbound(
  sent: { subject: string; recipients: string[] },
  askerAddress: string,
): Extract<EventKind, 'REPLY' | 'FORWARD' | 'INTERNAL'> {
  const asker = askerAddress.toLowerCase().trim()
  if (asker && sent.recipients.includes(asker)) return 'REPLY'

  const internalOthers = sent.recipients.filter(
    address => isInternalAddress(address) && address !== asker,
  )
  // An outside recipient who is not the asker is still someone being brought in
  // — a supplier being asked for a rate is a hand-off as much as a colleague is.
  const externalOthers = sent.recipients.filter(
    address => !isInternalAddress(address) && address !== asker,
  )

  return internalOthers.length + externalOthers.length > 0 ? 'FORWARD' : 'INTERNAL'
}

/** `entryId|messageId` — stable across sweeps, which is what makes recording idempotent. */
export function eventKeyFor(entryId: string, input: ThreadEventInput): string | null {
  const id = input.messageId ?? input.graphId
  return id ? `${entryId}|${id}`.slice(0, 190) : null
}

/**
 * Write one event, once.
 *
 * Returns true only when the row was actually created, so a caller can tell "the
 * thread grew" from "we have seen this mail before" without a second query —
 * which is what decides whether the sheet row needs rewriting.
 *
 * A failure here is swallowed on purpose. The ledger is enrichment: a reply that
 * could not be logged must still set `repliedAt` on the entry, because the SLA
 * the team is measured on does not depend on this table existing.
 */
export async function recordThreadEvent(
  entryId: string, input: ThreadEventInput, directory: Directory,
): Promise<boolean> {
  const eventKey = eventKeyFor(entryId, input)
  if (!eventKey) return false

  const toNames = namesForAddresses(input.toAddresses, directory)

  try {
    await prisma.queryMonitorThreadEvent.create({
      data: {
        entryId,
        eventKey,
        direction:    input.direction,
        kind:         input.kind,
        actorName:    input.actorName.slice(0, 180),
        actorAddress: input.actorAddress.slice(0, 180),
        toNames:      toNames.join(', ').slice(0, 500),
        toAddresses:  input.toAddresses.join(', ').slice(0, 500),
        occurredAt:   input.occurredAt,
        subject:      input.subject.slice(0, 500),
        snippet:      input.snippet?.slice(0, 1000) ?? null,
        messageId:    input.messageId?.slice(0, 255) ?? null,
      },
    })
    return true
  } catch (err) {
    // P2002 = the unique key already holds this message: the expected outcome on
    // every overlapping sweep, and not worth a log line.
    if ((err as { code?: string }).code === 'P2002') return false
    console.error('[QueryMonitor] thread event not recorded:',
      err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Move one entry's ledger onto another's, for the admin clean-up that folds
 * rows written before thread merging existed.
 *
 * `eventKey` carries the entry id, so it has to be rewritten rather than the
 * rows simply re-pointed — and rewriting it can collide, when both rows already
 * logged the same message. A collision is the mail being recorded twice, which
 * is precisely what the fold is undoing, so the loser is deleted.
 *
 * Returns how many events the receiving entry gained.
 */
export async function reassignThreadEvents(
  fromEntryId: string, toEntryId: string,
): Promise<number> {
  const events = await prisma.queryMonitorThreadEvent.findMany({
    where: { entryId: fromEntryId },
    take:  200,
  })

  let moved = 0
  for (const event of events) {
    const suffix = event.messageId ?? event.id
    try {
      await prisma.queryMonitorThreadEvent.update({
        where: { id: event.id },
        data:  { entryId: toEntryId, eventKey: `${toEntryId}|${suffix}`.slice(0, 190) },
      })
      moved += 1
    } catch {
      await prisma.queryMonitorThreadEvent.delete({ where: { id: event.id } }).catch(() => {})
    }
  }
  return moved
}

// ── Roll-ups ─────────────────────────────────────────────────────────────────

export type LedgerEvent = Prisma.QueryMonitorThreadEventGetPayload<Record<string, never>>

/** Everything the entry stores *about* its ledger, recomputed from the ledger. */
export interface ThreadRollUp {
  inboundCount:  number
  outboundCount: number
  replyType:     string | null
  forwardChain:  string | null
  lastActor:     string | null
  lastDirection: string | null
  lastMessageAt: Date | null
}

/**
 * Read the whole conversation back and fold it into the columns the sheet shows.
 *
 * `replyType` reports the *strongest* thing that has left the building, not the
 * latest: once the agent has been answered the thread is answered, and a
 * colleague being copied afterwards does not undo that. While no reply has gone
 * out, saying "Forwarded" or "Internal only" is precisely the useful thing —
 * that is a query somebody is sitting on.
 */
export function rollUp(events: readonly LedgerEvent[]): ThreadRollUp {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const inbound  = ordered.filter(e => e.direction === 'IN')
  const outbound = ordered.filter(e => e.direction === 'OUT')
  const last     = ordered[ordered.length - 1]

  const replyType = outbound.some(e => e.kind === 'REPLY')   ? 'DIRECT'
    :               outbound.some(e => e.kind === 'FORWARD') ? 'FORWARD'
    :               outbound.length > 0                      ? 'INTERNAL'
    :               null

  // "Sajid → Vishmika · Vishmika → Sudari" — every hand-off in the order it
  // happened, which is the question "who forwarded to who" asked literally.
  const hops = outbound
    .filter(e => e.kind === 'FORWARD' && e.toNames)
    .map(e => `${e.actorName || 'Someone'} → ${e.toNames}`)
    .filter((hop, i, all) => all.indexOf(hop) === i)

  return {
    // A thread whose ledger has not started yet still had one mail in it: the
    // query itself. Zero would read as "no mail", which is never true.
    inboundCount:  Math.max(inbound.length, 1),
    outboundCount: outbound.length,
    replyType,
    forwardChain:  hops.length > 0 ? hops.join(' · ').slice(0, 500) : null,
    lastActor:     last?.actorName || null,
    lastDirection: last?.direction ?? null,
    lastMessageAt: last?.occurredAt ?? null,
  }
}

/** Read the ledger for one entry and roll it up. */
export async function rollUpEntry(entryId: string): Promise<ThreadRollUp> {
  const events = await prisma.queryMonitorThreadEvent.findMany({
    where:   { entryId },
    orderBy: { occurredAt: 'asc' },
    take:    200,
  })
  return rollUp(events)
}

// ── Reading a thread back in words ───────────────────────────────────────────

const stamp = (date: Date) => date.toISOString().slice(0, 16).replace('T', ' ')

/**
 * The thread as a plain list of lines — one per mail, oldest first.
 *
 * This is what the dashboard's detail panel shows, and what the AI is handed to
 * summarise. It is deliberately the same text in both places: a summary the team
 * cannot check against the events it was written from is a summary they will
 * stop trusting the first time it is wrong.
 */
export function timelineLines(events: readonly LedgerEvent[]): string[] {
  return [...events]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map(event => {
      const who = event.actorName || event.actorAddress || 'Unknown'
      const to  = event.toNames ? ` → ${event.toNames}` : ''
      const verb = event.kind === 'QUERY'     ? 'asked'
        :          event.kind === 'FOLLOW_UP' ? 'wrote again'
        :          event.kind === 'REPLY'     ? 'replied'
        :          event.kind === 'FORWARD'   ? 'forwarded'
        :                                       'noted internally'
      const said = event.snippet ? ` — ${event.snippet.replace(/\s+/g, ' ').slice(0, 160)}` : ''
      return `${stamp(event.occurredAt)} · ${who} ${verb}${to}${said}`
    })
}

/**
 * What happened in the thread, in one sentence, without asking a model.
 *
 * This is what column AA carries whenever the AI switch is off, and what it
 * falls back to when a call fails. It says less than the model would, but it is
 * always true and it always costs nothing — and a team reading "3 mails from the
 * agent, answered by Sajid after 2 chasers" is already ahead of a blank cell.
 */
export function describeThread(events: readonly LedgerEvent[]): string | null {
  if (events.length === 0) return null

  const ordered  = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const inbound  = ordered.filter(e => e.direction === 'IN')
  const chasers  = inbound.filter(e => e.kind === 'FOLLOW_UP').length
  const reply    = ordered.find(e => e.kind === 'REPLY')
  const forwards = ordered.filter(e => e.kind === 'FORWARD')

  const parts: string[] = []

  const asker = inbound[0]?.actorName || inbound[0]?.actorAddress || 'The agent'
  parts.push(chasers > 0
    ? `${asker} wrote ${inbound.length} times (${chasers} chaser${chasers === 1 ? '' : 's'})`
    : `${asker} wrote once`)

  if (forwards.length > 0) {
    const hops = forwards.map(e => `${e.actorName} → ${e.toNames}`).join(', ')
    parts.push(`forwarded ${hops}`)
  }

  parts.push(reply
    ? `answered by ${reply.actorName} on ${stamp(reply.occurredAt)}`
    : 'not yet answered to the agent')

  const sentence = parts.join('; ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * Is this thread worth summarising at all, and has it moved since last time?
 *
 * A one-mail thread has nothing a thread summary can add over the AI Summary
 * that already reads that mail — so it is left blank rather than padded. Beyond
 * that the test is purely "did the ledger grow": re-summarising an unchanged
 * conversation is a paid call that produces the sentence already in the cell.
 */
export function needsThreadSummary(entry: {
  inboundCount: number; outboundCount: number; replySummaryEvents: number
}): boolean {
  const total = entry.inboundCount + entry.outboundCount
  return total > 1 && entry.replySummaryEvents < total
}
