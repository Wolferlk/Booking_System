/**
 * Checklist VN 2.1v — downloads.
 *
 *   ?kind=original          the workbook exactly as it is on SharePoint (a
 *                           read-only fetch; nothing is opened for editing)
 *   ?kind=mirror            what OPS has stored, in the desk's layout
 *   ?kind=mirror&tour=CODE  one tour's block — the booking page's button
 */
import { NextRequest } from 'next/server'
import { buildApiError } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { downloadSheet, isMissingTable } from '@/lib/vn-checklist-sheet/sync'
import { buildMirrorWorkbook } from '@/lib/vn-checklist-sheet/export'
import { SHEET_NOT_INSTALLED } from '@/lib/vn-checklist-sheet/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function fileResponse(buffer: Buffer, filename: string) {
  const safe = filename.replace(/[^\w .()-]+/g, '_')
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  const auth = await checklistSession(false)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const sp = req.nextUrl.searchParams
  const kind = sp.get('kind') ?? 'original'
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '')

  try {
    if (kind === 'original') {
      const { file, buffer } = await downloadSheet()
      return fileResponse(buffer, file.fileName || 'Checklist.xlsx')
    }
    const tour = sp.get('tour')
    const buffer = await buildMirrorWorkbook(tour ? { tourCodes: [tour], activeOnly: false } : {})
    return fileResponse(buffer, tour ? `Checklist VN ${tour}.xlsx` : `Checklist VN 2.1 mirror ${stamp}.xlsx`)
  } catch (err) {
    if (isMissingTable(err)) return buildApiError(SHEET_NOT_INSTALLED, 503)
    return buildApiError(err instanceof Error ? err.message : 'Download failed', 502)
  }
}
