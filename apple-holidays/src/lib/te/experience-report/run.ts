/**
 * The pipeline: collect → grade → write → send, or hold.
 *
 * One report per trip, at the end of the trip. Nothing here sends day-by-day.
 *
 * The hold is the important part. If the grading finds the client had a bad
 * experience, the agent mail is built but not sent; the report goes to the
 * escalation inbox instead, saying in the first line that the agent has not
 * been told. Only a person can release it after that.
 */
import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'
import { collectTripDossier, dossierChannels } from './collect'
import { assessRisk } from './risk'
import { generateNarrative, fallbackNarrative } from './narrative'
import {
  buildAgentEmail, buildAgentSubject, buildEscalationEmail, buildEscalationSubject,
} from './email'
import {
  appendEvent, event, getReport, getSettings, toRecord, updateReport, alreadySent,
} from './store'
import type {
  ExperienceReportRecord, ExperienceReportSettings, RiskAssessment, TriggerSource, TripDossier,
} from './types'
import type { Prisma } from '@prisma/client'

const APP_URL = (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')

function reviewUrl(id: string) {
  return APP_URL ? `${APP_URL}/dashboard/te/experience-reports?report=${id}` : null
}

export class ReportError extends Error {}

/**
 * Test mode is shared with the rest of the mailers: when `use_test_data` is on,
 * nothing leaves for a real agent — everything is redirected to the two test
 * inboxes. Escalations follow the same rule.
 */
async function getMailMode() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['use_test_data', 'test_email_1', 'test_email_2'] } },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    testMode: map['use_test_data'] === 'true',
    testTo: (map['test_email_1'] ?? 'sasiofficial25@gmail.com').trim(),
    testCc: (map['test_email_2'] ?? 'sasindu@aahaas.com').trim(),
  }
}

function dateOnly(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : new Date(d.toISOString().slice(0, 10))
}

// ─── Build ────────────────────────────────────────────────────────────────────

export interface BuildOptions {
  bookingRef: string
  actor: string | null
  trigger: TriggerSource
  /** Skip the OpenAI call — used when the desk only wants to see the evidence. */
  skipNarrative?: boolean
  /** Grade and hold as usual, but never auto-send even if clean. */
  draftOnly?: boolean
}

/**
 * Builds (or rebuilds) a report row for a booking and returns it. This never
 * sends: it decides between `held` and `draft`/`queued` and stops there, so the
 * caller — the sweep or a person — owns the decision to actually mail.
 */
export async function buildReport(opts: BuildOptions): Promise<ExperienceReportRecord> {
  const settings = await getSettings()
  const dossier = await collectTripDossier(opts.bookingRef)
  const channels = dossierChannels(dossier)

  if (!channels.length) {
    throw new ReportError(
      `No feedback of any kind was collected for ${opts.bookingRef} — there is nothing to report on yet.`,
    )
  }

  const risk = assessRisk(dossier, settings.holdAtLevel)

  const narrative = opts.skipNarrative
    ? fallbackNarrative(dossier)
    : await generateNarrative({ dossier, risk })

  const subject = buildAgentSubject(dossier)
  const bodyHtml = buildAgentEmail({ dossier, narrative, isAutoSend: opts.trigger === 'auto' })

  const status: ExperienceReportRecord['status'] =
    risk.shouldHold ? 'held'
    : opts.draftOnly || settings.requireApproval ? 'draft'
    : 'queued'

  const escalationHtml = risk.shouldHold
    ? buildEscalationEmail({ dossier, narrative, risk, reviewUrl: null })
    : null

  const created = await prisma.teExperienceReport.create({
    data: {
      bookingRef: opts.bookingRef,
      status,
      triggerSource: opts.trigger,
      riskLevel: risk.level,
      riskScore: risk.score,
      riskSignals: risk.signals as unknown as Prisma.InputJsonValue,
      holdReason: risk.reason,
      clientName: dossier.facts.clientName,
      agentName: dossier.facts.agentName,
      arrivalDate: dateOnly(dossier.facts.arrivalDate),
      departureDate: dateOnly(dossier.facts.departureDate),
      sources: channels as unknown as Prisma.InputJsonValue,
      dossier: dossier as unknown as Prisma.InputJsonValue,
      narrative: narrative as unknown as Prisma.InputJsonValue,
      subject,
      bodyHtml,
      escalationHtml,
      escalationTo: risk.shouldHold ? settings.escalationEmail : null,
      createdBy: opts.actor,
      events: [
        event('built', opts.actor, `Built from ${channels.length} channel(s); risk ${risk.level} (${risk.score}).`),
        ...(risk.shouldHold ? [event('held', opts.actor, risk.reason)] : []),
      ] as unknown as Prisma.InputJsonValue,
    },
  })

  const record = toRecord(created)

  // The escalation embeds a link back to itself, so it can only be rendered
  // once the row has an id. Re-render now that we have one.
  if (risk.shouldHold) {
    await prisma.teExperienceReport.update({
      where: { id: record.id },
      data: {
        escalationHtml: buildEscalationEmail({
          dossier, narrative, risk, reviewUrl: reviewUrl(record.id),
        }),
      },
    })
  }

  return (await getReport(record.id))!
}

/** Re-grade and re-write an existing report against fresh evidence. */
export async function regenerateReport(
  id: string,
  actor: string | null,
  opts?: { skipNarrative?: boolean },
): Promise<ExperienceReportRecord> {
  const existing = await getReport(id)
  if (!existing) throw new ReportError('Report not found.')
  if (existing.status === 'sent') {
    throw new ReportError('This report has already gone to the agent and cannot be rewritten. Build a new one instead.')
  }

  const settings = await getSettings()
  const dossier = await collectTripDossier(existing.bookingRef)
  const risk = assessRisk(dossier, settings.holdAtLevel)
  const narrative = opts?.skipNarrative
    ? fallbackNarrative(dossier)
    : await generateNarrative({ dossier, risk })

  const bodyHtml = buildAgentEmail({ dossier, narrative })

  return updateReport(id, {
    status: risk.shouldHold ? 'held' : existing.status === 'held' ? 'draft' : existing.status,
    riskLevel: risk.level,
    riskScore: risk.score,
    riskSignals: risk.signals as unknown as Prisma.InputJsonValue,
    holdReason: risk.reason,
    sources: dossierChannels(dossier) as unknown as Prisma.InputJsonValue,
    dossier: dossier as unknown as Prisma.InputJsonValue,
    narrative: narrative as unknown as Prisma.InputJsonValue,
    subject: buildAgentSubject(dossier),
    bodyHtml,
    escalationHtml: risk.shouldHold
      ? buildEscalationEmail({ dossier, narrative, risk, reviewUrl: reviewUrl(id) })
      : null,
    lastError: null,
  }, event('regenerated', actor, `Risk re-graded to ${risk.level} (${risk.score}).`))
}

// ─── Recipients ───────────────────────────────────────────────────────────────

function resolveRecipients(
  record: ExperienceReportRecord,
  settings: ExperienceReportSettings,
  mode: { testMode: boolean; testTo: string; testCc: string },
  overrides?: { to?: string | null; cc?: string[] },
): { to: string; cc: string[] } {
  if (mode.testMode) {
    if (!mode.testTo) {
      throw new ReportError('Test mode is on but no test address is configured in Settings → Email Settings.')
    }
    return { to: mode.testTo, cc: mode.testCc ? [mode.testCc] : [] }
  }

  const to = (overrides?.to ?? record.dossier?.facts.agentEmail ?? '').trim()
  if (!to.includes('@')) {
    throw new ReportError('No agent email is on file for this booking. Enter one before sending.')
  }

  const contact = record.dossier?.facts.contactEmail?.trim()
  const cc = [
    ...settings.ccEmails,
    ...(overrides?.cc ?? []),
    ...(contact && contact !== to ? [contact] : []),
  ]
    .map(e => e.trim())
    .filter(e => e.includes('@') && e !== to)
    .filter((e, i, a) => a.indexOf(e) === i)

  return { to, cc }
}

// ─── Send to the agent ────────────────────────────────────────────────────────

export interface SendOptions {
  actor: string | null
  agentEmailOverride?: string | null
  extraCc?: string[]
  /**
   * Send a held report anyway. Requires a note — whoever overrides the hold
   * owns that decision, and the note is what the audit trail shows.
   */
  overrideHold?: boolean
  note?: string | null
}

export async function sendToAgent(id: string, opts: SendOptions): Promise<ExperienceReportRecord> {
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')

  if (record.status === 'sent') {
    throw new ReportError(`This report was already sent on ${new Date(record.sentAt!).toLocaleString('en-GB')}.`)
  }
  if (record.status === 'cancelled') {
    throw new ReportError('This report was cancelled. Rebuild it before sending.')
  }
  if (record.status === 'held' && !opts.overrideHold) {
    throw new ReportError(
      'This report is held because the client had a bad experience. Release it explicitly if you still want the agent to receive it.',
    )
  }
  if (record.status === 'held' && !opts.note?.trim()) {
    throw new ReportError('Releasing a held report needs a note saying how the problem was resolved.')
  }
  if (!record.bodyHtml || !record.subject) {
    throw new ReportError('This report has no prepared mail body. Regenerate it first.')
  }

  const settings = await getSettings()
  const mode = await getMailMode()
  const { to, cc } = resolveRecipients(record, settings, mode, {
    to: opts.agentEmailOverride,
    cc: opts.extraCc,
  })

  try {
    await sendMailViaGraph({ to, cc: cc.length ? cc : undefined, subject: record.subject, bodyHtml: record.bodyHtml })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateReport(id, { status: 'failed', lastError: message },
      event('send_failed', opts.actor, message))
    throw new ReportError(`The mail could not be sent: ${message}`)
  }

  const wasHeld = record.status === 'held'
  const detail = [
    `Sent to ${to}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`,
    mode.testMode ? 'test mode — redirected away from the agent' : null,
    wasHeld ? `hold overridden: ${opts.note?.trim()}` : null,
  ].filter(Boolean).join(' · ')

  return updateReport(id, {
    status: 'sent',
    sentAt: new Date(),
    sentBy: opts.actor,
    toEmail: to,
    ccEmails: cc.join(', '),
    lastError: null,
    ...(wasHeld ? { releasedAt: new Date(), releasedBy: opts.actor, resolutionNote: opts.note?.trim() ?? null } : {}),
  }, event(wasHeld ? 'released_and_sent' : 'sent', opts.actor, detail))
}

// ─── Escalate a hold ──────────────────────────────────────────────────────────

export async function escalate(
  id: string,
  opts: { actor: string | null; note?: string | null; toOverride?: string | null },
): Promise<ExperienceReportRecord> {
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')
  if (!record.dossier) throw new ReportError('This report has no evidence snapshot. Regenerate it first.')

  const settings = await getSettings()
  const mode = await getMailMode()

  const intended = (opts.toOverride ?? record.escalationTo ?? settings.escalationEmail).trim()
  if (!intended.includes('@')) throw new ReportError('No escalation address is configured.')
  const to = mode.testMode ? mode.testTo : intended

  const risk: RiskAssessment = {
    level: record.riskLevel,
    score: record.riskScore,
    signals: record.riskSignals,
    shouldHold: true,
    reason: record.holdReason,
  }
  const dossier = record.dossier as TripDossier

  const html = buildEscalationEmail({
    dossier,
    narrative: record.narrative,
    risk,
    reviewUrl: reviewUrl(id),
    note: opts.note ?? null,
  })

  try {
    await sendMailViaGraph({ to, subject: buildEscalationSubject(dossier, risk), bodyHtml: html })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendEvent(id, event('escalation_failed', opts.actor, message))
    throw new ReportError(`The escalation could not be sent: ${message}`)
  }

  return updateReport(id, {
    escalationTo: intended,
    escalationHtml: html,
    escalatedAt: new Date(),
    // Escalating something that was not already held is itself a hold — the
    // agent must not receive it while the concern is open.
    status: record.status === 'sent' ? record.status : 'held',
    holdReason: record.holdReason ?? opts.note?.trim() ?? 'Held for review by the Traveller Experience team.',
  }, event('escalated', opts.actor, `Sent to ${intended}${mode.testMode ? ' (test mode — redirected)' : ''}${opts.note ? ` · ${opts.note}` : ''}`))
}

// ─── Manual state changes ─────────────────────────────────────────────────────

export async function holdReport(id: string, actor: string | null, reason: string) {
  if (!reason.trim()) throw new ReportError('Say why this report is being held.')
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')
  if (record.status === 'sent') throw new ReportError('This report has already reached the agent.')

  return updateReport(id, { status: 'held', holdReason: reason.trim() },
    event('held', actor, reason.trim()))
}

export async function cancelReport(id: string, actor: string | null, reason: string | null) {
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')
  if (record.status === 'sent') throw new ReportError('A report that has already been sent cannot be cancelled.')

  return updateReport(id, { status: 'cancelled', resolutionNote: reason?.trim() ?? null },
    event('cancelled', actor, reason?.trim() ?? null))
}

/** Clears a hold without sending — the report goes back to the draft queue. */
export async function releaseHold(id: string, actor: string | null, note: string) {
  if (!note.trim()) throw new ReportError('Say how the problem was resolved before releasing the hold.')
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')
  if (record.status !== 'held') throw new ReportError('This report is not on hold.')

  return updateReport(id, {
    status: 'draft',
    releasedAt: new Date(),
    releasedBy: actor,
    resolutionNote: note.trim(),
  }, event('hold_released', actor, note.trim()))
}

export async function addNote(id: string, actor: string | null, note: string) {
  if (!note.trim()) throw new ReportError('The note is empty.')
  await appendEvent(id, event('note', actor, note.trim()))
  return (await getReport(id))!
}

// ─── The post-departure sweep ─────────────────────────────────────────────────

export interface SweepResult {
  considered: number
  built: number
  sent: number
  held: number
  skipped: number
  errors: { bookingRef: string; message: string }[]
}

/**
 * Finds trips that ended inside the look-back window and have not been reported
 * on, builds a report for each, and mails the clean ones.
 *
 * A trip only qualifies once `quietDays` have passed since departure, so a call
 * placed on the last evening or a form filled in on the flight home still makes
 * it into the report rather than arriving after it was written.
 */
export async function runSweep(opts?: { actor?: string | null; dryRun?: boolean }): Promise<SweepResult> {
  const settings = await getSettings()
  const result: SweepResult = { considered: 0, built: 0, sent: 0, held: 0, skipped: 0, errors: [] }

  if (!settings.autoSend) return result

  const now = new Date()
  const latestDeparture = new Date(now)
  latestDeparture.setDate(latestDeparture.getDate() - settings.quietDays)
  const earliestDeparture = new Date(now)
  earliestDeparture.setDate(earliestDeparture.getDate() - settings.lookbackDays)

  const candidates = await prisma.booking.findMany({
    where: {
      departureDate: { gte: earliestDeparture, lte: latestDeparture },
      status: { notIn: ['CANCELLED'] },
    },
    select: { bookingRef: true },
    orderBy: { departureDate: 'asc' },
    take: 200,
  })

  result.considered = candidates.length

  for (const booking of candidates) {
    try {
      // Anything already sent, held or waiting is somebody else's business now.
      const existing = await prisma.teExperienceReport.findFirst({
        where: { bookingRef: booking.bookingRef, status: { in: ['sent', 'held', 'draft', 'queued'] } },
        select: { id: true },
      })
      if (existing) { result.skipped++; continue }
      if (await alreadySent(booking.bookingRef)) { result.skipped++; continue }

      if (opts?.dryRun) { result.built++; continue }

      const report = await buildReport({
        bookingRef: booking.bookingRef,
        actor: opts?.actor ?? 'auto',
        trigger: 'auto',
      })
      result.built++

      if (report.status === 'held') {
        // The agent must not hear about this trip. Tell the escalation inbox.
        await escalate(report.id, { actor: 'auto', note: null })
        result.held++
        continue
      }

      if (report.status === 'queued') {
        await sendToAgent(report.id, { actor: 'auto' })
        result.sent++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // "No feedback yet" is the normal case for a trip nobody called — it is
      // not worth reporting as a failure.
      if (err instanceof ReportError && message.includes('No feedback of any kind')) {
        result.skipped++
        continue
      }
      result.errors.push({ bookingRef: booking.bookingRef, message })
    }
  }

  return result
}
