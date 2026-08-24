/**
 * Did the driver actually get it?
 *
 *   GET ?ref=IS48634        the full delivery history for one booking — every
 *                           document, to the driver and to the standing copy,
 *                           with the status Meta last reported for each.
 *   GET ?refs=IS1,IS2,…     one summary per booking, for the Drive Log's rows:
 *                           what the latest driver-facing send was and where it
 *                           got to. Capped, because a row badge must never cost
 *                           more than the row.
 *
 * The distinction this route exists to draw: a send that returned 200 is not a
 * delivery. Everything here is Meta's own answer, arriving by webhook against
 * the message id — `sent` means it left, `delivered` means the handset has it,
 * `read` means the driver opened it, `failed` means it never arrived and the
 * desk needs to do something about that this morning rather than on the day the
 * signed sheets do not come back.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Enough for a full day of the Drive Log without letting a URL become a scan. */
const MAX_REFS = 200
/** One booking's history — a resend three times over still fits comfortably. */
const MAX_ROWS = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const ref  = (req.nextUrl.searchParams.get('ref') ?? '').trim()
  const refs = (req.nextUrl.searchParams.get('refs') ?? '')
    .split(',').map(r => r.trim()).filter(Boolean).slice(0, MAX_REFS)

  if (!ref && !refs.length) return buildApiError('A booking reference is required.', 400)

  try {
    if (ref) {
      const rows = await prisma.driverDocSend.findMany({
        where:   { bookingRef: ref },
        orderBy: { createdAt: 'desc' },
        take:    MAX_ROWS,
      })
      return buildApiSuccess({ ref, sends: rows.map(shape) })
    }

    // The row badges. Only driver-facing sends decide a booking's state — a copy
    // that failed is a filing problem, not a driver without his paperwork — but
    // the copy count travels alongside so the desk can see one went at all.
    const rows = await prisma.driverDocSend.findMany({
      where:   { bookingRef: { in: refs } },
      orderBy: { createdAt: 'desc' },
      take:    MAX_REFS * 6,
    })

    const summary: Record<string, {
      status: string
      at: string
      kind: string
      phone: string
      driverName: string | null
      failureReason: string | null
      total: number
      copies: number
      failed: number
    }> = {}

    for (const row of rows) {
      const entry = summary[row.bookingRef] ?? {
        status: row.status, at: row.createdAt.toISOString(), kind: row.kind,
        phone: row.phone, driverName: row.driverName, failureReason: row.failureReason,
        total: 0, copies: 0, failed: 0,
      }
      // Newest first, so the first driver-facing row seen is the current state.
      if (row.audience === 'driver' && entry.total === 0) {
        entry.status = row.status
        entry.at     = row.createdAt.toISOString()
        entry.kind   = row.kind
        entry.phone  = row.phone
        entry.driverName    = row.driverName
        entry.failureReason = row.failureReason
      }
      if (row.audience === 'copy') entry.copies += 1
      else entry.total += 1
      if (row.status === 'failed') entry.failed += 1
      summary[row.bookingRef] = entry
    }

    return buildApiSuccess({ summary })
  } catch (err) {
    // The receipts table is created by prisma/sql/2026-08-24-sl-driver-doc-sends.sql.
    // Before it is applied this screen should read "no deliveries recorded",
    // not fall over — the documents themselves are unaffected.
    console.error('[drive-log/documents/deliveries]', err)
    return buildApiSuccess(ref ? { ref, sends: [] } : { summary: {} })
  }
}

function shape(row: {
  id: string; bookingRef: string; kind: string; audience: string
  driverName: string | null; phone: string; channel: string | null
  docs: string | null; filename: string | null; mediaUrl: string | null
  status: string; failureReason: string | null
  sentAt: Date | null; deliveredAt: Date | null; readAt: Date | null; failedAt: Date | null
  copyOfId: string | null; copyLabel: string | null
  sentByName: string | null; createdAt: Date
}) {
  return {
    id:            row.id,
    bookingRef:    row.bookingRef,
    kind:          row.kind,
    audience:      row.audience,
    driverName:    row.driverName,
    phone:         row.phone,
    channel:       row.channel,
    docs:          row.docs ? row.docs.split(',').filter(Boolean) : [],
    filename:      row.filename,
    mediaUrl:      row.mediaUrl,
    status:        row.status,
    failureReason: row.failureReason,
    sentAt:        row.sentAt?.toISOString() ?? null,
    deliveredAt:   row.deliveredAt?.toISOString() ?? null,
    readAt:        row.readAt?.toISOString() ?? null,
    failedAt:      row.failedAt?.toISOString() ?? null,
    copyOfId:      row.copyOfId,
    copyLabel:     row.copyLabel,
    sentByName:    row.sentByName,
    createdAt:     row.createdAt.toISOString(),
  }
}
