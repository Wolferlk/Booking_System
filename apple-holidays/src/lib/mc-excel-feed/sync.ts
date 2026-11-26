/**
 * MC Excel Feed — one sync (or a preview of one).
 *
 *   1. resolve the workbook; refuse a workbook other features read from;
 *   2. read the feed tab (header found by its text, anywhere in the top 10 rows);
 *   3. load what OPS says (source.ts) and the per-booking memory (config.ts);
 *   4. plan (plan.ts) — the preview stops here and writes nothing at all;
 *   5. carry the plan out: cell updates first, then new rows bottom-up so the
 *      planned row numbers stay true; then Excel → OPS write-backs (Meeting
 *      Time / Driver Details, compare-and-set); then remember what was agreed;
 *      then the cosmetics — booking colours and the banner's sync stamp.
 *
 * A failure part-way leaves the sheet consistent enough for the next run to
 * finish the job: every step is "make the cell hold X", and the memory is only
 * moved on after the whole plan went through.
 */
import { randomUUID } from 'crypto'
import { buildPlan, findHeaderRow, insertWrites, mapHeader, type BaseEntry, type FeedPlan, type HeaderMap } from './plan'
import { loadFeed, usedListValues } from './source'
import {
  feedLockHeldSince, getFeedConfig, readAliases, readMemory, readPaint, recordFeedRun, releaseFeedLock,
  saveMemory, savePaint, setFeedProgress, sheetKeyOf, takeFeedLock,
} from './config'
import {
  addTab, clearRowFormats, closeSession, fillBlocks, freezeHeader, greyRows, hasLayout, insertRows, listTabs, openSession, plainRows,
  readColumn, readGrid, resolveFeedWorkbook, setColumnWidths, uploadWorkbook, usedExtent, workbookIsEmpty, writeBlock,
  writeHeader, writeStamp, WorkbookError, type FeedSheetRef,
} from './workbook'
import { applyWritebacks } from './writeback'
import { buildFeedWorkbook } from './template'
import { cellKey, FEED_COLUMNS, FEED_COUNTRIES, PALETTE, type FeedConfig, type FeedCounts, type FeedRun, type PlanSample } from './shared'

export interface SheetStatus {
  file: { name: string; webUrl: string; lastModified: string | null } | null
  tabExists: boolean
  tabs: string[]
  headerRow: number | null
  header: Pick<HeaderMap, 'missing' | 'missingOps' | 'missingRequired' | 'duplicateHeaders'> | null
  dataRows: number
  /** The workbook carries the OPS layout (dropdowns, booking colours by conditional formatting). */
  layout: boolean
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
  layout: boolean
}

async function loadSheet(config: FeedConfig, session: string | null, known?: FeedSheetRef): Promise<Loaded> {
  const ref = known ?? await resolveFeedWorkbook(config.sheetUrl)
  const [tabs, layout] = await Promise.all([listTabs(ref, session), hasLayout(ref, session)])
  const tabName = tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase())
  if (!tabName) return { ref, tabs, tabExists: false, grid: [], headerIndex: -1, header: null, layout }
  const grid = await readGrid(ref, tabName, session)
  const headerIndex = findHeaderRow(grid)
  return { ref, tabs, tabExists: true, grid, headerIndex, header: headerIndex >= 0 ? mapHeader(grid[headerIndex]) : null, layout }
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
    layout: l?.layout ?? false,
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

/** The sheet key of the configured workbook tab (for settling conflicts). */
export async function currentSheetKey(): Promise<string> {
  const config = await getFeedConfig()
  const ref = await resolveFeedWorkbook(config.sheetUrl)
  const tabs = await listTabs(ref)
  return sheetKeyOf(ref.itemId, tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase()) ?? config.tabName)
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
 *   - whole workbook empty → upload the OPS layout (eTag-guarded);
 *   - otherwise, through Graph: add the tab if missing; write the header on an
 *     empty row 1; or append missing columns to the right of an existing header.
 *     A header with data under it is never rewritten or reordered.
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
      return {
        mode: 'uploaded', created: true, headerWritten: FEED_COLUMNS.map(c => c.header),
        notes: ['The workbook was empty, so it now has the full OPS layout: banner, coloured header, two booking colours, today highlight, dropdowns, a Lists tab and a Read me tab.'],
      }
    }

    const session = await openSession(ref)
    try {
      const notes: string[] = ['The workbook already holds data, so it was prepared cell by cell. Dropdowns and automatic colours need the OPS layout (an empty workbook); OPS paints the booking colours itself on every sync instead.']
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
  /** Send more Excel → OPS changes than the safety limit (someone looked at the preview). */
  allowBulkWriteBack?: boolean
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
        run.warnings.push(`The "${config.tabName}" tab was empty — the header was written. "Prepare sheet" on an empty workbook gives the full layout with dropdowns.`)
      }
      loaded = { ...loaded, tabExists: true, grid: [], headerIndex: 0, header }
    }
    if (!header) {
      throw new WorkbookError(`The "${config.tabName}" tab has data but no header naming "Agenda Line ID" and "VN Number" — OPS will not write into it. Pick an empty tab or press "Prepare sheet".`, 'NOT_EMPTY')
    }
    const tab = loaded.tabs.find(t => t.toLowerCase() === config.tabName.toLowerCase()) ?? config.tabName

    const sheetKey = sheetKeyOf(ref.itemId, tab)
    const [feed, memory, alias] = await Promise.all([loadFeed(config), readMemory(sheetKey), readAliases()])
    const plan = buildPlan({
      header, headerRow,
      rows: loaded.grid.slice(headerRow),
      feed: feed.rows, written: memory.written, alias, base: memory.base,
      placement: config.placement, restoreDeleted: Boolean(opts.restoreDeleted), greyInactive: config.greyInactive,
      writeBack: config.writeBack, allowBulkWriteBack: Boolean(opts.allowBulkWriteBack),
    })
    run.counts = plan.counts
    run.warnings.push(...plan.warnings)
    if (feed.bookingsWithoutAgenda) run.warnings.push(`${feed.bookingsWithoutAgenda} booking(s) in range have no movement chart yet — they appear once their agenda exists`)
    if (header.missingOps.length) run.warnings.push(`Not on the sheet, so not written: ${header.missingOps.map(k => FEED_COLUMNS.find(c => c.key === k)!.header).join(', ')} — press "Prepare sheet" to add them`)
    if (plan.counts.conflicts) run.warnings.push(`${plan.counts.conflicts} Meeting Time / Driver cell(s) changed on both sides — left alone; settle them in the preview`)
    if (plan.blocked) throw new WorkbookError(plan.blocked, 'NOT_EMPTY')

    const summary = { inserts: plan.counts.added, insertBlocks: plan.inserts.length, writes: plan.updates.length }
    if (dry) {
      run.status = changes(plan.counts) ? 'SUCCESS' : 'NO_CHANGE'
      return finish({ run, sheet: statusOf(loaded, null), samples: plan.samples, plan: summary })
    }

    await carryOut(plan, header, ref, tab, session, run.id, loaded.layout)

    // Excel → OPS. A write OPS refuses keeps the old agreed value, so the next sync re-plans it.
    if (plan.writebacks.length) {
      const wb = await applyWritebacks(plan.writebacks)
      for (const { wb: w, reason } of wb.skipped) {
        const e: BaseEntry = { ...(plan.nextBase.get(w.lineId) ?? {}) }
        const f = w.field === 'meetingTime' ? 't' : 'd'
        if (w.baseBefore === undefined) delete e[f]; else e[f] = w.baseBefore
        plan.nextBase.set(w.lineId, e)
        run.warnings.push(`${w.bookingRef} ${w.date}: ${w.field === 'meetingTime' ? 'meeting time' : 'driver'} not sent to OPS — ${reason}`)
      }
      plan.counts.toOps = wb.applied.length
      plan.counts.toOpsWaiting += wb.skipped.length
    }
    await saveMemory(sheetKey, memory, plan.nextWritten, plan.nextBase)

    // Cosmetics — never fail the sync.
    if (loaded.layout) {
      await writeStamp(ref, stampText(config, plan.counts.feedRows), session)
    } else if (config.bandColors) {
      const failed = await paintBands(ref, tab, header, headerRow, session, sheetKey).catch(() => -1)
      if (failed) run.warnings.push(failed < 0 ? 'Booking colours could not be painted this time' : `${failed} booking colour block(s) could not be painted`)
    }

    run.status = changes(plan.counts) ? 'SUCCESS' : 'NO_CHANGE'
    if (changes(plan.counts)) {
      console.log(`[mc-excel-feed] ${run.trigger} — +${plan.counts.added} rows, ${plan.counts.updatedRows} updated (${plan.counts.updatedCells} cells), ${plan.counts.rekeyed} re-attached, ${plan.counts.markedInactive} flagged, ${plan.counts.toOps} sent to OPS`)
    }
    return finish({ run, sheet: statusOf(loaded, null), samples: plan.samples.slice(0, 60), plan: summary })
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

const changes = (c: FeedCounts) => c.added + c.updatedRows + c.markedInactive + c.toOps > 0

function stampText(config: FeedConfig, movements: number): string {
  const now = new Date()
  const at = (tz: string) => now.toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  const countries = config.countries.map(c => FEED_COUNTRIES.find(x => x.value === c)?.label ?? c).join(', ')
  const from = new Date(`${config.startDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `Synced ${at('Asia/Ho_Chi_Minh')} VN · ${at('Asia/Colombo')} SL   ·   ${movements.toLocaleString()} movements   ·   ${countries} arrivals from ${from}`
}

/**
 * `layout`: the OPS layout greys and colours rows by conditional formatting and
 * its inserted rows inherit the column styles — so no font / fill is set here
 * (it would only override the layout's own styling).
 */
async function carryOut(plan: FeedPlan, header: HeaderMap, ref: FeedSheetRef, tab: string, session: string | null, runId: string, layout: boolean): Promise<void> {
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
  if (!layout && plan.grey.length) await greyRows(ref, tab, plan.grey, lastCol, true, session)
  if (!layout && plan.ungrey.length) await greyRows(ref, tab, plan.ungrey, lastCol, false, session)

  // 2. New rows, bottom-up: inserting lower down never moves a row higher up.
  for (const block of plan.inserts) {
    const first = block.after + 1
    if (!block.atEnd) {
      await insertRows(ref, tab, first, block.feed.length, session)
      // Inserted rows copy the row above: under the header that is the header's style.
      if (!layout) await plainRows(ref, tab, first, first + block.feed.length - 1, lastCol, session)
      else if (block.after === plan.headerRow) await clearRowFormats(ref, tab, first, first + block.feed.length - 1, lastCol, session)
    }
    for (const w of insertWrites(block, first, header, plan.ctx)) {
      await writeBlock(ref, tab, w.firstRow, w.firstCol, w.lastCol, w.values, w.formats, session)
    }
    await tick('Adding rows')
  }
}

/**
 * Two booking colours on a workbook without the OPS layout: read where each
 * booking's rows are now, and fill only the blocks whose colour or size
 * changed since the last paint (an insert above a booking moves its fill with
 * it; a new booking flips the ones below it).
 */
async function paintBands(ref: FeedSheetRef, tab: string, header: HeaderMap, headerRow: number, session: string | null, sheetKey: string): Promise<number> {
  const { rows } = await usedExtent(ref, tab, session)
  if (rows <= headerRow) return 0
  const refs = await readColumn(ref, tab, header.cols.ref, headerRow + 1, rows, session)
  const bands = header.cols.band !== undefined ? await readColumn(ref, tab, header.cols.band, headerRow + 1, rows, session) : []
  const blocks: { ref: string; first: number; last: number; odd: boolean }[] = []
  let counter = 0
  refs.forEach((v, i) => {
    const r = cellKey(v).toUpperCase()
    const row = headerRow + 1 + i
    if (!r) return
    const prev = blocks[blocks.length - 1]
    if (prev && prev.ref === r && prev.last === row - 1) { prev.last = row; return }
    counter++
    const b = bands[i]
    blocks.push({ ref: r, first: row, last: row, odd: typeof b === 'number' ? b % 2 === 1 : counter % 2 === 1 })
  })
  const painted = await readPaint(sheetKey)
  const next = new Map<string, string>()
  const seen = new Map<string, number>()
  const todo: { first: number; last: number; color: string }[] = []
  for (const b of blocks) {
    const k = seen.get(b.ref) ?? 0
    seen.set(b.ref, k + 1)
    const key = `${b.ref}#${k}`
    const sig = `${b.odd ? 1 : 0}:${b.last - b.first + 1}`
    next.set(key, sig)
    if (painted.get(key) !== sig) todo.push({ first: b.first, last: b.last, color: b.odd ? PALETTE.bandA : PALETTE.bandB })
  }
  const lastCol = Math.max(...Object.values(header.cols))
  const failed = todo.length ? await fillBlocks(ref, tab, todo, lastCol, session) : 0
  if (!failed && JSON.stringify(Object.fromEntries(next)).length < 60_000) await savePaint(sheetKey, next)
  return failed
}
