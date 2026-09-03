import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'
import { syncThreadReplies } from '@/lib/mailbox/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function loadThread(id: string) {
  return prisma.mailThread.findUnique({
    where: { id },
    include: {
      agent:    { select: { id: true, name: true, company: true, primaryEmail: true } },
      template: { select: { id: true, name: true, category: true } },
      messages: { orderBy: { sentAt: 'asc' } },
    },
  })
}

/**
 * One conversation with every message. `?sync=true` reaches out to Graph first,
 * which is what the UI does on open — the reply the desk is looking for is
 * usually the one that arrived since they last looked.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const existing = await prisma.mailThread.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!existing) return buildApiError('Mail not found', 404)

  let syncError: string | null = null
  if (req.nextUrl.searchParams.get('sync') === 'true') {
    try {
      await syncThreadReplies(params.id)
    } catch (err) {
      // A mailbox we cannot reach must not hide the correspondence we already
      // have — the stored thread is still the useful thing on the screen.
      syncError = err instanceof Error ? err.message : 'Could not reach the mailbox'
    }
  }

  const thread = await loadThread(params.id)
  if (!thread) return buildApiError('Mail not found', 404)
  return buildApiSuccess({ thread, syncError })
}

/** Explicit refresh. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  try {
    const result = await syncThreadReplies(params.id)
    const thread = await loadThread(params.id)
    return buildApiSuccess({ thread, ...result },
      result.newMessages > 0
        ? `${result.newMessages} new repl${result.newMessages === 1 ? 'y' : 'ies'}.`
        : 'No new replies.')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Sync failed', 502)
  }
}

/** Marks the inbound messages read, clearing the thread's unread badge. */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const thread = await prisma.mailThread.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!thread) return buildApiError('Mail not found', 404)

  await prisma.$transaction([
    prisma.mailThreadMessage.updateMany({
      where: { threadId: params.id, direction: 'IN', isRead: false },
      data:  { isRead: true },
    }),
    prisma.mailThread.update({ where: { id: params.id }, data: { unreadReplies: 0 } }),
  ])
  return buildApiSuccess({ ok: true })
}
