/**
 * Booking Logs — one timeline of who changed what on a booking, per section,
 * and why an automatic guest message did not go out.
 *
 * Write:  logBookingEvent() → booking_event_logs (additive table). If that
 *         table is not on this database yet, a staff action falls back to
 *         activity_logs so nothing is lost; a scheduler event is console-only.
 *
 * Read:   readLogs() merges, read-only, every place history already lives:
 *           booking_event_logs     new, detailed (from → to, reasons)
 *           activity_logs          older booking edits, guest-automation switches
 *           status_events          workflow status changes
 *           booking_versions       TC versions / amendments
 *           whatsapp_messages      outbound guest messages (daily plan, feedback…)
 *           vn_driver_sync_events  drivers filled from the VN movement sheet
 *           file_handler_logs      flight edits by file handlers
 *         Each source is optional — a missing table is skipped, never an error.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const LOG_SECTIONS = ['overview', 'contact', 'passengers', 'flights', 'accommodation', 'agenda', 'messages'] as const
export type LogSection = (typeof LOG_SECTIONS)[number]

export const SECTION_LABEL: Record<LogSection, string> = {
  overview: 'Overview & status',
  contact: 'Guest contact',
  passengers: 'Passengers',
  flights: 'Flights',
  accommodation: 'Accommodation',
  agenda: 'Movement chart',
  messages: 'Daily messages',
}

export type LogTone = 'create' | 'update' | 'delete' | 'assign' | 'unassign' | 'send' | 'fail' | 'skip' | 'status' | 'info'

export interface LogChange { field: string; from: string | null; to: string | null }

export interface LogEntry {
  id: string
  at: string
  bookingRef: string | null
  section: LogSection
  tone: LogTone
  title: string
  detail?: string | null
  changes?: LogChange[]
  reason?: string | null
  actor: string | null
  source: string
}

export function isLogSection(v: unknown): v is LogSection {
  return typeof v === 'string' && (LOG_SECTIONS as readonly string[]).includes(v)
}

// ── Writing ──────────────────────────────────────────────────────────────────

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return e?.code === 'P2021' || /booking_event_logs.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

const clip = (v: unknown, n = 300): string | null => {
  if (v === null || v === undefined || v === '') return null
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export async function logBookingEvent(e: {
  bookingRef: string
  section: LogSection
  action: string
  summary: string
  changes?: LogChange[]
  status?: 'ok' | 'failed' | 'skipped'
  reason?: string | null
  actor?: { id?: string | null; name?: string | null } | null
  source?: string
}): Promise<void> {
  const data = {
    bookingRef: e.bookingRef,
    section: e.section,
    action: e.action.slice(0, 32),
    summary: e.summary.slice(0, 500),
    changes: e.changes?.length ? (e.changes as unknown as Prisma.InputJsonValue) : undefined,
    status: e.status ?? null,
    reason: e.reason ? e.reason.slice(0, 2000) : null,
    actorId: e.actor?.id ?? null,
    actorName: e.actor?.name ?? null,
    source: e.source ?? (e.actor?.id ? 'user' : 'system'),
  }
  try {
    await prisma.bookingEventLog.create({ data })
  } catch (err) {
    if (isMissingTable(err) && e.actor?.id) {
      await prisma.activityLog.create({
        data: {
          userId: e.actor.id, action: 'BOOKING_UPDATED', entityType: 'Booking', entityId: e.bookingRef,
          details: JSON.stringify({ section: e.section, logAction: e.action, summary: e.summary, changes: e.changes, reason: e.reason }),
        },
      }).catch(() => undefined)
    } else if (!isMissingTable(err)) {
      console.warn('[booking-logs] write failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }
}

/** Scheduler failures repeat every tick — write one row per booking/section/reason per 20 h. */
export async function logBookingEventOnce(e: Parameters<typeof logBookingEvent>[0]): Promise<void> {
  try {
    const dup = await prisma.bookingEventLog.findFirst({
      where: {
        bookingRef: e.bookingRef, section: e.section, summary: e.summary.slice(0, 500),
        reason: e.reason ? e.reason.slice(0, 2000) : null,
        createdAt: { gte: new Date(Date.now() - 20 * 3_600_000) },
      },
      select: { id: true },
    })
    if (dup) return
  } catch (err) {
    if (isMissingTable(err)) return
  }
  await logBookingEvent(e)
}

/** from → to for the keys that actually changed. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): LogChange[] {
  const out: LogChange[] = []
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in after) || after[key] === undefined) continue
    const a = clip(before[key]), b = clip(after[key])
    const norm = (s: string | null) => (s ?? '').trim()
    if (norm(a) !== norm(b)) out.push({ field: label, from: a, to: b })
  }
  return out
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface ReadLogsOpts {
  bookingRef?: string | null
  section?: LogSection | null
  q?: string | null
  actor?: string | null
  tone?: 'fail' | null
  from?: Date | null
  to?: Date | null
  before?: Date | null
  limit?: number
  /** Restrict to bookings in these countries (country-scoped staff). */
  countryRefFilter?: (ref: string) => boolean
}

const FIELD_SECTION: [RegExp, LogSection][] = [
  [/^contact|^agent(Email|Phone|Whatsapp|Address)/, 'contact'],
  [/^passenger/, 'passengers'],
  [/^flight/, 'flights'],
  [/^accommodation/, 'accommodation'],
]

function sectionOfFields(fields: string[]): LogSection {
  for (const [re, s] of FIELD_SECTION) if (fields.length && fields.every(f => re.test(f))) return s
  for (const [re, s] of FIELD_SECTION) if (fields.some(f => re.test(f))) return s
  return 'overview'
}

const humanField = (f: string) => f.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())

function toneOfAction(a: string): LogTone {
  const v = a.toLowerCase()
  if (/fail|error/.test(v)) return 'fail'
  if (/skip/.test(v)) return 'skip'
  if (/unassign|removed/.test(v)) return 'unassign'
  if (/assign|applied/.test(v)) return 'assign'
  if (/delete|cancel|undone/.test(v)) return 'delete'
  if (/create|add|new|generated/.test(v)) return 'create'
  if (/sent|send/.test(v)) return 'send'
  if (/status/.test(v)) return 'status'
  return 'update'
}

const MSG_TAGS: [string, string][] = [
  ['[DAILY-BRIEFING]', 'Daily trip plan'],
  ['[FEEDBACK-REQUEST]', 'Feedback request'],
  ['[CALL-APPROVAL-REMINDER]', 'Call-permission reminder'],
  ['[PORTAL-REMINDER]', 'Portal reminder'],
  ['[TICKETS-SENT]', 'Tickets sent'],
  ['[MOVEMENT', 'Movement message'],
  ['[DRIVER]', 'Driver notified'],
]

function msgLabel(sender: string | null): string {
  const s = sender ?? ''
  for (const [tag, label] of MSG_TAGS) if (s.startsWith(tag)) return label
  return 'WhatsApp message'
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p } catch { return fallback }
}

export async function readLogs(o: ReadLogsOpts): Promise<{ entries: LogEntry[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(o.limit ?? 60, 1), 300)
  const ref = o.bookingRef?.trim() || null
  const q = o.q?.trim() || null
  const qRef = q && /^[A-Za-z]{1,4}\d{3,}/.test(q) ? q.toUpperCase() : null
  // Free-text search filters after merging, so look further back to find matches.
  const take = q && !qRef ? 400 : limit + 1
  const refWhere = ref ?? qRef
  const time = {
    ...(o.from ? { gte: o.from } : {}),
    ...(o.to || o.before ? { lt: o.before && (!o.to || o.before < o.to) ? o.before : o.to! } : {}),
  }
  const hasTime = Object.keys(time).length > 0
  const want = (s: LogSection) => !o.section || o.section === s
  const entries: LogEntry[] = []

  // ── booking_event_logs ──
  {
    const rows = await safe(prisma.bookingEventLog.findMany({
      where: {
        ...(refWhere ? (ref ? { bookingRef: ref } : { bookingRef: { startsWith: refWhere } }) : {}),
        ...(o.section ? { section: o.section } : {}),
        ...(hasTime ? { createdAt: time } : {}),
        ...(o.tone === 'fail' ? { status: { in: ['failed', 'skipped'] } } : {}),
        ...(o.actor ? { actorName: { contains: o.actor } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take,
    }), [])
    for (const r of rows) {
      entries.push({
        id: `bel_${r.id}`, at: r.createdAt.toISOString(), bookingRef: r.bookingRef,
        section: isLogSection(r.section) ? r.section : 'overview',
        tone: r.status === 'failed' ? 'fail' : r.status === 'skipped' ? 'skip' : toneOfAction(r.action),
        title: r.summary, changes: Array.isArray(r.changes) ? (r.changes as unknown as LogChange[]) : undefined,
        reason: r.reason, actor: r.actorName ?? (r.source === 'scheduler' ? 'Scheduler' : r.source === 'system' ? 'System' : null), source: r.source ?? 'user',
      })
    }
  }

  // ── activity_logs (older edits, guest automation) ──
  if (o.tone !== 'fail') {
    const rows = await safe(prisma.activityLog.findMany({
      where: {
        entityType: 'Booking',
        ...(refWhere ? (ref ? { entityId: ref } : { entityId: { startsWith: refWhere } }) : {}),
        ...(hasTime ? { createdAt: time } : {}),
        ...(o.actor ? { user: { name: { contains: o.actor } } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: take * 2,
      select: { id: true, action: true, entityId: true, details: true, createdAt: true, user: { select: { name: true, email: true } } },
    }), [])
    for (const r of rows) {
      let d: Record<string, unknown> = {}
      try { d = r.details ? JSON.parse(r.details) : {} } catch { /* plain text */ }
      // A save that also wrote its detailed rows — those carry the from → to.
      if (d.logged === true) continue
      let section: LogSection = 'overview'
      let title = humanField(r.action.toLowerCase())
      let changes: LogChange[] | undefined
      let tone: LogTone = toneOfAction(r.action)
      if (isLogSection(d.section)) {
        section = d.section
        title = String(d.summary ?? title)
        changes = Array.isArray(d.changes) ? (d.changes as LogChange[]) : undefined
        if (typeof d.logAction === 'string') tone = toneOfAction(d.logAction)
      } else if (d.guestAutomation) {
        section = 'messages'
        const g = d.guestAutomation as Record<string, unknown> | string
        title = typeof g === 'string'
          ? (g === 'approval-request-started' ? 'Call-permission request sent' : humanField(g))
          : `Auto ${Array.isArray(g.kinds) ? (g.kinds as string[]).join(' & ') : ''} turned ${g.on ? 'ON' : 'OFF'}${g.reason ? ` — “${g.reason}”` : ''}`
      } else if (d.aiCallsPhone) {
        section = 'contact'
        const p = d.aiCallsPhone as { from?: string; to?: string }
        title = 'AI-call number updated'
        changes = [{ field: 'AI-call phone', from: p.from ?? null, to: p.to ?? null }]
      } else if (Array.isArray(d.fields)) {
        const fields = (d.fields as string[]).filter(f => f !== 'role')
        section = sectionOfFields(fields)
        title = `Edited ${fields.slice(0, 4).map(humanField).join(', ')}${fields.length > 4 ? ` +${fields.length - 4}` : ''}`
      } else if (r.action === 'BOOKING_CREATED') { title = 'Booking created'; tone = 'create' }
      else if (r.action === 'BOOKING_DELETED') { title = 'Booking deleted'; tone = 'delete' }
      if (!want(section)) continue
      entries.push({
        id: `act_${r.id}`, at: r.createdAt.toISOString(), bookingRef: r.entityId, section, tone, title, changes,
        actor: r.user?.name || r.user?.email || null, source: 'user',
      })
    }
  }

  // ── status_events + booking_versions (overview) ──
  if (want('overview') && o.tone !== 'fail') {
    const bookingWhere = refWhere ? (ref ? { bookingRef: ref } : { bookingRef: { startsWith: refWhere } }) : undefined
    const [status, versions] = await Promise.all([
      safe(prisma.statusEvent.findMany({
        where: { ...(bookingWhere ? { booking: bookingWhere } : {}), ...(hasTime ? { createdAt: time } : {}), ...(o.actor ? { actor: { name: { contains: o.actor } } } : {}) },
        orderBy: { createdAt: 'desc' }, take,
        select: { id: true, fromState: true, toState: true, note: true, createdAt: true, actor: { select: { name: true } }, booking: { select: { bookingRef: true } } },
      }), []),
      o.actor ? Promise.resolve([]) : safe(prisma.bookingVersion.findMany({
        where: { ...(bookingWhere ? { booking: bookingWhere } : {}), ...(hasTime ? { createdAt: time } : {}) },
        orderBy: { createdAt: 'desc' }, take,
        select: { id: true, versionNo: true, source: true, amendmentNote: true, createdById: true, createdAt: true, booking: { select: { bookingRef: true } } },
      }), []),
    ])
    for (const s of status) {
      entries.push({
        id: `st_${s.id}`, at: s.createdAt.toISOString(), bookingRef: s.booking.bookingRef, section: 'overview', tone: 'status',
        title: `Status → ${humanField(String(s.toState).toLowerCase().replace(/_/g, ' '))}`,
        changes: [{ field: 'Status', from: s.fromState ? String(s.fromState) : null, to: String(s.toState) }],
        detail: s.note, actor: s.actor?.name ?? null, source: 'user',
      })
    }
    const ids = Array.from(new Set(versions.map(v => v.createdById)))
    const users = ids.length ? await safe(prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }), []) : []
    const nameOf = new Map(users.map(u => [u.id, u.name]))
    for (const v of versions) {
      entries.push({
        id: `ver_${v.id}`, at: v.createdAt.toISOString(), bookingRef: v.booking.bookingRef, section: 'overview',
        tone: v.versionNo === 1 ? 'create' : 'update',
        title: v.versionNo === 1 ? `Booking created (V1${v.source ? ` · ${v.source}` : ''})` : `Version V${v.versionNo} added${v.source ? ` · ${v.source}` : ''}`,
        detail: v.amendmentNote, actor: nameOf.get(v.createdById) ?? (v.source ? 'Automation' : null), source: v.source ?? 'user',
      })
    }
  }

  // ── whatsapp_messages (messages) ──
  if (want('messages') && !o.actor) {
    const rows = await safe(prisma.whatsAppMessage.findMany({
      where: {
        direction: 'outbound',
        ...(refWhere ? (ref ? { bookingRef: ref } : { bookingRef: { startsWith: refWhere } }) : { senderName: { startsWith: '[' } }),
        ...(hasTime ? { createdAt: time } : {}),
        ...(o.tone === 'fail' ? { status: 'failed' } : {}),
        NOT: [{ bookingRef: { in: ['AGENT-DIGEST', 'DRIVER-BOARD'] } }],
      },
      orderBy: { createdAt: 'desc' }, take,
      select: { id: true, bookingRef: true, phone: true, body: true, status: true, senderName: true, createdAt: true },
    }), [])
    for (const m of rows) {
      const label = msgLabel(m.senderName)
      const failed = m.status === 'failed'
      entries.push({
        id: `wa_${m.id}`, at: m.createdAt.toISOString(), bookingRef: m.bookingRef, section: 'messages',
        tone: failed ? 'fail' : 'send',
        title: `${label} — ${failed ? 'not delivered' : m.status === 'read' ? 'read' : m.status === 'delivered' ? 'delivered' : 'sent'}`,
        detail: `To +${m.phone.replace(/^\+/, '')}${m.body ? ` · ${m.body.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`,
        reason: failed ? 'WhatsApp reported the message as undelivered (number not on WhatsApp, blocked, or outside the 24 h window).' : null,
        actor: m.senderName && !m.senderName.startsWith('[') ? m.senderName : null,
        source: m.senderName?.startsWith('[') ? 'automation' : 'user',
      })
    }
  }

  // ── AI calls (messages), per booking only — the schedule table is not time-indexed ──
  if (want('messages') && ref && !o.actor) {
    const rows = await safe(prisma.tbl_te_call_schedule.findMany({
      where: { booking_ref: ref, OR: [{ last_attempt_at: { not: null } }, { status: { notIn: ['pending', 'scheduled'] } }] },
      orderBy: { call_date: 'desc' }, take: 60,
      select: { id: true, day_no: true, call_date: true, phase: true, status: true, attempts: true, last_attempt_at: true, updated_at: true, error: true },
    }), [])
    for (const c of rows) {
      const at = c.last_attempt_at ?? c.updated_at
      if (hasTime && ((o.from && at < o.from) || (time.lt && at >= time.lt))) continue
      const st = c.status.toLowerCase()
      const ok = ['answered', 'done', 'completed'].includes(st)
      const bad = ['missed', 'failed', 'no_answer', 'busy', 'rejected'].includes(st) || !!c.error
      if (o.tone === 'fail' && !bad) continue
      const phase = /post/i.test(c.phase ?? '') ? 'After-tour call' : /reconf|pre/i.test(c.phase ?? '') ? 'Reconfirmation call' : `Day ${c.day_no} AI call`
      entries.push({
        id: `call_${c.id}`, at: at.toISOString(), bookingRef: ref, section: 'messages',
        tone: ok ? 'send' : bad ? 'fail' : 'info',
        title: `${phase} — ${ok ? 'answered' : st.replace(/_/g, ' ')}`,
        detail: `${c.call_date.toISOString().slice(0, 10)}${c.attempts > 1 ? ` · ${c.attempts} attempts` : ''}`,
        reason: c.error ?? (bad ? 'The guest did not pick up.' : null),
        actor: 'AI caller', source: 'automation',
      })
    }
  }

  // ── vn_driver_sync_events (agenda) ──
  if (want('agenda') && o.tone !== 'fail') {
    const rows = await safe(prisma.vnDriverSyncEvent.findMany({
      where: {
        ...(refWhere ? (ref ? { bookingRef: ref } : { bookingRef: { startsWith: refWhere } }) : {}),
        ...(hasTime ? { createdAt: time } : {}),
        ...(o.actor ? { actor: { contains: o.actor } } : {}),
        action: { in: ['applied', 'updated', 'undone'] },
      },
      orderBy: { createdAt: 'desc' }, take,
    }), [])
    for (const r of rows) {
      entries.push({
        id: `vds_${r.id}`, at: r.createdAt.toISOString(), bookingRef: r.bookingRef, section: 'agenda',
        tone: r.action === 'undone' ? 'unassign' : 'assign',
        title: `Driver ${r.action === 'undone' ? 'sync undone' : 'filled from VN sheet'}${r.movementLabel ? ` · ${r.movementLabel}` : ''}`,
        changes: [{ field: 'Driver', from: r.fromValue, to: r.toValue }], detail: r.detail,
        actor: r.actor ?? 'VN Driver Sync', source: 'sync',
      })
    }
  }

  // ── file_handler_logs (flights) ──
  if (want('flights') && o.tone !== 'fail') {
    const rows = await safe(prisma.fileHandlerLog.findMany({
      where: {
        action: { not: 'LOGIN' },
        ...(refWhere ? (ref ? { bookingRef: ref } : { bookingRef: { startsWith: refWhere } }) : { bookingRef: { not: null } }),
        ...(hasTime ? { createdAt: time } : {}),
        ...(o.actor ? { fileHandlerName: { contains: o.actor } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take,
      select: { id: true, action: true, bookingRef: true, details: true, fileHandlerName: true, createdAt: true },
    }), [])
    for (const r of rows) {
      entries.push({
        id: `fh_${r.id}`, at: r.createdAt.toISOString(), bookingRef: r.bookingRef, section: 'flights',
        tone: toneOfAction(r.action), title: humanField(r.action.toLowerCase().replace(/_/g, ' ')),
        detail: r.details?.slice(0, 300) ?? null, actor: `${r.fileHandlerName} (file handler)`, source: 'file-handler',
      })
    }
  }

  // ── merge, search, page ──
  let all = entries
  if (o.countryRefFilter) all = all.filter(e => !e.bookingRef || o.countryRefFilter!(e.bookingRef))
  if (q && !qRef) {
    const needle = q.toLowerCase()
    all = all.filter(e => [e.title, e.detail, e.reason, e.actor, e.bookingRef, ...(e.changes ?? []).flatMap(c => [c.field, c.from, c.to])]
      .some(v => v && v.toLowerCase().includes(needle)))
  }
  if (o.tone === 'fail') all = all.filter(e => e.tone === 'fail' || e.tone === 'skip')
  all.sort((a, b) => b.at.localeCompare(a.at))
  const page = all.slice(0, limit)
  return { entries: page, nextBefore: all.length > limit ? page[page.length - 1].at : null }
}
