/**
 * D-3 → D-1 Driver Brief readiness — the morning list of files that are about
 * to start and the drivers who have not been told.
 *
 * The allocation board answers "does this file have a driver". It cannot answer
 * the question that actually loses a tour: *has anyone spoken to him*. A driver
 * allocated four weeks ago and never briefed is indistinguishable, on that
 * board, from one who was walked through the file yesterday — and the day that
 * difference shows up is the morning of the pickup, which is far too late.
 *
 * So this report reads the three days before travel, in the order the desk can
 * still act on them:
 *
 *   • **D-3** — the working deadline. The driver is allocated, the file is
 *     complete, and there is still room to swap him if he says no.
 *   • **D-2** — chase. One day of slack left.
 *   • **D-1** — escalation. Anything unbriefed here is tomorrow's problem, and
 *     anything *unallocated* here is tonight's.
 *
 * Every row carries a verdict rather than raw columns, because the reader of a
 * 07:00 email is triaging, not analysing: `ready_to_brief` is work to do today,
 * `briefed` is done, `no_driver` is an allocation emergency, and `no_driver_needed`
 * is a Hotel Only or all-leisure file that correctly needs neither.
 *
 * Read-only over bookings. The single write is the once-a-day send guard.
 */
import { prisma } from '@/lib/prisma'
import { bookingNeedsDriver } from '@/lib/driver-requirement'
import { todayUtc } from '@/lib/driver-brief'
import type { OperationCountry } from '@prisma/client'

/** How many days ahead the report looks. D-3 is the working deadline. */
export const BRIEF_LEAD_DAYS = [3, 2, 1] as const
export type BriefLeadDay = (typeof BRIEF_LEAD_DAYS)[number]

export const SETTING_BRIEF_REPORT_LAST_RUN = 'driver_brief_report_last_run_date'
export const SETTING_BRIEF_REPORT_ENABLED = 'driver_brief_report_enabled'

/**
 * Where a file stands, three days out.
 *
 * Ordered by how loudly it needs the desk: an unallocated file three days from
 * arrival outranks an allocated one nobody has phoned.
 */
export type BriefVerdict =
  | 'no_driver'          // needs a driver, has none — allocation emergency
  | 'ready_to_brief'     // driver allocated, brief not started — today's work
  | 'brief_started'      // deck opened, not signed off
  | 'briefed'            // signed off by a named person
  | 'no_driver_needed'   // Hotel Only / all-leisure — correctly nothing to do

export const VERDICT_LABEL: Record<BriefVerdict, string> = {
  no_driver:        'No driver allocated',
  ready_to_brief:   'Ready to brief',
  brief_started:    'Brief started',
  briefed:          'Briefed',
  no_driver_needed: 'No driver needed',
}

export const VERDICT_HEX: Record<BriefVerdict, string> = {
  no_driver:        '#ef4444',
  ready_to_brief:   '#14b8a6',
  brief_started:    '#eab308',
  briefed:          '#22c55e',
  no_driver_needed: '#64748b',
}

export interface BriefReportRow {
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  agent: string | null
  fileHandler: string | null
  status: string
  country: string | null
  arrivalDate: string
  departureDate: string
  /** 3, 2 or 1 — days between today and arrival. */
  leadDay: number
  pax: number
  leadName: string | null
  hotelOnly: boolean
  driverName: string | null
  driverPhone: string | null
  driverPhotoUrl: string | null
  vehicleType: string | null
  vehiclePlate: string | null
  /** Movements that need a driver and have nobody on them. */
  unassignedMovements: number
  movementCount: number
  verdict: BriefVerdict
  briefStatus: 'pending' | 'in_progress' | 'completed'
  briefedByName: string | null
  briefedAt: string | null
}

export interface BriefReportGroup {
  leadDay: number
  label: string
  /** What the desk is meant to do with this group today. */
  instruction: string
  rows: BriefReportRow[]
}

export interface BriefReadinessReport {
  generatedAt: string
  /** The date the report is *about* — today, in the operating timezone. */
  forDate: string
  country: string | null
  groups: BriefReportGroup[]
  totals: Record<BriefVerdict, number> & { files: number }
}

const GROUP_COPY: Record<BriefLeadDay, { label: string; instruction: string }> = {
  3: {
    label: 'D-3 — brief today',
    instruction: 'Driver is allocated and the file is complete. Call him today, while there is still room to swap him if he says no.',
  },
  2: {
    label: 'D-2 — chasing',
    instruction: 'Should already have been briefed at D-3. One day of slack left — call now.',
  },
  1: {
    label: 'D-1 — escalate',
    instruction: 'They travel tomorrow. Anything unbriefed here is a supervisor call tonight; anything unallocated is an emergency.',
  },
}

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

/**
 * The report.
 *
 * `country` narrows to one operation (the Sri Lanka board passes `SRILANKA`);
 * omit it for every country at once. Cancelled files are excluded — nobody is
 * briefing a driver for a tour that is not happening.
 */
export async function buildBriefReadinessReport(opts: {
  country?: OperationCountry | null
  /** Override "today" — used by the cron so a run is reproducible. */
  today?: Date
} = {}): Promise<BriefReadinessReport> {
  const today = opts.today ?? todayUtc()

  // One query for all three days rather than three: the desk reads them as one
  // list and the group boundaries are a property of the row, not of the query.
  const windowStart = new Date(today.getTime() + 1 * 86_400_000)
  const windowEnd = new Date(today.getTime() + 3 * 86_400_000 + 86_399_999)

  const bookings = await prisma.booking.findMany({
    where: {
      status: { not: 'CANCELLED' },
      arrivalDate: { gte: windowStart, lte: windowEnd },
      ...(opts.country ? { operationCountry: opts.country } : {}),
    },
    orderBy: { arrivalDate: 'asc' },
    select: {
      bookingRef: true, isNumber: true, cntlNumber: true, agent: true, fileHandler: true,
      status: true, operationCountry: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, hotelOnly: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      slDriverAllocation: {
        select: {
          vehicleType: true,
          driver: {
            select: {
              name: true, phone: true, photoUrl: true,
              vehicle: { select: { type: true, plateNo: true } },
            },
          },
          vendor: { select: { name: true } },
        },
      },
      tourAgenda: {
        select: {
          items: {
            select: {
              location: true, fromPoint: true, toPoint: true, details: true,
              serviceType: true, isLeisure: true, isHotelOnly: true,
              assignment: {
                select: {
                  driverName: true, driverPhone: true, vehiclePlate: true, vehicleType: true,
                  driver: { select: { name: true, phone: true, photoUrl: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  const refs = bookings.map(b => b.bookingRef)
  const briefs = refs.length
    ? await prisma.driverBrief.findMany({ where: { bookingRef: { in: refs } } })
    : []
  const briefByRef = new Map(briefs.map(b => [b.bookingRef, b]))

  const rows: BriefReportRow[] = bookings.map(b => {
    const items = b.tourAgenda?.items ?? []
    const needsDriver = bookingNeedsDriver({
      hotelOnly: b.hotelOnly,
      vehicleType: b.slDriverAllocation?.vehicleType ?? null,
      items,
    })

    // The allocation board's driver first; failing that, the driver carrying
    // the most movements — a file driven entirely from the movement chart is
    // still an allocated file.
    const allocDriver = b.slDriverAllocation?.driver ?? null
    const chartDriver = items.map(i => i.assignment).find(a => a?.driver?.name || a?.driverName) ?? null

    const driverName = allocDriver?.name ?? chartDriver?.driver?.name ?? chartDriver?.driverName ?? null
    const driverPhone = allocDriver?.phone ?? chartDriver?.driver?.phone ?? chartDriver?.driverPhone ?? null

    const unassigned = items.filter(i => {
      const needs = !(i.isHotelOnly === true) && !(i.isLeisure === true)
      return needs && !(i.assignment?.driver?.name || i.assignment?.driverName)
    }).length

    const brief = briefByRef.get(b.bookingRef)
    const briefStatus = (brief?.status as BriefReportRow['briefStatus']) ?? 'pending'

    const verdict: BriefVerdict =
      !needsDriver ? 'no_driver_needed'
      : !driverName ? 'no_driver'
      : briefStatus === 'completed' ? 'briefed'
      : briefStatus === 'in_progress' ? 'brief_started'
      : 'ready_to_brief'

    return {
      bookingRef: b.bookingRef,
      isNumber: b.isNumber,
      cntlNumber: b.cntlNumber,
      agent: b.agent,
      fileHandler: b.fileHandler,
      status: String(b.status),
      country: b.operationCountry ?? null,
      arrivalDate: iso(b.arrivalDate),
      departureDate: iso(b.departureDate),
      leadDay: Math.round((new Date(iso(b.arrivalDate)).getTime() - today.getTime()) / 86_400_000),
      pax: b.paxAdults + b.paxChildren,
      leadName: b.passengers[0]?.name ?? null,
      hotelOnly: b.hotelOnly,
      driverName,
      driverPhone,
      driverPhotoUrl: allocDriver?.photoUrl ?? chartDriver?.driver?.photoUrl ?? null,
      vehicleType: allocDriver?.vehicle?.type ?? chartDriver?.vehicleType ?? b.slDriverAllocation?.vehicleType ?? null,
      vehiclePlate: allocDriver?.vehicle?.plateNo ?? chartDriver?.vehiclePlate ?? null,
      unassignedMovements: unassigned,
      movementCount: items.length,
      verdict,
      briefStatus,
      briefedByName: brief?.briefedByName ?? null,
      briefedAt: brief?.completedAt?.toISOString() ?? null,
    }
  })

  // Loudest first inside each day, so triage reads top-down.
  const ORDER: BriefVerdict[] = ['no_driver', 'ready_to_brief', 'brief_started', 'briefed', 'no_driver_needed']
  const groups: BriefReportGroup[] = BRIEF_LEAD_DAYS.map(day => ({
    leadDay: day,
    label: GROUP_COPY[day].label,
    instruction: GROUP_COPY[day].instruction,
    rows: rows
      .filter(r => r.leadDay === day)
      .sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.bookingRef.localeCompare(b.bookingRef)),
  }))

  const totals = ORDER.reduce(
    (acc, v) => ({ ...acc, [v]: rows.filter(r => r.verdict === v).length }),
    {} as Record<BriefVerdict, number>,
  )

  return {
    generatedAt: new Date().toISOString(),
    forDate: iso(today),
    country: opts.country ?? null,
    groups,
    totals: { ...totals, files: rows.length },
  }
}

// ── The email ────────────────────────────────────────────────────────────────

const OPS_BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://ops.aahaas.com').replace(/\/$/, '')

const esc = (v: string | null | undefined) =>
  String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const pretty = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })

/**
 * The report as mail.
 *
 * Written to be actioned from a phone at 07:00: every row's booking ref is a
 * link straight into the file, and each group leads with the sentence saying
 * what to do with it rather than a bare count. Deliberately table-based inline
 * HTML — Outlook is the reader here, not a browser.
 */
export function renderBriefReadinessEmail(report: BriefReadinessReport): string {
  const t = report.totals
  const chip = (label: string, n: number, hex: string) => `
    <td style="padding:0 6px 0 0;">
      <div style="background:${hex}14;border:1px solid ${hex}40;border-radius:10px;padding:10px 12px;">
        <div style="font:700 20px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:${hex};">${n}</div>
        <div style="font:600 10px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">${esc(label)}</div>
      </div>
    </td>`

  const row = (r: BriefReportRow) => {
    const hex = VERDICT_HEX[r.verdict]
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
        <a href="${OPS_BASE}/dashboard/bookings/${encodeURIComponent(r.bookingRef)}"
           style="font:800 13px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f766e;text-decoration:none;">${esc(r.bookingRef)}</a>
        <div style="font:400 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;margin-top:2px;">
          ${esc(r.isNumber ? `IS ${r.isNumber}` : '')}${r.agent ? ` · ${esc(r.agent)}` : ''}
        </div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
        ${esc(r.leadName ?? '—')}
        <div style="font-weight:400;color:#64748b;font-size:11px;">${r.pax} pax · ${esc(pretty(r.arrivalDate))}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
        ${r.driverName ? esc(r.driverName) : '<span style="color:#ef4444;">— none —</span>'}
        ${r.driverPhone ? `<div style="font-weight:400;color:#64748b;font-size:11px;">${esc(r.driverPhone)}</div>` : ''}
        ${r.unassignedMovements > 0 ? `<div style="color:#b45309;font-size:11px;font-weight:600;">${r.unassignedMovements} movement(s) unassigned</div>` : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
        <span style="display:inline-block;background:${hex}14;border:1px solid ${hex}45;color:${hex};border-radius:999px;padding:3px 10px;font:700 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;">
          ${esc(VERDICT_LABEL[r.verdict])}
        </span>
        ${r.briefedByName ? `<div style="font:400 10px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;margin-top:3px;">by ${esc(r.briefedByName)}</div>` : ''}
      </td>
    </tr>`
  }

  const group = (g: BriefReportGroup) => {
    if (g.rows.length === 0) {
      return `
      <div style="margin:0 0 20px;">
        <h3 style="font:800 15px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0 0 4px;">${esc(g.label)}</h3>
        <p style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8;margin:0;">Nothing arriving on this day.</p>
      </div>`
    }
    const toBrief = g.rows.filter(r => r.verdict === 'ready_to_brief' || r.verdict === 'brief_started').length
    return `
    <div style="margin:0 0 26px;">
      <h3 style="font:800 15px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0 0 4px;">
        ${esc(g.label)} <span style="color:#94a3b8;font-weight:600;">· ${g.rows.length} file${g.rows.length === 1 ? '' : 's'}${toBrief ? `, ${toBrief} to call` : ''}</span>
      </h3>
      <p style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;margin:0 0 10px;">${esc(g.instruction)}</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr style="background:#f8fafc;">
          ${['File', 'Guests', 'Driver', 'Brief'].map(h =>
            `<th align="left" style="padding:8px 12px;font:700 10px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">${h}</th>`).join('')}
        </tr>
        ${g.rows.map(row).join('')}
      </table>
    </div>`
  }

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px 12px;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:linear-gradient(135deg,#0f766e,#0e7490);padding:22px 24px;">
      <div style="font:800 19px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:#ffffff;">Driver Brief Readiness · D-3 → D-1</div>
      <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#ccfbf1;margin-top:4px;">
        ${esc(pretty(report.forDate))}${report.country ? ` · ${esc(report.country)}` : ''} · ${t.files} file${t.files === 1 ? '' : 's'} arriving in the next three days
      </div>
    </td></tr>
    <tr><td style="padding:22px 24px;">
      <table cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
        ${chip('No driver', t.no_driver, VERDICT_HEX.no_driver)}
        ${chip('Ready to brief', t.ready_to_brief, VERDICT_HEX.ready_to_brief)}
        ${chip('Started', t.brief_started, VERDICT_HEX.brief_started)}
        ${chip('Briefed', t.briefed, VERDICT_HEX.briefed)}
        ${chip('No driver needed', t.no_driver_needed, VERDICT_HEX.no_driver_needed)}
      </tr></table>
      ${report.groups.map(group).join('')}
      <div style="margin-top:6px;padding-top:16px;border-top:1px solid #e2e8f0;">
        <a href="${OPS_BASE}/dashboard/srilanka/driver-allocation"
           style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:10px;padding:11px 18px;font:700 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;">
          Open the allocation board
        </a>
        <p style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8;margin:14px 0 0;">
          A file is <strong>ready to brief</strong> once it has a driver and nobody has opened the brief yet.
          Open the booking, press <strong>Driver Brief</strong>, and read it to him screen by screen.
        </p>
      </div>
    </td></tr>
  </table></body></html>`
}

// ── The daily send ───────────────────────────────────────────────────────────

/** Comma-separated recipients. No default: an unset list means "do not send". */
function recipients(): string[] {
  return (process.env.DRIVER_BRIEF_REPORT_TO ?? '')
    .split(/[,;]/).map(s => s.trim()).filter(s => s.includes('@'))
}

export interface BriefReportRunResult {
  sent: boolean
  reason?: string
  to?: string[]
  files?: number
  readyToBrief?: number
}

/**
 * Builds and mails the readiness report, at most once per calendar day.
 *
 * The day guard is claimed *before* the mail is built, matching every other
 * scheduler here: a restart mid-send must not be able to mail the desk twice,
 * and a report that is missed once is far cheaper than one that arrives twice
 * and trains people to ignore it.
 */
export async function runDriverBriefReport(opts: {
  country?: OperationCountry | null
  /** Send even if today's send already happened — used by the manual trigger. */
  force?: boolean
  today?: Date
} = {}): Promise<BriefReportRunResult> {
  const today = opts.today ?? todayUtc()
  const dayKey = iso(today)

  const enabled = await prisma.systemSetting.findUnique({ where: { key: SETTING_BRIEF_REPORT_ENABLED } })
  if (enabled?.value === 'false' && !opts.force) return { sent: false, reason: 'disabled' }

  const to = recipients()
  if (to.length === 0) return { sent: false, reason: 'DRIVER_BRIEF_REPORT_TO is not set' }

  if (!opts.force) {
    const last = await prisma.systemSetting.findUnique({ where: { key: SETTING_BRIEF_REPORT_LAST_RUN } })
    if (last?.value === dayKey) return { sent: false, reason: `already sent for ${dayKey}` }
    await prisma.systemSetting.upsert({
      where:  { key: SETTING_BRIEF_REPORT_LAST_RUN },
      update: { value: dayKey },
      create: { key: SETTING_BRIEF_REPORT_LAST_RUN, value: dayKey },
    })
  }

  const report = await buildBriefReadinessReport({ country: opts.country ?? null, today })
  const { sendMailViaGraph } = await import('@/lib/send-mail')

  const subject =
    `Driver Brief D-3 → D-1 · ${report.totals.ready_to_brief} to call` +
    (report.totals.no_driver ? `, ${report.totals.no_driver} with no driver` : '') +
    ` · ${pretty(report.forDate)}`

  await sendMailViaGraph({
    to: to[0],
    cc: to.slice(1),
    subject,
    bodyHtml: renderBriefReadinessEmail(report),
  })

  return {
    sent: true,
    to,
    files: report.totals.files,
    readyToBrief: report.totals.ready_to_brief,
  }
}
