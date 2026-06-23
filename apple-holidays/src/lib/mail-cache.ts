import { prisma } from './prisma'
import type { MailMessage } from '@prisma/client'
import type { MailboxKind, ProcessedEmail } from './mail-processor'
import { fetchUnprocessedEmailsForUser } from './mail-processor'
import { detectCountryFromText, type OperationCountry } from './country-detection'

type MailboxFilter = 'all' | 'tq' | 'pnl'
type FolderFilter = 'all' | 'inbox'

// If the Prisma client was generated before the MailMessage model was added to
// the schema, prisma.mailMessage is undefined. Return null and log clearly so
// the operator knows to run `npx prisma generate && pm2 restart`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mm(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any).mailMessage
  if (!model) {
    console.error('[mail-cache] prisma.mailMessage is undefined — run "npx prisma generate" then restart the server')
  }
  return model ?? null
}

export interface CachedMailboxEmail extends ProcessedEmail {
  mailboxKind: MailboxKind
  mailboxUser: string
  status: string
  bookingRef: string | null
  operationCountry: OperationCountry | null
  processedAt: string | null
}

const SYNC_KEY_PREFIX = 'mail_sync_'

function syncKey(mailboxUser: string, folder: FolderFilter) {
  return `${SYNC_KEY_PREFIX}${mailboxUser}_${folder}`
}

function mapStatus(status?: string): 'RECEIVED' | 'PROCESSED' | 'WAITING' | 'ERROR' {
  if (status === 'WAITING') return 'WAITING'
  if (status === 'ERROR') return 'ERROR'
  if (status === 'PROCESSED') return 'PROCESSED'
  return 'RECEIVED'
}

async function getLastSyncAt(mailboxUser: string, folder: FolderFilter): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: syncKey(mailboxUser, folder) } })
  return row?.value ?? null
}

async function setLastSyncAt(mailboxUser: string, folder: FolderFilter, value: string) {
  await prisma.systemSetting.upsert({
    where: { key: syncKey(mailboxUser, folder) },
    update: { value },
    create: { key: syncKey(mailboxUser, folder), value },
  })
}

export async function upsertCachedMailMessage(params: {
  email: ProcessedEmail
  mailboxUser: string
  mailboxKind: MailboxKind
  bookingRef?: string | null
  operationCountry?: OperationCountry | null
  status?: 'RECEIVED' | 'PROCESSED' | 'WAITING' | 'ERROR'
  processedAt?: string | Date | null
}) {
  const model = mm()
  if (!model) return
  const { email, mailboxUser, mailboxKind } = params

  // Auto-detect country from subject+body if not provided (only for TQ mails)
  const country = params.operationCountry !== undefined
    ? params.operationCountry
    : mailboxKind === 'TOUR_CONFIRMATION'
      ? detectCountryFromText(email.subject, email.rawBody)
      : null

  await model.upsert({
    where: { graphId: email.graphId },
    create: {
      graphId: email.graphId,
      mailboxUser,
      mailboxKind,
      uid: email.uid || null,
      subject: email.subject,
      fromAddress: email.from,
      fromName: email.fromName,
      toRecipients: email.to,
      ccRecipients: email.cc,
      receivedAt: new Date(email.date),
      folder: email.folder,
      isRead: email.isRead,
      hasAttachments: email.hasAttachments,
      importance: email.importance,
      conversationId: email.conversationId || null,
      type: email.type,
      rawBody: email.rawBody,
      bodyHtml: email.bodyHtml,
      bookingRef: params.bookingRef ?? null,
      operationCountry: country ?? null,
      status: mapStatus(params.status),
      processedAt: params.processedAt ? new Date(params.processedAt) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      mailboxUser,
      mailboxKind,
      uid: email.uid || null,
      subject: email.subject,
      fromAddress: email.from,
      fromName: email.fromName,
      toRecipients: email.to,
      ccRecipients: email.cc,
      receivedAt: new Date(email.date),
      folder: email.folder,
      isRead: email.isRead,
      hasAttachments: email.hasAttachments,
      importance: email.importance,
      conversationId: email.conversationId || null,
      type: email.type,
      rawBody: email.rawBody,
      bodyHtml: email.bodyHtml,
      bookingRef: params.bookingRef ?? undefined,
      operationCountry: country ?? undefined,
      status: mapStatus(params.status),
      processedAt: params.processedAt ? new Date(params.processedAt) : undefined,
      lastSyncedAt: new Date(),
    },
  })
}

export async function syncMailboxEmailsToDb(params: {
  mailboxUser: string
  mailboxKind: MailboxKind
  limit: number
  folder: FolderFilter
}) {
  const since = await getLastSyncAt(params.mailboxUser, params.folder)
  const emails = await fetchUnprocessedEmailsForUser(
    params.mailboxUser,
    params.limit,
    params.folder,
    since ? { since } : undefined,
  )

  let newest = since ? new Date(since).getTime() : 0
  for (const email of emails) {
    await upsertCachedMailMessage({
      email,
      mailboxUser: params.mailboxUser,
      mailboxKind: params.mailboxKind,
      status: email.type === 'UNKNOWN' ? 'RECEIVED' : 'RECEIVED',
    })
    const received = new Date(email.date).getTime()
    if (received > newest) newest = received
  }

  if (newest > 0) {
    await setLastSyncAt(params.mailboxUser, params.folder, new Date(newest).toISOString())
  }

  return emails.length
}

export async function listCachedMailboxEmails(params: {
  mailbox: MailboxFilter
  folder: FolderFilter
  limit: number
  operationCountry?: OperationCountry | null
}): Promise<CachedMailboxEmail[]> {
  const model = mm()
  if (!model) return []

  const countryFilter = params.operationCountry
    ? { OR: [{ operationCountry: params.operationCountry }, { operationCountry: null }] }
    : {}

  const rows = await model.findMany({
    where: {
      ...(params.mailbox === 'tq' ? { mailboxKind: 'TOUR_CONFIRMATION' } : params.mailbox === 'pnl' ? { mailboxKind: 'PNL' } : {}),
      ...(params.folder === 'inbox'
        ? {
            OR: [
              { folder: 'Inbox' },
              { folder: { startsWith: 'Inbox / ' } },
              { folder: 'Focused' },
            ],
          }
        : {}),
      ...countryFilter,
    },
    orderBy: { receivedAt: 'desc' },
    take: params.limit,
  })

  return rows.map((row: MailMessage) => ({
    uid: row.uid ?? 0,
    graphId: row.graphId,
    mailboxKind: row.mailboxKind,
    mailboxUser: row.mailboxUser,
    subject: row.subject,
    from: row.fromAddress,
    fromName: row.fromName,
    to: Array.isArray(row.toRecipients) ? (row.toRecipients as string[]) : [],
    cc: Array.isArray(row.ccRecipients) ? (row.ccRecipients as string[]) : [],
    date: row.receivedAt.toISOString(),
    type: row.type as ProcessedEmail['type'],
    rawBody: row.rawBody,
    bodyHtml: row.bodyHtml,
    folder: row.folder,
    isRead: row.isRead,
    hasAttachments: row.hasAttachments,
    importance: row.importance,
    conversationId: row.conversationId ?? '',
    parsed: null,
    status: row.status,
    bookingRef: row.bookingRef,
    operationCountry: ((row as any).operationCountry as OperationCountry | null) ?? null,
    processedAt: row.processedAt?.toISOString() ?? null,
  }))
}

export async function listUnprocessedDbEmails(
  mailboxUser: string,
  limit: number,
): Promise<CachedMailboxEmail[]> {
  const model = mm()
  if (!model) return []
  const rows = await model.findMany({
    where: { mailboxUser, status: { in: ['RECEIVED', 'WAITING'] } },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })

  return rows.map((row: MailMessage) => ({
    uid: row.uid ?? 0,
    graphId: row.graphId,
    mailboxKind: row.mailboxKind,
    mailboxUser: row.mailboxUser,
    subject: row.subject,
    from: row.fromAddress,
    fromName: row.fromName,
    to: Array.isArray(row.toRecipients) ? (row.toRecipients as string[]) : [],
    cc: Array.isArray(row.ccRecipients) ? (row.ccRecipients as string[]) : [],
    date: row.receivedAt.toISOString(),
    type: row.type as ProcessedEmail['type'],
    rawBody: row.rawBody,
    bodyHtml: row.bodyHtml,
    folder: row.folder,
    isRead: row.isRead,
    hasAttachments: row.hasAttachments,
    importance: row.importance,
    conversationId: row.conversationId ?? '',
    parsed: null,
    status: row.status,
    bookingRef: row.bookingRef,
    operationCountry: ((row as any).operationCountry as OperationCountry | null) ?? null,
    processedAt: row.processedAt?.toISOString() ?? null,
  }))
}

export async function getCachedProcessedMail(graphIds: string[]) {
  if (!graphIds.length) return []
  const model = mm()
  if (!model) return []
  const rows = await model.findMany({
    where: {
      graphId: { in: graphIds },
      status: { in: ['PROCESSED', 'WAITING'] },
    },
  })

  return rows.map((row: MailMessage) => ({
    graphId: row.graphId,
    bookingRef: row.bookingRef ?? '',
    processedAt: row.processedAt?.toISOString() ?? null,
    status: row.status,
  }))
}
