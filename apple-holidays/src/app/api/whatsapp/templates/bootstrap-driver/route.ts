/**
 * One-click registration of the driver-assignment WhatsApp templates with Meta.
 *
 * The assignment automation (driver-assignment-whatsapp.ts) can only deliver
 * through APPROVED templates — a driver who has never messaged the ops number is
 * outside the 24h customer-service window, where free-form text is dropped.
 * Rather than have staff retype these bodies into the "New template" dialog (and
 * risk a placeholder/example mismatch Meta rejects), this submits both for
 * review in one call.
 *
 *   GET  — preview the exact bodies that would be submitted
 *   POST — submit them to Meta for review (a name that already exists comes back
 *          as an error for that one template only)
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, uploadTemplateHeaderHandle, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import {
  TEMPLATE_DRIVER_ASSIGN,
  TEMPLATE_DRIVER_CANCEL,
  DRIVER_ASSIGN_BODY,
  DRIVER_CANCEL_BODY,
  DRIVER_TEMPLATE_LANG,
} from '@/lib/driver-assignment-whatsapp'
import { TEMPLATE_DRIVER_ADVANCE, DRIVER_ADVANCE_BODY } from '@/lib/driver-log-notify'
import { TEMPLATE_SETTLEMENT_DOCS, SETTLEMENT_DOCS_BODY } from '@/lib/sl-settlement-docs-notify'
import { sampleAdvanceSheetPdf } from '@/lib/generate-driver-log-pdf'
import { sampleSettlementDocsPdf } from '@/lib/sl-settlement-docs-pdfkit'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Meta requires an example value for every {{n}} placeholder before it reviews a template. */
const TEMPLATES: {
  name: string
  bodyText: string
  bodyExamples: string[]
  footerText: string
  /** DOCUMENT-header templates carry the generated PDF; needs a sample attachment. */
  headerFormat?: 'DOCUMENT'
  /** The sample Meta reviews the header against — one per document, not shared. */
  sample?: () => Promise<Buffer>
  sampleName?: string
}[] = [
  {
    name:     TEMPLATE_DRIVER_ASSIGN,
    bodyText: DRIVER_ASSIGN_BODY,
    bodyExamples: [
      'Sunil',
      'IS48305',
      'Tue, 30 Jun 2026 at 09:00',
      'Trincomalee: Airport → Uppuveli Beach By Dsk',
      'Mr. Harre · 2 Adult(s)',
      'Car · ABC-1234',
    ],
    footerText: 'AppleHolidays Operations',
  },
  {
    name:         TEMPLATE_DRIVER_CANCEL,
    bodyText:     DRIVER_CANCEL_BODY,
    bodyExamples: ['Sunil', 'IS48305'],
    footerText:   'AppleHolidays Operations',
  },
  {
    name:         TEMPLATE_DRIVER_ADVANCE,
    bodyText:     DRIVER_ADVANCE_BODY,
    headerFormat: 'DOCUMENT',
    sample:       sampleAdvanceSheetPdf,
    sampleName:   'DriverAdvanceSheet-sample.pdf',
    bodyExamples: [
      'Sunil',
      'IS48305',
      '30 Jun 2026',
      'Mr. Harre (2A/0C)',
      'LKR 116,251.63 (100%)',
      'LKR 0.00 (30%)',
      'LKR 116,251.63',
    ],
    footerText: 'AppleHolidays Operations',
  },
  {
    name:         TEMPLATE_SETTLEMENT_DOCS,
    bodyText:     SETTLEMENT_DOCS_BODY,
    headerFormat: 'DOCUMENT',
    sample:       sampleSettlementDocsPdf,
    sampleName:   'TourDocuments-sample.pdf',
    bodyExamples: [
      'Sunil',
      'IS48305',
      '30 Jun 2026 to 05 Jul 2026',
      'Mr. Harre - 2 pax',
      'Car - ABC-1234',
      'Name board, Transport settlement, Local visit settlement, Tour settlement',
    ],
    footerText: 'AppleHolidays Operations',
  },
]

function guard(role: string) {
  return (WHATSAPP_STAFF_ROLES as readonly string[]).includes(role as UserRole)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  return buildApiSuccess({ language: DRIVER_TEMPLATE_LANG, category: 'UTILITY', templates: TEMPLATES })
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  const results: { name: string; ok: boolean; status?: string; error?: string }[] = []
  for (const t of TEMPLATES) {
    try {
      // A media header needs an uploaded sample before Meta will review it.
      const headerHandle = t.headerFormat === 'DOCUMENT' && t.sample
        ? await uploadTemplateHeaderHandle(await t.sample(), t.sampleName ?? 'sample.pdf')
        : undefined

      const created = await createMetaTemplate({
        name:         t.name,
        category:     'UTILITY',
        language:     DRIVER_TEMPLATE_LANG,
        bodyText:     t.bodyText,
        bodyExamples: t.bodyExamples,
        footerText:   t.footerText,
        ...(t.headerFormat ? { headerFormat: t.headerFormat, headerHandle } : {}),
      })
      results.push({ name: created.name, ok: true, status: created.status })
    } catch (err) {
      results.push({ name: t.name, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const okCount = results.filter(r => r.ok).length
  return buildApiSuccess(
    results,
    `${okCount}/${TEMPLATES.length} driver template(s) submitted to Meta for review`,
  )
}
