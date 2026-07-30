/**
 * Global WhatsApp inbox — Meta message templates.
 *   GET  — list templates on the business account (default ?status=APPROVED)
 *   POST — register a NEW template with Meta for review (Business Manager
 *          approval, typically minutes to ~24h)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listMetaTemplates, createMetaTemplate, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const status = req.nextUrl.searchParams.get('status') ?? 'APPROVED'
  try {
    const data = await listMetaTemplates(status)
    return buildApiSuccess(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(msg, 502)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json() as {
    name?: string
    category?: string
    language?: string
    bodyText?: string
    bodyExamples?: string[]
    headerText?: string | null
    headerExamples?: string[]
    footerText?: string | null
  }
  const name = (body.name ?? '').trim()
  const bodyText = (body.bodyText ?? '').trim()
  if (!name) return buildApiError('name is required')
  if (!bodyText) return buildApiError('bodyText is required')

  try {
    const data = await createMetaTemplate({
      name,
      category: body.category,
      language: body.language,
      bodyText,
      bodyExamples: Array.isArray(body.bodyExamples) ? body.bodyExamples : [],
      headerText: body.headerText ?? null,
      headerExamples: Array.isArray(body.headerExamples) ? body.headerExamples : [],
      footerText: body.footerText ?? null,
    })
    return buildApiSuccess(data, `Submitted "${data.name}" for review`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(msg, 400)
  }
}
