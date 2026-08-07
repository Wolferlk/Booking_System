/**
 * Query Monitor — edit or drop a single entry.
 *
 * Any field a human corrects here is recorded in `manualOverrides` so a later
 * sweep's re-extraction can never undo the correction, and the row is queued for
 * a rewrite so the sheet matches what the dashboard shows.
 */
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'

export const dynamic = 'force-dynamic'

/** Free-text fields a user may correct. `subject` and `handlerNames` are NOT NULL. */
const TEXT_FIELDS = ['salesPerson', 'agent', 'destination', 'region', 'cntl', 'amendment'] as const
const REQUIRED_TEXT_FIELDS = ['subject', 'handlerNames'] as const
const DATE_FIELDS = ['travelDate', 'repliedAt'] as const

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const entry = await prisma.queryMonitorEntry.findUnique({
    where:   { id: params.id },
    include: { matches: { include: { mailbox: true } } },
  })
  if (!entry) return buildApiError('Entry not found', 404)

  return buildApiSuccess({ entry })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const entry = await prisma.queryMonitorEntry.findUnique({ where: { id: params.id } })
  if (!entry) return buildApiError('Entry not found', 404)

  const body = await req.json() as Record<string, unknown>
  const data: Prisma.QueryMonitorEntryUpdateInput = {}
  const touched: string[] = []

  const asText = (value: unknown) =>
    value === null || value === undefined || value === '' ? null : String(value).slice(0, 500)

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue
    data[field] = asText(body[field])
    touched.push(field)
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!(field in body)) continue
    // Both columns are NOT NULL — an emptied correction becomes an empty cell.
    data[field] = asText(body[field]) ?? ''
    touched.push(field)
  }

  for (const field of DATE_FIELDS) {
    if (!(field in body)) continue
    const raw = body[field]
    const date = raw ? new Date(String(raw)) : null
    if (date && Number.isNaN(date.getTime())) return buildApiError(`${field} is not a valid date`)
    data[field] = date
    touched.push(field)
  }

  if ('replyStatus' in body) {
    const status = String(body.replyStatus ?? '').toUpperCase()
    if (!['REPLIED', 'PENDING', 'OVERDUE'].includes(status)) {
      return buildApiError('replyStatus must be REPLIED, PENDING or OVERDUE')
    }
    data.replyStatus = status
    touched.push('replyStatus')
  }

  // Moving a mail between the two worksheets. Only possible before it is
  // written: the row it already owns lives on the other tab and this app never
  // deletes rows, so the move would leave an orphan behind.
  if ('mailKind' in body) {
    const kind = String(body.mailKind ?? '').toUpperCase()
    if (!['QUERY', 'EXCLUDED'].includes(kind)) {
      return buildApiError('mailKind must be QUERY or EXCLUDED')
    }
    if (kind !== entry.mailKind) {
      if (entry.sheetRow) {
        return buildApiError(
          `This mail is already written to row ${entry.sheetRow} of "${entry.sheetTab ?? 'the query sheet'}". `
          + 'Clear that row in Excel first, then move it.',
          409,
        )
      }
      data.mailKind = kind
      data.excludeReason = kind === 'EXCLUDED'
        ? (asText(body.excludeReason) ?? 'Moved by hand')
        : null
      touched.push('mailKind')
    }
  }

  if (touched.length === 0) return buildApiError('No editable fields supplied')

  // Editing the reply time implies the query is answered, unless told otherwise.
  if (touched.includes('repliedAt') && !touched.includes('replyStatus')) {
    data.replyStatus = data.repliedAt ? 'REPLIED' : 'PENDING'
  }

  const previous = Array.isArray(entry.manualOverrides)
    ? entry.manualOverrides.filter((v): v is string => typeof v === 'string')
    : []
  const overrides = Array.from(new Set(previous.concat(touched)))

  const updated = await prisma.queryMonitorEntry.update({
    where: { id: entry.id },
    data: {
      ...data,
      manualOverrides:  overrides,
      extractionSource: 'MANUAL',
      // Already in the sheet → rewrite that row; not yet → it goes out with the
      // next append, carrying the correction.
      syncStatus: entry.sheetRow ? 'DIRTY' : 'PENDING',
      syncError:  null,
    },
  })

  return buildApiSuccess({ entry: updated }, 'Entry updated — queued for the sheet')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const entry = await prisma.queryMonitorEntry.findUnique({ where: { id: params.id } })
  if (!entry) return buildApiError('Entry not found', 404)

  if (entry.sheetRow) {
    return buildApiError(
      `This entry is already written to sheet row ${entry.sheetRow}. `
      + 'Deleting it here would not remove that row — clear the row in Excel first.',
      409,
    )
  }

  await prisma.queryMonitorEntry.delete({ where: { id: entry.id } })
  return buildApiSuccess(null, 'Entry deleted')
}
