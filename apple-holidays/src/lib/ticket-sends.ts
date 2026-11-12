/**
 * Tickets Sent — issued tickets go to the guest on WhatsApp, once each.
 *
 * Every day at the configured time (default 14:30 Asia/Colombo) the sweep looks
 * at every live booking still to travel and sends the guest every ticket that
 * is *issued* — active, purchased or paid, with a file attached — and has not
 * been sent before. A ticket that is not issued yet simply waits for a later
 * day; nothing half-done ever goes out.
 *
 * The message is the ticket list (what, which day, reference) followed by each
 * file as a photo / PDF. Outside the guest's 24h window free-form media is
 * dropped by Meta, so the text goes through the approved guest template
 * (`deliverToGuest`) and carries a download link per file instead.
 *
 * What was sent is remembered per booking in `system_settings`
 * (`ticket_sent:<ref>` → { ticketId: { at, files, mode, by } }), so the sweep,
 * the manual "Send now" button and the Ops Board all read one record.
 * **No schema change.**
 *
 * Backlog guard: on first use the module stamps `ticket_sends_since`. The
 * automatic sweep only sends tickets issued after that moment, so switching
 * this on never fires every ticket ever issued at every guest at once. Older
 * tickets are sent with the per-booking button.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalisePhone, sendWhatsAppMedia, isWithin24hWindow } from '@/lib/whatsapp'
import { deliverToGuest, liveBookingWhere, getSuperPartners, nowInTz } from '@/lib/customer-whatsapp-automation'
import { isSuperPartner } from '@/lib/super-partners'
import type { BrandAudience } from '@/lib/customer-branding'
import { loadTicketFiles } from '@/lib/ticket-files'

// ── Settings ──────────────────────────────────────────────────────────────────

export const SETTING_TICKET_SENDS      = 'auto_whatsapp_ticket_sends_enabled'
export const SETTING_TICKET_SENDS_TIME = 'auto_whatsapp_ticket_sends_time'
const SETTING_LAST_RUN = 'ticket_sends_last_run_date'
const SETTING_SINCE    = 'ticket_sends_since'
const LEDGER_PREFIX    = 'ticket_sent:'

export const TAG_TICKETS_SENT = '[TICKETS-SENT]'
export const TICKET_SENDS_TZ  = 'Asia/Colombo'
export const DEFAULT_TICKET_SENDS_TIME = '14:30'

const ISSUED_STATUSES = ['PURCHASED', 'PAID'] as const

export interface TicketSendsConfig {
  enabled: boolean
  time: string        // "HH:MM", Asia/Colombo
  since: string       // ISO — the automatic sweep's backlog cut-off
  lastRunDate: string | null
}

function normTime(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

export async function getTicketSendsConfig(): Promise<TicketSendsConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_TICKET_SENDS, SETTING_TICKET_SENDS_TIME, SETTING_SINCE, SETTING_LAST_RUN] } },
  })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  let since = map.get(SETTING_SINCE)
  if (!since || isNaN(Date.parse(since))) {
    since = new Date().toISOString()
    await prisma.systemSetting.upsert({
      where: { key: SETTING_SINCE }, update: { value: since }, create: { key: SETTING_SINCE, value: since },
    }).catch(() => {})
  }
  return {
    // Default ON when the row does not exist yet, like the daily briefing.
    enabled: map.get(SETTING_TICKET_SENDS) !== 'false',
    time: normTime(map.get(SETTING_TICKET_SENDS_TIME)) ?? DEFAULT_TICKET_SENDS_TIME,
    since,
    lastRunDate: map.get(SETTING_LAST_RUN) || null,
  }
}

export async function saveTicketSendsConfig(patch: { enabled?: boolean; time?: string }): Promise<TicketSendsConfig> {
  if (typeof patch.enabled === 'boolean') {
    const value = String(patch.enabled)
    await prisma.systemSetting.upsert({
      where: { key: SETTING_TICKET_SENDS }, update: { value }, create: { key: SETTING_TICKET_SENDS, value },
    })
  }
  if (patch.time !== undefined) {
    const t = normTime(patch.time)
    if (!t) throw new Error('Time must be HH:MM (24-hour)')
    await prisma.systemSetting.upsert({
      where: { key: SETTING_TICKET_SENDS_TIME }, update: { value: t }, create: { key: SETTING_TICKET_SENDS_TIME, value: t },
    })
  }
  return getTicketSendsConfig()
}

// ── Ledger ────────────────────────────────────────────────────────────────────

export interface SentMark {
  at: string
  files: number
  /** `media` = files went as photos/PDFs; `links` = outside the 24h window, links only. */
  mode: 'media' | 'links'
  by: string
}
export type TicketLedger = Record<string, SentMark>

async function readLedger(ref: string): Promise<TicketLedger> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LEDGER_PREFIX + ref } })
    const parsed = row?.value ? JSON.parse(row.value) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeLedger(ref: string, ledger: TicketLedger): Promise<void> {
  const value = JSON.stringify(ledger)
  await prisma.systemSetting.upsert({
    where: { key: LEDGER_PREFIX + ref }, update: { value }, create: { key: LEDGER_PREFIX + ref, value },
  })
}

export async function readLedgers(refs: string[]): Promise<Map<string, TicketLedger>> {
  const out = new Map<string, TicketLedger>()
  if (!refs.length) return out
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: refs.map((r) => LEDGER_PREFIX + r) } },
  }).catch(() => [])
  for (const r of rows) {
    try { out.set(r.key.slice(LEDGER_PREFIX.length), JSON.parse(r.value)) } catch { /* skip a bad row */ }
  }
  return out
}

// ── What counts as "issued" ───────────────────────────────────────────────────

const ISSUED_WHERE: Prisma.TicketWhereInput = {
  activated: true,
  status: { in: [...ISSUED_STATUSES] },
}

interface IssuedTicket {
  id: string
  label: string
  reference: string | null
  qty: number
  date: string | null          // the movement's day, yyyy-mm-dd
  issuedAt: Date
  files: { url: string; name: string; kind: 'image' | 'document' }[]
}

const ticketLabel = (t: { category: string | null; type: string }) => t.category?.trim() || t.type || 'Ticket'

function absolute(url: string): string | null {
  if (/^https:\/\//i.test(url)) return url
  const app = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
  if (!app || !url.startsWith('/')) return null
  const full = `${app}${url}`
  return /^https:\/\//i.test(full) ? full : null
}

function kindOf(type: string | null | undefined, name: string | null | undefined): 'image' | 'document' {
  if (type === 'image' || /^image\//.test(type ?? '')) return 'image'
  return /\.(jpe?g|png|webp)$/i.test(name ?? '') ? 'image' : 'document'
}

/**
 * The tickets on one booking that are issued and still useful: active,
 * purchased or paid, carrying at least one file, and for a movement that has
 * not already happened (booking-level tickets always count).
 */
async function loadIssuedTickets(bookingId: string, today: string): Promise<IssuedTicket[]> {
  const tickets = await prisma.ticket.findMany({
    where: { bookingId, ...ISSUED_WHERE },
    select: {
      id: true, type: true, category: true, reference: true, qty: true,
      fileUrl: true, fileName: true, fileType: true, purchasedAt: true, updatedAt: true,
      agendaItem: { select: { date: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const extra = await loadTicketFiles(tickets.map((t) => t.id))

  const out: IssuedTicket[] = []
  for (const t of tickets) {
    const date = t.agendaItem?.date ? t.agendaItem.date.toISOString().slice(0, 10) : null
    if (date && date < today) continue
    const files: IssuedTicket['files'] = []
    const seen = new Set<string>()
    const push = (u: string | null | undefined, n: string | null | undefined, k: string | null | undefined) => {
      const url = u ? absolute(u) : null
      if (!url || seen.has(url)) return
      seen.add(url)
      files.push({ url, name: n || `${ticketLabel(t)}.${kindOf(k, n) === 'image' ? 'jpg' : 'pdf'}`, kind: kindOf(k, n) })
    }
    push(t.fileUrl, t.fileName, t.fileType)
    for (const f of extra[t.id] ?? []) push(f.fileUrl, f.fileName ?? f.label, f.fileType)
    if (!files.length) continue
    out.push({
      id: t.id, label: ticketLabel(t), reference: t.reference, qty: t.qty, date,
      issuedAt: t.purchasedAt ?? t.updatedAt, files,
    })
  }
  return out
}

// ── The message ───────────────────────────────────────────────────────────────

function dayLabel(ymd: string | null): string {
  if (!ymd) return ''
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

export function formatTicketsMessage(p: {
  bookingRef: string
  leadName: string | null
  tickets: IssuedTicket[]
  withLinks: boolean
}): string {
  const first = (p.leadName ?? '').trim().split(/\s+/)[0]
  const lines: string[] = [
    `🎫 *Your tickets are ready* — ${p.bookingRef}`,
    '',
    `${first ? `Dear ${first}, h` : 'H'}ere ${p.tickets.length === 1 ? 'is the ticket' : `are the ${p.tickets.length} tickets`} issued for your trip:`,
    '',
  ]
  p.tickets.forEach((t, i) => {
    const bits = [dayLabel(t.date), t.qty > 1 ? `${t.qty} pax` : null, t.reference ? `Ref ${t.reference}` : null]
      .filter(Boolean).join(' · ')
    lines.push(`${i + 1}. *${t.label}*${bits ? ` — ${bits}` : ''}`)
    if (p.withLinks) t.files.forEach((f) => lines.push(`   📎 ${f.url}`))
  })
  lines.push('')
  lines.push(p.withLinks
    ? 'Please open each link to download your ticket and keep it on your phone for the day.'
    : 'Your ticket files follow below — please keep them on your phone for the day.')
  lines.push('Have a wonderful trip! 🌴')
  return lines.join('\n')
}

// ── Sending one booking ───────────────────────────────────────────────────────

export interface TicketSendResult {
  ok: boolean
  sent: number          // tickets sent now
  files: number
  mode?: 'media' | 'links'
  reason?: string
  message?: string
}

/**
 * Send this booking's issued, not-yet-sent tickets to the guest.
 *   opts.force   — resend every issued ticket, sent before or not
 *   opts.since   — only tickets issued after this moment (the automatic sweep)
 *   opts.dryRun  — build the message, send nothing, record nothing
 */
export async function sendTicketsForBooking(
  bookingRef: string,
  opts: { force?: boolean; since?: Date; dryRun?: boolean; by?: string } = {},
): Promise<TicketSendResult> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, status: true, agent: true,
      contactWhatsapp: true, contactPhone: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
    },
  })
  if (!b) return { ok: false, sent: 0, files: 0, reason: 'Booking not found' }
  if (b.status === 'CANCELLED') return { ok: false, sent: 0, files: 0, reason: 'Booking is cancelled' }

  const today = nowInTz(TICKET_SENDS_TZ).date
  const ledger = await readLedger(bookingRef)
  let due = (await loadIssuedTickets(b.id, today)).filter((t) => opts.force || !ledger[t.id])
  if (opts.since) due = due.filter((t) => t.issuedAt >= opts.since!)
  if (!due.length) return { ok: false, sent: 0, files: 0, reason: 'No issued tickets waiting to be sent' }

  const phone = b.contactWhatsapp || b.contactPhone
  if (!phone || !normalisePhone(phone)) {
    return { ok: false, sent: 0, files: 0, reason: 'No WhatsApp/phone contact on this booking' }
  }

  // Inside the window the files go as photos/PDFs; outside it media is dropped
  // by Meta, so the text carries a link per file instead.
  const windowOpen = await isWithin24hWindow(phone)
  const mode: 'media' | 'links' = windowOpen ? 'media' : 'links'
  const leadName = b.passengers[0]?.name ?? null
  const msg = formatTicketsMessage({ bookingRef, leadName, tickets: due, withLinks: !windowOpen })
  const fileCount = due.reduce((s, t) => s + t.files.length, 0)
  if (opts.dryRun) return { ok: true, sent: due.length, files: fileCount, mode, message: msg }

  const audience: BrandAudience = isSuperPartner(b.agent, await getSuperPartners()) ? 'superPartnerGuest' : 'guest'
  const tag = `${TAG_TICKETS_SENT} ${leadName ?? 'Guest'}`
  const sent = await deliverToGuest({ phone, text: msg, guestName: leadName, bookingRef, tag, audience })
  if (!sent.ok) return { ok: false, sent: 0, files: fileCount, reason: sent.reason ?? 'WhatsApp send failed', message: msg }

  await prisma.whatsAppMessage.create({
    data: {
      bookingRef, phone: normalisePhone(phone), direction: 'outbound', body: msg,
      waMessageId: sent.waMessageId, status: 'sent', senderName: tag,
    },
  })

  if (windowOpen) {
    for (const t of due) {
      for (const f of t.files) {
        try {
          await sendWhatsAppMedia(phone, f.url, f.kind, {
            caption: `🎫 ${t.label}${t.reference ? ` · Ref ${t.reference}` : ''} — ${bookingRef}`,
            filename: f.name,
            audience,
          })
        } catch (err) {
          console.error(`[TicketSends] media failed for ${bookingRef}/${t.id}:`, err)
        }
      }
    }
  }

  const at = new Date().toISOString()
  const by = opts.by ?? 'Automatic (daily ticket send)'
  const next: TicketLedger = { ...(await readLedger(bookingRef)) }
  for (const t of due) next[t.id] = { at, files: t.files.length, mode, by }
  await writeLedger(bookingRef, next)

  return { ok: true, sent: due.length, files: fileCount, mode, message: msg }
}

// ── The daily sweep ───────────────────────────────────────────────────────────

export interface TicketSweepResult { ran: boolean; reason?: string; bookings: number; tickets: number; errors: string[] }

/**
 * Send today's batch if it is due: switched on, past the send time in Colombo,
 * not yet run today. Called by the customer WhatsApp 5-minute tick and by the
 * daily-briefing cron route, so it runs on Amplify without a new cron.
 */
export async function runDueTicketSends(force = false): Promise<TicketSweepResult> {
  const res: TicketSweepResult = { ran: false, bookings: 0, tickets: 0, errors: [] }
  const cfg = await getTicketSendsConfig()
  const now = nowInTz(TICKET_SENDS_TZ)
  if (!force) {
    if (!cfg.enabled) return { ...res, reason: 'disabled' }
    const [h, m] = cfg.time.split(':').map(Number)
    if (now.minutes < h * 60 + m) return { ...res, reason: 'before-time' }
    if (cfg.lastRunDate === now.date) return { ...res, reason: 'already-ran-today' }
    // Claim the day before sending — a second caller sees it and stops.
    const claimed = cfg.lastRunDate === null
      ? await prisma.systemSetting.create({ data: { key: SETTING_LAST_RUN, value: now.date } }).then(() => true, () => false)
      : (await prisma.systemSetting.updateMany({
          where: { key: SETTING_LAST_RUN, value: cfg.lastRunDate }, data: { value: now.date },
        })).count === 1
    if (!claimed) return { ...res, reason: 'already-ran-today' }
  }
  res.ran = true

  const since = new Date(cfg.since)
  const candidates = await prisma.booking.findMany({
    where: {
      AND: [await liveBookingWhere()],
      departureDate: { gte: new Date(`${now.date}T00:00:00.000Z`) },
      OR: [{ contactWhatsapp: { not: null } }, { contactPhone: { not: null } }],
      tickets: { some: { ...ISSUED_WHERE, OR: [{ purchasedAt: { gte: since } }, { purchasedAt: null, updatedAt: { gte: since } }] } },
    },
    select: { bookingRef: true },
    take: 500,
  })

  for (const { bookingRef } of candidates) {
    try {
      const r = await sendTicketsForBooking(bookingRef, { since })
      if (r.ok) { res.bookings++; res.tickets += r.sent }
    } catch (err) {
      res.errors.push(`${bookingRef}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`[TicketSends] ${now.date}: ${res.tickets} ticket(s) to ${res.bookings} guest(s), ${res.errors.length} error(s)`)
  return res
}

// ── Status for the Ops Board ──────────────────────────────────────────────────

export interface TicketSendStatus {
  /** Issued tickets (with files) still relevant for this trip. */
  issued: number
  /** …of those, already sent to the guest. */
  sent: number
  /** Tickets on the file that are not issued yet. */
  notIssued: number
  lastSentAt: string | null
  /** Any of the sends went as links only (guest outside the 24h window). */
  linksOnly: boolean
}

/** One query per table for the whole board. Never throws. */
export async function loadTicketSendStatus(
  bookings: { id: string; bookingRef: string }[],
): Promise<Map<string, TicketSendStatus>> {
  const out = new Map<string, TicketSendStatus>()
  if (!bookings.length) return out
  try {
    const today = nowInTz(TICKET_SENDS_TZ).date
    const tickets = await prisma.ticket.findMany({
      where: { bookingId: { in: bookings.map((b) => b.id) }, activated: true },
      select: { id: true, bookingId: true, status: true, fileUrl: true, agendaItem: { select: { date: true } } },
    })
    const extra = await loadTicketFiles(tickets.filter((t) => !t.fileUrl).map((t) => t.id))
    const ledgers = await readLedgers(bookings.map((b) => b.bookingRef))
    const refById = new Map(bookings.map((b) => [b.id, b.bookingRef]))

    for (const b of bookings) out.set(b.bookingRef, { issued: 0, sent: 0, notIssued: 0, lastSentAt: null, linksOnly: false })
    for (const t of tickets) {
      const ref = refById.get(t.bookingId)!
      const s = out.get(ref)!
      const date = t.agendaItem?.date ? t.agendaItem.date.toISOString().slice(0, 10) : null
      const mark = ledgers.get(ref)?.[t.id]
      const issued = (ISSUED_STATUSES as readonly string[]).includes(t.status) && (!!t.fileUrl || !!extra[t.id]?.length)
      if (!issued) { if (!date || date >= today) s.notIssued++; continue }
      // A past movement's ticket no longer needs sending — unless it was sent.
      if (date && date < today && !mark) continue
      s.issued++
      if (mark) {
        s.sent++
        if (!s.lastSentAt || mark.at > s.lastSentAt) s.lastSentAt = mark.at
        if (mark.mode === 'links') s.linksOnly = true
      }
    }
  } catch (err) {
    console.error('[TicketSends] status load failed (non-fatal):', err instanceof Error ? err.message : err)
  }
  return out
}

/** When today's / the next batch goes out, as an ISO instant (Colombo is a fixed UTC+05:30). */
export function nextTicketSendAt(cfg: TicketSendsConfig): string {
  const now = nowInTz(TICKET_SENDS_TZ)
  const [h, m] = cfg.time.split(':').map(Number)
  const ranToday = cfg.lastRunDate === now.date || now.minutes >= h * 60 + m + 60
  const day = ranToday
    ? new Date(Date.parse(`${now.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : now.date
  return new Date(Date.parse(`${day}T${cfg.time}:00+05:30`)).toISOString()
}
