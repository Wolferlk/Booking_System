/**
 * The "Daily Mail Stats" tab: how much mail reached each monitored address each
 * day, split into the mail that was a query and the mail that was not.
 *
 * Like the AI Usage tab and unlike the two query tabs, this one is entirely the
 * app's. Nothing on it is hand-edited, so every export clears it and lays it out
 * again from the database — the counts move with every sweep, and half a stale
 * report is worse than no report. That is also why it can carry real Excel
 * charts: there is nothing of the team's underneath them to disturb.
 *
 * Three blocks, in the order the questions get asked:
 *   1. **Per mailbox** over the window — who is carrying the volume.
 *   2. **Per day**, all addresses together — is today heavier than yesterday.
 *   3. **Per day and mailbox** — the detail the first two are made of, which is
 *      what a pivot table gets pointed at.
 */
import { graphFetch } from '@/lib/graph-client'
import { getConfig } from './config'
import {
  DAILY_STATS_FIRST_COLUMN, DAILY_STATS_LAST_COLUMN, DAILY_STATS_NUMBER_FORMATS,
} from './constants'
import { toExcelDateSerial } from './dates'
import {
  closeSession, openSession, resolveSheetRef,
  type SheetRef, type WorkbookTarget,
} from './sheet'
import { getDailyMailStats, type DailyMailStats } from './daily-stats'

const FIRST_COLUMN = DAILY_STATS_FIRST_COLUMN
const LAST_COLUMN  = DAILY_STATS_LAST_COLUMN
const COLUMNS      = DAILY_STATS_NUMBER_FORMATS.length

/** Charts float to the right of the numbers. */
const CHART_FIRST_COLUMN = 'K'
const CHART_LAST_COLUMN  = 'T'

/**
 * Cleared before every rewrite. Generous on purpose: 180 days × 8 addresses is
 * about 1 500 rows, and a clear that stops short leaves yesterday's longer
 * report showing underneath today's shorter one.
 */
const CLEAR_RANGE = 'A1:T2000'

type Cell = string | number

interface ChartSpec {
  type:       string
  title:      string
  sourceData: string
  startCell:  string
  endCell:    string
}

export interface DailyStatsSheetResult {
  target:    WorkbookTarget
  fileName:  string
  webUrl:    string
  sheetName: string
  rows:      number
  charts:    number
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

/** Create the tab if the workbook has never had one. It is ours alone. */
async function ensureTab(ref: SheetRef, sheetName: string, sessionId: string | null): Promise<void> {
  const sheets = await call<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
    sessionId,
  )
  if ((sheets.value ?? []).some(w => w.name.toLowerCase() === sheetName.toLowerCase())) return

  await call(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/add`,
    sessionId,
    { method: 'POST', body: JSON.stringify({ name: sheetName }) },
  )
}

/** Charts are objects, not cell contents — clearing the range leaves them behind. */
async function removeCharts(ref: SheetRef, sheetName: string, sessionId: string | null): Promise<void> {
  const charts = await call<{ value: { id: string }[] }>(
    `${worksheetPath(ref, sheetName)}/charts?$select=id`, sessionId,
  ).catch(() => ({ value: [] as { id: string }[] }))

  for (const chart of charts.value ?? []) {
    await call(
      `${worksheetPath(ref, sheetName)}/charts('${encodeURIComponent(chart.id)}')`,
      sessionId, { method: 'DELETE' },
    ).catch(() => { /* a chart we cannot delete must not stop the numbers landing */ })
  }
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

async function addChart(
  ref: SheetRef, sheetName: string, sessionId: string | null, spec: ChartSpec,
): Promise<boolean> {
  try {
    const chart = await call<{ id: string }>(
      `${worksheetPath(ref, sheetName)}/charts/add`,
      sessionId,
      { method: 'POST', body: JSON.stringify({ type: spec.type, sourceData: spec.sourceData, seriesBy: 'Columns' }) },
    )
    const chartPath = `${worksheetPath(ref, sheetName)}/charts('${encodeURIComponent(chart.id)}')`

    await call(`${chartPath}/setPosition`, sessionId, {
      method: 'POST', body: JSON.stringify({ startCell: spec.startCell, endCell: spec.endCell }),
    }).catch(() => {})

    await call(`${chartPath}/title`, sessionId, {
      method: 'PATCH', body: JSON.stringify({ text: spec.title, visible: true, overlay: false }),
    }).catch(() => {})

    return true
  } catch {
    // A workbook that refuses charts still gets its tables — the counts are the
    // point, the pictures are the presentation.
    return false
  }
}

// ── Report layout ────────────────────────────────────────────────────────────

const rate = (replied: number, useful: number) => (useful > 0 ? replied / useful : '')

/**
 * Lay the whole report out in memory first: the workbook is written in a couple
 * of large PATCHes rather than one per row, and the charts need to know the
 * exact addresses the blocks landed on.
 */
function composeReport(stats: DailyMailStats): {
  cells: Cell[][]
  formats: string[][]
  boldRows: number[]
  titleRows: number[]
  charts: ChartSpec[]
} {
  const cells:   Cell[][]   = []
  const formats: string[][] = []
  const boldRows:  number[] = []
  const titleRows: number[] = []
  const charts: ChartSpec[] = []

  const general = () => Array<string>(COLUMNS).fill('General')

  const push = (row: Cell[], fmt: string[] = general()) => {
    cells.push([...row, ...Array<Cell>(Math.max(0, COLUMNS - row.length)).fill('')].slice(0, COLUMNS))
    formats.push([...fmt, ...Array<string>(Math.max(0, COLUMNS - fmt.length)).fill('General')].slice(0, COLUMNS))
    return cells.length // 1-based row number on the sheet
  }

  const generated = new Date(stats.generatedAt).toLocaleString('en-GB', {
    timeZone: stats.timezone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  // Text formats for the two blocks that are keyed by a label rather than a date.
  const labelFormats = ['General', 'General', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '0%']
  const dateFormats  = [...DAILY_STATS_NUMBER_FORMATS]

  titleRows.push(push(['Daily mail counts — Booking Team Query Monitor']))
  push([`${stats.from} → ${stats.to} (${stats.days} days, ${stats.timezone}) · generated ${generated}`])
  push(['Rewritten in full by the Query Monitor on every export — do not edit this tab'])
  push([])
  push([
    'One mail counted once per address it reached: a mail to five handlers is five mails here and one row on the query sheet. '
    + '"Useful" became a query; "Other mail" went to the other-mail tab (vouchers, on-ground, avail checks, mailer noise).',
  ])
  push([])

  // ── Whole window ──────────────────────────────────────────────────────────
  titleRows.push(push(['Total for the window']))
  boldRows.push(push(['Period', 'Mailbox', 'Total mails', 'Useful (queries)', 'Other mail', 'Replied', 'Awaiting reply', 'Answered by them', 'Reply rate']))
  const t = stats.totals
  push(
    [`${stats.days} days`, 'All addresses', t.total, t.useful, t.other, t.replied, t.awaiting, '', rate(t.replied, t.useful)],
    labelFormats,
  )
  push([`Distinct queries in the window (one per query, however many inboxes it reached): ${t.queries}`])
  push([])

  // ── Per mailbox ───────────────────────────────────────────────────────────
  const summaryTitle = push(['Per mailbox'])
  titleRows.push(summaryTitle)
  const summaryHeader = push(['Period', 'Mailbox', 'Total mails', 'Useful (queries)', 'Other mail', 'Replied', 'Awaiting reply', 'Answered by them', 'Reply rate'])
  boldRows.push(summaryHeader)

  const summaryRows = stats.summary.filter(s => s.total > 0 || s.isActive)
  for (const s of summaryRows) {
    push(
      [
        `${stats.days} days`,
        s.mailbox + (s.isAlias ? ' (group)' : '') + (s.isActive ? '' : ' — off'),
        s.total, s.useful, s.other, s.replied, s.awaiting, s.answeredByThem,
        rate(s.replied, s.useful),
      ],
      labelFormats,
    )
  }
  if (summaryRows.length === 0) push(['—', 'No mail in the window', 0, 0, 0, 0, 0, 0, ''], labelFormats)

  // Sourced from B (mailbox) + C (total): the chart API reads a contiguous
  // label+value pair without ambiguity about which column is the category axis.
  charts.push({
    type:       'ColumnClustered',
    title:      `Mail per address — last ${stats.days} days`,
    sourceData: `B${summaryHeader}:C${cells.length}`,
    startCell:  `${CHART_FIRST_COLUMN}${summaryTitle}`,
    endCell:    `${CHART_LAST_COLUMN}${summaryTitle + Math.max(16, summaryRows.length + 3)}`,
  })
  push([])

  // ── Per day ───────────────────────────────────────────────────────────────
  const dailyTitle = push(['Per day — all addresses'])
  titleRows.push(dailyTitle)
  const dailyHeader = push(['Date', 'Distinct queries', 'Total mails', 'Useful (queries)', 'Other mail', 'Replied', 'Awaiting reply', '', 'Reply rate'])
  boldRows.push(dailyHeader)

  for (const d of stats.daily) {
    push(
      [
        toExcelDateSerial(new Date(`${d.day}T12:00:00Z`)),
        d.queries, d.total, d.useful, d.other, d.replied, d.awaiting, '',
        rate(d.replied, d.useful),
      ],
      dateFormats,
    )
  }
  if (stats.daily.length === 0) push(['', 0, 0, 0, 0, 0, 0, '', ''], dateFormats)

  // One contiguous block — A is the category axis, B–E the series. The chart API
  // reads a multi-area address inconsistently, so the layout is arranged to make
  // the range contiguous instead of asking it to.
  charts.push({
    type:       'Line',
    title:      `Mail per day — last ${stats.days} days`,
    sourceData: `A${dailyHeader}:E${cells.length}`,
    startCell:  `${CHART_FIRST_COLUMN}${dailyTitle}`,
    endCell:    `${CHART_LAST_COLUMN}${dailyTitle + Math.max(18, stats.daily.length + 3)}`,
  })
  push([])

  // ── Per day and mailbox ───────────────────────────────────────────────────
  titleRows.push(push(['Per day and address — the detail, ready to pivot']))
  boldRows.push(push(['Date', 'Mailbox', 'Total mails', 'Useful (queries)', 'Other mail', 'Replied', 'Awaiting reply', 'Answered by them', 'Reply rate']))

  for (const c of stats.perMailbox) {
    push(
      [
        toExcelDateSerial(new Date(`${c.day}T12:00:00Z`)),
        c.mailbox + (c.isAlias ? ' (group)' : ''),
        c.total, c.useful, c.other, c.replied, c.awaiting, c.answeredByThem,
        rate(c.replied, c.useful),
      ],
      dateFormats,
    )
  }
  if (stats.perMailbox.length === 0) push(['', 'No mail in the window', 0, 0, 0, 0, 0, 0, ''], dateFormats)

  return { cells, formats, boldRows, titleRows, charts }
}

// ── Export ───────────────────────────────────────────────────────────────────

async function writeOne(
  target: WorkbookTarget, sheetName: string, stats: DailyMailStats,
): Promise<DailyStatsSheetResult> {
  const ref = await resolveSheetRef(false, target)
  const base: DailyStatsSheetResult = {
    target, fileName: ref.fileName, webUrl: ref.webUrl, sheetName, rows: 0, charts: 0,
  }

  const sessionId = await openSession(ref)
  try {
    await ensureTab(ref, sheetName, sessionId)
    await removeCharts(ref, sheetName, sessionId)

    await call(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(CLEAR_RANGE)}')/clear`,
      sessionId, { method: 'POST', body: JSON.stringify({ applyTo: 'All' }) },
    ).catch(() => {})

    const { cells, formats, boldRows, titleRows, charts } = composeReport(stats)

    // Written in chunks: a year of days × eight addresses is a payload Graph
    // will refuse in one PATCH, and a refused write means no report at all.
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

    for (const row of titleRows) {
      await styleRange(ref, sheetName, `${FIRST_COLUMN}${row}:${LAST_COLUMN}${row}`, sessionId, 'font', {
        bold: true, size: 12, color: '#0F766E',
      })
    }
    for (const row of boldRows) {
      await styleRange(ref, sheetName, `${FIRST_COLUMN}${row}:${LAST_COLUMN}${row}`, sessionId, 'font', { bold: true })
      await styleRange(ref, sheetName, `${FIRST_COLUMN}${row}:${LAST_COLUMN}${row}`, sessionId, 'fill', { color: '#F1F5F9' })
    }

    await call(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent('A1:B1')}')/format`,
      sessionId, { method: 'PATCH', body: JSON.stringify({ columnWidth: 150 }) },
    ).catch(() => {})

    let drawn = 0
    for (const spec of charts) {
      if (await addChart(ref, sheetName, sessionId, spec)) drawn += 1
    }

    return { ...base, rows: cells.length, charts: drawn }
  } finally {
    await closeSession(ref, sessionId)
  }
}

/**
 * Rewrite the daily counts tab on the live workbook, and on the standby copy
 * when the mirror is switched on. A failure on the backup is reported but never
 * fails the export — the workbook the team reads is the one that matters.
 */
export async function exportDailyStatsToSheet(
  days?: number,
): Promise<{ sheetName: string; days: number; stats: DailyMailStats; workbooks: DailyStatsSheetResult[] }> {
  const cfg   = await getConfig()
  const window = days ?? cfg.dailyStatsDays
  const stats = await getDailyMailStats(window)
  const sheetName = cfg.dailyStatsSheetName

  const workbooks: DailyStatsSheetResult[] = []
  workbooks.push(await writeOne('primary', sheetName, stats))

  if (cfg.backupEnabled && cfg.backupSheetUrl) {
    try {
      workbooks.push(await writeOne('backup', sheetName, stats))
    } catch (err) {
      workbooks.push({
        target: 'backup', fileName: '—', webUrl: '', sheetName, rows: 0, charts: 0,
        error: err instanceof Error ? err.message : 'Backup workbook write failed',
      })
    }
  }

  return { sheetName, days: stats.days, stats, workbooks }
}
