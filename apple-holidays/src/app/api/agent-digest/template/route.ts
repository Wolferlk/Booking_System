/**
 * GET  /api/agent-digest/template — is the digest-link WhatsApp template approved?
 * POST /api/agent-digest/template — submit it to Meta for review.
 *
 * `?kind=tickets` means the ticket pack's template instead, and `&pdf=1` the
 * version with the PDF in its header.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, listMetaTemplates, uploadTemplateHeaderHandle } from '@/lib/whatsapp'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import {
  AGENT_DIGEST_PDF_TEMPLATE_DEF, AGENT_DIGEST_TEMPLATE_DEF, AGENT_TICKETS_PDF_TEMPLATE_DEF, AGENT_TICKETS_TEMPLATE_DEF,
} from '@/lib/agent-digest/server'
import { sampleDigestPdf } from '@/lib/agent-digest/attachments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const isPack = (req: NextRequest) => req.nextUrl.searchParams.get('kind') === 'tickets'
const withPdf = (req: NextRequest) => req.nextUrl.searchParams.get('pdf') === '1'

function defFor(req: NextRequest) {
  if (isPack(req)) return withPdf(req) ? AGENT_TICKETS_PDF_TEMPLATE_DEF : AGENT_TICKETS_TEMPLATE_DEF
  return withPdf(req) ? AGENT_DIGEST_PDF_TEMPLATE_DEF : AGENT_DIGEST_TEMPLATE_DEF
}

export async function GET(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const def = defFor(req)
  const base = { name: def.name, language: def.language, body: def.bodyText }
  try {
    // Every status, not only APPROVED — so a template waiting for review reads
    // as PENDING rather than "missing" (and nobody re-submits it).
    const all = await listMetaTemplates('ALL')
    const hit = all.find(t => t.name === def.name && t.language === def.language)
      ?? all.find(t => t.name === def.name)
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

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    // A document header needs an uploaded sample before Meta will review it.
    const header = withPdf(req)
      ? { headerFormat: 'DOCUMENT' as const, headerHandle: await uploadTemplateHeaderHandle(await sampleDigestPdf(isPack(req)), 'Agent-digest-sample.pdf') }
      : {}
    const created = await createMetaTemplate({ ...defFor(req), ...header })
    return buildApiSuccess(created, `Template ${created.name} submitted to Meta (${created.status})`)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Template submission failed', 400)
  }
}
