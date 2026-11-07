/**
 * Ticket pack — server side. Read-only over bookings and tickets, always with
 * an explicit `select`: cost, portal and approval columns are never read, so
 * they cannot reach an agent.
 *
 * The link in a pack shows LIVE ticket status for the bookings that were sent,
 * not a frozen copy: a ticket uploaded after the message went out must be there
 * when the agent opens it. Which bookings the link covers is fixed by the run.
 */
import { prisma } from '@/lib/prisma'
import { testBookingWhere } from '@/lib/test-bookings'
import { loadTicketFiles, type TicketFileRow } from '@/lib/ticket-files'
import { getUpload, contentTypeFor } from '@/lib/storage'
import { normalizeUploadUrl } from '@/lib/upload-path'
import { addDays, agentMatches, todayIn, type DigestBooking, type DigestConfig, type DigestPayload, type DigestTicket, type DigestTicketFile } from './shared'
import {
  ACTIVE_EXCLUDED, agentLabelOf, bookingCountry, CONFIRMED_EXCLUDED, countryAllowed, dayDiff, displayCountry, ymd,
} from './scope'
import { ticketFilesAllowed, ticketInPack, ticketState, type TicketPackConfig } from './tickets-config'
import {
  countPack, packLinkExpiry, packPayload, passesHold, readyTickets, selectPackBookings,
  type PackBooking, type PriorSends,
} from './tickets-select'

const TICKET_SELECT = {
  id: true, type: true, qty: true, supplier: true, status: true, reference: true, category: true, activated: true,
  fileName: true, fileType: true, fileUrl: true,
  pnlLine: { select: { category: true } },
  agendaItem: { select: { date: true, location: true } },
} as const

const BOOKING_SELECT = {
  bookingRef: true, isNumber: true, cntlNumber: true, agent: true, operationCountry: true,
  arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true,
  hotelOnly: true, noTickets: true,
  passengers: { select: { name: true, isLead: true }, orderBy: [{ isLead: 'desc' as const }, { name: 'asc' as const }], take: 1 },
  tickets: { select: TICKET_SELECT, orderBy: { createdAt: 'asc' as const } },
}

function fileKind(type: string | null | undefined, name: string | null | undefined): DigestTicketFile['kind'] {
  const v = `${type ?? ''} ${name ?? ''}`.toLowerCase()
  if (v.includes('pdf')) return 'pdf'
  return /image|\.(jpe?g|png|webp|gif)/.test(v) ? 'image' : 'file'
}

type TicketRow = { id: string; type: string; qty: number; supplier: string | null; status: string; reference: string | null; category: string | null; activated: boolean; fileName: string | null; fileType: string | null; fileUrl: string | null; pnlLine: { category: string } | null; agendaItem: { date: Date; location: string | null } | null }

const ticketCategory = (t: Pick<TicketRow, 'category' | 'pnlLine'>) => t.category ?? t.pnlLine?.category ?? 'OTHER'

function toTicket(t: TicketRow, extra: TicketFileRow[], pack: TicketPackConfig): DigestTicket {
  const files: DigestTicketFile[] = []
  if (ticketFilesAllowed(pack, t)) {
    if (pack.includeMainFile && t.fileUrl) files.push({ id: `t-${t.id}`, name: t.fileName?.trim() || 'Ticket', kind: fileKind(t.fileType, t.fileName) })
    for (const f of extra) files.push({ id: `f-${f.id}`, name: f.label?.trim() || f.fileName?.trim() || 'Ticket', kind: fileKind(f.fileType, f.fileName) })
  }
  return {
    id: t.id, name: t.type, category: ticketCategory(t), qty: t.qty,
    date: t.agendaItem ? ymd(t.agendaItem.date) : null,
    location: t.agendaItem?.location?.trim() || null,
    reference: t.reference?.trim() || null,
    supplier: t.supplier?.trim() || null,
    state: ticketState(t, files.length),
    files,
  }
}

async function loadPackBookings(where: Record<string, unknown>, pack: TicketPackConfig): Promise<(PackBooking & { country: string | null })[]> {
  const rows = await prisma.booking.findMany({ where, select: BOOKING_SELECT, orderBy: { arrivalDate: 'asc' } })
  const extra = await loadTicketFiles(rows.flatMap(b => b.tickets.map(t => t.id)))
  return rows.map(b => {
    const arrival = ymd(b.arrivalDate)
    const departure = ymd(b.departureDate)
    const tickets = b.tickets
      .filter(t => ticketInPack(pack, ticketCategory(t)))
      .map(t => toTicket(t, extra[t.id] ?? [], pack))
      .sort((x, y) => (x.date ?? '9').localeCompare(y.date ?? '9'))
    const view: DigestBooking = {
      ref: b.bookingRef, tripNo: b.bookingRef, isNumber: b.isNumber?.trim() || null, cntlNumber: b.cntlNumber?.trim() || null,
      agent: b.agent, country: displayCountry(bookingCountry(b.operationCountry, b.bookingRef)),
      lead: b.passengers[0]?.name?.trim() || null,
      paxAdults: b.paxAdults, paxChildren: b.paxChildren, paxInfants: b.paxInfants,
      arrival, departure, dayNo: 0, totalDays: dayDiff(arrival, departure) + 1,
      hotel: null, flight: null, items: [],
      team: { drivers: [], driverVendors: [], guides: [], tourVendors: [] },
      missing: tickets.filter(t => !t.files.length).length,
      tickets,
    }
    return { view, waived: b.hotelOnly || b.noTickets, country: bookingCountry(b.operationCountry, b.bookingRef) }
  })
}

/** Bookings of this design arriving from `from` to `to`, inclusive. */
async function arrivingBetween(config: DigestConfig, from: string, to: string): Promise<PackBooking[]> {
  const excluded = config.statusFilter === 'CONFIRMED' ? CONFIRMED_EXCLUDED : ACTIVE_EXCLUDED
  const test = await testBookingWhere('exclude')
  const rows = await loadPackBookings({
    AND: [
      { status: { notIn: [...excluded] } },
      { cancelledAt: null },
      { arrivalDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) } },
      ...(test.clause ? [test.clause] : []),
    ],
  }, config.ticketPack)
  return rows.filter(r => agentMatches(r.view.agent, config.agents) && countryAllowed(r.country, config.countries))
}

/** A send more than this long ago cannot matter to a booking still ahead of us. */
const PRIOR_LOOKBACK_DAYS = 35

/** What earlier sends of this rule really delivered. Tests and fully failed runs do not count. */
async function priorSends(ruleId: string, runDate: string): Promise<{ prior: PriorSends; sentOn: Map<string, string> }> {
  const sends = await prisma.agentDigestSend.findMany({
    where: { ruleId, status: 'sent', trigger: { not: 'test' }, runDate: { gte: addDays(runDate, -PRIOR_LOOKBACK_DAYS), lte: runDate } },
    select: { runId: true }, distinct: ['runId'],
  })
  const ids = sends.map(s => s.runId).filter((id): id is string => !!id)
  const prior: PriorSends = new Map()
  const sentOn = new Map<string, string>()
  if (!ids.length) return { prior, sentOn }
  const runs = await prisma.agentDigestRun.findMany({ where: { id: { in: ids } }, select: { payload: true, runDate: true }, orderBy: { runDate: 'asc' } })
  for (const run of runs) {
    for (const blk of (run.payload as unknown as DigestPayload).blocks ?? []) {
      for (const b of blk.bookings ?? []) {
        const ready = prior.get(b.ref) ?? new Set<string>()
        for (const t of readyTickets(b)) ready.add(t.id)
        prior.set(b.ref, ready)
        if (!sentOn.has(b.ref)) sentOn.set(b.ref, run.runDate)
      }
    }
  }
  return { prior, sentOn }
}

/** Builds the pack for one send day. Pure read. */
export async function buildTicketPayload(config: DigestConfig, runDate: string, ruleName: string, ruleId: string | null): Promise<DigestPayload> {
  const pack = config.ticketPack
  const [bookings, history] = await Promise.all([
    arrivingBetween(config, runDate, addDays(runDate, pack.daysBefore)),
    ruleId ? priorSends(ruleId, runDate) : Promise.resolve(null),
  ])
  const selection = selectPackBookings(bookings, runDate, pack, history?.prior ?? null)
  return packPayload(selection, config, runDate, ruleName, agentLabelOf(config))
}

export const packRefs = (p: DigestPayload) => new Set(p.blocks.flatMap(b => b.bookings.map(x => x.ref)))

export function isPackExpired(p: DigestPayload, config: DigestConfig, now = new Date()): boolean {
  return todayIn('Asia/Colombo', now) > packLinkExpiry(p, config.ticketPack)
}

/** The pack as it stands now: same bookings, current tickets. A cancelled booking drops out. */
export async function refreshPack(stored: DigestPayload, config: DigestConfig): Promise<DigestPayload> {
  const rows = await loadPackBookings({
    bookingRef: { in: Array.from(packRefs(stored)) }, cancelledAt: null, status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] },
  }, config.ticketPack)
  const now = new Map(rows.map(r => [r.view.ref, r.view]))
  const blocks = stored.blocks.map(blk => ({
    ...blk,
    bookings: blk.bookings.flatMap(old => {
      const cur = now.get(old.ref)
      if (!cur) return []
      const before = new Set(readyTickets(old).map(t => t.id))
      return [{ ...cur, reason: old.reason, tickets: cur.tickets?.map(t => (t.files.length && !before.has(t.id) ? { ...t, isNew: true } : t)) }]
    }),
  })).filter(b => b.bookings.length)
  const n = countPack(blocks)
  return {
    ...stored, blocks, generatedAt: new Date().toISOString(),
    totals: { bookings: n.bookings, lines: n.tickets, missing: n.tickets - n.ready },
    pack: { ...stored.pack!, ready: n.ready, files: n.files, held: [] },
  }
}

// ── Downloads ────────────────────────────────────────────────────────────────

export interface PackFile { name: string; contentType: string; data: Uint8Array }

/** Only images and PDFs are served; anything else downloads as opaque bytes. */
const SAFE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

const S3_HOST = /^s3[.-][a-z0-9-]+\.amazonaws\.com$|^s3\.amazonaws\.com$/i

async function readStored(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const clean = normalizeUploadUrl(url)
  if (!clean) return null
  if (clean.startsWith('/api/uploads/')) {
    return getUpload(decodeURIComponent(clean.slice('/api/uploads/'.length)))
  }
  // Some live rows point straight at the public bucket. Fetched here rather than
  // redirected, so "Download all" can read them from our own origin.
  let parsed: URL
  try { parsed = new URL(clean) } catch { return null }
  if (parsed.protocol !== 'https:' || !S3_HOST.test(parsed.hostname)) return null
  const res = await fetch(parsed, { redirect: 'error' })
  if (!res.ok) return null
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? contentTypeFor(parsed.pathname) }
}

function safeFileName(ref: string, name: string, contentType: string): string {
  const base = `${ref}-${name}`.replace(/[^\wÀ-ɏ ._()-]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType]
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base
}

/**
 * One file of a pack, or null. Every rule is checked again against the current
 * ticket, whatever the message said: the booking must be in this run and not
 * cancelled, and the ticket must still be shareable.
 */
export async function readPackFile(stored: DigestPayload, config: DigestConfig, fileId: string): Promise<PackFile | null> {
  const pack = config.ticketPack
  const [prefix, id] = [fileId.slice(0, 2), fileId.slice(2)]
  if (!id || (prefix !== 't-' && prefix !== 'f-')) return null

  const row = prefix === 'f-'
    ? await prisma.ticketFile.findUnique({ where: { id }, select: { ticketId: true, fileUrl: true, fileName: true, label: true } })
    : null
  if (prefix === 'f-' && !row) return null
  const ticket = await prisma.ticket.findUnique({
    where: { id: row?.ticketId ?? id },
    select: {
      activated: true, status: true, type: true, category: true, fileUrl: true, fileName: true,
      pnlLine: { select: { category: true } },
      booking: { select: { bookingRef: true, status: true, cancelledAt: true } },
    },
  })
  if (!ticket || !packRefs(stored).has(ticket.booking.bookingRef)) return null
  if (ticket.booking.cancelledAt || ['CANCELLED', 'PENDING_CANCELLATION'].includes(ticket.booking.status)) return null
  if (!ticketFilesAllowed(pack, ticket) || !ticketInPack(pack, ticketCategory(ticket))) return null
  if (prefix === 't-' && !pack.includeMainFile) return null

  const url = prefix === 'f-' ? row!.fileUrl : ticket.fileUrl
  if (!url) return null
  const file = await readStored(url)
  if (!file) return null
  const contentType = SAFE_TYPES.includes(file.contentType) ? file.contentType : 'application/octet-stream'
  const label = (prefix === 'f-' ? row!.label || row!.fileName : ticket.fileName) || ticket.type
  return { name: safeFileName(ticket.booking.bookingRef, label, contentType), contentType, data: new Uint8Array(file.buffer) }
}

// ── Radar: what is coming up, for the desk ───────────────────────────────────

export interface RadarRow {
  ref: string
  lead: string | null
  agent: string | null
  arrival: string
  /** The day this booking goes out: arrival minus the rule's days. */
  sendDay: string
  tickets: number
  ready: number
  counts: Record<string, number>
  stage: 'SENT' | 'WAIVED' | 'NO_TICKETS' | 'HELD' | 'TODAY' | 'LATE' | 'UPCOMING'
  sentOn: string | null
}

export async function ticketRadar(config: DigestConfig, ruleId: string | null, days: number, now = new Date(), tz = 'Asia/Colombo'): Promise<{ today: string; rows: RadarRow[] }> {
  const today = todayIn(tz, now)
  const pack = config.ticketPack
  const [bookings, history] = await Promise.all([
    arrivingBetween(config, today, addDays(today, days)),
    ruleId ? priorSends(ruleId, today) : Promise.resolve(null),
  ])
  const rows = bookings.map(({ view: b, waived }): RadarRow => {
    const tickets = b.tickets ?? []
    const counts: Record<string, number> = {}
    for (const t of tickets) counts[t.state] = (counts[t.state] ?? 0) + 1
    const sendDay = addDays(b.arrival, -pack.daysBefore)
    const sentOn = history?.sentOn.get(b.ref) ?? null
    const stage: RadarRow['stage'] = waived ? 'WAIVED'
      : sentOn ? 'SENT'
      : !tickets.length ? 'NO_TICKETS'
      : sendDay > today ? 'UPCOMING'
      : !passesHold(pack, b) ? 'HELD'
      : sendDay === today ? 'TODAY' : 'LATE'
    return { ref: b.ref, lead: b.lead, agent: b.agent, arrival: b.arrival, sendDay, tickets: tickets.length, ready: readyTickets(b).length, counts, stage, sentOn }
  })
  return { today, rows }
}
