/**
 * POST /api/agent-digest/send
 *
 *   { ruleId, runDate?, force? }                       — send now to the rule's recipients
 *                                                         (already-sent recipients are skipped
 *                                                         unless force; failed ones are retried)
 *   { ruleId | draft, test: { phone?, email?, name? } } — send ONE test copy to a typed number /
 *                                                         address; never counts as the day's send
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { isDigestTableMissing, sendDigest, SETUP_MESSAGE } from '@/lib/agent-digest/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const body = await req.json()
    const runDate = typeof body.runDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runDate) ? body.runDate : undefined
    const test = body.test && typeof body.test === 'object'
      ? { phone: String(body.test.phone ?? '').trim(), email: String(body.test.email ?? '').trim(), name: String(body.test.name ?? '').trim() || staff.name }
      : null
    if (test && !test.phone && !test.email) return buildApiError('Type a WhatsApp number or an email for the test')
    const result = await sendDigest({
      ruleId: typeof body.ruleId === 'string' ? body.ruleId : null,
      draft: body.draft && typeof body.draft === 'object' ? { name: String(body.draft.name ?? ''), config: body.draft.config } : undefined,
      runDate,
      trigger: test ? 'test' : 'manual',
      testTo: test ?? undefined,
      force: body.force === true,
      onlyRecipientIds: Array.isArray(body.onlyRecipientIds) ? body.onlyRecipientIds.filter((x: unknown) => typeof x === 'string') : undefined,
      sentByName: staff.name,
    })
    const msg = result.reason ?? `Sent ${result.sent}${result.failed ? `, failed ${result.failed}` : ''}${result.skipped ? `, skipped ${result.skipped}` : ''}`
    return buildApiSuccess(result, msg)
  } catch (err) {
    if (isDigestTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    return buildApiError(err instanceof Error ? err.message : 'Send failed', 400)
  }
}
