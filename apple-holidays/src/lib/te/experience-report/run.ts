/**
 * The pipeline: collect → grade → write → send, or hold.
 *
 * One report per trip, at the end of the trip. Nothing here sends day-by-day.
 *
 * The hold is the important part. If the grading finds the client had a bad
 * experience, the agent mail is built but not sent; the report goes to the
 * escalation inbox instead, saying in the first line that the agent has not
 * been told. Only a person can release it after that.
 *
 * The second gate is evidence. Nothing is sent automatically unless the guest
 * themselves left something behind — an on-ground call or a filled-in feedback
 * form. A trip with neither is parked as `pending` for the Experience team to
 * write up by hand; it is never guessed at and never mailed on its own.
 *
 * When a clean report does reach the agent, the traveller gets their own
 * letter: a short written thank-you, not a copy of the agent's report.
 */
import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'
import { collectTripDossier, dossierChannels, hasAutoSendEvidence } from './collect'
import { assessRisk } from './risk'
import { generateNarrative, fallbackNarrative } from './narrative'
import {
  buildAgentEmail, buildAgentSubject, buildEscalationEmail, buildEscalationSubject,
} from './email'
import {
  buildClientEmail, buildClientSubject, generateClientLetter,
} from './client-mail'
import {
  appendEvent, event, getReport, getSettings, toRecord, updateReport, alreadySent,
  OPEN_STATUSES,
} from './store'
import type {
  ClientMail, DeskNoteEvidence, ExperienceNarrative, ExperienceReportRecord,
  ExperienceReportSettings, RiskAssessment, TriggerSource, TripDossier,
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

  const risk = assessRisk(dossier, settings.holdAtLevel)

  // The evidence gate. Without an on-ground call or a feedback form there is no
  // guest voice to report, so we do not write one — the row is parked as
  // `pending` with the evidence we do have, and the Experience team writes the
  // summary themselves. No mail body is prepared, which is also what stops it
  // being sent by accident from anywhere else in this file.
  if (!hasAutoSendEvidence(dossier)) {
    return createRow({
      opts, dossier, risk, settings,
      status: 'pending',
      narrative: fallbackNarrative(dossier),
      subject: buildAgentSubject(dossier),
      bodyHtml: null,
      channels,
      builtDetail: channels.length
        ? 'No call and no feedback form — waiting for the Experience team to write this one.'
        : 'Nothing was collected for this trip — waiting for the Experience team to write this one.',
    })
  }

  const narrative = opts.skipNarrative
    ? fallbackNarrative(dossier)
    : await generateNarrative({ dossier, risk })

  const status: ExperienceReportRecord['status'] =
    risk.shouldHold ? 'held'
    : opts.draftOnly || settings.requireApproval ? 'draft'
    : 'queued'

  return createRow({
    opts, dossier, risk, settings, status, narrative, channels,
    subject: buildAgentSubject(dossier),
    bodyHtml: buildAgentEmail({ dossier, narrative, isAutoSend: opts.trigger === 'auto' }),
    builtDetail: `Built from ${channels.length} channel(s); risk ${risk.level} (${risk.score}).`,
  })
}

/** The single INSERT every build path goes through. */
async function createRow(args: {
  opts: BuildOptions
  dossier: TripDossier
  risk: RiskAssessment
  settings: ExperienceReportSettings
  status: ExperienceReportRecord['status']
  narrative: ExperienceNarrative
  subject: string
  bodyHtml: string | null
  channels: ReturnType<typeof dossierChannels>
  builtDetail: string
}): Promise<ExperienceReportRecord> {
  const { opts, dossier, risk, settings, status, narrative, subject, bodyHtml, channels } = args

  // A pending report is not a hold: nobody has said the trip went badly, we
  // simply have nothing to say yet. Only a real hold escalates.
  const isHeld = status === 'held'

  const escalationHtml = isHeld
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
      holdReason: isHeld ? risk.reason : null,
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
      escalationTo: isHeld ? settings.escalationEmail : null,
      createdBy: opts.actor,
      events: [
        event('built', opts.actor, args.builtDetail),
        ...(isHeld ? [event('held', opts.actor, risk.reason)] : []),
      ] as unknown as Prisma.InputJsonValue,
    },
  })

  const record = toRecord(created)

  // The escalation embeds a link back to itself, so it can only be rendered
  // once the row has an id. Re-render now that we have one.
  if (isHeld) {
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

/**
 * Re-grade and re-write an existing report against fresh evidence.
 *
 * `extraNote` is how the Experience team's own write-up gets in: it is folded
 * into the dossier as a desk note, so it is graded for risk and quoted by the
 * narrative writer exactly like every other piece of evidence.
 */
export async function regenerateReport(
  id: string,
  actor: string | null,
  opts?: { skipNarrative?: boolean; extraNote?: string | null },
): Promise<ExperienceReportRecord> {
  const existing = await getReport(id)
  if (!existing) throw new ReportError('Report not found.')
  if (existing.status === 'sent') {
    throw new ReportError('This report has already gone to the agent and cannot be rewritten. Build a new one instead.')
  }

  const settings = await getSettings()
  const dossier = await collectTripDossier(existing.bookingRef)

  // Desk write-ups live on the report, not on the booking, so a fresh collect
  // would drop them. Carry the previous ones over and append the new one.
  const carried = (existing.dossier?.deskNotes ?? []).filter(isWriteUp)
  const written: DeskNoteEvidence[] = opts?.extraNote?.trim()
    ? [{
        rating: null,
        comment: opts.extraNote.trim(),
        savedBy: actor,
        createdAt: new Date().toISOString(),
      }]
    : []
  dossier.deskNotes = dedupeNotes([...dossier.deskNotes, ...carried, ...written])

  const risk = assessRisk(dossier, settings.holdAtLevel)
  const channels = dossierChannels(dossier)

  // Still nothing from the guest and nobody has written anything either — there
  // is no report to write, so it goes back to waiting rather than being faked.
  if (!hasAutoSendEvidence(dossier) && !dossier.deskNotes.length) {
    return updateReport(id, {
      status: 'pending',
      riskLevel: risk.level,
      riskScore: risk.score,
      riskSignals: risk.signals as unknown as Prisma.InputJsonValue,
      holdReason: null,
      sources: channels as unknown as Prisma.InputJsonValue,
      dossier: dossier as unknown as Prisma.InputJsonValue,
      bodyHtml: null,
      escalationHtml: null,
      lastError: null,
    }, event('regenerated', actor, 'Still no call and no feedback form — left waiting for a written summary.'))
  }

  const narrative = opts?.skipNarrative
    ? fallbackNarrative(dossier)
    : await generateNarrative({ dossier, risk })

  // The traveller's letter, if one has already gone out, is part of the record
  // and must survive a rewrite of the agent's side.
  narrative.clientMail = existing.narrative?.clientMail ?? null

  const bodyHtml = buildAgentEmail({ dossier, narrative })

  const status: ExperienceReportRecord['status'] =
    risk.shouldHold ? 'held'
    : existing.status === 'held' || existing.status === 'pending' ? 'draft'
    : existing.status

  return updateReport(id, {
    status,
    riskLevel: risk.level,
    riskScore: risk.score,
    riskSignals: risk.signals as unknown as Prisma.InputJsonValue,
    holdReason: risk.shouldHold ? risk.reason : null,
    sources: channels as unknown as Prisma.InputJsonValue,
    dossier: dossier as unknown as Prisma.InputJsonValue,
    narrative: narrative as unknown as Prisma.InputJsonValue,
    subject: buildAgentSubject(dossier),
    bodyHtml,
    escalationHtml: risk.shouldHold
      ? buildEscalationEmail({ dossier, narrative, risk, reviewUrl: reviewUrl(id) })
      : null,
    escalationTo: risk.shouldHold ? (existing.escalationTo ?? settings.escalationEmail) : existing.escalationTo,
    lastError: null,
  }, opts?.extraNote?.trim()
    ? event('written_up', actor, `Experience team wrote the summary; risk graded ${risk.level} (${risk.score}).`)
    : event('regenerated', actor, `Risk re-graded to ${risk.level} (${risk.score}).`))
}

/**
 * A desk note that came from the Experience team typing it here, rather than
 * from the booking's own saved rating. Only the former needs carrying over.
 */
function isWriteUp(n: DeskNoteEvidence): boolean {
  return n.rating == null && !!n.comment?.trim()
}

function dedupeNotes(notes: DeskNoteEvidence[]): DeskNoteEvidence[] {
  const seen = new Set<string>()
  return notes.filter(n => {
    const key = `${n.rating ?? '-'}|${n.comment ?? ''}|${n.createdAt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The Experience team writes the feedback for a trip the guest left no trace
 * of. Their words become the evidence, the report is written from them, and it
 * moves out of `pending` into the normal review queue.
 */
export async function writeUpReport(
  id: string,
  actor: string | null,
  text: string,
): Promise<ExperienceReportRecord> {
  if (!text.trim()) {
    throw new ReportError('Write what the trip was like before saving — this is the only feedback the report will have.')
  }
  const existing = await getReport(id)
  if (!existing) throw new ReportError('Report not found.')
  if (existing.status === 'sent') throw new ReportError('This report has already gone to the agent.')
  if (existing.status === 'cancelled') throw new ReportError('This report was cancelled. Rebuild it before writing it up.')

  return regenerateReport(id, actor, { extraNote: text })
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

  // The traveller used to be CC'd on the agent's report. Now that they get a
  // letter written for them, copying them on the agent's analysis as well would
  // mean two mails about the same trip in two completely different voices — so
  // they are only CC'd here when the letter is switched off.
  const contact = record.dossier?.facts.contactEmail?.trim()
  const ccClient = !settings.sendClientThankYou && contact && contact !== to

  const cc = [
    ...settings.ccEmails,
    ...(overrides?.cc ?? []),
    ...(ccClient ? [contact] : []),
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
  /** Send the agent report only, and leave the traveller's letter for later. */
  sendClientMail?: boolean
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
  if (record.status === 'pending') {
    throw new ReportError(
      'This trip has no call and no feedback form, so nothing has been written yet. Add the Experience team’s summary first — then it can be sent.',
    )
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

  const sent = await updateReport(id, {
    status: 'sent',
    sentAt: new Date(),
    sentBy: opts.actor,
    toEmail: to,
    ccEmails: cc.join(', '),
    lastError: null,
    ...(wasHeld ? { releasedAt: new Date(), releasedBy: opts.actor, resolutionNote: opts.note?.trim() ?? null } : {}),
  }, event(wasHeld ? 'released_and_sent' : 'sent', opts.actor, detail))

  // The traveller's letter is a follow-on, never a precondition: the agent's
  // report has already gone, and nothing that happens here may undo that or
  // report the send as failed.
  //
  // A trip that was held at any point — including one released after somebody
  // fixed the problem — does not get one automatically. It may well deserve
  // one, but that is a judgement call, so it is left as the button in the
  // drawer rather than made here.
  const everHeld = wasHeld || !!record.releasedAt || !!record.holdReason

  if (settings.sendClientThankYou && !everHeld && opts.sendClientMail !== false) {
    try {
      return await sendClientMail(id, { actor: opts.actor })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await appendEvent(id, event('client_mail_skipped', opts.actor, message))
      return (await getReport(id)) ?? sent
    }
  }

  return sent
}

// ─── The traveller's thank-you ────────────────────────────────────────────────

/**
 * Writes and sends the guest their own letter.
 *
 * Held trips are refused outright. A trip somebody had to escalate is not one
 * we write a warm note about, and the check lives here rather than only at the
 * call site so no future caller can route around it.
 */
export async function sendClientMail(
  id: string,
  opts: { actor: string | null; toOverride?: string | null },
): Promise<ExperienceReportRecord> {
  const record = await getReport(id)
  if (!record) throw new ReportError('Report not found.')
  if (!record.dossier) throw new ReportError('This report has no evidence snapshot. Regenerate it first.')
  if (record.status === 'held') {
    throw new ReportError('This trip is held as a bad experience — the traveller is not sent a thank-you letter.')
  }
  if (record.narrative?.clientMail?.sentAt) {
    throw new ReportError(
      `The traveller was already written to on ${new Date(record.narrative.clientMail.sentAt).toLocaleString('en-GB')}.`,
    )
  }

  const settings = await getSettings()
  const mode = await getMailMode()

  const intended = (opts.toOverride ?? record.dossier.facts.contactEmail ?? '').trim()
  if (!intended.includes('@')) {
    throw new ReportError('No traveller email is on file for this booking, so there is nobody to write to.')
  }

  const to = mode.testMode ? mode.testTo : intended
  const cc = mode.testMode
    ? (mode.testCc ? [mode.testCc] : [])
    : settings.clientMailCc.filter(e => e !== to)

  const letter = await generateClientLetter(record.dossier)
  const subject = buildClientSubject(letter, record.dossier)
  const bodyHtml = buildClientEmail({ dossier: record.dossier, letter })

  const base: ClientMail = {
    subject, bodyHtml, to: intended, cc,
    sentAt: null, error: null, testMode: mode.testMode,
  }

  try {
    await sendMailViaGraph({ to, cc: cc.length ? cc : undefined, subject, bodyHtml })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await saveClientMail(id, record.narrative, { ...base, error: message })
    await appendEvent(id, event('client_mail_failed', opts.actor, message))
    throw new ReportError(`The traveller's letter could not be sent: ${message}`)
  }

  await saveClientMail(id, record.narrative, { ...base, sentAt: new Date().toISOString() })
  await appendEvent(id, event(
    'client_mail_sent',
    opts.actor,
    `Thank-you letter sent to ${to}${mode.testMode ? ' (test mode — redirected)' : ''}.`,
  ))

  return (await getReport(id))!
}

/**
 * Persists the letter inside the `narrative` blob. Read back the row first so
 * a rewrite that landed in between is not clobbered by a stale copy.
 */
async function saveClientMail(
  id: string,
  fallback: ExperienceNarrative | null,
  clientMail: ClientMail,
) {
  const fresh = await getReport(id)
  const narrative = fresh?.narrative ?? fallback
  if (!narrative) return
  await prisma.teExperienceReport.update({
    where: { id },
    data: { narrative: { ...narrative, clientMail } as unknown as Prisma.InputJsonValue },
  })
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
  /** Built but parked — no call and no form, so a person has to write it. */
  pending: number
  /** Agent reports whose traveller also received their thank-you letter. */
  clientMailed: number
  skipped: number
  errors: { bookingRef: string; message: string }[]
}

/**
 * Bookings in these states never travelled, so there is no experience to
 * report on. Everything else that reached its departure date is fair game.
 */
const NOT_TRAVELLED = ['DRAFT', 'CANCELLED', 'PENDING_CANCELLATION'] as const

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const addDays = (d: Date, n: number) => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/**
 * Finds trips that ended inside the look-back window and have not been reported
 * on, builds a report for each, and mails the clean ones.
 *
 * A trip only qualifies once `quietDays` whole days have passed since
 * departure — two by default, which is the desk's "the day before yesterday's
 * finished trips" rule. Working in whole days rather than from the clock
 * matters: a sweep that ran at 09:00 and one that ran at 23:00 have to consider
 * exactly the same set of trips, or a run's timing would decide whether a trip
 * was reported on that day or the next.
 *
 * Everything before that, back to `lookbackDays`, is still swept so a missed
 * tick catches up on its own.
 */
export async function runSweep(opts?: { actor?: string | null; dryRun?: boolean }): Promise<SweepResult> {
  const settings = await getSettings()
  const result: SweepResult = {
    considered: 0, built: 0, sent: 0, held: 0, pending: 0,
    clientMailed: 0, skipped: 0, errors: [],
  }

  if (!settings.autoSend) return result

  const today = startOfDay(new Date())
  const latestDeparture = endOfDay(addDays(today, -settings.quietDays))
  const earliestDeparture = startOfDay(addDays(today, -settings.lookbackDays))

  const candidates = await prisma.booking.findMany({
    where: {
      departureDate: { gte: earliestDeparture, lte: latestDeparture },
      status: { notIn: [...NOT_TRAVELLED] },
    },
    select: { bookingRef: true },
    orderBy: { departureDate: 'asc' },
    take: 200,
  })

  result.considered = candidates.length

  for (const booking of candidates) {
    try {
      // Anything already sent, held, waiting or pending is somebody else's
      // business now — a second report for the same trip is never wanted.
      const existing = await prisma.teExperienceReport.findFirst({
        where: { bookingRef: booking.bookingRef, status: { in: ['sent', ...OPEN_STATUSES] } },
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

      // No call, no form: nothing goes out. It waits for the Experience team.
      if (report.status === 'pending') {
        result.pending++
        continue
      }

      if (report.status === 'held') {
        // The agent must not hear about this trip. Tell the escalation inbox.
        await escalate(report.id, { actor: 'auto', note: null })
        result.held++
        continue
      }

      if (report.status === 'queued') {
        const sent = await sendToAgent(report.id, { actor: 'auto' })
        result.sent++
        if (sent.narrative?.clientMail?.sentAt) result.clientMailed++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ bookingRef: booking.bookingRef, message })
    }
  }

  return result
}
