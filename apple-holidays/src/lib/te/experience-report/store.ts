/**
 * Persistence for the Experience Report Centre.
 *
 * Every report is a row in `te_experience_reports` — including the ones that
 * were held and the ones that failed — because "view past mails" means seeing
 * what actually went out, not regenerating an approximation of it. The exact
 * `bodyHtml` that Graph was handed is stored alongside the evidence it came
 * from.
 *
 * Settings live in a single `SystemSetting` JSON document, the same pattern the
 * daily call report uses.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type {
  ExperienceNarrative, ExperienceReportRecord, ExperienceReportSettings,
  ExperienceReportSummary, FeedbackChannel, ReportEvent, ReportStatus,
  RiskSignal, TripDossier,
} from './types'

export const SETTINGS_KEY = 'te_experience_report_settings'

export const DEFAULT_SETTINGS: ExperienceReportSettings = {
  autoSend: true,
  lookbackDays: 7,
  // Two clear days after departure: the desk's rule is "day before yesterday's
  // finished trips", which also gives a last-evening call or a form filled in
  // on the flight home time to land before the report is written.
  quietDays: 2,
  holdAtLevel: 'medium',
  escalationEmail: 'pradeep.kumar@aahaas.com',
  ccEmails: [],
  requireApproval: false,
  sendClientThankYou: true,
  clientMailCc: [],
  updatedAt: null,
  updatedBy: null,
}

/**
 * A report in one of these states still has someone waiting on it, so the
 * sweep leaves it alone rather than building a second one for the same trip.
 */
export const OPEN_STATUSES: ReportStatus[] = ['pending', 'held', 'draft', 'queued']

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<ExperienceReportSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } })
  if (!row?.value) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(row.value) as Partial<ExperienceReportSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ccEmails: Array.isArray(parsed.ccEmails) ? parsed.ccEmails : [],
      clientMailCc: Array.isArray(parsed.clientMailCc) ? parsed.clientMailCc : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export class SettingsError extends Error {}

const cleanAddresses = (list: string[]) => list
  .map(e => e.trim())
  .filter(e => e.includes('@'))
  .filter((e, i, a) => a.indexOf(e) === i)

export async function saveSettings(
  patch: Partial<ExperienceReportSettings>,
  actor: string | null,
): Promise<ExperienceReportSettings> {
  const current = await getSettings()

  const email = (patch.escalationEmail ?? current.escalationEmail).trim()
  if (!email.includes('@')) throw new SettingsError('The escalation address must be a valid email.')

  const lookbackDays = Number(patch.lookbackDays ?? current.lookbackDays)
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new SettingsError('Look-back must be between 1 and 90 days.')
  }

  const quietDays = Number(patch.quietDays ?? current.quietDays)
  if (!Number.isFinite(quietDays) || quietDays < 0 || quietDays > 30) {
    throw new SettingsError('The settling period must be between 0 and 30 days.')
  }
  if (quietDays >= lookbackDays) {
    throw new SettingsError('The settling period must be shorter than the look-back window, or no trip would ever qualify.')
  }

  const holdAtLevel = patch.holdAtLevel ?? current.holdAtLevel
  if (!['low', 'medium', 'high'].includes(holdAtLevel)) {
    throw new SettingsError('Hold level must be low, medium or high.')
  }

  const next: ExperienceReportSettings = {
    ...current,
    ...patch,
    escalationEmail: email,
    lookbackDays,
    quietDays,
    holdAtLevel,
    ccEmails: cleanAddresses(patch.ccEmails ?? current.ccEmails),
    clientMailCc: cleanAddresses(patch.clientMailCc ?? current.clientMailCc),
    autoSend: patch.autoSend ?? current.autoSend,
    requireApproval: patch.requireApproval ?? current.requireApproval,
    sendClientThankYou: patch.sendClientThankYou ?? current.sendClientThankYou,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  }

  await prisma.systemSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  })
  return next
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

type Row = Prisma.TeExperienceReportGetPayload<Record<string, never>>

function asArray<T>(v: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function asObject<T>(v: Prisma.JsonValue | null | undefined): T | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null
}

export function toRecord(row: Row): ExperienceReportRecord {
  return {
    id: row.id,
    bookingRef: row.bookingRef,
    status: row.status as ReportStatus,
    triggerSource: row.triggerSource as ExperienceReportRecord['triggerSource'],
    riskLevel: row.riskLevel as ExperienceReportRecord['riskLevel'],
    riskScore: row.riskScore,
    riskSignals: asArray<RiskSignal>(row.riskSignals),
    holdReason: row.holdReason,
    clientName: row.clientName,
    agentName: row.agentName,
    arrivalDate: row.arrivalDate?.toISOString() ?? null,
    departureDate: row.departureDate?.toISOString() ?? null,
    sources: asArray<FeedbackChannel>(row.sources),
    dossier: asObject<TripDossier>(row.dossier),
    narrative: asObject<ExperienceNarrative>(row.narrative),
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    toEmail: row.toEmail,
    ccEmails: (row.ccEmails ?? '').split(',').map(s => s.trim()).filter(Boolean),
    sentAt: row.sentAt?.toISOString() ?? null,
    sentBy: row.sentBy,
    escalationTo: row.escalationTo,
    escalationHtml: row.escalationHtml,
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    releasedBy: row.releasedBy,
    resolutionNote: row.resolutionNote,
    lastError: row.lastError,
    events: asArray<ReportEvent>(row.events),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSummary(record: ExperienceReportRecord): ExperienceReportSummary {
  const { dossier, narrative, ...rest } = record
  return {
    ...rest,
    bodyHtml: undefined as never,
    escalationHtml: undefined as never,
    headline: narrative?.headline ?? null,
    hasNarrative: !!narrative,
    callCount: dossier?.calls.length ?? 0,
    transcriptCount: dossier?.calls.reduce((n, c) => n + c.transcript.length, 0) ?? 0,
    clientMailSentAt: narrative?.clientMail?.sentAt ?? null,
  } as ExperienceReportSummary
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export interface ListFilters {
  status?: ReportStatus | 'all'
  riskLevel?: string
  search?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export async function listReports(filters: ListFilters) {
  const where: Prisma.TeExperienceReportWhereInput = {}

  if (filters.status && filters.status !== 'all') where.status = filters.status
  if (filters.riskLevel && filters.riskLevel !== 'all') where.riskLevel = filters.riskLevel

  const search = filters.search?.trim()
  if (search) {
    where.OR = [
      { bookingRef: { contains: search } },
      { clientName: { contains: search } },
      { agentName: { contains: search } },
      { toEmail: { contains: search } },
    ]
  }

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59`) } : {}),
    }
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  // `dossier` and the two HTML bodies are megabytes across a full page — the
  // list never shows them, so they are not selected. The detail route reads
  // them for one row at a time.
  const [rows, total, statusGroups] = await Promise.all([
    prisma.teExperienceReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true, bookingRef: true, status: true, triggerSource: true,
        riskLevel: true, riskScore: true, riskSignals: true, holdReason: true,
        clientName: true, agentName: true, arrivalDate: true, departureDate: true,
        sources: true, subject: true, toEmail: true, ccEmails: true,
        sentAt: true, sentBy: true, escalationTo: true, escalatedAt: true,
        releasedAt: true, releasedBy: true, resolutionNote: true, lastError: true,
        events: true, createdBy: true, createdAt: true, updatedAt: true,
        narrative: true,
      },
    }),
    prisma.teExperienceReport.count({ where }),
    prisma.teExperienceReport.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const items: ExperienceReportSummary[] = rows.map(r => {
    const record = toRecord({ ...r, dossier: null, bodyHtml: null, escalationHtml: null } as Row)
    return {
      ...toSummary(record),
      // These two come from the dossier, which we did not select. The list shows
      // them as a hint only; the detail view has the real counts.
      callCount: 0,
      transcriptCount: 0,
    }
  })

  const counts: Record<string, number> = { all: 0 }
  for (const g of statusGroups) {
    counts[g.status] = g._count._all
    counts.all += g._count._all
  }

  return { items, total, counts, limit, offset }
}

export async function getReport(id: string): Promise<ExperienceReportRecord | null> {
  const row = await prisma.teExperienceReport.findUnique({ where: { id } })
  return row ? toRecord(row) : null
}

/** The most recent report for a booking, whatever its state. */
export async function latestForBooking(bookingRef: string): Promise<ExperienceReportRecord | null> {
  const row = await prisma.teExperienceReport.findFirst({
    where: { bookingRef },
    orderBy: { createdAt: 'desc' },
  })
  return row ? toRecord(row) : null
}

/** Has this booking's report already gone to the agent? Guards the auto sweep. */
export async function alreadySent(bookingRef: string): Promise<boolean> {
  const n = await prisma.teExperienceReport.count({
    where: { bookingRef, status: 'sent' },
  })
  return n > 0
}

/** Any report for this booking still waiting on a human. */
export async function openReportFor(bookingRef: string): Promise<ExperienceReportRecord | null> {
  const row = await prisma.teExperienceReport.findFirst({
    where: { bookingRef, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: 'desc' },
  })
  return row ? toRecord(row) : null
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export function event(action: string, actor: string | null, detail?: string | null): ReportEvent {
  return { at: new Date().toISOString(), actor, action, detail: detail ?? null }
}

/** Appends to the audit trail without clobbering a concurrent write's entries. */
export async function appendEvent(id: string, entry: ReportEvent) {
  const row = await prisma.teExperienceReport.findUnique({ where: { id }, select: { events: true } })
  const events = asArray<ReportEvent>(row?.events)
  await prisma.teExperienceReport.update({
    where: { id },
    data: { events: [...events, entry] as unknown as Prisma.InputJsonValue },
  })
}

export async function updateReport(
  id: string,
  data: Prisma.TeExperienceReportUpdateInput,
  entry?: ReportEvent,
): Promise<ExperienceReportRecord> {
  if (entry) {
    const row = await prisma.teExperienceReport.findUnique({ where: { id }, select: { events: true } })
    const events = asArray<ReportEvent>(row?.events)
    data = { ...data, events: [...events, entry] as unknown as Prisma.InputJsonValue }
  }
  const updated = await prisma.teExperienceReport.update({ where: { id }, data })
  return toRecord(updated)
}
