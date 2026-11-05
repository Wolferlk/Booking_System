import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { commitImport, previewImport, type CommitOptions } from '@/lib/trans-recon/excel-import'
import { loadSheet } from '@/lib/trans-recon/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 8 * 1024 * 1024

/**
 * Import a desk's own workbook into a Trans-Reconsultation sheet.
 *
 * multipart/form-data: `file` (xlsx / xls / csv), `mode` = preview | commit,
 * `options` = JSON (country, year, month, half, sheet, columns, headerRow,
 * links, aiPair, applyText, unmatchedMc). The file is sent on both steps and
 * re-read on both — the server never takes rows back from the browser.
 */
export async function POST(req: NextRequest) {
  const s = await reconSession('edit')
  if (s instanceof Response) return s

  let form: FormData
  try { form = await req.formData() } catch { return buildApiError('Send the workbook as a file upload') }
  const file = form.get('file')
  if (!(file instanceof Blob) || !file.size) return buildApiError('Choose an Excel file')
  if (file.size > MAX_BYTES) return buildApiError('That file is over 8 MB — is it the right workbook?')
  const name = (file as File).name || 'upload.xlsx'
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(name)) return buildApiError('Upload an .xlsx, .xls or .csv file')

  let opts: CommitOptions = {}
  try { opts = JSON.parse(String(form.get('options') ?? '{}')) as CommitOptions } catch { return buildApiError('Bad import options') }
  const mode = String(form.get('mode') ?? 'preview')
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    if (mode === 'commit') {
      const out = await commitImport(buffer, name, opts, s.allowed, s.actor)
      return buildApiSuccess({ ...out, ...(await loadSheet(out.sheetId, s.allowed)) })
    }
    return buildApiSuccess(await previewImport(buffer, name, opts, s.allowed))
  } catch (err) {
    return reconFailure(err, `import ${mode}`)
  }
}
