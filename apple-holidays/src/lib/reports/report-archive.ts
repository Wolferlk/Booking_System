/**
 * SharePoint report archive — the OPS half.
 *
 * Every daily report the Accounts system and this system email is filed in one
 * SharePoint folder, by the day it was sent:
 *
 *   ERP System Back Up / 2026 / 10 - October / 2026-10-19 /
 *     OPS Daily Report - 2026-10-19 - sent 07.00.xlsx
 *     OPS Daily Report - 2026-10-19 - sent 07.00 - email.html
 *     Invoice B2B (AHDS) - 2026-10-18 - sent 00.16.xlsx      ← written by Accounts
 *
 * The Accounts side (ReportArchiveService / SharePointArchiveClient) owns the
 * same layout; keep folderSegments() and the naming in step with it.
 *
 * Safety, identical to the Accounts client:
 *  - create-only: no DELETE / PATCH / move anywhere in this file;
 *  - every write is addressed below the archive folder's own item id;
 *  - uploads use conflictBehavior=fail — same name + same size is our own
 *    earlier attempt (adopted), anything else is someone's file and ours is
 *    stored beside it (conflictBehavior=rename);
 *  - archiveSentReport() never throws and is time-boxed, so a slow SharePoint
 *    can never fail or hold up a report that has already been emailed.
 *
 * Uses the GRAPH_* app credentials (getGraphToken('pnl')), which carry
 * Files.ReadWrite.All. Off switch: REPORT_ARCHIVE_ENABLED=0.
 */
import { getGraphToken } from '@/lib/mail-processor'
import { DEFAULT_REPORT_TZ } from './report-window'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const DEFAULT_URL =
  'https://aahaas.sharepoint.com/:f:/s/Accounts/IgD13PXSlinoQ6v8o4blyzdVAd9R1FFpXb_mOCvAeuaQMok?e=Ef66c0'

/** The whole archive step for one email, worst case. */
const TIME_BOX_MS = 45_000

export interface ArchiveFile {
  /** Name without extension is built here; pass only the extension. */
  ext: 'xlsx' | 'csv' | 'html'
  contentType: string
  content: string | Buffer
  /** Suffix after the base name, e.g. " - email". */
  suffix?: string
}

export interface ArchiveRequest {
  /** "OPS Daily Report", "OPS Reconciliation" … */
  category: string
  periodFrom?: string | null
  periodTo?: string | null
  sentAt?: Date
  files: ArchiveFile[]
}

export interface ArchiveResult {
  ok: boolean
  filed: string[]
  error?: string
}

export function archiveEnabled(): boolean {
  return !['0', 'false', 'off', 'no'].includes(String(process.env.REPORT_ARCHIVE_ENABLED ?? '1').toLowerCase())
}

/* ------------------------------------------------------------------ */
/*  Naming — mirrors ReportArchiveService                              */
/* ------------------------------------------------------------------ */

function partsInTz(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(x => [x.type, x.value]),
  )
  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long' }).format(d)
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, monthName }
}

/** ['2026', '10 - October', '2026-10-19'] */
export function folderSegments(sentAt: Date, tz = DEFAULT_REPORT_TZ): string[] {
  const p = partsInTz(sentAt, tz)
  return [p.y, `${p.m} - ${p.monthName}`, `${p.y}-${p.m}-${p.d}`]
}

export function baseName(req: ArchiveRequest, tz = DEFAULT_REPORT_TZ): string {
  const p = partsInTz(req.sentAt ?? new Date(), tz)
  const from = req.periodFrom || null
  const to = req.periodTo || from
  const period = !from ? null : from === to ? from : `${from} to ${to}`
  return [req.category, period, `sent ${p.hh}.${p.mm}`].filter(Boolean).join(' - ')
}

/** SharePoint-illegal characters out, no "..", no leading/trailing dots or spaces. */
export function cleanName(name: string): string {
  const out = name
    .replace(/["*:<>?/\\|#%\x00-\x1F]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .replace(/\.\./g, '.')
    .slice(0, 200)
  if (!out) throw new Error('Empty archive file or folder name')
  return out
}

/* ------------------------------------------------------------------ */
/*  Graph                                                              */
/* ------------------------------------------------------------------ */

interface Root { driveId: string; itemId: string }

let cachedRoot: { url: string; root: Root } | null = null

async function graph(token: string, path: string, init: RequestInit = {}, attempt = 1): Promise<Response> {
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  })
  // Throttling and transient 5xx only; a 4xx is an answer.
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * attempt
    await new Promise(r => setTimeout(r, Math.min(wait, 8000)))
    return graph(token, path, init, attempt + 1)
  }
  return res
}

async function ok<T = any>(res: Response, what: string): Promise<T> {
  if (res.ok) return (await res.json()) as T
  let msg = ''
  try { msg = (await res.json())?.error?.message ?? '' } catch { /* body not JSON */ }
  throw new Error(`${what}: HTTP ${res.status}${msg ? ' — ' + msg : ''}`)
}

async function resolveRoot(token: string): Promise<Root> {
  const url = process.env.REPORT_ARCHIVE_SHAREPOINT_URL || DEFAULT_URL
  if (cachedRoot?.url === url) return cachedRoot.root

  const encoded = 'u!' + Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const item = await ok(await graph(token, `/shares/${encoded}/driveItem?$select=id,name,folder,parentReference`), 'Could not open the archive folder link')
  if (!item.folder) throw new Error(`The archive link points at a file ('${item.name}'), not a folder`)

  const root = { driveId: item.parentReference.driveId, itemId: item.id }
  cachedRoot = { url, root }
  return root
}

async function findChild(token: string, root: Root, parentId: string, name: string): Promise<any | null> {
  const res = await graph(token, `/drives/${root.driveId}/items/${parentId}:/${encodeURIComponent(name)}?$select=id,name,folder,file,size,webUrl`)
  if (res.status === 404) return null
  return ok(res, `Could not read '${name}' in the archive`)
}

async function ensureFolder(token: string, root: Root, segments: string[]): Promise<string> {
  let parent = root.itemId
  for (const raw of segments) {
    const name = cleanName(raw)
    let item = await findChild(token, root, parent, name)
    if (!item) {
      const res = await graph(token, `/drives/${root.driveId}/items/${parent}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      })
      // 409: the Accounts side (or another run) created it a moment ago.
      item = res.status === 409 ? await findChild(token, root, parent, name) : await ok(res, `Could not create folder '${name}'`)
    }
    if (!item?.folder) throw new Error(`'${name}' exists in the archive but is a file, not a folder — left untouched`)
    parent = item.id
  }
  return parent
}

async function upload(token: string, root: Root, folderId: string, name: string, file: ArchiveFile): Promise<string> {
  const body = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content
  if (body.length > 4 * 1024 * 1024) throw new Error(`'${name}' is over 4 MB — too large for a simple upload`)

  const put = (conflict: 'fail' | 'rename') =>
    graph(token, `/drives/${root.driveId}/items/${folderId}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=${conflict}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.contentType },
      body: new Uint8Array(body),
    })

  let res = await put('fail')
  if (res.status === 409) {
    const existing = await findChild(token, root, folderId, name)
    // Our own earlier attempt whose response was lost — adopt it.
    if (existing?.file && Number(existing.size) === body.length) return existing.name
    // Someone else's file: keep it, store ours beside it.
    res = await put('rename')
  }
  return (await ok(res, `Could not upload '${name}'`)).name
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

/** File one sent report. Never throws; resolves within TIME_BOX_MS. */
export async function archiveSentReport(req: ArchiveRequest): Promise<ArchiveResult> {
  if (!archiveEnabled()) return { ok: true, filed: [] }

  const work = (async (): Promise<ArchiveResult> => {
    const sentAt = req.sentAt ?? new Date()
    const token = await getGraphToken('pnl')
    const root = await resolveRoot(token)
    const folderId = await ensureFolder(token, root, folderSegments(sentAt))
    const base = baseName({ ...req, sentAt })

    const filed: string[] = []
    for (const f of req.files) {
      filed.push(await upload(token, root, folderId, cleanName(`${base}${f.suffix ?? ''}.${f.ext}`), f))
    }
    return { ok: true, filed }
  })()

  const timeout = new Promise<ArchiveResult>(resolve =>
    setTimeout(() => resolve({ ok: false, filed: [], error: `timed out after ${TIME_BOX_MS / 1000}s` }), TIME_BOX_MS).unref?.(),
  )

  try {
    const result = await Promise.race([work, timeout])
    if (result.ok) console.log(`[ReportArchive] filed ${folderSegments(req.sentAt ?? new Date()).join('/')}: ${result.filed.join(', ')}`)
    else console.warn(`[ReportArchive] "${req.category}" not filed: ${result.error}`)
    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn(`[ReportArchive] "${req.category}" not filed: ${error}`)
    return { ok: false, filed: [], error }
  }
}

/** The email body as a file that opens on its own, with who/when on top. */
export function archivedEmailHtml(html: string, meta: { subject: string; to: string[]; cc?: string[]; sentAt?: Date }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_REPORT_TZ, dateStyle: 'short', timeStyle: 'short' }).format(meta.sentAt ?? new Date())
  const banner =
    '<div style="font:12px/1.5 Arial,sans-serif;background:#f1f5f9;border-bottom:1px solid #cbd5e1;padding:10px 16px;color:#334155">'
    + '<b>Archived copy of a sent email</b><br>'
    + `Subject: ${esc(meta.subject)}<br>To: ${esc(meta.to.join(', '))}`
    + (meta.cc?.length ? `<br>Cc: ${esc(meta.cc.join(', '))}` : '')
    + `<br>Sent: ${esc(when)} (${esc(DEFAULT_REPORT_TZ)})</div>`

  let out = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + banner) : banner + html
  if (!/charset/i.test(out)) out = '<meta charset="utf-8">' + out
  return out
}
