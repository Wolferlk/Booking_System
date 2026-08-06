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

/** Fields a user may correct from the dashboard. */
const EDITABLE = [
  'subject', 'handlerNames', 'salesPerson', 'agent', 'destination',
  'region', 'cntl', 'amendment', 'travelDate', 'repliedAt', 'replyStatus',
] as const

type EditableField = (typeof EDITABLE)[number]

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

  for (const field of EDITABLE) {
    if (!(field in body)) continue
    const value = body[field]

    if (field === 'travelDate' || field === 'repliedAt') {
      const date = value ? new Date(String(value)) : null
      if (date && Number.isNaN(date.getTime())) return buildApiError(`${field} is not a valid date`)
      data[field] = date
    } else {
      data[field as Exclude<EditableField, 'travelDate' | 'repliedAt'>] =
        value === null || value === '' ? null : String(value).slice(0, 500)
    }
    touched.push(field)
  }

  if (touched.length === 0) return buildApiError('No editable fields supplied')

  // handlerNames is NOT NULL in the schema — an empty correction means "unknown".
  if (data.handlerNames === null) data.handlerNames = ''

  // Editing the reply time implies the query is answered, unless told otherwise.
  if (touched.includes('repliedAt') && !touched.includes('replyStatus')) {
    data.replyStatus = data.repliedAt ? 'REPLIED' : 'PENDING'
  }

  const previous = Array.isArray(entry.manualOverrides)
    ? entry.manualOverrides.filter((v): v is string => typeof v === 'string')
    : []
  const overrides = [...new Set([...previous, ...touched])]

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
