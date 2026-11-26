/**
 * MC Excel Feed — one sync (or a preview of one).
 *
 *   1. resolve the workbook; refuse a workbook other features read from;
 *   2. read the feed tab (header found by its text, anywhere in the top 10 rows);
 *   3. load what OPS says (source.ts) and the per-booking memory (config.ts);
 *   4. plan (plan.ts) — the preview stops here and writes nothing at all;
 *   5. carry the plan out: cell updates first, then new rows bottom-up so the
 *      planned row numbers stay true; then remember what is on the sheet.
 *
 * A failure part-way leaves the sheet consistent enough for the next run to
 * finish the job: every step is "make the cell hold X", and the memory is only
 * moved on after the whole plan went through.
 */
import { randomUUID } from 'crypto'
import { buildPlan, findHeaderRow, insertWrites, mapHeader, type FeedPlan, type HeaderMap } from './plan'
import { loadFeed, usedListValues } from './source'
import {
  feedLockHeldSince, getFeedConfig, readAliases, readWritten, recordFeedRun, releaseFeedLock,
  saveWritten, setFeedProgress, sheetKeyOf, takeFeedLock,
} from './config'
import {
  addTab, closeSession, freezeHeader, greyRows, insertRows, listTabs, openSession, plainRows, readGrid,
  resolveFeedWorkbook, setColumnWidths, uploadWorkbook, workbookIsEmpty, writeBlock, writeHeader,
  WorkbookError, type FeedSheetRef,
} from './workbook'
import { buildFeedWorkbook } from './template'
import { EMPTY_COUNTS, FEED_COLUMNS, type FeedConfig, type FeedCounts, type FeedRun, type PlanSample } from './shared'

export interface SheetStatus {
  file: { name: string; webUrl: string; lastModified: string | null } | null
  tabExists: boolean
  tabs: string[]
  headerRow: number | null
  header: Pick<HeaderMap, 'missing' | 'missingOps' | 'missingRequired' | 'duplicateHeaders'> | null
  dataRows: number
  error: string | null
}

export interface FeedResult {
  run: FeedRun
  sheet: SheetStatus
  samples: PlanSample[]
  plan: { inserts: number; insertBlocks: number; writes: number } | null
}

// ── Reading ──────────────────────────────────────────────────────────────────

interface Loaded {
  ref: FeedSheetRef
  tabs: string[]
  tabExists: boolean
  grid: unknown[][]
  headerIndex: number   // 0-based row in grid, -1 when none
  header: HeaderMap | null
}

async function loadSheet(config: FeedConfig, session: string | null, known?: FeedSheetRef): Promise<Loaded> {
  const ref = known ?? await resolveFeedWorkbook(config.sheetUrl)
  const tabs = await listTabs(ref, session)
  const tabName = tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase())
  if (!tabName) return { ref, tabs, tabExists: false, grid: [], headerIndex: -1, header: null }
  const grid = await readGrid(ref, tabName, session)
  const headerIndex = findHeaderRow(grid)
  return { ref, tabs, tabExists: true, grid, headerIndex, header: headerIndex >= 0 ? mapHeader(grid[headerIndex]) : null }
}

function statusOf(l: Loaded | null, error: string | null): SheetStatus {
  return {
    file: l ? { name: l.ref.fileName, webUrl: l.ref.webUrl, lastModified: l.ref.lastModified } : null,
    tabExists: l?.tabExists ?? false,
    tabs: l?.tabs ?? [],
    headerRow: l && l.headerIndex >= 0 ? l.headerIndex + 1 : null,
    header: l?.header ? {
      missing: l.header.missing, missingOps: l.header.missingOps,
      missingRequired: l.header.missingRequired, duplicateHeaders: l.header.duplicateHeaders,
    } : null,
    dataRows: l && l.headerIndex >= 0 ? Math.max(0, l.grid.length - l.headerIndex - 1) : (l?.grid.length ?? 0),
    error,
  }
}

/** Read-only look at the workbook: does the link open, is the tab there, does the header map. */
export async function checkSheet(): Promise<SheetStatus> {
  const config = await getFeedConfig()
  try {
    return statusOf(await loadSheet(config, null), null)
  } catch (err) {
    return statusOf(null, err instanceof Error ? err.message : String(err))
  }
}

// ── Preparing ────────────────────────────────────────────────────────────────

export interface PrepareResult {
  mode: 'uploaded' | 'graph'
  created: boolean
  headerWritten: string[]
  notes: string[]
}

/**
 * Make the tab ready for rows:
 *   - whole workbook empty → upload the dropdown-ready layout (eTag-guarded);
 *   - otherwise, through Graph: add the tab if missing; write the header on an
 *     empty row 1; or append missing columns to the right of an existing header
 *     when the column below is empty. A header with data under it is never
 *     rewritten or reordered.
 */
export async function prepareSheet(by: string | null): Promise<PrepareResult> {
  const config = await getFeedConfig()
  if (!await takeFeedLock()) throw new Error('A sync is running — try again when it finishes')
  try {
    const ref = await resolveFeedWorkbook(config.sheetUrl)
    const check = await workbookIsEmpty(ref)
    if (check.empty) {
      const lists = await usedListValues(config).catch(() => ({}))
      const buf = await buildFeedWorkbook({ tabName: config.tabName, lists })
      // Re-read the eTag right before replacing — a file edited since the check is refused.
      const fresh = await resolveFeedWorkbook(config.sheetUrl)
      await uploadWorkbook(fresh, buf, fresh.eTag)
      console.log(`[mc-excel-feed] ${by ?? 'someone'} set up the empty workbook ${ref.fileName} (tabs were: ${check.tabs.map(t => t.name).join(', ')})`)
      return { mode: 'uploaded', created: true, headerWritten: FEED_COLUMNS.map(c => c.header), notes: ['The workbook was empty, so it now has the full layout: header, colours, filters, frozen header, the Lists tab and dropdowns.'] }
    }

    const session = await openSession(ref)
    try {
      const notes: string[] = ['The workbook already holds data, so it was prepared cell by cell. Dropdowns cannot be added through Microsoft Graph to a workbook in use — see "Dropdowns" below.']
      const l = await loadSheet(config, session, ref)
      let created = false
      if (!l.tabExists) {
        await addTab(ref, config.tabName, session)
        created = true
      }
      const tab = l.tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase()) ?? config.tabName
      if (!l.tabExists || l.grid.length === 0 || (l.headerIndex < 0 && l.grid.every(r => r.every(v => String(v ?? '').trim() === '')))) {
        await writeHeader(ref, tab, 1, 0, FEED_COLUMNS, session)
        await freezeHeader(ref, tab, 1, session)
        await setColumnWidths(ref, tab, FEED_COLUMNS.map(c => c.width), session)
        return { mode: 'graph', created, headerWritten: FEED_COLUMNS.map(c => c.header), notes }
      }
      if (l.headerIndex < 0) {
        throw new WorkbookError(`The "${tab}" tab has data but no header with "Agenda Line ID" and "VN Number" in its top 10 rows. Use an empty tab (change the tab name) — OPS will not write over the desk's rows.`, 'NOT_EMPTY')
      }
      // Existing header: add only the columns it lacks, to the right, where the column is empty.
      const header = l.header!
      const headerRow = l.headerIndex + 1
      const width = Math.max(...l.grid.map(r => r.length))
      const missing = FEED_COLUMNS.filter(c => header.missing.includes(c.key))
      if (missing.length) {
        await writeHeader(ref, tab, headerRow, width, missing, session)
        notes.push(`Added ${missing.length} missing column(s) at the right: ${missing.map(c => c.header).join(', ')}. Move them where you like — OPS finds columns by their header text.`)
      }
      return { mode: 'graph', created, headerWritten: missing.map(c => c.header), notes }
    } finally {
      await closeSession(ref, session)
    }
  } finally {
    await releaseFeedLock()
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

let running = false

export async function runFeedSync(opts: {
  trigger: 'CRON' | 'MANUAL' | 'PREVIEW'
  by?: string | null
  restoreDeleted?: boolean
}): Promise<FeedResult> {
  const dry = opts.trigger === 'PREVIEW'
  const started = Date.now()
  const run: FeedRun = {
    id: randomUUID(), at: new Date().toISOString(), finishedAt: null, trigger: opts.trigger, by: opts.by ?? null,
    status: 'SUCCESS', counts: null, error: null, warnings: [], durationMs: null,
  }
  const finish = async (r: FeedResult): Promise<FeedResult> => {
    r.run.finishedAt = new Date().toISOString()
    r.run.durationMs = Date.now() - started
    await recordFeedRun(r.run)
    return r
  }

  const config = await getFeedConfig()
  if (!config.sheetUrl) {
    return finish({ run: { ...run, status: 'SKIPPED', error: 'No workbook link is set' }, sheet: statusOf(null, 'No workbook link is set'), samples: [], plan: null })
  }
  if (!dry) {
    if (running || !await takeFeedLock()) {
      const since = await feedLockHeldSince()
      return { run: { ...run, status: 'SKIPPED', error: `Another sync is running${since ? ` (since ${since})` : ''}` }, sheet: statusOf(null, null), samples: [], plan: null }
    }
    running = true
  }

  let loaded: Loaded | null = null
  let session: string | null = null
  try {
    const ref = await resolveFeedWorkbook(config.sheetUrl)
    if (!dry) session = await openSession(ref)
    loaded = await loadSheet(config, session, ref)

    // A missing tab or an empty one is laid out automatically: nothing is there to overwrite.
    let headerRow = loaded.headerIndex + 1
    let header = loaded.header
    const blank = !loaded.tabExists || loaded.grid.every(r => r.every(v => String(v ?? '').trim() === ''))
    if (!header && blank) {
      header = mapHeader(FEED_COLUMNS.map(c => c.header))
      headerRow = 1
      if (!dry) {
        if (!loaded.tabExists) await addTab(ref, config.tabName, session)
        await writeHeader(ref, config.tabName, 1, 0, FEED_COLUMNS, session)
        await freezeHeader(ref, config.tabName, 1, session)
        run.warnings.push(`The "${config.tabName}" tab was empty — the header was written. Press "Set up workbook" on an empty file for the dropdowns.`)
      }
      loaded = { ...loaded, tabExists: true, grid: [], headerIndex: 0, header }
    }
    if (!header) {
      throw new WorkbookError(`The "${config.tabName}" tab has data but no header naming "Agenda Line ID" and "VN Number" — OPS will not write into it. Pick an empty tab or press "Prepare sheet".`, 'NOT_EMPTY')
    }
    const tab = loaded.tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase()) ?? config.tabName

    const sheetKey = sheetKeyOf(ref.itemId, tab)
    const [feed, written, alias] = await Promise.all([loadFeed(config), readWritten(sheetKey), readAliases()])
    const plan = buildPlan({
      header, headerRow,
      rows: loaded.grid.slice(headerRow),
      feed: feed.rows, written, alias,
      placement: config.placement, restoreDeleted: Boolean(opts.restoreDeleted), greyInactive: config.greyInactive,
    })
    run.counts = plan.counts
    run.warnings.push(...plan.warnings)
    if (feed.bookingsWithoutAgenda) run.warnings.push(`${feed.bookingsWithoutAgenda} booking(s) in range have no movement chart yet — they appear once their agenda exists`)
    if (header.missingOps.length) run.warnings.push(`Not on the sheet, so not written: ${header.missingOps.map(k => FEED_COLUMNS.find(c => c.key === k)!.header).join(', ')} — press "Prepare sheet" to add them`)
    if (plan.blocked) throw new WorkbookError(plan.blocked, 'NOT_EMPTY')

    const summary = { inserts: plan.counts.added, insertBlocks: plan.inserts.length, writes: plan.updates.length }
    if (dry) {
      run.status = changes(plan.counts) ? 'SUCCESS' : 'NO_CHANGE'
      return finish({ run, sheet: statusOf(loaded, null), samples: plan.samples, plan: summary })
    }

    await carryOut(plan, header, ref, tab, session, run.id)
    await saveWritten(sheetKey, written, plan.nextWritten)
    run.status = changes(plan.counts) ? 'SUCCESS' : 'NO_CHANGE'
    if (changes(plan.counts)) {
      console.log(`[mc-excel-feed] ${run.trigger} — +${plan.counts.added} rows, ${plan.counts.updatedRows} updated (${plan.counts.updatedCells} cells), ${plan.counts.rekeyed} re-attached, ${plan.counts.markedInactive} flagged`)
    }
    return finish({ run, sheet: statusOf(loaded, null), samples: plan.samples.slice(0, 40), plan: summary })
  } catch (err) {
    run.status = 'FAILED'
    run.error = err instanceof Error ? err.message : String(err)
    console.error('[mc-excel-feed] sync failed:', run.error)
    return finish({ run, sheet: statusOf(loaded, run.error), samples: [], plan: null })
  } finally {
    if (!dry) {
      if (loaded) await closeSession(loaded.ref, session)
      running = false
      await releaseFeedLock()
    }
  }
}

const changes = (c: FeedCounts) => c.added + c.updatedRows + c.markedInactive > 0

async function carryOut(plan: FeedPlan, header: HeaderMap, ref: FeedSheetRef, tab: string, session: string | null, runId: string): Promise<void> {
  const lastCol = Math.max(...Object.values(header.cols))
  const total = plan.updates.length + plan.inserts.length
  let done = 0
  const tick = async (phase: string) => {
    done++
    if (done % 5 === 0 || done === total) await setFeedProgress({ runId, phase, done, total, at: new Date().toISOString() })
  }

  // 1. Existing rows — numbers as read, before any insert.
  for (const w of plan.updates) {
    await writeBlock(ref, tab, w.firstRow, w.firstCol, w.lastCol, w.values, w.formats, session)
    await tick('Updating rows')
  }
  if (plan.grey.length) await greyRows(ref, tab, plan.grey, lastCol, true, session)
  if (plan.ungrey.length) await greyRows(ref, tab, plan.ungrey, lastCol, false, session)

  // 2. New rows, bottom-up: inserting lower down never moves a row higher up.
  for (const block of plan.inserts) {
    const first = block.after + 1
    if (!block.atEnd) {
      await insertRows(ref, tab, first, block.feed.length, session)
      await plainRows(ref, tab, first, first + block.feed.length - 1, lastCol, session)
    }
    for (const w of insertWrites(block, first, header)) {
      await writeBlock(ref, tab, w.firstRow, w.firstCol, w.lastCol, w.values, w.formats, session)
    }
    await tick('Adding rows')
  }
}

export { EMPTY_COUNTS }
