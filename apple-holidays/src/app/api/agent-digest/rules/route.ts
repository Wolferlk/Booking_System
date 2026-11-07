/**
 * POST   /api/agent-digest/rules        — create a digest
 * PUT    /api/agent-digest/rules?id=…   — update it
 * DELETE /api/agent-digest/rules?id=…   — archive it (soft: the row and its
 *                                          send history stay)
 * PATCH  /api/agent-digest/rules?id=…   — restore an archived digest
 *
 * Writes only to agent_digest_rules.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { isDigestTableMissing, SETUP_MESSAGE, toRuleView } from '@/lib/agent-digest/server'
import { DIGEST_TIMEZONES, isTime, normaliseConfig } from '@/lib/agent-digest/shared'

export const dynamic = 'force-dynamic'

function parseBody(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 190) : ''
  if (!name) throw new Error('Give the digest a name')
  const sendTime = isTime(body.sendTime) ? body.sendTime : '07:00'
  const tz = typeof body.timezone === 'string' && DIGEST_TIMEZONES.some(t => t.value === body.timezone) ? body.timezone : 'Asia/Colombo'
  const config = normaliseConfig(body.config)
  if (config.kind !== 'TICKETS' && !config.blocks.some(b => b.enabled)) throw new Error('Add at least one block (e.g. “On ground today”)')
  return {
    name, sendTime, timezone: tz,
    isActive: body.isActive !== false,
    autoSend: body.autoSend === true,
    config: JSON.parse(JSON.stringify(config)),
  }
}

function fail(err: unknown) {
  if (isDigestTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
  return buildApiError(err instanceof Error ? err.message : 'Failed', 400)
}

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const data = parseBody(await req.json())
    const row = await prisma.agentDigestRule.create({ data: { ...data, createdByName: staff.name, updatedByName: staff.name } })
    return buildApiSuccess(toRuleView(row), 'Digest saved')
  } catch (err) { return fail(err) }
}

export async function PUT(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return buildApiError('id required')
  try {
    const existing = await prisma.agentDigestRule.findUnique({ where: { id }, select: { archivedAt: true } })
    if (!existing || existing.archivedAt) return buildApiError('Digest not found', 404)
    const data = parseBody(await req.json())
    const row = await prisma.agentDigestRule.update({ where: { id }, data: { ...data, updatedByName: staff.name } })
    return buildApiSuccess(toRuleView(row), 'Digest updated')
  } catch (err) { return fail(err) }
}

export async function PATCH(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return buildApiError('id required')
  try {
    const existing = await prisma.agentDigestRule.findUnique({ where: { id }, select: { archivedAt: true } })
    if (!existing) return buildApiError('Digest not found', 404)
    if (!existing.archivedAt) return buildApiError('This digest is not archived', 409)
    // Archive clears autoSend without keeping its old value, and this mail goes
    // to external agents — so a restored digest stays manual until someone
    // turns auto-send back on.
    const row = await prisma.agentDigestRule.update({
      where: { id },
      data: { archivedAt: null, isActive: true, autoSend: false, updatedByName: staff.name },
    })
    return buildApiSuccess(toRuleView(row), 'Digest restored')
  } catch (err) { return fail(err) }
}

export async function DELETE(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return buildApiError('id required')
  try {
    await prisma.agentDigestRule.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false, autoSend: false, updatedByName: staff.name },
    })
    return buildApiSuccess({ id }, 'Digest archived')
  } catch (err) { return fail(err) }
}
