/**
 * GET  /api/agent-digest/template — is the digest-link WhatsApp template approved?
 * POST /api/agent-digest/template — submit it to Meta for review.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, listMetaTemplates } from '@/lib/whatsapp'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { AGENT_DIGEST_TEMPLATE_DEF } from '@/lib/agent-digest/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const base = { name: AGENT_DIGEST_TEMPLATE_DEF.name, language: AGENT_DIGEST_TEMPLATE_DEF.language, body: AGENT_DIGEST_TEMPLATE_DEF.bodyText }
  try {
    // Every status, not only APPROVED — so a template waiting for review reads
    // as PENDING rather than "missing" (and nobody re-submits it).
    const all = await listMetaTemplates('ALL')
    const hit = all.find(t => t.name === AGENT_DIGEST_TEMPLATE_DEF.name && t.language === AGENT_DIGEST_TEMPLATE_DEF.language)
      ?? all.find(t => t.name === AGENT_DIGEST_TEMPLATE_DEF.name)
    return buildApiSuccess({
      ...base,
      status: hit ? hit.status : 'MISSING',
      approved: hit?.status === 'APPROVED',
      metaBody: hit?.bodyText ?? null,
      metaLanguage: hit?.language ?? null,
    })
  } catch (err) {
    return buildApiSuccess({ ...base, status: null, approved: null, metaBody: null, metaLanguage: null, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function POST() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const created = await createMetaTemplate(AGENT_DIGEST_TEMPLATE_DEF)
    return buildApiSuccess(created, `Template ${created.name} submitted to Meta (${created.status})`)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Template submission failed', 400)
  }
}
