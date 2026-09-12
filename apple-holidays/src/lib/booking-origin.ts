/**
 * Who filed this booking, when, and where it came in from.
 *
 * ## Why it is not just `createdBy`
 *
 * `Booking.createdById` is a real user row on every booking, including the ones
 * no person ever touched: the mail pipeline, the OneDrive poller and the
 * AppleSystem importer all stamp an automation user (`getAutomationUserId()`
 * picks the first SUPER_ADMIN) because the column is required. Printing that
 * name on its own would be worse than printing nothing — it says a colleague
 * typed up a file that a cron job imported at 3am, and that is exactly the kind
 * of wrong attribution somebody later builds an argument on.
 *
 * So the origin is *derived*, from whichever evidence the booking actually
 * carries, strongest first:
 *
 *   1. **The activity log** — `BOOKING_CREATED` against this booking id. The
 *      only record written at the moment of creation by the code that created
 *      it, and it carries the channel (`api`, `email`, `onedrive`, `OPS_AI`)
 *      and the caller's IP. Where it exists, it decides.
 *   2. **Version 1** — `BookingVersion.source` is `mail`, `onedrive`, `manual`
 *      or `restore`, written by the same pipelines.
 *   3. **The mail it arrived on** — a `TOUR_CONFIRMATION` mailbox message
 *      carrying this reference: the mailbox, the sender and the subject line.
 *   4. **The OneDrive event** — the file and folder path it was read from.
 *   5. **The source document** on the booking itself.
 *   6. **The shape of the booking** — an IS number with no document and no mail
 *      behind it is an AppleSystem import, which is the one path that writes no
 *      log of its own.
 *
 * Anything derived from (6) is reported as `inferred`, never as fact. A screen
 * that cannot tell "we know" from "we think" is how a guess becomes a quote in
 * a meeting.
 *
 * ## Timestamps
 *
 * `createdAt` is when the row was written here, which is not always when the
 * booking happened: an email that arrived at 22:40 and was processed at 22:41
 * has both stamps, and a file confirmed upstream days earlier has neither. All
 * of them are returned, each labelled with what it actually measures, rather
 * than one number presented as "when the booking was made".
 *
 * Read-only. Every lookup is a SELECT and each is individually tolerant — a
 * failing side query removes one line of evidence rather than the whole panel.
 */
import { prisma } from '@/lib/prisma'

export type OriginChannel =
  | 'EMAIL' | 'ONEDRIVE' | 'APPLESYSTEM' | 'OPS_AI' | 'API' | 'MANUAL' | 'UNKNOWN'

export interface OriginEvidence {
  /** What kind of record this is — "Activity log", "Tour confirmation email"… */
  source: string
  /** What it says, in one line. */
  detail: string
  /** When that record was written, where it has a time of its own. */
  at: string | null
}

export interface OriginStamp {
  key: string
  /** What this timestamp actually measures — never just "created". */
  label: string
  at: string
  /** Why it is here and how it differs from the others. */
  note: string
}

export interface BookingOrigin {
  bookingRef: string
  /** The user on `createdById` — the account the row was written under. */
  who: { id: string; name: string | null; role: string | null } | null
  /**
   * True when the evidence says a pipeline wrote it, so `who` is the automation
   * account rather than a person who did anything.
   */
  automated: boolean
  /** How the booking got in. */
  channel: OriginChannel
  channelLabel: string
  /** Where from, specifically — the mailbox and subject, the file, the endpoint. */
  where: string
  /** The IP the creating request came from, where one was recorded. */
  ipAddress: string | null
  /** 'certain' when a creation-time record says so; 'inferred' when shape does. */
  confidence: 'certain' | 'inferred'
  /** One sentence a person can read without decoding the fields above. */
  summary: string
  /** Every time this booking carries, each saying what it measures. */
  stamps: OriginStamp[]
  /** The records the answer was built from, strongest first. */
  evidence: OriginEvidence[]
  /** The first status this booking was ever put into, and by whom. */
  firstStatus: { toState: string; at: string; actor: string | null } | null
}

const CHANNEL_LABEL: Record<OriginChannel, string> = {
  EMAIL:       'Email pipeline',
  ONEDRIVE:    'OneDrive / SharePoint',
  APPLESYSTEM: 'AppleSystem import',
  OPS_AI:      'Ops AI assistant',
  API:         'Created in this system',
  MANUAL:      'Created in this system',
  UNKNOWN:     'Not recorded',
}

/** A pipeline wrote it — so the name on `createdById` is an account, not an author. */
const AUTOMATED: Record<OriginChannel, boolean> = {
  EMAIL: true, ONEDRIVE: true, APPLESYSTEM: true,
  OPS_AI: false, API: false, MANUAL: false, UNKNOWN: false,
}

/** How the summary names the thing that did the work, when no person did. */
const AUTOMATION_PHRASE: Record<OriginChannel, string> = {
  EMAIL:       'the email pipeline',
  ONEDRIVE:    'the OneDrive poller',
  APPLESYSTEM: 'the AppleSystem importer',
  OPS_AI:      'the Ops AI assistant',
  API:         'an API call',
  MANUAL:      'a user',
  UNKNOWN:     'an unrecorded process',
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/**
 * Graph paths arrive as `/drives/b!<40 characters of drive id>/root:/VN
 * OPERATION/2026/…`. The drive id identifies nothing a reader can use and
 * pushes the part that matters off the end of the line, so it is dropped.
 */
function prettyPath(path: string | null | undefined): string {
  const raw = String(path ?? '')
  const cut = raw.indexOf('root:')
  return (cut >= 0 ? raw.slice(cut + 5) : raw).replace(/^\/+/, '')
}

function parseDetails(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The channel an activity-log `details` blob is describing. */
function channelFromLog(details: Record<string, unknown>): OriginChannel | null {
  const via    = String(details.via ?? '').toUpperCase()
  const source = String(details.source ?? '').toLowerCase()

  if (via === 'OPS_AI') return 'OPS_AI'
  if (source === 'email' || source === 'mail') return 'EMAIL'
  if (source === 'onedrive' || source === 'drive') return 'ONEDRIVE'
  if (source === 'api') return 'API'
  if (source === 'manual') return 'MANUAL'
  return null
}

/**
 * Everything known about how one booking came to exist.
 *
 * `bookingId` and `bookingRef` are both taken because the evidence is keyed
 * both ways — the activity log by id, the mail and drive records by reference.
 */
export async function resolveBookingOrigin(args: {
  bookingId: string
  bookingRef: string
  createdAt: Date
  isNumber?: string | null
  agentBookingId?: string | null
  sourceDocName?: string | null
  sourceDocUrl?: string | null
  createdById?: string | null
}): Promise<BookingOrigin> {
  const { bookingId, bookingRef, createdAt } = args

  const [creator, log, firstVersion, mail, driveEvent, firstStatusRow, handlerLog] = await Promise.all([
    args.createdById
      ? prisma.user.findUnique({
          where: { id: args.createdById },
          select: { id: true, name: true, role: true },
        }).catch(() => null)
      : Promise.resolve(null),

    prisma.activityLog.findFirst({
      where: { entityType: 'Booking', entityId: bookingId, action: 'BOOKING_CREATED' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, details: true, ipAddress: true, createdAt: true,
                user: { select: { name: true, role: true } } },
    }).catch(() => null),

    prisma.bookingVersion.findFirst({
      where: { bookingId },
      orderBy: { versionNo: 'asc' },
      select: { versionNo: true, source: true, createdAt: true },
    }).catch(() => null),

    prisma.mailMessage.findFirst({
      where: { bookingRef, mailboxKind: 'TOUR_CONFIRMATION' },
      orderBy: { receivedAt: 'asc' },
      select: { subject: true, fromAddress: true, fromName: true, mailboxUser: true,
                receivedAt: true, processedAt: true, status: true },
    }).catch(() => null),

    prisma.oneDriveEvent.findFirst({
      where: { bookingRef, eventType: { in: ['TC_PROCESSED', 'FOLDER_DETECTED', 'FILE_DETECTED'] } },
      orderBy: { createdAt: 'asc' },
      select: { itemName: true, itemPath: true, driveType: true, processedAt: true, createdAt: true },
    }).catch(() => null),

    prisma.statusEvent.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
      select: { toState: true, createdAt: true, actor: { select: { name: true } } },
    }).catch(() => null),

    prisma.fileHandlerLog.findFirst({
      where: { bookingRef },
      orderBy: { createdAt: 'asc' },
      select: { fileHandlerName: true, action: true, details: true, createdAt: true },
    }).catch(() => null),
  ])

  const logDetails = parseDetails(log?.details ?? null)

  // ── Channel, strongest evidence first ──────────────────────────────────────
  let channel: OriginChannel = 'UNKNOWN'
  let confidence: BookingOrigin['confidence'] = 'inferred'
  let where = 'Not recorded'

  const fromLog = log ? channelFromLog(logDetails) : null
  // The AppleSystem importer writes no activity log, but the file-handler trail
  // it does write is a creation-time record all the same — so a booking with
  // one is `certain`, not a deduction from its IS number.
  const asImported = /AS_IMPORT/i.test(handlerLog?.action ?? '')

  if (fromLog) {
    channel = fromLog
    confidence = 'certain'
  } else if (firstVersion?.source === 'mail') {
    channel = 'EMAIL'; confidence = 'certain'
  } else if (firstVersion?.source === 'onedrive') {
    channel = 'ONEDRIVE'; confidence = 'certain'
  } else if (firstVersion?.source === 'manual') {
    channel = 'MANUAL'; confidence = 'certain'
  } else if (asImported) {
    channel = 'APPLESYSTEM'; confidence = 'certain'
  } else if (mail) {
    channel = 'EMAIL'
  } else if (driveEvent || /sharepoint|onedrive/i.test(args.sourceDocUrl ?? '')) {
    channel = 'ONEDRIVE'
  } else if (args.isNumber) {
    // The AppleSystem importer writes no log of its own, so a booking carrying
    // an IS number with nothing else behind it came in that way.
    channel = 'APPLESYSTEM'
  }

  // ── Where, in the most specific terms the evidence allows ──────────────────
  if (channel === 'EMAIL' && mail) {
    where = `${mail.mailboxUser} · from ${mail.fromName || mail.fromAddress}${mail.subject ? ` · “${mail.subject}”` : ''}`
  } else if (channel === 'EMAIL') {
    where = `Tour-confirmation mailbox${logDetails.subject ? ` · “${String(logDetails.subject)}”` : ''}`
  } else if (channel === 'ONEDRIVE' && driveEvent) {
    where = `${driveEvent.driveType} drive · ${prettyPath(driveEvent.itemPath) || driveEvent.itemName}`
  } else if (channel === 'ONEDRIVE') {
    where = String(logDetails.file ?? args.sourceDocName ?? 'A watched OneDrive folder')
  } else if (channel === 'APPLESYSTEM') {
    // The IS number is often spelled "IS49103" already, so it is never given a
    // second "IS" in front of it.
    const is = args.isNumber ? (/^IS/i.test(args.isNumber) ? args.isNumber : `IS ${args.isNumber}`) : null
    where = [
      'AppleSystem quotation',
      is,
      args.agentBookingId ? `agent ref ${args.agentBookingId}` : null,
      asImported ? 'pulled over the API' : null,
    ].filter(Boolean).join(' · ')
  } else if (channel === 'OPS_AI') {
    where = `Ops AI assistant${logDetails.isNumber ? ` · AppleSystem IS ${String(logDetails.isNumber)}` : ''}`
  } else if (channel === 'API' || channel === 'MANUAL') {
    where = 'Typed into this system by a user'
  } else if (args.sourceDocName) {
    where = String(args.sourceDocName)
  }

  const automated = AUTOMATED[channel]

  // ── The trail, strongest first ─────────────────────────────────────────────
  const evidence: OriginEvidence[] = []

  if (log) {
    const bits = Object.entries(logDetails)
      .filter(([k]) => !['bookingRef'].includes(k))
      .map(([k, v]) => `${k}: ${String(v)}`)
    evidence.push({
      source: 'Activity log',
      detail:
        `BOOKING_CREATED under ${log.user?.name ?? log.userId}${log.user?.role ? ` (${log.user.role})` : ''}`
        + (bits.length ? ` — ${bits.join(', ')}` : '')
        + (log.ipAddress ? ` — from ${log.ipAddress}` : ''),
      at: iso(log.createdAt),
    })
  }

  if (firstVersion) {
    evidence.push({
      source: `Version ${firstVersion.versionNo}`,
      detail: `First snapshot of the file${firstVersion.source ? `, written by the ${firstVersion.source} pipeline` : ''}.`,
      at: iso(firstVersion.createdAt),
    })
  }

  if (mail) {
    evidence.push({
      source: 'Tour confirmation email',
      detail:
        `“${mail.subject}” from ${mail.fromName || mail.fromAddress} into ${mail.mailboxUser}`
        + ` — ${mail.status.toLowerCase()}${mail.processedAt ? ` at ${iso(mail.processedAt)?.slice(11, 16)} UTC` : ''}.`,
      at: iso(mail.receivedAt),
    })
  }

  if (driveEvent) {
    evidence.push({
      source: 'OneDrive event',
      detail: `${driveEvent.itemName} in ${prettyPath(driveEvent.itemPath) || driveEvent.driveType}.`,
      at: iso(driveEvent.processedAt ?? driveEvent.createdAt),
    })
  }

  if (args.sourceDocName || args.sourceDocUrl) {
    evidence.push({
      source: 'Source document',
      detail: args.sourceDocName ?? String(args.sourceDocUrl),
      at: null,
    })
  }

  if (handlerLog) {
    evidence.push({
      source: 'File handler log',
      detail: `${handlerLog.action} by ${handlerLog.fileHandlerName}.${handlerLog.details ? ` ${handlerLog.details}` : ''}`,
      at: iso(handlerLog.createdAt),
    })
  }

  if (!evidence.length) {
    evidence.push({
      source: 'No creation record',
      detail:
        'Nothing was written at the moment this booking was created — it predates the activity log, or came in through a path that keeps none. '
        + 'The channel above is read off the shape of the booking and is a deduction, not a record.',
      at: null,
    })
  }

  // ── Timestamps, each labelled with what it measures ────────────────────────
  const stamps: OriginStamp[] = [
    {
      key: 'filed',
      label: 'Filed in this system',
      at: createdAt.toISOString(),
      note: 'When the booking row was written here. This is the date the bookings list and the daily report count it against.',
    },
  ]

  if (log && Math.abs(log.createdAt.getTime() - createdAt.getTime()) > 60_000) {
    stamps.push({
      key: 'logged',
      label: 'Creation logged',
      at: iso(log.createdAt)!,
      note: 'When the creating request finished. A gap from the row above means the write and the log were minutes apart — a long import, usually.',
    })
  }

  if (mail) {
    stamps.push({
      key: 'received',
      label: 'Email received',
      at: iso(mail.receivedAt)!,
      note: 'When the confirmation landed in the mailbox — before anything here knew about it.',
    })
    if (mail.processedAt) {
      stamps.push({
        key: 'processed',
        label: 'Email processed',
        at: iso(mail.processedAt)!,
        note: 'When the pipeline finished reading the attachment and wrote the booking.',
      })
    }
  }

  if (driveEvent) {
    stamps.push({
      key: 'drive',
      label: 'File seen on OneDrive',
      at: iso(driveEvent.processedAt ?? driveEvent.createdAt)!,
      note: 'When the poller found the document in the watched folder.',
    })
  }

  if (firstVersion) {
    stamps.push({
      key: 'v1',
      label: `Version ${firstVersion.versionNo} snapshot`,
      at: iso(firstVersion.createdAt)!,
      note: 'The first immutable copy of the document-derived data. Every later amendment is measured against it.',
    })
  }

  if (firstStatusRow) {
    stamps.push({
      key: 'status',
      label: `First moved to ${firstStatusRow.toState}`,
      at: iso(firstStatusRow.createdAt)!,
      note: `The first workflow move on the file${firstStatusRow.actor?.name ? `, by ${firstStatusRow.actor.name}` : ''}.`,
    })
  }

  // ── The sentence ──────────────────────────────────────────────────────────
  const actorWords = automated
    ? `by ${AUTOMATION_PHRASE[channel]}, under the ${creator?.name ?? 'automation'} account`
    : creator?.name
      ? `by ${creator.name}${creator.role ? ` (${creator.role.replace(/_/g, ' ')})` : ''}`
      : 'by an account no longer on the system'

  const summary =
    `${bookingRef} was filed here ${createdAt.toISOString().slice(0, 10)} ${actorWords}, from ${where}.`
    + (confidence === 'inferred'
      ? ' No creation record survives, so the channel is deduced from what the booking carries rather than read from a log.'
      : '')

  return {
    bookingRef,
    who: creator,
    automated,
    channel,
    channelLabel: CHANNEL_LABEL[channel],
    where,
    ipAddress: log?.ipAddress ?? null,
    confidence,
    summary,
    stamps,
    evidence,
    firstStatus: firstStatusRow
      ? { toState: firstStatusRow.toState, at: iso(firstStatusRow.createdAt)!, actor: firstStatusRow.actor?.name ?? null }
      : null,
  }
}
