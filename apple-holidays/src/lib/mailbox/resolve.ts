import { prisma } from '@/lib/prisma'
import type { MailAgent } from '@prisma/client'
import { normaliseAddresses } from './send'

/**
 * Turns a booking into "who is this mail going to?".
 *
 * A booking records its operator as a free-text string (`Booking.agent`) typed
 * or AI-extracted from a confirmation document, so it arrives spelled a dozen
 * ways: "Make My Trip", "MakeMyTrip Pvt Ltd", "MMT". Matching that against the
 * directory is therefore a normalise-then-widen ladder rather than an equality
 * test, and the compose window always shows *how* it matched so an operator can
 * see the difference between a certain hit and a guess — and override either.
 */

/** Lower-cased, punctuation and legal-suffix stripped, whitespace collapsed. */
export function normaliseAgentName(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[.,''`"()]/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llc|inc|co|company|travels?|tours?|holidays?|group)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type MatchReason = 'email' | 'exact' | 'alias' | 'partial' | 'none'

export interface AgentMatch {
  agent: MailAgent | null
  reason: MatchReason
  /** Every active agent whose normalised name overlaps — offered as alternatives. */
  candidates: MailAgent[]
}

function keysFor(agent: MailAgent): string[] {
  const raw = Array.isArray(agent.matchKeys) ? agent.matchKeys as unknown[] : []
  return [agent.name, agent.company ?? '', ...raw.map(k => String(k))]
    .map(normaliseAgentName)
    .filter(Boolean)
}

export async function matchAgentForBooking(booking: {
  agent?: string | null
  agentEmail?: string | null
}): Promise<AgentMatch> {
  const agents = await prisma.mailAgent.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  if (agents.length === 0) return { agent: null, reason: 'none', candidates: [] }

  // 1. The booking already carries an address, and it is one we know. This is
  //    the only signal that cannot be a spelling coincidence, so it wins.
  const email = booking.agentEmail?.trim().toLowerCase()
  if (email) {
    const byEmail = agents.find(a => {
      const cc = Array.isArray(a.ccEmails) ? (a.ccEmails as unknown[]).map(e => String(e).toLowerCase()) : []
      return a.primaryEmail.toLowerCase() === email || cc.includes(email)
    })
    if (byEmail) return { agent: byEmail, reason: 'email', candidates: [] }
  }

  const needle = normaliseAgentName(booking.agent)
  if (!needle) return { agent: null, reason: 'none', candidates: [] }

  // 2. Exact on the agent's own name.
  const exact = agents.find(a => normaliseAgentName(a.name) === needle)
  if (exact) return { agent: exact, reason: 'exact', candidates: [] }

  // 3. Exact on a configured alias or the company name.
  const alias = agents.find(a => keysFor(a).includes(needle))
  if (alias) return { agent: alias, reason: 'alias', candidates: [] }

  // 4. Containment either way — "mmt" inside "mmt india", or the booking's long
  //    "make my trip india" containing the directory's "make my trip". Ambiguity
  //    here is real, so a partial hit is proposed rather than assumed: every
  //    overlapping agent comes back as a candidate for the operator to pick.
  const partial = agents.filter(a =>
    keysFor(a).some(k => k.length >= 3 && (k.includes(needle) || needle.includes(k))),
  )
  if (partial.length === 1) return { agent: partial[0], reason: 'partial', candidates: partial }
  if (partial.length > 1)   return { agent: null, reason: 'partial', candidates: partial }

  return { agent: null, reason: 'none', candidates: [] }
}

export function agentAddresses(agent: MailAgent | null): { to: string[]; cc: string[] } {
  if (!agent) return { to: [], cc: [] }
  const cc = Array.isArray(agent.ccEmails) ? (agent.ccEmails as unknown[]).map(e => String(e)) : []
  return { to: normaliseAddresses([agent.primaryEmail]), cc: normaliseAddresses(cc) }
}

export interface InternalRecipient {
  id: string
  name: string
  email: string
  team: string | null
  alwaysCc: boolean
}

/**
 * The Aahaas team copy. `alwaysCc` rows are locked into the CC line of every
 * send — the compose window renders them as fixed chips, and the send endpoint
 * re-adds them server-side so a crafted request cannot drop the internal copy.
 */
export async function internalRecipients(): Promise<InternalRecipient[]> {
  const rows = await prisma.mailInternalRecipient.findMany({
    where: { isActive: true },
    orderBy: [{ alwaysCc: 'desc' }, { team: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, email: true, team: true, alwaysCc: true },
  })
  return rows
}

export async function alwaysCcAddresses(): Promise<string[]> {
  const rows = await prisma.mailInternalRecipient.findMany({
    where: { isActive: true, alwaysCc: true },
    select: { email: true },
  })
  return normaliseAddresses(rows.map(r => r.email))
}

/**
 * Honours the same `use_test_data` switch the existing senders read, so turning
 * test mode on diverts Mail Box too rather than leaving one sender live.
 */
export async function getMailTestMode(): Promise<{ enabled: boolean; to: string; cc: string }> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['use_test_data', 'test_email_1', 'test_email_2'] } },
  })
  const map: Record<string, string> = {}
  rows.forEach(r => { map[r.key] = r.value })
  return {
    enabled: map['use_test_data'] === 'true',
    to:      map['test_email_1'] ?? 'sasiofficial25@gmail.com',
    cc:      map['test_email_2'] ?? 'sasindu@aahaas.com',
  }
}
