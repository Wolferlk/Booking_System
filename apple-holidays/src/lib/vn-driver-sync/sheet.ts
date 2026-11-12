/**
 * VN Driver Sync — reading the "(VN TEAM) Movement Chart" Google Sheet.
 *
 * The sheet is only ever READ. How it is fetched depends on the link:
 *
 *   OneDrive / SharePoint link (the default) — Microsoft Graph, with the same
 *   app login OPS already uses for mailboxes and the Checklist VN 2.1 mirror.
 *   The link resolves through /shares/{link}/driveItem, then a plain /content
 *   download; no workbook session is opened, nothing is written.
 *
 *   Google Sheet link (kept as a fallback), tried in this order:
 *   1. A Google service account (GOOGLE_SERVICE_ACCOUNT_JSON, or
 *      GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).
 *      Share the sheet with that e-mail as Viewer — the sheet can stay private.
 *      Scope: drive.readonly.
 *   2. The sheet's own "Anyone with the link — Viewer" export. No secrets.
 *
 * Either way the whole workbook comes down as .xlsx (every tab) and is parsed
 * here. Columns are found by their header TEXT, not position, so the desk can
 * add, hide or move columns. A tab is used when its header row has a date,
 * a booking code and a vendors column.
 */
import { createHash, createSign } from 'crypto'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { downloadDriveItem, graphFetch } from '@/lib/graph-client'
import { DRIVER_SYNC_SETTINGS, isMicrosoftLink, sheetIdOf } from './shared'
import { normaliseServiceType, SERVICE_TYPE_SHORT_LABELS, isBuiltInServiceType } from '@/lib/service-types'
import { extractPhones } from '@/lib/guest-driver'

export interface SheetRow {
  /** Stable within one read: `${tab}!${row}`. */
  id: string
  tab: string
  /** 1-based, as the sheet shows it. */
  row: number
  refs: string[]
  date: string | null          // yyyy-mm-dd
  details: string | null
  meal: string | null
  time: string | null          // HH:MM when it parses, else as typed
  service: string | null       // as typed
  serviceCode: string | null   // normalised ServiceType code (or the typed text)
  location: string | null      // Location column (the city)
  from: string | null          // From column
  to: string | null            // To/Tours column
  route: string | null         // "from → to", for display
  guest: string | null         // Name of guests ("Tapati Ganguly +918240694973")
  text: string | null          // the Vendors cell, full
  driverText: string | null    // a Driver / Driver details column, when the sheet has one
  phones: string[]
}

export interface SheetRead {
  rows: SheetRow[]
  tabs: string[]
  skippedTabs: string[]
  hash: string
  source: 'MICROSOFT_GRAPH' | 'SERVICE_ACCOUNT' | 'PUBLIC_LINK'
  title: string | null
  warnings: string[]
}

export class SheetAccessError extends Error {
  constructor(message: string, readonly code: 'NOT_SHARED' | 'NOT_FOUND' | 'AUTH' | 'HTTP' | 'FORMAT') {
    super(message)
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ── Service account ──────────────────────────────────────────────────────────

interface ServiceAccount { email: string; key: string }

export function serviceAccount(): ServiceAccount | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (json) {
    try {
      const raw = json.startsWith('{') ? json : Buffer.from(json, 'base64').toString('utf8')
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string }
      if (parsed.client_email && parsed.private_key) return { email: parsed.client_email, key: parsed.private_key }
    } catch { /* fall through to the split variables */ }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  return email && key ? { email, key } : null
}

let cachedToken: { token: string; exp: number; email: string } | null = null

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.email === sa.email && cachedToken.exp > Date.now() + 60_000) return cachedToken.token
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.key).toString('base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const json = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !json.access_token) throw new SheetAccessError(`Google sign-in failed for ${sa.email}: ${json.error_description ?? res.status}`, 'AUTH')
  cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000, email: sa.email }
  return json.access_token
}

async function downloadWithServiceAccount(sheetId: string, sa: ServiceAccount): Promise<{ buf: Buffer; title: string | null }> {
  const token = await accessToken(sa)
  const auth = { Authorization: `Bearer ${token}` }
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?fields=name,mimeType&supportsAllDrives=true`, { headers: auth })
  if (meta.status === 404) throw new SheetAccessError(`The sheet is not shared with ${sa.email} — share it with that address as Viewer`, 'NOT_SHARED')
  if (!meta.ok) throw new SheetAccessError(`Google Drive answered ${meta.status} for the sheet`, 'HTTP')
  const info = await meta.json() as { name?: string; mimeType?: string }
  const url = info.mimeType === 'application/vnd.google-apps.spreadsheet'
    ? `https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
    : `https://www.googleapis.com/drive/v3/files/${sheetId}?alt=media&supportsAllDrives=true`   // an uploaded .xlsx
  const res = await fetch(url, { headers: auth })
  if (!res.ok) throw new SheetAccessError(`Google Drive export answered ${res.status}`, 'HTTP')
  return { buf: Buffer.from(await res.arrayBuffer()), title: info.name ?? null }
}

async function downloadPublic(sheetId: string): Promise<Buffer> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, { redirect: 'follow', cache: 'no-store' })
  const type = res.headers.get('content-type') ?? ''
  if (res.status === 401 || res.status === 403 || type.includes('text/html')) {
    throw new SheetAccessError('The sheet is private. In Google Sheets: Share → General access → "Anyone with the link" → Viewer (or set up a service account and share it with that)', 'NOT_SHARED')
  }
  if (res.status === 404) throw new SheetAccessError('No sheet at that link', 'NOT_FOUND')
  if (!res.ok) throw new SheetAccessError(`Google answered ${res.status}`, 'HTTP')
  return Buffer.from(await res.arrayBuffer())
}

// ── Microsoft Graph (OneDrive / SharePoint) ─────────────────────────────────

function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * Resolve the share link to the file and download it. The resolved ids are
 * remembered, so if the share link is later revoked or re-issued the file it
 * pointed at is still reached (the app login can read it without the link).
 */
async function downloadWithGraph(url: string): Promise<{ buf: Buffer; title: string | null; cTag: string | null }> {
  type Item = { id: string; name: string; cTag?: string; eTag?: string; file?: unknown; parentReference?: { driveId?: string } }
  const select = '$select=id,name,cTag,eTag,file,parentReference'
  let item: Item
  try {
    item = await graphFetch<Item>(`/shares/${encodeShareUrl(url)}/driveItem?${select}`)
  } catch (err) {
    const cached = await prisma.systemSetting.findUnique({ where: { key: DRIVER_SYNC_SETTINGS.sheetRef } }).catch(() => null)
    let ref: { driveId?: string; itemId?: string; forUrl?: string } | null = null
    try { ref = cached?.value ? JSON.parse(cached.value) : null } catch { ref = null }
    if (!ref?.driveId || !ref.itemId || ref.forUrl !== url) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/40[134]|accessDenied|itemNotFound|invalidRequest/i.test(msg)) {
        throw new SheetAccessError(`Microsoft Graph could not open the OneDrive link (${msg.slice(0, 160)}). Check the link is a share link to the Excel file itself, inside the aahaas.com tenant.`, 'NOT_SHARED')
      }
      throw err
    }
    item = await graphFetch<Item>(`/drives/${ref.driveId}/items/${ref.itemId}?${select}`)
    item.parentReference = { driveId: ref.driveId }
  }
  const driveId = item.parentReference?.driveId
  if (!driveId || !item.file) throw new SheetAccessError('The OneDrive link points to a folder, not the Excel file — share the workbook itself', 'FORMAT')
  if (!/\.xls[xm]?$/i.test(item.name)) throw new SheetAccessError(`"${item.name}" is not an Excel workbook`, 'FORMAT')
  await prisma.systemSetting.upsert({
    where: { key: DRIVER_SYNC_SETTINGS.sheetRef },
    create: { key: DRIVER_SYNC_SETTINGS.sheetRef, value: JSON.stringify({ driveId, itemId: item.id, forUrl: url }) },
    update: { value: JSON.stringify({ driveId, itemId: item.id, forUrl: url }) },
  }).catch(() => undefined)
  return { buf: await downloadDriveItem(driveId, item.id), title: item.name, cTag: item.cTag ?? item.eTag ?? null }
}

/** Read the Movement Chart behind a link: OneDrive / SharePoint via Graph, else a Google Sheet. */
export async function readMovementSheet(link: string): Promise<SheetRead> {
  if (isMicrosoftLink(link)) {
    const d = await downloadWithGraph(link.trim())
    const parsed = parseMovementWorkbook(d.buf)
    return { ...parsed, source: 'MICROSOFT_GRAPH', title: d.title, hash: createHash('sha256').update(d.buf).digest('hex').slice(0, 32) }
  }
  const sheetId = sheetIdOf(link)
  if (!sheetId) throw new SheetAccessError('The workbook link is not a OneDrive / SharePoint or Google Sheets link', 'NOT_FOUND')
  return readGoogleSheet(sheetId)
}

async function readGoogleSheet(sheetId: string): Promise<SheetRead> {
  const sa = serviceAccount()
  let buf: Buffer
  let title: string | null = null
  let source: SheetRead['source']
  if (sa) {
    try {
      const d = await downloadWithServiceAccount(sheetId, sa)
      buf = d.buf; title = d.title; source = 'SERVICE_ACCOUNT'
    } catch (err) {
      // Not shared with the service account yet — the public link may still work.
      if (!(err instanceof SheetAccessError) || err.code !== 'NOT_SHARED') throw err
      try { buf = await downloadPublic(sheetId) } catch { throw err }
      source = 'PUBLIC_LINK'
    }
  } else {
    buf = await downloadPublic(sheetId)
    source = 'PUBLIC_LINK'
  }
  const parsed = parseMovementWorkbook(buf)
  return { ...parsed, source, title, hash: createHash('sha256').update(buf).digest('hex').slice(0, 32) }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

type Cell = string | number | boolean | Date | null

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const text = (v: Cell | undefined): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return s || null
}

interface Columns {
  date: number; code: number; details: number; meal: number; time: number; service: number; vendor: number
  driver: number; from: number; to: number; location: number; guest: number
}

/** Header text (normalised) → field. The first column that fits wins. */
function mapColumns(header: Cell[]): Columns | null {
  const c: Columns = { date: -1, code: -1, details: -1, meal: -1, time: -1, service: -1, vendor: -1, driver: -1, from: -1, to: -1, location: -1, guest: -1 }
  header.forEach((h, i) => {
    const n = norm(h)
    if (!n) return
    if (c.date < 0 && /^(date|day|servicedate|movementdate)$/.test(n)) c.date = i
    else if (c.code < 0 && /^(code|bookingcode|bookingref|bookingno|ref|tourcode|vncode|fileno)$/.test(n)) c.code = i
    else if (c.details < 0 && /^(tourdetails|details|itinerary|description|activity|program|programme)/.test(n)) c.details = i
    else if (c.meal < 0 && /^meal/.test(n)) c.meal = i
    else if (c.time < 0 && /^(meetingtime|pickuptime|time|pickup)$/.test(n)) c.time = i
    else if (c.service < 0 && /^(servicetype|service|type)$/.test(n)) c.service = i
    else if (c.vendor < 0 && /^(vendors?|supplier|suppliers|transport|transportvendor)$/.test(n)) c.vendor = i
    else if (c.driver < 0 && /^(driver|drivers|driverdetails|drivername|driverinfo|drivercontact)$/.test(n)) c.driver = i
    else if (c.from < 0 && /^(from|pickup|pickuppoint|pickupfrom)$/.test(n)) c.from = i
    else if (c.to < 0 && /^(to|totours?|totour|dropoff|destination|tours?)$/.test(n)) c.to = i
    else if (c.location < 0 && /^(location|city)$/.test(n)) c.location = i
    else if (c.guest < 0 && /^(nameofguests?|guestnames?|guests?|leadguest|paxname|clientname)$/.test(n)) c.guest = i
  })
  return c.date >= 0 && c.code >= 0 && (c.vendor >= 0 || c.driver >= 0) ? c : null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')

function toIsoDate(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    return d && d.y > 2000 ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)            // dd/mm/yyyy — the Vietnam desk's order
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}` }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-,]+(\d{4})/i)    // 30 Sep 2026
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`
  return null
}

/** "9:30", "09.30", "0930", 0.395833 (an Excel time) → "09:30". Anything else is kept as typed. */
export function normTime(v: Cell | string | undefined | null): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60)
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\s*[:.hH]\s*(\d{2})\s*(am|pm)?/i) ?? s.match(/^(\d{2})(\d{2})$/)
  if (!m) return s.slice(0, 32) || null
  let h = +m[1]
  const ap = (m[3] ?? '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return h < 24 && +m[2] < 60 ? `${pad(h)}:${m[2]}` : s.slice(0, 32)
}

const REF_RE = /\bVN\s?-?\d{4,6}\b/gi

/** The desk writes "PVT Transfer", "Own Arr.", "Ticket" — map them to the system's service codes. */
export function sheetServiceCode(raw: string | null): string | null {
  if (!raw) return null
  const direct = normaliseServiceType(raw)
  if (direct && isBuiltInServiceType(direct)) return direct
  const t = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  for (const [code, label] of Object.entries(SERVICE_TYPE_SHORT_LABELS)) if (label.toLowerCase() === t) return code
  const expanded = normaliseServiceType(raw.replace(/\bpvt\b/gi, 'Private').replace(/\bown arr\.?(?=\s|$)/gi, 'Own Arrangement or Booked with another vendor'))
  return expanded ?? direct
}

export function parseMovementWorkbook(buf: Buffer): Omit<SheetRead, 'hash' | 'source' | 'title'> {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const rows: SheetRow[] = []
  const tabs: string[] = []
  const skippedTabs: string[] = []
  const warnings: string[] = []
  // The desk copies rows; an exact copy of a row is one service, not two.
  const seen = new Set<string>()
  let dupes = 0

  for (const tab of wb.SheetNames) {
    const ws = wb.Sheets[tab]
    if (!ws) continue
    const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
    // The header is in the first 10 rows (a title row above it is common).
    let cols: Columns | null = null
    let headerAt = -1
    for (let r = 0; r < Math.min(10, grid.length) && !cols; r++) {
      cols = mapColumns(grid[r] ?? [])
      if (cols) headerAt = r
    }
    if (!cols) { skippedTabs.push(tab); continue }
    tabs.push(tab)

    let lastRefs: string[] = []
    let lastDate: string | null = null
    for (let r = headerAt + 1; r < grid.length; r++) {
      const line = grid[r] ?? []
      const at = (i: number) => (i >= 0 ? line[i] : null)
      const codeText = text(at(cols.code))
      const refsHere = Array.from(new Set((codeText ?? '').match(REF_RE)?.map(x => x.replace(/[\s-]/g, '').toUpperCase()) ?? []))
      const dateHere = toIsoDate(at(cols.date))
      const details = text(at(cols.details))
      const vendor = text(at(cols.vendor))
      const driver = text(at(cols.driver))
      if (!codeText && !dateHere && !details && !vendor && !driver) continue   // blank row
      if (norm(codeText) === 'code' || norm(at(cols.date)) === 'date') continue // a repeated header

      // A merged / left-blank code or date continues the row above.
      const refs = refsHere.length ? refsHere : (codeText ? [] : lastRefs)
      const date = dateHere ?? (refsHere.length && lastRefs.join() !== refsHere.join() ? null : lastDate)
      if (refsHere.length) lastRefs = refsHere
      if (dateHere) lastDate = dateHere
      if (!refs.length) continue

      const service = text(at(cols.service))
      const contact = driver ?? vendor
      const dupKey = [refs.join(), date, details, normTime(at(cols.time)), service, contact].join('\u0001')
      if (seen.has(dupKey)) { dupes++; continue }
      seen.add(dupKey)
      rows.push({
        id: `${tab}!${r + 1}`, tab, row: r + 1, refs, date,
        details, meal: text(at(cols.meal)), time: normTime(at(cols.time)),
        service, serviceCode: sheetServiceCode(service),
        location: text(at(cols.location)), from: text(at(cols.from)), to: text(at(cols.to)),
        route: [text(at(cols.from)), text(at(cols.to))].filter(Boolean).join(' → ') || null,
        guest: text(at(cols.guest)),
        text: vendor, driverText: driver,
        phones: extractPhones(contact),
      })
    }
  }
  if (dupes) warnings.push(`${dupes} exact duplicate row(s) counted once`)
  if (!tabs.length) warnings.push(`No tab has a header row with Date, Code and Vendors (tabs: ${wb.SheetNames.join(', ')})`)
  return { rows, tabs, skippedTabs, warnings }
}
