/**
 * MC Report → PDF, printed through Chromium from the same HTML the Report
 * Studio preview shows.
 *
 * The page posts the rows it is displaying (already through every filter) and
 * the template config — never HTML. The server rebuilds the document itself
 * with every value escaped, and Chromium runs with all network requests
 * blocked, so nothing posted here can make the renderer fetch anything.
 *
 * When the host has no usable Chromium this answers 503 and the page falls
 * back to the browser's own print dialog on the identical document.
 */

import path from 'path'
import { readFile } from 'fs/promises'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { launchBrowser, PdfEngineUnavailableError } from '@/lib/html-to-pdf'
import { buildMcReportHtml, pdfFileName, sanitizeConfig, esc, type McPdfRow } from '@/lib/mc-report-pdf'
import { MC_REPORT_ROLES } from '@/lib/mc-report-templates'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_ROWS = 2_500

const s = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v ? v.slice(0, max) : typeof v === 'number' ? String(v) : null)
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const b = (v: unknown) => v === true

function toRow(raw: unknown): McPdfRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const flow = r.flow === 'arrival' || r.flow === 'departure' || r.flow === 'both' ? r.flow : null
  return {
    id: s(r.id, 64) ?? '', date: s(r.date, 32) ?? '', time: s(r.time, 8),
    vnCode: s(r.vnCode, 40) ?? '', isNumber: s(r.isNumber, 40), agentRef: s(r.agentRef, 80),
    leadGuest: s(r.leadGuest, 200), agent: s(r.agent, 200), location: s(r.location, 200) ?? '',
    country: s(r.country, 40), adults: n(r.adults) ?? 0, children: n(r.children) ?? 0,
    from: s(r.from, 400), to: s(r.to, 400), details: s(r.details, 3000), mealPlan: s(r.mealPlan, 20),
    service: s(r.service, 60) ?? '', flow, airport: s(r.airport, 8),
    flights: Array.isArray(r.flights) ? r.flights.slice(0, 6).map(f => s(f, 120)).filter((f): f is string => !!f) : [],
    leisure: b(r.leisure), hotelOnly: b(r.hotelOnly), noDriver: b(r.noDriver),
    vendor: s(r.vendor, 200), driver: s(r.driver, 200), driverPhone: s(r.driverPhone, 40),
    vehicle: s(r.vehicle, 120), plate: s(r.plate, 40),
    guide: s(r.guide, 200), guidePhone: s(r.guidePhone, 40),
    tourVendor: s(r.tourVendor, 200), tourVendorPhone: s(r.tourVendorPhone, 40),
    mealPrefs: s(r.mealPrefs, 500) ?? '', specialReq: s(r.specialReq, 2000) ?? '',
    ticketsControl: s(r.ticketsControl, 500), status: s(r.status, 60) ?? '',
    cancelled: b(r.cancelled), cancelPending: b(r.cancelPending), done: b(r.done),
    budgetKm: n(r.budgetKm), actualKm: n(r.actualKm), packageCost: n(r.packageCost),
    budgetTransfer: s(r.budgetTransfer, 60),
  }
}

let logoCache: string | null | undefined
async function logoDataUri(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'logo.png'))
    logoCache = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    logoCache = null // not bundled on this host — the masthead simply has no logo
  }
  return logoCache
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!MC_REPORT_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  let body: { rows?: unknown; config?: unknown; meta?: Record<string, unknown> }
  try { body = await req.json() } catch { return buildApiError('Invalid request body') }

  if (!Array.isArray(body.rows)) return buildApiError('rows is required')
  if (body.rows.length > MAX_ROWS) return buildApiError(`A PDF is limited to ${MAX_ROWS} movements — narrow the filters`)
  const rows = body.rows.map(toRow).filter((r): r is McPdfRow => !!r)
  const config = sanitizeConfig(body.config)
  const meta = body.meta ?? {}
  const dateFrom = s(meta.dateFrom, 10) ?? ''
  const dateTo = s(meta.dateTo, 10) ?? ''
  const filterChips = Array.isArray(meta.filterChips)
    ? meta.filterChips.slice(0, 30).map(c => s(c, 200)).filter((c): c is string => !!c) : []

  const now = new Date()
  const html = buildMcReportHtml(rows, config, {
    dateFrom, dateTo, filterChips, generatedAt: now,
    generatedBy: session.user.name ?? null,
    logoSrc: await logoDataUri(),
  })

  try {
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      // Everything the document needs is inline; refuse every other request.
      await page.setRequestInterception(true)
      page.on('request', r => (r.url().startsWith('data:') || r.url() === 'about:blank' ? r.continue() : r.abort()))
      await page.setContent(html, { waitUntil: 'load' })
      const stamp = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const raw = await page.pdf({
        format: config.layout.paper,
        landscape: config.layout.orientation === 'landscape',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<div style="font-size:1px;"> </div>',
        footerTemplate: `
          <div style="width:100%;padding:0 9mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;
                      font-size:7px;color:#94a3b8;display:flex;justify-content:space-between;">
            <span>Apple Holidays MMT · ${esc(config.title)} · ${esc(stamp)}</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
      return new Response(new Uint8Array(raw), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${pdfFileName(config, dateFrom, dateTo)}"`,
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    if (error instanceof PdfEngineUnavailableError) {
      console.error('[mc-report/export-pdf] no PDF engine:', error.message)
      return buildApiError('PDF rendering is unavailable on this server — use Print instead.', 503)
    }
    console.error('[mc-report/export-pdf]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to generate the PDF', 500)
  }
}
