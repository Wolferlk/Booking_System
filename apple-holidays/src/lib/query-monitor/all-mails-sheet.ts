/**
 * The "All Mails" tab: every message that reached a monitored inbox, unfiltered.
 *
 * Like the daily counts and the AI usage report — and unlike the two query tabs
 * — this one is entirely the app's. Nothing on it is hand-edited, so every
 * export clears it and lays it out again from the log. That is not laziness
 * about appending: a row's Status, SLA and thread summary all move whenever a
 * reply lands, and a ledger that shows half of yesterday's answers as still
 * pending is worse than one that is simply rewritten.
 *
 * It is rewritten at the end of every sweep, so the tab is never more than one
 * sweep behind the mailboxes — and never able to fail the sweep that writes it.
 */
import { graphFetch } from '@/lib/graph-client'
import { getConfig, getSetting, setSetting } from './config'
import {
  ALL_MAILS_FIRST_COLUMN, ALL_MAILS_LAST_COLUMN, ALL_MAILS_NUMBER_FORMATS,
  ALL_MAILS_SHEET_COLUMNS, SETTINGS,
} from './constants'
import { backfillMailLog } from './mail-log'
import {
  closeSession, openSession, resolveSheetRef,
  type SheetRef, type WorkbookTarget,
} from './sheet'
import {
  allMailsRowToCells, getAllMailsReport, MAX_ALL_MAILS_ROWS, type AllMailsReport,
} from './all-mails'

const FIRST_COLUMN = ALL_MAILS_FIRST_COLUMN
const LAST_COLUMN  = ALL_MAILS_LAST_COLUMN
const COLUMNS      = ALL_MAILS_SHEET_COLUMNS.length

/** Rows above the first mail: the title, the window, and the header. */
const HEADER_ROWS = 4

type Cell = string | number

export interface AllMailsSheetResult {
  target:    WorkbookTarget
  fileName:  string
  webUrl:    string
  sheetName: string
  /** Mail rows written, header excluded. */
  rows:      number
  error?:    string
}

// ── Graph plumbing ───────────────────────────────────────────────────────────

function worksheetPath(ref: SheetRef, sheetName: string): string {
  return `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')`
}

function call<T>(path: string, sessionId: string | null, opts: RequestInit = {}): Promise<T> {
  return graphFetch<T>(path, {
    ...opts,
    headers: { ...(sessionId ? { 'workbook-session-id': sessionId } : {}), ...(opts.headers ?? {}) },
  })
}

/**
 * Create the tab if the workbook has never had one, and say whether it had to.
 *
 * The caller needs the answer: a tab this call just created is unambiguously
 * ours and can be written without further question, and a tab that was already
 * there has to prove it is ours before anything is cleared. See `assertOurs`.
 */
async function ensureTab(
  ref: SheetRef, sheetName: string, sessionId: string | null,
): Promise<{ created: boolean }> {
  const sheets = await call<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
    sessionId,
  )
  if ((sheets.value ?? []).some(w => w.name.toLowerCase() === sheetName.toLowerCase())) {
    return { created: false }
  }

  await call(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/add`,
    sessionId,
    { method: 'POST', body: JSON.stringify({ name: sheetName }) },
  )
  return { created: true }
}

/** What cell A1 of this tab says when the tab is ours. See `assertOurs`. */
const OWNERSHIP_MARK = 'Every mail that reached the monitored mailboxes'

/**
 * Refuse to clear a tab this app does not own.
 *
 * Everything below this point clears several thousand cells and lays them out
 * again, and the tab it does that to is named by a setting somebody can type
 * into. The settings API already refuses a name that collides with one of the
 * other four tabs, but it cannot know what else is in the team's workbook — a
 * pivot sheet, a lookup list, a month's hand-kept notes. Typing that tab's name
 * here must not be able to erase it.
 *
 * So the tab has to be one of three things: just created by this export, empty,
 * or already carrying the title this export writes into A1. Anything else stops
 * with a message naming the tab, and the sweep logs it as a warning rather than
 * touching the file.
 */
async function assertOurs(
  ref: SheetRef, sheetName: string, sessionId: string | null, created: boolean,
): Promise<void> {
  if (created) return

  const range = await call<{ values?: unknown[][] }>(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent('A1:A1')}')?$select=values`,
    sessionId,
  )
  const a1 = String(range.values?.[0]?.[0] ?? '').trim()
  if (!a1 || a1.startsWith(OWNERSHIP_MARK)) return

  throw new Error(
    `"${sheetName}" already exists in ${ref.fileName} and is not this app's tab — `
    + `cell A1 reads "${a1.slice(0, 60)}". Nothing was written. Point the all-mail tab `
    + 'at a different name, or rename that worksheet, and run it again.',
  )
}

async function writeRange(
  ref: SheetRef, sheetName: string, address: string, sessionId: string | null,
  body: Record<string, unknown>,
): Promise<void> {
  await call(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
    sessionId, { method: 'PATCH', body: JSON.stringify(body) },
  )
}

/** Cosmetic — never allowed to fail the export. */
async function styleRange(
  ref: SheetRef, sheetName: string, address: string, sessionId: string | null,
  part: 'font' | 'fill', body: Record<string, unknown>,
): Promise<void> {
  await call(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')/format/${part}`,
    sessionId, { method: 'PATCH', body: JSON.stringify(body) },
  ).catch(() => {})
}

// ── Layout ───────────────────────────────────────────────────────────────────

const GENERAL = Array<string>(COLUMNS).fill('General')

/** Pad or trim a row to exactly the tab's width. */
function fit<T>(row: T[], filler: T): T[] {
  return [...row, ...Array<T>(Math.max(0, COLUMNS - row.length)).fill(filler)].slice(0, COLUMNS)
}

/**
 * The whole tab in memory, laid out before anything is sent.
 *
 * Two facts belong on it in words rather than in a column, because they are the
 * two ways somebody reads this tab and reaches a wrong conclusion: that it is
 * one row per *mail* (so the same subject appearing four times is four mails,
 * not a bug), and how far back it reaches (so an absent mail is understood as
 * out of the window rather than as missing).
 */
function compose(report: AllMailsReport, timezone: string): { cells: Cell[][]; formats: string[][] } {
  const cells:   Cell[][]   = []
  const formats: string[][] = []

  const push = (row: Cell[], fmt: string[] = GENERAL) => {
    cells.push(fit<Cell>(row, ''))
    formats.push(fit(fmt, 'General'))
  }

  const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', {
    timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  const t = report.totals
  push([`${OWNERSHIP_MARK} — nothing filtered out`])
  push([
    `${stamp(report.from)} → ${stamp(report.to)} (${report.days} days, ${timezone}) · `
    + `rewritten ${stamp(report.generatedAt)}`,
  ])
  push([
    `${t.total} mail(s): ${t.useful} usefull (from a sender the rules know), `
    + `${t.total - t.useful} not. ${t.queries} opened a query, ${t.followUps} chased one, `
    + `${t.other} were other mail, ${t.internal} internal, ${t.automated} automated`
    + (report.truncated > 0
      ? ` — the oldest ${report.truncated} are not shown, the tab holds ${MAX_ALL_MAILS_ROWS} rows`
      : '')
    + '. One row per mail, oldest first — the same subject four times is four mails. '
    + 'Rewritten in full after every sweep — do not edit this tab.',
  ])
  push([...ALL_MAILS_SHEET_COLUMNS])

  const rowFormats = [...ALL_MAILS_NUMBER_FORMATS]
  for (const row of report.rows) push(allMailsRowToCells(row), rowFormats)

  return { cells, formats }
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Cleared before every rewrite, and always at least as tall as the tallest tab
 * this export has ever written: a clear that stops short leaves yesterday's
 * longer ledger showing underneath today's shorter one.
 */
const CLEAR_RANGE = `${FIRST_COLUMN}1:${LAST_COLUMN}${MAX_ALL_MAILS_ROWS + HEADER_ROWS + 100}`

async function writeOne(
  target: WorkbookTarget, sheetName: string, report: AllMailsReport, timezone: string,
): Promise<AllMailsSheetResult> {
  const ref = await resolveSheetRef(false, target)
  const base: AllMailsSheetResult = {
    target, fileName: ref.fileName, webUrl: ref.webUrl, sheetName, rows: 0,
  }

  const sessionId = await openSession(ref)
  try {
    const { created } = await ensureTab(ref, sheetName, sessionId)
    // Nothing below here runs against a tab that is not ours.
    await assertOurs(ref, sheetName, sessionId, created)

    await call(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(CLEAR_RANGE)}')/clear`,
      sessionId, { method: 'POST', body: JSON.stringify({ applyTo: 'All' }) },
    ).catch(() => {})

    const { cells, formats } = compose(report, timezone)

    // 200 rows a call: a few thousand mails in one PATCH is a payload Graph
    // refuses outright, and a refused write means no ledger at all.
    const CHUNK = 200
    for (let start = 0; start < cells.length; start += CHUNK) {
      const slice = cells.slice(start, start + CHUNK)
      await writeRange(
        ref, sheetName,
        `${FIRST_COLUMN}${start + 1}:${LAST_COLUMN}${start + slice.length}`,
        sessionId,
        { values: slice, numberFormat: formats.slice(start, start + CHUNK) },
      )
    }

    await styleRange(ref, sheetName, `${FIRST_COLUMN}1:${LAST_COLUMN}1`, sessionId, 'font', {
      bold: true, size: 12, color: '#0F766E',
    })
    const headerRow = `${FIRST_COLUMN}${HEADER_ROWS}:${LAST_COLUMN}${HEADER_ROWS}`
    await styleRange(ref, sheetName, headerRow, sessionId, 'font', { bold: true })
    await styleRange(ref, sheetName, headerRow, sessionId, 'fill', { color: '#F1F5F9' })

    // The header row freezes so a scroll down the ledger keeps its column names.
    await call(`${worksheetPath(ref, sheetName)}/freezePanes/freezeRows`, sessionId, {
      method: 'POST', body: JSON.stringify({ count: HEADER_ROWS }),
    }).catch(() => {})

    return { ...base, rows: report.rows.length }
  } finally {
    await closeSession(ref, sessionId)
  }
}

/**
 * Rewrite the all-mail tab on the live workbook, and on the standby copy when
 * the mirror is switched on. A failure on the backup is reported but never
 * fails the export — the workbook the team reads is the one that matters.
 */
/**
 * Seed the log from the entries that predate it, once.
 *
 * The log only knows what it has watched arrive, so on the first export the tab
 * would start at today and show nothing behind it — on a workbook the team has
 * already been reading for weeks, that reads as a broken tab rather than a new
 * one. Seeding recovers every mail that became a query or an other-mail row.
 *
 * What it cannot recover is internal and automated mail from before the switch:
 * no entry was ever made for it. So the seeded stretch is "everything the sheets
 * already showed", and only the days from here on carry the full picture.
 */
async function backfillOnce(): Promise<number> {
  if (await getSetting(SETTINGS.allMailsBackfilled)) return 0
  const seeded = await backfillMailLog()
  await setSetting(SETTINGS.allMailsBackfilled, new Date().toISOString())
  return seeded
}

export async function exportAllMailsToSheet(days?: number): Promise<{
  sheetName: string
  days:      number
  report:    AllMailsReport
  workbooks: AllMailsSheetResult[]
}> {
  const cfg       = await getConfig()
  await backfillOnce().catch(() => { /* a failed seed must not cost the export */ })
  const report    = await getAllMailsReport(days)
  const sheetName = cfg.allMailsSheetName
  const timezone  = process.env.QUERY_MONITOR_TZ || 'Asia/Colombo'

  const workbooks: AllMailsSheetResult[] = []
  workbooks.push(await writeOne('primary', sheetName, report, timezone))

  if (cfg.backupEnabled && cfg.backupSheetUrl) {
    try {
      workbooks.push(await writeOne('backup', sheetName, report, timezone))
    } catch (err) {
      workbooks.push({
        target: 'backup', fileName: '—', webUrl: '', sheetName, rows: 0,
        error: err instanceof Error ? err.message : 'Backup workbook write failed',
      })
    }
  }

  return { sheetName, days: report.days, report, workbooks }
}
