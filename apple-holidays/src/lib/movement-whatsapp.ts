/**
 * Movement WhatsApp briefing — server half. See movement-whatsapp-shared.ts for
 * the template, the parameter rules and why it is a template at all.
 *
 * Accuracy rules:
 *   - The movement is always re-read from the database. What goes out is the
 *     SAVED movement, never whatever the browser happens to be showing, so an
 *     unsaved edit cannot reach a driver who then can't find it on the chart.
 *   - Recipients default to the numbers on the assignment / directory, but the
 *     desk may correct any of them for this send (and optionally save the fix
 *     back onto the movement).
 *   - "Mail & WhatsApp Mode" test switch is honoured: with `use_test_data` on,
 *     every send is redirected to the test number.
 *   - The agreed driver rate is never read here, let alone sent.
 */
import { prisma } from '@/lib/prisma'
import {
  normalisePhone,
  sendViaMetaTemplate,
  sendWhatsAppText,
  isWithin24hWindow,
  listMetaTemplates,
} from '@/lib/whatsapp'
import { serviceTypeLabel } from '@/lib/service-types'
import { mealPlanFullName } from '@/lib/agenda-suggestions'
import {
  MOVEMENT_BRIEF_VARIABLES,
  MOVEMENT_ROLE_LABEL,
  MOVEMENT_TAG_PREFIX,
  MOVEMENT_WA_CONFIG_KEY,
  movementFollowUpText,
  parseMovementWaConfig,
  renderMovementBrief,
  type MovementBriefInput,
  type MovementRole,
  type MovementWaConfig,
} from '@/lib/movement-whatsapp-shared'

const DEFAULT_TEST_WHATSAPP = '94778231121'

export async function loadMovementWaConfig(): Promise<MovementWaConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: MOVEMENT_WA_CONFIG_KEY } })
  return parseMovementWaConfig(row?.value)
}

/** Test-mode redirect: null when live, the test number when `use_test_data` is on. */
async function testRedirect(): Promise<string | null> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['use_test_data', 'test_whatsapp'] } },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  if (map.use_test_data !== 'true') return null
  return normalisePhone(map.test_whatsapp || DEFAULT_TEST_WHATSAPP)
}

// ── Template status (cached — a Graph call per dialog open is wasteful) ─────

export interface TemplateStatus {
  name: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'MISSING' | 'UNKNOWN' | string
  /** Set when the template exists but its variable count does not match ours. */
  mismatch?: string
  error?: string
}

let statusCache: { at: number; key: string; value: TemplateStatus } | null = null

export async function movementTemplateStatus(config: MovementWaConfig, fresh = false): Promise<TemplateStatus> {
  const key = `${config.templateName}:${config.lang}`
  if (!fresh && statusCache && statusCache.key === key && Date.now() - statusCache.at < 5 * 60_000) {
    return statusCache.value
  }
  let value: TemplateStatus
  try {
    const all = await listMetaTemplates('ALL')
    const same = all.filter(t => t.name === config.templateName)
    const t = same.find(x => x.language === config.lang) ?? same[0]
    if (!t) value = { name: config.templateName, status: 'MISSING' }
    else {
      value = { name: t.name, status: t.status }
      if (t.bodyVariableCount !== MOVEMENT_BRIEF_VARIABLES) {
        value.mismatch = `Template has ${t.bodyVariableCount} body variables; this feature fills ${MOVEMENT_BRIEF_VARIABLES}.`
      }
      if (t.language !== config.lang) {
        value.mismatch = `Template language is "${t.language}" but Settings send "${config.lang}".`
      }
    }
  } catch (err) {
    value = { name: config.templateName, status: 'UNKNOWN', error: err instanceof Error ? err.message : String(err) }
  }
  statusCache = { at: Date.now(), key, value }
  return value
}

// ── Load one movement ───────────────────────────────────────────────────────

export interface MovementRecipient {
  role: MovementRole
  name: string
  phone: string
  /** Where the number came from — shown so the desk knows what they're overriding. */
  source: string
  /** Pre-ticked per Settings → default recipients. */
  selected: boolean
}

export interface LoadedMovement {
  itemId: string
  bookingRef: string
  operationCountry: string | null
  input: MovementBriefInput
  recipients: MovementRecipient[]
}

export async function loadMovement(bookingRef: string, itemId: string, config: MovementWaConfig): Promise<LoadedMovement | null> {
  const item = await prisma.agendaItem.findFirst({
    where: { id: itemId, agenda: { booking: { bookingRef } } },
    include: {
      assignment: {
        include: {
          vendor:     { select: { name: true, phone: true, whatsappPhone: true } },
          driver:     { select: { name: true, phone: true } },
          guide:      { select: { whatsappPhone: true } },
          tourVendor: { select: { whatsappPhone: true } },
        },
      },
      agenda: {
        select: {
          booking: {
            select: {
              bookingRef: true, isNumber: true, operationCountry: true,
              paxAdults: true, paxChildren: true, paxInfants: true,
              contactPhone: true, contactWhatsapp: true,
              passengers: { select: { name: true, isLead: true } },
            },
          },
        },
      },
    },
  })
  if (!item) return null

  const b = item.agenda.booking
  const a = item.assignment
  const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]

  const input: MovementBriefInput = {
    bookingRef:       b.bookingRef,
    isNumber:         b.isNumber,
    date:             item.date.toISOString().slice(0, 10),
    meetingTime:      item.meetingTime,
    timeFrom:         item.timeFrom,
    timeTo:           item.timeTo,
    serviceTypeLabel: serviceTypeLabel(item.serviceType),
    location:         item.location,
    fromPoint:        item.fromPoint,
    toPoint:          item.toPoint,
    details:          item.details,
    mealPlan:         item.mealPlan ? mealPlanFullName(item.mealPlan) : null,
    isLeisure:        item.isLeisure === true,
    isHotelOnly:      item.isHotelOnly === true,
    leadPassenger:    lead?.name ?? null,
    paxAdults:        b.paxAdults,
    paxChildren:      b.paxChildren,
    paxInfants:       b.paxInfants,
    guestContact:     b.contactWhatsapp || b.contactPhone || null,
    crew: {
      driverName:      a?.driverName ?? a?.driver?.name ?? null,
      driverPhone:     a?.driverPhone ?? a?.driver?.phone ?? null,
      vehicleType:     a?.vehicleType ?? null,
      vehiclePlate:    a?.vehiclePlate ?? null,
      vendorName:      a?.vendorName ?? a?.vendor?.name ?? null,
      guideName:       a?.guideName ?? null,
      guidePhone:      a?.guidePhone ?? null,
      tourVendorName:  a?.tourVendorName ?? null,
      tourVendorPhone: a?.tourVendorPhone ?? null,
    },
  }

  const recipients: MovementRecipient[] = []
  const add = (role: Exclude<MovementRole, 'other'>, name: string | null | undefined, phone: string | null | undefined, source: string) => {
    if (!name && !phone) return
    recipients.push({
      role,
      name: (name ?? '').trim() || MOVEMENT_ROLE_LABEL[role],
      phone: normalisePhone(phone ?? ''),
      source,
      selected: config.defaultRoles[role] && !!normalisePhone(phone ?? ''),
    })
  }
  if (a) {
    add('driver', input.crew.driverName, input.crew.driverPhone, a.driverPhone ? 'Movement assignment' : 'Driver directory')
    if (a.vendorId || a.vendorName) {
      const vPhone = a.vendor?.whatsappPhone || a.vendor?.phone
      add('vendor', input.crew.vendorName, vPhone, a.vendor?.whatsappPhone ? 'Vendor WhatsApp' : 'Vendor directory')
    }
    add('guide', a.guideName, a.guide?.whatsappPhone || a.guidePhone, a.guide?.whatsappPhone ? 'Guide WhatsApp' : 'Movement assignment')
    add('tourVendor', a.tourVendorName, a.tourVendor?.whatsappPhone || a.tourVendorPhone, a.tourVendor?.whatsappPhone ? 'Tour vendor WhatsApp' : 'Movement assignment')
  }

  return { itemId: item.id, bookingRef: b.bookingRef, operationCountry: b.operationCountry, input, recipients }
}

// ── History ─────────────────────────────────────────────────────────────────

export interface MovementSendLog {
  id: string
  phone: string
  role: string
  name: string
  status: string
  body: string | null
  createdAt: string
}

function parseTag(senderName: string | null): { itemId: string; who: string } | null {
  if (!senderName?.startsWith(MOVEMENT_TAG_PREFIX)) return null
  const close = senderName.indexOf(']')
  if (close < 0) return null
  return { itemId: senderName.slice(MOVEMENT_TAG_PREFIX.length, close), who: senderName.slice(close + 1).trim() }
}

export async function movementHistory(bookingRef: string, itemId: string): Promise<MovementSendLog[]> {
  const rows = await prisma.whatsAppMessage.findMany({
    where: { bookingRef, direction: 'outbound', senderName: { startsWith: `${MOVEMENT_TAG_PREFIX}${itemId}]` } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, phone: true, status: true, body: true, senderName: true, createdAt: true },
  })
  return rows.map(r => {
    const who = parseTag(r.senderName)?.who ?? ''
    const [role, ...rest] = who.split(' · ')
    return {
      id: r.id, phone: r.phone, role: role || '', name: rest.join(' · '),
      status: r.status, body: r.body, createdAt: r.createdAt.toISOString(),
    }
  })
}

/** Per-movement summary for the chart badges: one query for the whole booking. */
export async function movementSendSummary(bookingRef: string) {
  const rows = await prisma.whatsAppMessage.findMany({
    where: { bookingRef, direction: 'outbound', senderName: { startsWith: MOVEMENT_TAG_PREFIX } },
    orderBy: { createdAt: 'asc' },
    select: { phone: true, status: true, senderName: true, createdAt: true, body: true },
  })
  const out: Record<string, { count: number; lastAt: string; recipients: number; statuses: Record<string, number> }> = {}
  const latestPerPhone = new Map<string, { itemId: string; status: string }>()
  for (const r of rows) {
    const tag = parseTag(r.senderName)
    if (!tag) continue
    // Follow-up free-text rows share the tag; count only the template sends.
    if (r.body?.startsWith('📝 *Full details')) continue
    const s = out[tag.itemId] ??= { count: 0, lastAt: '', recipients: 0, statuses: {} }
    s.count += 1
    s.lastAt = r.createdAt.toISOString()
    latestPerPhone.set(`${tag.itemId}|${r.phone}`, { itemId: tag.itemId, status: r.status })
  }
  for (const { itemId, status } of Array.from(latestPerPhone.values())) {
    const s = out[itemId]
    s.recipients += 1
    s.statuses[status] = (s.statuses[status] ?? 0) + 1
  }
  return out
}

// ── Send ────────────────────────────────────────────────────────────────────

export interface SendRequestRecipient {
  role: MovementRole
  name: string
  phone: string
  /** Write a corrected number back onto the movement's assignment. */
  saveToMovement?: boolean
}

export interface SendResult {
  role: MovementRole
  name: string
  phone: string
  ok: boolean
  /** 'duplicate' needs a confirm; anything else is the failure reason. */
  reason?: string
  redirectedTo?: string
  followUpSent?: boolean
  waMessageId?: string | null
}

export async function sendMovementBrief(params: {
  movement: LoadedMovement
  config: MovementWaConfig
  recipients: SendRequestRecipient[]
  note?: string | null
  force?: boolean
  sentBy: string
}): Promise<SendResult[]> {
  const { movement, config } = params
  const redirect = await testRedirect()
  const results: SendResult[] = []
  const seen = new Set<string>()

  for (const r of params.recipients) {
    const phone = normalisePhone(r.phone ?? '')
    const role: MovementRole = r.role in MOVEMENT_ROLE_LABEL ? r.role : 'other'
    const name = (r.name ?? '').trim() || MOVEMENT_ROLE_LABEL[role]
    const base = { role, name, phone }

    if (phone.length < 8 || phone.length > 15) { results.push({ ...base, ok: false, reason: 'Invalid phone number' }); continue }
    if (seen.has(phone)) { results.push({ ...base, ok: false, reason: 'Same number already in this send' }); continue }
    seen.add(phone)

    const brief = renderMovementBrief(movement.input, { role, name }, { config, note: params.note })
    const to = redirect ?? phone
    const tag = `${MOVEMENT_TAG_PREFIX}${movement.itemId}] ${MOVEMENT_ROLE_LABEL[role]} · ${name}`

    if (!params.force && config.duplicateGuardMin > 0) {
      const since = new Date(Date.now() - config.duplicateGuardMin * 60_000)
      const dup = await prisma.whatsAppMessage.findFirst({
        where: { bookingRef: movement.bookingRef, phone: to, direction: 'outbound', body: brief.text, createdAt: { gte: since } },
        select: { id: true },
      })
      if (dup) { results.push({ ...base, ok: false, reason: 'duplicate' }); continue }
    }

    try {
      const sent = await sendViaMetaTemplate({
        to,
        templateName: config.templateName,
        lang:         config.lang,
        bodyParams:   brief.params,
      })
      if (!sent) {
        results.push({ ...base, ok: false, reason: 'WhatsApp is not configured on this server (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)' })
        continue
      }
      const waMessageId = (sent.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null
      await prisma.whatsAppMessage.create({
        data: {
          bookingRef: movement.bookingRef, phone: to, direction: 'outbound',
          body: brief.text, waMessageId, status: 'sent', senderName: tag,
        },
      })

      // The template had to trim the details — if the window is open, send them whole.
      let followUpSent = false
      if (config.fullDetailFollowUp && brief.detailsTrimmed && (await isWithin24hWindow(to))) {
        const text = movementFollowUpText(movement.input, brief.fullDetails)
        followUpSent = await sendWhatsAppText(to, text, name)
        if (followUpSent) {
          await prisma.whatsAppMessage.create({
            data: { bookingRef: movement.bookingRef, phone: to, direction: 'outbound', body: text, status: 'sent', senderName: tag },
          })
        }
      }

      if (r.saveToMovement && !redirect && (role === 'driver' || role === 'guide' || role === 'tourVendor')) {
        const field = role === 'driver' ? 'driverPhone' : role === 'guide' ? 'guidePhone' : 'tourVendorPhone'
        await prisma.assignment.updateMany({ where: { agendaItemId: movement.itemId }, data: { [field]: phone } })
      }

      console.log(`[MovementWA] ${movement.bookingRef}/${movement.itemId} → ${MOVEMENT_ROLE_LABEL[role]} ${name} (${to}) by ${params.sentBy}`)
      results.push({ ...base, ok: true, waMessageId, followUpSent, ...(redirect ? { redirectedTo: redirect } : {}) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[MovementWA] send failed ${movement.bookingRef}/${movement.itemId} → ${to}:`, msg)
      results.push({ ...base, ok: false, reason: friendlyMetaError(msg) })
    }
  }

  await prisma.assignment.updateMany({
    where: { agendaItemId: movement.itemId },
    data:  { waSentAt: new Date() },
  }).catch(() => { /* no assignment row (ad-hoc recipient only) — nothing to stamp */ })

  return results
}

/** Turn the common Graph errors into something the desk can act on. */
function friendlyMetaError(msg: string): string {
  if (/132001|does not exist/i.test(msg)) return 'Template not found on WhatsApp — register it in Settings → Movement WhatsApp Briefing'
  if (/132000|number of parameters/i.test(msg)) return 'Template variables do not match — the approved template must have exactly 8 body variables'
  if (/132015|paused/i.test(msg)) return 'Template is paused by Meta (low quality) — check WhatsApp Manager'
  if (/131026|131030|not a valid whatsapp|recipient/i.test(msg)) return 'This number is not on WhatsApp or cannot receive messages'
  if (/131056|pair rate/i.test(msg)) return 'Too many messages to this number in a short time — wait a minute and retry'
  if (/130472|experiment/i.test(msg)) return 'Meta held this message (marketing experiment) — retry later'
  return msg.slice(0, 240)
}

/**
 * A whole-chart save deletes and recreates every movement under a new id, so
 * the history tagged `[MOVEMENT:<oldId>]` is moved to the new id — same idea as
 * carryMcDetails. Without it the chart badges and the send history would reset
 * on every Save. Non-fatal by design; the caller swallows errors.
 */
export async function carryMovementWhatsApp(bookingRef: string, movedIds: [string, string][]): Promise<void> {
  for (const [oldId, newId] of movedIds) {
    if (!oldId || !newId || oldId === newId) continue
    const oldTag = `${MOVEMENT_TAG_PREFIX}${oldId}]`
    const newTag = `${MOVEMENT_TAG_PREFIX}${newId}]`
    await prisma.$executeRaw`
      UPDATE whatsapp_messages
         SET senderName = CONCAT(${newTag}, SUBSTRING(senderName, ${oldTag.length + 1}))
       WHERE bookingRef = ${bookingRef}
         AND senderName LIKE ${`${oldTag}%`}`
  }
}
