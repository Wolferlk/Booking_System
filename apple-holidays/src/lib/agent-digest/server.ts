/**
 * Agent Daily Digest — server side.
 *
 * READ-ONLY over bookings: every query on bookings / agenda / assignments here
 * is a findMany with an explicit `select`. The only writes are to the three
 * agent_digest_* tables this component owns. Money never leaves: driverRate is
 * never selected.
 *
 * Delivery
 *   • WhatsApp — ALWAYS the approved template TEMPLATE_AGENT_DIGEST (counts +
 *     a link to the frozen web view with every detail). Never free-form text,
 *     even inside the 24h window — one predictable message for the agent.
 *   • Email — the HTML digest through Microsoft Graph.
 *
 * Once per rule / day / recipient / channel: `agent_digest_sends.dedupeKey`
 * is UNIQUE, so the in-process scheduler, the cron route and "Send now" can all
 * be on without double-messaging anyone. A failed row can be retried.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'
import { normalisePhone, sendViaMetaTemplate } from '@/lib/whatsapp'
import { movementNeedsDriver } from '@/lib/driver-requirement'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { serviceTypeLabel } from '@/lib/service-types'
import { testBookingWhere } from '@/lib/test-bookings'
import {
  addDays, agentMatches, allocationPending, emailSubject, isEmail, isEmptyPayload,
  normaliseConfig, nowHmIn, renderEmailHtml, renderTemplateText, renderWhatsApp, templateParams, todayIn,
  AGENT_DIGEST_TEMPLATE_BODY, AGENT_TICKETS_TEMPLATE_BODY,
  type DigestBlockResult, type DigestBooking, type DigestConfig, type DigestItem,
  type DigestParty, type DigestPayload, type DigestRecipient, type DigestRuleView,
} from './shared'
import {
  ACTIVE_EXCLUDED, agentLabelOf, bookingCountry, CONFIRMED_EXCLUDED, countryAllowed, dayDiff, displayCountry, ymd,
} from './scope'
import { buildTicketPayload } from './tickets-server'

// ── Setup / errors ───────────────────────────────────────────────────────────

export const SETUP_MESSAGE =
  'Agent Daily Digest is not set up on this database yet — run `bash prisma/sql/apply-agent-digest.sh` (additive: creates three new tables).'

export function isDigestTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (e?.code === 'P2021') return true
  return /agent_digest_\w+.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

// ── WhatsApp template (for recipients outside the 24h window) ────────────────

export const TEMPLATE_AGENT_DIGEST =
  process.env.WHATSAPP_AGENT_DIGEST_TEMPLATE?.trim() || 'aahaas_agent_daily_digest'
export { AGENT_DIGEST_TEMPLATE_BODY }
export const AGENT_DIGEST_TEMPLATE_LANG = process.env.WHATSAPP_AGENT_DIGEST_TEMPLATE_LANG?.trim() || 'en'

export const AGENT_DIGEST_TEMPLATE_DEF = {
  name: TEMPLATE_AGENT_DIGEST,
  category: 'UTILITY',
  language: AGENT_DIGEST_TEMPLATE_LANG,
  bodyText: AGENT_DIGEST_TEMPLATE_BODY,
  bodyExamples: ['Priya', '30 Sundays', '04 Nov', '6', '14', 'https://ops.aahaas.com/digest/cm1abc234?t=0123456789abcdef'],
  footerText: 'AppleHolidays Operations',
}

/** A ticket pack has its own wording, so it is its own template. */
export const TEMPLATE_AGENT_TICKETS =
  process.env.WHATSAPP_AGENT_TICKETS_TEMPLATE?.trim() || 'aahaas_agent_ticket_pack'

export const AGENT_TICKETS_TEMPLATE_DEF = {
  name: TEMPLATE_AGENT_TICKETS,
  category: 'UTILITY',
  language: AGENT_DIGEST_TEMPLATE_LANG,
  bodyText: AGENT_TICKETS_TEMPLATE_BODY,
  bodyExamples: ['Priya', '30 Sundays', '10 Nov', '3', '8', '11', 'https://ops.aahaas.com/digest/cm1abc234?t=0123456789abcdef'],
  footerText: 'AppleHolidays Operations',
}

export function appBaseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://ops.aahaas.com').replace(/\/$/, '')
}

export function runLink(run: { id: string; token: string }): string {
  return `${appBaseUrl()}/digest/${encodeURIComponent(run.id)}?t=${run.token}`
}

/** The token-checked download of one ticket file in a pack. */
export function runFileLink(run: { id: string; token: string }, fileId: string): string {
  return `${appBaseUrl()}/digest/${encodeURIComponent(run.id)}/file/${encodeURIComponent(fileId)}?t=${run.token}`
}

// ── Building the digest (read-only) ──────────────────────────────────────────

function party(name: string | null | undefined, phone: string | null | undefined): DigestParty | null {
  const n = name?.trim() || null
  const p = phone?.trim() || null
  return n || p ? { name: n, phone: p } : null
}

function vehicleText(type: string | null | undefined, plate: string | null | undefined): string | null {
  const t = type && type !== 'hotel_only' ? type : null
  return [t, plate].filter(Boolean).join(' · ') || null
}

type LoadedBooking = Awaited<ReturnType<typeof loadBookings>>[number]

async function loadBookings(config: DigestConfig, minDate: string, maxDate: string) {
  const excluded = config.statusFilter === 'CONFIRMED' ? CONFIRMED_EXCLUDED : ACTIVE_EXCLUDED
  const test = await testBookingWhere('exclude')
  const rows = await prisma.booking.findMany({
    where: {
      AND: [
        { status: { notIn: [...excluded] as never } },
        { cancelledAt: null },
        // One day of slack each side: agenda lines are sometimes typed a day
        // outside the TC's arrival/departure.
        { arrivalDate: { lte: new Date(`${addDays(maxDate, 1)}T23:59:59.999Z`) } },
        { departureDate: { gte: new Date(`${addDays(minDate, -1)}T00:00:00.000Z`) } },
        ...(test.clause ? [test.clause] : []),
      ],
    },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true, agent: true, operationCountry: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true, hotelOnly: true,
      passengers: { select: { name: true, isLead: true }, orderBy: [{ isLead: 'desc' }, { name: 'asc' }], take: 1 },
      flights: { select: { flightNo: true, date: true, fromApt: true, toApt: true, depTime: true, arrTime: true } },
      accommodations: { select: { hotel: true, city: true, checkIn: true, checkOut: true } },
      slDriverAllocation: {
        select: {
          vehicleType: true,
          driver: { select: { name: true, phone: true, vehicle: { select: { type: true, plateNo: true } } } },
          vendor: { select: { name: true, phone: true, whatsappPhone: true } },
        },
      },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
              serviceType: true, timeFrom: true, meetingTime: true, isLeisure: true, isHotelOnly: true,
              assignment: {
                select: {
                  driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
                  vendorName: true, guideName: true, guidePhone: true, tourVendorName: true, tourVendorPhone: true,
                  driver: { select: { name: true, phone: true } },
                  vendor: { select: { name: true, phone: true, whatsappPhone: true } },
                  guide: { select: { name: true, phone: true, whatsappPhone: true } },
                  tourVendor: { select: { name: true, phone: true, whatsappPhone: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { arrivalDate: 'asc' },
  })
  return rows.filter(b =>
    agentMatches(b.agent, config.agents) &&
    countryAllowed(bookingCountry(b.operationCountry, b.bookingRef), config.countries),
  )
}

function toItem(b: LoadedBooking, it: NonNullable<LoadedBooking['tourAgenda']>['items'][number], notes: Map<string, string>): DigestItem {
  const a = it.assignment
  const sl = b.slDriverAllocation
  const isLeisure = resolveIsLeisure(it)
  const needsDriver = !b.hotelOnly && movementNeedsDriver(it) && it.serviceType !== 'FLIGHT'
  // Sri Lanka allocates one driver per booking; a line without its own
  // assignment inherits it.
  const driver = party(a?.driver?.name ?? a?.driverName, a?.driver?.phone ?? a?.driverPhone)
    ?? (needsDriver && sl?.driver ? party(sl.driver.name, sl.driver.phone) : null)
  const vehicle = vehicleText(a?.vehicleType, a?.vehiclePlate)
    ?? (needsDriver && sl ? vehicleText(sl.driver?.vehicle?.type ?? sl.vehicleType, sl.driver?.vehicle?.plateNo) : null)
  const driverVendor = party(a?.vendor?.name ?? a?.vendorName, a?.vendor?.whatsappPhone || a?.vendor?.phone)
    ?? (needsDriver && sl?.vendor ? party(sl.vendor.name, sl.vendor.whatsappPhone || sl.vendor.phone) : null)
  const from = it.fromPoint?.trim()
  const to = it.toPoint?.trim()
  return {
    date: ymd(it.date),
    time: (it.timeFrom || it.meetingTime)?.trim() || null,
    route: from && to && from !== to ? `${from} → ${to}` : (to || from || it.location || '').trim(),
    service: it.serviceType ? serviceTypeLabel(it.serviceType) : null,
    note: notes.get(it.id) ?? null,
    isLeisure,
    needsDriver,
    driver,
    vehicle,
    driverVendor,
    guide: party(a?.guide?.name ?? a?.guideName, a?.guide?.whatsappPhone || a?.guide?.phone || a?.guidePhone),
    tourVendor: party(a?.tourVendor?.name ?? a?.tourVendorName, a?.tourVendor?.whatsappPhone || a?.tourVendor?.phone || a?.tourVendorPhone),
  }
}

function uniqParties<T extends DigestParty>(list: (T | null)[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of list) {
    if (!p) continue
    const k = `${(p.name ?? '').toLowerCase()}|${(p.phone ?? '').replace(/\D/g, '')}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

function hotelOn(b: LoadedBooking, day: string): string | null {
  const stay = b.accommodations.find(a => ymd(a.checkIn) <= day && day < ymd(a.checkOut))
    ?? b.accommodations.find(a => ymd(a.checkIn) === day)
  return stay ? [stay.hotel, stay.city].filter(Boolean).join(', ') : null
}

function flightOn(b: LoadedBooking, day: string): string | null {
  const f = b.flights.filter(x => ymd(x.date) === day)
  if (!f.length) return null
  return f.map(x => `${x.flightNo} ${x.fromApt} ${x.depTime} → ${x.toApt} ${x.arrTime}`.replace(/\s+/g, ' ').trim()).join(' | ')
}

function toDigestBooking(b: LoadedBooking, day: string, scope: 'ITEM' | 'TOUR', notes: Map<string, string>): DigestBooking {
  const allItems = (b.tourAgenda?.items ?? []).map(it => toItem(b, it, notes))
  const items = scope === 'ITEM' ? allItems.filter(i => i.date === day) : []
  const arrival = ymd(b.arrivalDate)
  const departure = ymd(b.departureDate)
  const counted = scope === 'ITEM' ? items : allItems
  const drivers = uniqParties(allItems.map(i => (i.driver ? { ...i.driver, vehicle: i.vehicle } : null)))
  return {
    ref: b.bookingRef,
    tripNo: b.bookingRef,
    isNumber: b.isNumber?.trim() || null,
    cntlNumber: b.cntlNumber?.trim() || null,
    agent: b.agent,
    country: displayCountry(bookingCountry(b.operationCountry, b.bookingRef)),
    lead: b.passengers[0]?.name?.trim() || null,
    paxAdults: b.paxAdults, paxChildren: b.paxChildren, paxInfants: b.paxInfants,
    arrival, departure,
    dayNo: dayDiff(arrival, day) + 1,
    totalDays: dayDiff(arrival, departure) + 1,
    hotel: hotelOn(b, day),
    flight: flightOn(b, day),
    items,
    team: {
      drivers,
      driverVendors: uniqParties(allItems.map(i => i.driverVendor)),
      guides: uniqParties(allItems.map(i => i.guide)),
      tourVendors: uniqParties(allItems.map(i => i.tourVendor)),
    },
    missing: counted.filter(allocationPending).length,
  }
}

function matchesBasis(b: LoadedBooking, basis: string, day: string): boolean {
  const arrival = ymd(b.arrivalDate)
  const departure = ymd(b.departureDate)
  const itemDays = (b.tourAgenda?.items ?? []).map(i => ymd(i.date))
  switch (basis) {
    case 'ARRIVAL': return arrival === day
    case 'DEPARTURE': return departure === day
    case 'ON_GROUND': return arrival <= day && day <= departure
    case 'ACTIVITY': return itemDays.includes(day)
    case 'TOUR_START': {
      const first = itemDays.length ? itemDays.reduce((m, d) => (d < m ? d : m)) : arrival
      return first === day
    }
    default: return false
  }
}

export { agentLabelOf }

/** Builds the digest for one send day. Pure read. `ruleId` lets a ticket pack see what it already sent. */
export async function buildPayload(config: DigestConfig, runDate: string, ruleName: string, ruleId: string | null = null): Promise<DigestPayload> {
  if (config.kind === 'TICKETS') return buildTicketPayload(config, runDate, ruleName, ruleId)
  const blocks = config.blocks.filter(b => b.enabled)
  const payload: DigestPayload = {
    ruleName, runDate, agentLabel: agentLabelOf(config), countries: config.countries,
    generatedAt: new Date().toISOString(), blocks: [], totals: { bookings: 0, lines: 0, missing: 0 },
  }
  if (!blocks.length) return payload

  const days = blocks.map(b => addDays(runDate, b.offset))
  const minDate = days.reduce((m, d) => (d < m ? d : m))
  const maxDate = days.reduce((m, d) => (d > m ? d : m))
  const bookings = await loadBookings(config, minDate, maxDate)

  // MC "special request" per movement — optional table; absence is not an error.
  const notes = new Map<string, string>()
  if (config.fields.movementNote && bookings.length) {
    const ids = bookings.flatMap(b => (b.tourAgenda?.items ?? []).map(i => i.id))
    try {
      for (let i = 0; i < ids.length; i += 1000) {
        const rows = await prisma.agendaMcDetail.findMany({
          where: { agendaItemId: { in: ids.slice(i, i + 1000) }, specialRequest: { not: null } },
          select: { agendaItemId: true, specialRequest: true },
        })
        for (const r of rows) if (r.specialRequest?.trim()) notes.set(r.agendaItemId, r.specialRequest.trim())
      }
    } catch { /* table not on this database — notes stay empty */ }
  }

  const seen = new Set<string>()
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i]
    const day = days[i]
    const list = bookings
      .filter(b => matchesBasis(b, blk.basis, day))
      .map(b => toDigestBooking(b, day, blk.scope, notes))
      .sort((a, b) => (a.items[0]?.time ?? '99').localeCompare(b.items[0]?.time ?? '99') || a.tripNo.localeCompare(b.tripNo))
    const res: DigestBlockResult = { id: blk.id, label: blk.label, basis: blk.basis, scope: blk.scope, date: day, bookings: list }
    payload.blocks.push(res)
    for (const b of list) {
      seen.add(b.ref)
      payload.totals.lines += blk.scope === 'ITEM' ? b.items.length : 0
      payload.totals.missing += b.missing
    }
  }
  payload.totals.bookings = seen.size
  return payload
}

// ── Rules ────────────────────────────────────────────────────────────────────

type RuleRow = {
  id: string; name: string; isActive: boolean; autoSend: boolean; sendTime: string; timezone: string
  config: unknown; createdByName: string | null; updatedByName: string | null; updatedAt: Date
}

/** Next local send moment of a rule as an ISO instant, for the UI countdown. */
export function nextSendAt(rule: { autoSend: boolean; isActive: boolean; sendTime: string; timezone: string }, now = new Date()): string | null {
  if (!rule.autoSend || !rule.isActive) return null
  const today = todayIn(rule.timezone, now)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: rule.timezone, timeZoneName: 'shortOffset' }).formatToParts(now)
  const off = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off)
  const offsetMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
  let t = Date.parse(`${today}T${rule.sendTime}:00Z`) - offsetMin * 60_000
  if (t <= now.getTime()) t += 86_400_000
  return new Date(t).toISOString()
}

export function toRuleView(r: RuleRow, last?: { at: Date; status: string } | null): DigestRuleView {
  return {
    id: r.id, name: r.name, isActive: r.isActive, autoSend: r.autoSend, sendTime: r.sendTime, timezone: r.timezone,
    config: normaliseConfig(r.config),
    createdByName: r.createdByName, updatedByName: r.updatedByName, updatedAt: r.updatedAt.toISOString(),
    lastSentAt: last?.at.toISOString() ?? null, lastStatus: last?.status ?? null,
    nextSendAt: nextSendAt(r),
  }
}

/** Archived digests, newest first — what the designer offers to restore. */
export async function listArchivedRules(): Promise<{ id: string; name: string; archivedAt: string; archivedByName: string | null }[]> {
  const rows = await prisma.agentDigestRule.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: 'desc' },
    select: { id: true, name: true, archivedAt: true, updatedByName: true },
  })
  return rows.map(r => ({ id: r.id, name: r.name, archivedAt: r.archivedAt!.toISOString(), archivedByName: r.updatedByName }))
}

export async function listRules(): Promise<DigestRuleView[]> {
  const rows = await prisma.agentDigestRule.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } })
  const last = new Map<string, { at: Date; status: string }>()
  if (rows.length) {
    const sends = await prisma.agentDigestSend.findMany({
      where: { ruleId: { in: rows.map(r => r.id) }, trigger: { not: 'test' } },
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { ruleId: true, createdAt: true, status: true },
    })
    for (const s of sends) if (s.ruleId && !last.has(s.ruleId)) last.set(s.ruleId, { at: s.createdAt, status: s.status })
  }
  return rows.map(r => toRuleView(r, last.get(r.id)))
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface SendDetail { name: string; channel: 'whatsapp' | 'email'; to: string; status: string; mode?: string; note?: string }

export interface SendResult {
  ruleId: string | null
  ruleName: string
  runDate: string
  runId: string | null
  link: string | null
  bookings: number
  lines: number
  sent: number
  failed: number
  skipped: number
  reason?: string
  details: SendDetail[]
}

async function createRun(input: { ruleId: string | null; ruleName: string; runDate: string; trigger: string; payload: DigestPayload; config: DigestConfig; by: string | null }) {
  return prisma.agentDigestRun.create({
    data: {
      token: crypto.randomBytes(16).toString('hex'),
      ruleId: input.ruleId, ruleName: input.ruleName, runDate: input.runDate, trigger: input.trigger,
      bookingCount: input.payload.totals.bookings, itemCount: input.payload.totals.lines,
      // The design rides along so the web view renders exactly what was sent.
      payload: JSON.parse(JSON.stringify({ ...input.payload, config: input.config })), createdByName: input.by,
    },
    select: { id: true, token: true },
  })
}

/**
 * Sends one digest. `testTo` sends to a single typed number/email instead of
 * the rule's recipients (never de-duplicated, never counted as the day's send).
 */
export async function sendDigest(opts: {
  ruleId?: string | null
  /** An unsaved design — only allowed together with `testTo`. */
  draft?: { name: string; config: unknown }
  runDate?: string
  trigger: 'schedule' | 'manual' | 'test'
  testTo?: { phone?: string; email?: string; name?: string }
  onlyRecipientIds?: string[]
  force?: boolean
  sentByName?: string | null
}): Promise<SendResult> {
  let ruleId: string | null = null
  let name: string
  let config: DigestConfig
  let tz = 'Asia/Colombo'
  if (opts.ruleId) {
    const r = await prisma.agentDigestRule.findUnique({ where: { id: opts.ruleId } })
    if (!r || r.archivedAt) throw new Error('Digest not found')
    ruleId = r.id; name = r.name; config = normaliseConfig(r.config); tz = r.timezone
  } else if (opts.draft && opts.trigger === 'test') {
    name = opts.draft.name || 'Draft digest'; config = normaliseConfig(opts.draft.config)
  } else {
    throw new Error('Pick a saved digest')
  }

  const runDate = opts.runDate ?? todayIn(tz)
  const payload = await buildPayload(config, runDate, name, ruleId)
  const isPack = config.kind === 'TICKETS'
  const result: SendResult = {
    ruleId, ruleName: name, runDate, runId: null, link: null,
    bookings: payload.totals.bookings, lines: payload.totals.lines,
    sent: 0, failed: 0, skipped: 0, details: [],
  }
  if (opts.trigger !== 'test' && config.skipEmpty && isEmptyPayload(payload)) {
    result.reason = 'Nothing to report for this day — skipped (the digest is set to skip empty days).'
    return result
  }

  const recipients: DigestRecipient[] = opts.testTo
    ? [{ id: 'test', name: opts.testTo.name || 'Test', phone: opts.testTo.phone ?? '', email: opts.testTo.email ?? '', whatsapp: !!opts.testTo.phone, emailOn: !!opts.testTo.email }]
    : config.recipients.filter(r => !opts.onlyRecipientIds || opts.onlyRecipientIds.includes(r.id))
  if (!recipients.length) {
    result.reason = 'No recipients on this digest.'
    return result
  }

  const run = await createRun({ ruleId, ruleName: name, runDate, trigger: opts.trigger, payload, config, by: opts.sentByName ?? null })
  const link = runLink(run)
  result.runId = run.id
  result.link = link

  const keyOf = (channel: string, to: string) =>
    opts.trigger === 'test' ? `test|${run.id}|${channel}|${to}` : `${ruleId}|${runDate}|${channel}|${to}`

  const base = { runId: run.id, ruleId, ruleName: name, runDate, trigger: opts.trigger, sentByName: opts.sentByName ?? null, bookingCount: payload.totals.bookings, itemCount: payload.totals.lines }

  async function guardAndRecord(channel: 'whatsapp' | 'email', to: string, recipientName: string, send: () => Promise<{ ok: boolean; mode?: string; waMessageId?: string | null; error?: string; body: string; subject?: string }>) {
    let key = keyOf(channel, to)
    const existing = await prisma.agentDigestSend.findUnique({ where: { dedupeKey: key }, select: { status: true } })
    if (existing?.status === 'sent') {
      if (!opts.force || opts.trigger === 'schedule') {
        result.skipped++
        result.details.push({ name: recipientName, channel, to, status: 'skipped', note: 'already sent for this day' })
        return
      }
      key = `${key}|resend-${Date.now()}`
    }
    let out: Awaited<ReturnType<typeof send>>
    try { out = await send() } catch (err) {
      out = { ok: false, error: err instanceof Error ? err.message : String(err), body: '' }
    }
    const data = {
      ...base, channel, recipient: to, recipientName, status: out.ok ? 'sent' : 'failed', mode: out.mode ?? null,
      subject: out.subject?.slice(0, 250) ?? null, body: out.body || null, waMessageId: out.waMessageId ?? null,
      error: out.ok ? (out.error ?? null) : (out.error ?? 'Send failed'),
    }
    await prisma.agentDigestSend.upsert({ where: { dedupeKey: key }, create: { dedupeKey: key, ...data }, update: data })
    if (out.ok) result.sent++
    else result.failed++
    result.details.push({ name: recipientName, channel, to, status: out.ok ? 'sent' : 'failed', mode: out.mode, note: out.ok ? out.error : out.error })
  }

  for (const r of recipients) {
    const who = r.name || r.phone || r.email
    // WhatsApp
    if ((config.channels.whatsapp || opts.testTo) && r.whatsapp) {
      const phone = normalisePhone(r.phone)
      if (!phone) {
        result.skipped++
        result.details.push({ name: who, channel: 'whatsapp', to: r.phone, status: 'skipped', note: 'no valid phone' })
      } else {
        await guardAndRecord('whatsapp', phone, who, async () => {
          // Always the approved template — never free-form text, whatever the 24h window.
          const params = templateParams(payload, r.name, link)
          const res = await sendViaMetaTemplate({ to: phone, templateName: isPack ? TEMPLATE_AGENT_TICKETS : TEMPLATE_AGENT_DIGEST, lang: AGENT_DIGEST_TEMPLATE_LANG, bodyParams: params })
          const tplBody = renderTemplateText(params, config.kind)
          if (!res) return { ok: false, mode: 'template', body: tplBody, error: 'WhatsApp (Meta) is not configured on this server' }
          const waMessageId = (res.template as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null
          await prisma.whatsAppMessage.create({
            data: { bookingRef: 'AGENT-DIGEST', phone, direction: 'outbound', body: tplBody, waMessageId, status: 'sent', senderName: `[${isPack ? 'AGENT-TICKETS' : 'AGENT-DIGEST'}] ${name}` },
          }).catch(() => undefined)
          return { ok: true, mode: 'template', waMessageId, body: tplBody }
        })
      }
    }
    // Email
    if ((config.channels.email || opts.testTo) && r.emailOn) {
      if (!isEmail(r.email)) {
        result.skipped++
        result.details.push({ name: who, channel: 'email', to: r.email, status: 'skipped', note: 'no valid email' })
      } else {
        const to = r.email.trim()
        await guardAndRecord('email', to, who, async () => {
          const subject = emailSubject(payload)
          const html = renderEmailHtml(payload, config, r.name, link, { fileLink: id => runFileLink(run, id) })
          await sendMailViaGraph({ to, cc: opts.testTo ? [] : config.ccEmails, subject, bodyHtml: html })
          return { ok: true, mode: 'html', subject, body: renderWhatsApp(payload, config, r.name, link) }
        })
      }
    }
  }

  console.log(`[AgentDigest] ${name} ${runDate} (${opts.trigger}) — sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}`)
  return result
}

// ── Scheduler tick ───────────────────────────────────────────────────────────

/** How long after its send time a rule may still go out (restart / late tick). */
const CATCH_UP_MINUTES = 180

function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Called every few minutes. Sends each auto rule once its local clock has
 * reached `sendTime`, within a catch-up window. The UNIQUE dedupeKey makes a
 * second tick on the same day a no-op per recipient.
 */
export async function runScheduledDigests(now = new Date()): Promise<SendResult[]> {
  let rules
  try {
    rules = await prisma.agentDigestRule.findMany({ where: { isActive: true, autoSend: true, archivedAt: null } })
  } catch (err) {
    if (isDigestTableMissing(err)) return []
    throw err
  }
  const out: SendResult[] = []
  for (const r of rules) {
    const local = minutesOf(nowHmIn(r.timezone, now))
    const target = minutesOf(r.sendTime)
    if (local < target || local > target + CATCH_UP_MINUTES) continue
    const runDate = todayIn(r.timezone, now)
    // One automatic attempt per rule per day. Failed recipients are retried
    // from the page ("Retry failed"), never by the clock — so an outage
    // (e.g. Meta billing block) can't turn into a send every few minutes.
    const already = await prisma.agentDigestRun.count({ where: { ruleId: r.id, runDate, trigger: 'schedule' } })
    if (already > 0) continue
    try {
      out.push(await sendDigest({ ruleId: r.id, runDate, trigger: 'schedule', sentByName: 'Scheduler' }))
    } catch (err) {
      console.error(`[AgentDigest] scheduled send "${r.name}" failed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

// ── Upcoming + history ───────────────────────────────────────────────────────

export interface UpcomingItem {
  rule: DigestRuleView
  runDate: string
  sendAt: string
  payload: DigestPayload
  willSkip: boolean
  recipients: { name: string; whatsapp: string | null; email: string | null }[]
}

/** What each active rule will send on `runDate` (default: tomorrow in its zone). */
export async function upcoming(dayOffset = 1, now = new Date()): Promise<UpcomingItem[]> {
  const rules = (await listRules()).filter(r => r.isActive)
  const out: UpcomingItem[] = []
  for (const rule of rules) {
    const runDate = addDays(todayIn(rule.timezone, now), dayOffset)
    const payload = await buildPayload(rule.config, runDate, rule.name, rule.id)
    out.push({
      rule, runDate,
      sendAt: `${runDate} ${rule.sendTime}`,
      payload,
      willSkip: !rule.autoSend || (rule.config.skipEmpty && isEmptyPayload(payload)),
      recipients: rule.config.recipients.map(r => ({
        name: r.name,
        whatsapp: rule.config.channels.whatsapp && r.whatsapp && r.phone ? r.phone : null,
        email: rule.config.channels.email && r.emailOn && isEmail(r.email) ? r.email : null,
      })),
    })
  }
  return out
}

export async function history(opts: { from: string; to: string; ruleId?: string | null; status?: string | null; take?: number }) {
  const rows = await prisma.agentDigestSend.findMany({
    where: {
      runDate: { gte: opts.from, lte: opts.to },
      ...(opts.ruleId ? { ruleId: opts.ruleId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.take ?? 300, 1000),
    select: {
      id: true, runId: true, ruleId: true, ruleName: true, runDate: true, channel: true, recipient: true, recipientName: true,
      status: true, mode: true, subject: true, error: true, trigger: true, sentByName: true, bookingCount: true, itemCount: true, createdAt: true,
    },
  })
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))
}
