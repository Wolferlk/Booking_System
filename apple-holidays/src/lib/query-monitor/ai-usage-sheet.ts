/**
 * The "AI Usage" tab: OpenAI spend written into the SharePoint workbook, with
 * real Excel charts rather than a picture of one.
 *
 * Unlike the query tabs — which are appended to, never rewritten, because the
 * team types into them — this tab is entirely the app's. Nothing on it is
 * hand-edited, so every export clears it and lays it out again: the numbers move
 * on every sweep and a stale half of a report is worse than no report.
 *
 * Charts are created through the workbook's own chart API, so they stay live in
 * Excel and on the web — click a bar and the source cells highlight. Each one is
 * sourced from a contiguous two-column range (period + dollars); that is the one
 * shape the chart API reads without ambiguity about which column is the category
 * axis and which is the series.
 */
import { graphFetch } from '@/lib/graph-client'
import { getConfig } from './config'
import {
  closeSession, openSession, resolveSheetRef,
  type SheetRef, type WorkbookTarget,
} from './sheet'
import { getAiUsageStats, type AiUsageStats, type UsageBucket, type UsageScope } from './ai-usage'

/** Rows are written into A–F; charts float over H–Q. */
const FIRST_COLUMN = 'A'
const LAST_COLUMN  = 'F'
const CHART_FIRST_COLUMN = 'H'
const CHART_LAST_COLUMN  = 'Q'

/** Cleared before every rewrite — comfortably past anything we lay down. */
const CLEAR_RANGE = 'A1:Z400'

/** Sections are padded to this height so one block's chart clears the next. */
const MIN_SECTION_ROWS = 16

const BLOCK_HEADER = ['Period', 'Cost (USD)', 'Calls', 'Total Tokens', 'Prompt Tokens', 'Completion Tokens']
const BLOCK_FORMATS = ['General', '0.0000', '#,##0', '#,##0', '#,##0', '#,##0']

type Cell = string | number

interface ChartSpec {
  /** Excel chart type — `ColumnClustered`, `Line`, `Pie`. */
  type:       string
  title:      string
  /** Address of the label+value block, header row included. */
  sourceData: string
  startCell:  string
  endCell:    string
}

export interface AiUsageSheetResult {
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
  const exists = (sheets.value ?? []).some(w => w.name.toLowerCase() === sheetName.toLowerCase())
  if (exists) return

  await call(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/add`,
    sessionId,
    { method: 'POST', body: JSON.stringify({ name: sheetName }) },
  )
}

/**
 * Charts are objects on the sheet, not cell contents — clearing the range leaves
 * them behind. Without this the tab would gain five more charts every export.
 */
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
      {
        method: 'POST',
        body: JSON.stringify({ type: spec.type, sourceData: spec.sourceData, seriesBy: 'Columns' }),
      },
    )

    const chartPath = `${worksheetPath(ref, sheetName)}/charts('${encodeURIComponent(chart.id)}')`

    await call(`${chartPath}/setPosition`, sessionId, {
      method: 'POST',
      body: JSON.stringify({ startCell: spec.startCell, endCell: spec.endCell }),
    }).catch(() => {})

    await call(`${chartPath}/title`, sessionId, {
      method: 'PATCH',
      body: JSON.stringify({ text: spec.title, visible: true, overlay: false }),
    }).catch(() => {})

    return true
  } catch {
    // A workbook that refuses charts still gets its tables — the dollar figures
    // are the point, the pictures are the presentation.
    return false
  }
}

// ── Report layout ────────────────────────────────────────────────────────────

const money = (n: number) => Number(n.toFixed(6))

function bucketRow(bucket: UsageBucket): Cell[] {
  return [
    bucket.periodLabel,
    money(bucket.costUsd),
    bucket.calls,
    bucket.totalTokens,
    bucket.promptTokens,
    bucket.completionTokens,
  ]
}

interface Block {
  title:     string
  chartType: string
  rows:      Cell[][]
}

function buildBlocks(stats: AiUsageStats): Block[] {
  const w = stats.windows
  return [
    {
      title:     `Hourly — last ${w.hourly} hours`,
      chartType: 'Line',
      rows:      stats.series.hourly.map(bucketRow),
    },
    {
      title:     `Daily — last ${w.daily} days`,
      chartType: 'ColumnClustered',
      rows:      stats.series.daily.map(bucketRow),
    },
    {
      title:     `Weekly — last ${w.weekly} weeks (Monday start)`,
      chartType: 'ColumnClustered',
      rows:      stats.series.weekly.map(bucketRow),
    },
    {
      title:     `Monthly — last ${w.monthly} months`,
      chartType: 'ColumnClustered',
      rows:      stats.series.monthly.map(bucketRow),
    },
    {
      title:     `By call type — last ${w.daily} days`,
      chartType: 'Pie',
      rows: stats.byCallType.length > 0
        ? stats.byCallType.map(t => ([
            `${t.label} (${t.model})`, money(t.costUsd), t.calls, t.totalTokens, 0, 0,
          ] as Cell[]))
        : [['No calls in the window', 0, 0, 0, 0, 0] as Cell[]],
    },
  ]
}

/**
 * Lay the whole report out in memory first: the workbook is written in a handful
 * of large PATCHes rather than one per row, and the charts need to know the exact
 * addresses the blocks landed on.
 */
function composeReport(stats: AiUsageStats, scopeLabel: string): {
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

  const plain = () => [...BLOCK_FORMATS.map(() => 'General')]
  const push = (row: Cell[], fmt: string[] = plain()) => {
    cells.push([...row, ...Array(BLOCK_FORMATS.length - row.length).fill('')].slice(0, BLOCK_FORMATS.length))
    formats.push(fmt)
    return cells.length // 1-based row number on the sheet
  }

  const generated = new Date(stats.generatedAt).toLocaleString('en-GB', {
    timeZone: stats.timezone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  titleRows.push(push([`OpenAI usage — ${scopeLabel}`]))
  push([`Generated ${generated} (${stats.timezone}) · rewritten by the Query Monitor on every export — do not edit this tab`])
  push([])

  // Summary — the four grains as single numbers, above the series they come from.
  titleRows.push(push(['Summary']))
  boldRows.push(push(BLOCK_HEADER))
  const t = stats.totals
  for (const [label, totals] of [
    ['This hour',  t.hour],
    ['Today',      t.today],
    ['This week',  t.week],
    ['This month', t.month],
    ['All time',   t.allTime],
  ] as const) {
    push(
      [label, money(totals.costUsd), totals.calls, totals.totalTokens, totals.promptTokens, totals.completionTokens],
      [...BLOCK_FORMATS],
    )
  }
  push([])

  for (const block of buildBlocks(stats)) {
    const sectionRow = push([block.title])
    titleRows.push(sectionRow)

    const headerRow = push(BLOCK_HEADER)
    boldRows.push(headerRow)

    for (const row of block.rows) push(row, [...BLOCK_FORMATS])
    const lastRow = cells.length

    charts.push({
      type:       block.chartType,
      title:      `${block.title} — USD`,
      sourceData: `${FIRST_COLUMN}${headerRow}:B${lastRow}`,
      startCell:  `${CHART_FIRST_COLUMN}${sectionRow}`,
      endCell:    `${CHART_LAST_COLUMN}${sectionRow + Math.max(MIN_SECTION_ROWS, block.rows.length + 2) - 1}`,
    })

    // Pad the section so the next block's chart starts below this one's.
    const used = cells.length - sectionRow + 1
    for (let i = used; i < MIN_SECTION_ROWS + 1; i += 1) push([])
    push([])
  }

  return { cells, formats, boldRows, titleRows, charts }
}

// ── Export ───────────────────────────────────────────────────────────────────

async function writeOne(
  target: WorkbookTarget, sheetName: string, stats: AiUsageStats, scopeLabel: string,
): Promise<AiUsageSheetResult> {
  const ref = await resolveSheetRef(false, target)
  const base: AiUsageSheetResult = {
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

    const { cells, formats, boldRows, titleRows, charts } = composeReport(stats, scopeLabel)

    // One PATCH for the whole grid: Graph is happy with a few hundred rows and
    // this is a single round-trip instead of one per section.
    await writeRange(
      ref, sheetName, `${FIRST_COLUMN}1:${LAST_COLUMN}${cells.length}`, sessionId,
      { values: cells, numberFormat: formats },
    )

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
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(`${FIRST_COLUMN}1:${FIRST_COLUMN}1`)}')/format`,
      sessionId, { method: 'PATCH', body: JSON.stringify({ columnWidth: 190 }) },
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
 * Rewrite the usage tab on the live workbook, and on the standby copy when the
 * mirror is switched on. A failure on the backup is reported but never fails the
 * export — the workbook the team reads is the one that matters.
 */
export async function exportAiUsageToSheet(
  scope: UsageScope = 'qm',
): Promise<{ scope: UsageScope; sheetName: string; workbooks: AiUsageSheetResult[] }> {
  const cfg   = await getConfig()
  const stats = await getAiUsageStats(scope)
  const sheetName = cfg.aiUsageSheetName
  const scopeLabel = scope === 'qm' ? 'Booking Team Query Monitor' : 'All AppleHolidays AI'

  const workbooks: AiUsageSheetResult[] = []
  workbooks.push(await writeOne('primary', sheetName, stats, scopeLabel))

  if (cfg.backupEnabled && cfg.backupSheetUrl) {
    try {
      workbooks.push(await writeOne('backup', sheetName, stats, scopeLabel))
    } catch (err) {
      workbooks.push({
        target: 'backup', fileName: '—', webUrl: '', sheetName, rows: 0, charts: 0,
        error: err instanceof Error ? err.message : 'Backup workbook write failed',
      })
    }
  }

  return { scope, sheetName, workbooks }
}
