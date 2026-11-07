/**
 * One-click registration of the three trip-portal WhatsApp templates with Meta.
 *
 * The portal-link automation (portal-link-whatsapp.ts) can only deliver through
 * APPROVED templates — a guest who has never messaged us is outside the 24h
 * customer-service window. Rather than have staff retype these three bodies into
 * the "New template" dialog (and risk a placeholder/example mismatch Meta
 * rejects), this submits all three for review in one call.
 *
 *   GET  — preview the exact bodies that would be submitted
 *   POST — submit them to Meta for review (idempotent-ish: a name that already
 *          exists comes back as an error for that one template only)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import {
  TEMPLATE_WELCOME, TEMPLATE_REMINDER, TEMPLATE_FORWARD,
  PORTAL_BODY_WELCOME, PORTAL_BODY_REMINDER, PORTAL_BODY_FORWARD,
  PORTAL_FOOTER, PORTAL_FOOTER_FORWARD,
} from '@/lib/portal-link-whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const LANG = process.env.WHATSAPP_PORTAL_TEMPLATE_LANG?.trim() || 'en'
const EXAMPLE_LINK = 'https://ops.aahaas.com/trip/464516CNTL?t=46c05230e67629e60867b7aeb5c68f8c'

/**
 * Meta requires an example value for every {{n}} placeholder before it will
 * review a template, and rejects bodies that start or end with a placeholder —
 * hence the closing line of static text on each.
 */
const TEMPLATES = [
  {
    name: TEMPLATE_WELCOME,
    bodyText: PORTAL_BODY_WELCOME,
    bodyExamples: ['Nimal', 'VN19018', EXAMPLE_LINK],
    footerText: PORTAL_FOOTER,
  },
  {
    name: TEMPLATE_REMINDER,
    bodyText: PORTAL_BODY_REMINDER,
    bodyExamples: ['Nimal', 'VN19018', EXAMPLE_LINK],
    footerText: PORTAL_FOOTER,
  },
  {
    name: TEMPLATE_FORWARD,
    bodyText: PORTAL_BODY_FORWARD,
    bodyExamples: ['VN19018', EXAMPLE_LINK],
    footerText: PORTAL_FOOTER_FORWARD,
  },
]

function guard(role: string) {
  return (WHATSAPP_STAFF_ROLES as readonly string[]).includes(role as UserRole)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  return buildApiSuccess({ language: LANG, category: 'UTILITY', templates: TEMPLATES })
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  const results: { name: string; ok: boolean; status?: string; error?: string }[] = []
  for (const t of TEMPLATES) {
    try {
      const created = await createMetaTemplate({
        name:         t.name,
        category:     'UTILITY',
        language:     LANG,
        bodyText:     t.bodyText,
        bodyExamples: t.bodyExamples,
        footerText:   t.footerText,
      })
      results.push({ name: created.name, ok: true, status: created.status })
    } catch (err) {
      results.push({ name: t.name, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const okCount = results.filter(r => r.ok).length
  return buildApiSuccess(
    results,
    `${okCount}/${TEMPLATES.length} trip-portal template(s) submitted to Meta for review`,
  )
}
