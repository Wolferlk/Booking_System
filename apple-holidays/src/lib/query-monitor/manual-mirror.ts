/**
 * Query Monitor — "Query Entry Sheet - Manual (Edit)".
 *
 * A second worksheet beside the live query sheet, holding the same rows, that
 * the booking team may write in. The live sheet cannot be that place: it is
 * rewritten in full every time a reply lands, a thread grows or a summary is
 * regenerated, and anything typed into a cell we own is gone on the next sweep.
 * So the team kept a copy of it by hand — which went stale the moment they
 * looked away.
 *
 * This tab is that copy, kept current by the sweep and never taken back:
 *
 *   • **A row is written exactly once.** Only queries that have no mirror row
 *     yet are appended. Nothing already on the tab is ever rewritten, whatever
 *     changes about the query afterwards — no reply time, no SLA, no thread
 *     count. There is no code path here that writes over a cell that already has
 *     something in it, which is a stronger promise than "we try not to".
 *
 *   • **Colour follows the query, until somebody else claims it.** A row turns
 *     green when the query is answered, exactly as on the live sheet — but only
 *     while it is still wearing the colour we last painted. The first sweep that
 *     finds a row in a colour of the team's own locks that row's fill for good.
 *
 *   • **Nothing is ever deleted.** The duplicate sweeps work tab by tab and this
 *     tab is not one of them; there is no delete call in this module at all. A
 *     line the team types in between two of ours simply stays, and the rows
 *     below it are re-found by identity rather than by the number they used to
 *     have.
 *
 * Everything the module needs to *read* a query it is handed by run.ts — the row
 * builder, the identity keys, the fill rule — so the mirror can never fall out
 * of step with the live sheet, and so this file does not have to import the
 * module that calls it.
 */
import { prisma } from '@/lib/prisma'
import type { QueryMonitorEntry } from '@prisma/client'
import { getConfig, startDateBoundary } from './config'
import {
  ALL_MAILS_LAYOUT, QUERY_LAYOUT, appendCellRows, appendRows, closeSession,
  ensureWorksheet, findLastDataRow, layoutFor, normalizeFill, openSession,
  readRowFill, readValuesRange, resolveSheetRef, setRowFill,
  type SheetLayout, type SheetRef, type SheetRowValues,
} from './sheet'
import { allMailsRowToCells, buildRowsForMails } from './all-mails'

/** What run.ts lends the mirror so it reads a query the same way the sheet does. */
export interface MirrorDeps {
  /** The row this entry would occupy — the identical builder the live tab uses. */
  rowFor:  (entry: QueryMonitorEntry) => SheetRowValues
  /** Every identity that entry's row answers to, exact one first. */
  keysFor: (entry: QueryMonitorEntry) => string[]
  /** The same identities, read back off cells already on a tab. */
  rowKeys: (cells: (string | number | boolean | null)[], layout: SheetLayout) => string[]
  /** The fill the query's row should be wearing — green once answered. */
  fillFor: (entry: QueryMonitorEntry) => string | null
  /** Run-log sink. Optional: the mirror is also driven from a button. */
  note?:   (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void
}

export interface MirrorResult {
  /** The tab written to, so a caller can name it in a message. */
  tab:      string
  appended: number
  /** Rows whose colour was brought up to date. */
  painted:  number
  /** Rows found in a colour the team gave them — locked, and left alone. */
  locked:   number
  failed:   number
  /** Off in configuration, or nothing to do. Not a failure. */
  skipped?: string
  error?:   string
}

const EMPTY = (tab: string): MirrorResult => ({ tab, appended: 0, painted: 0, locked: 0, failed: 0 })

/**
 * The query sheet's columns, marked as a tab that is only ever appended to.
 *
 * The same layout the live sheet uses — it is the same sheet — with one flag
 * added, and it must be added here rather than on the shared constant: the live
 * tab is rewritten in place and its bottom is found by scanning our own key
 * column, which is right for a tab nobody types in. This one is typed in. See
 * `appendOnly` on SheetLayout for what that changes and why.
 */
const MIRROR_LAYOUT: SheetLayout = { ...QUERY_LAYOUT, appendOnly: true }

/**
 * Bring the mirror up to date: append what is missing, recolour what is ours.
 *
 * Never throws. The mirror is a convenience beside the live sheet, and a sweep
 * that dies copying rows into it is a worse outcome than a mirror that is an
 * hour behind — so every failure is caught, recorded on the entries it concerns
 * and reported back for the run log to show.
 */
export async function syncManualMirror(
  deps: MirrorDeps, limit = 200,
): Promise<MirrorResult> {
  const cfg  = await getConfig()
  const tab  = cfg.manualSheetName
  const note = deps.note ?? (() => {})

  if (!cfg.manualMirrorEnabled) return { ...EMPTY(tab), skipped: 'The hand-editable mirror is switched off' }

  // Writing the mirror onto the live tab would turn the live tab append-only,
  // which is precisely the sheet that must not be. Refuse rather than repair.
  if (tab.trim().toLowerCase() === cfg.sheetName.trim().toLowerCase()) {
    return { ...EMPTY(tab), error: `The mirror tab and the live query tab are both "${tab}" — set a different name in Configuration` }
  }

  let ref: SheetRef
  try {
    ref = await resolveSheetRef()
  } catch (err) {
    return { ...EMPTY(tab), error: message(err) }
  }

  const sessionId = await openSession(ref)
  try {
    const { created, headerMismatch } = await ensureWorksheet(ref, tab, MIRROR_LAYOUT, sessionId)
    if (created) note('info', `Created the hand-editable "${tab}" tab`)
    if (headerMismatch) {
      return {
        ...EMPTY(tab),
        error:
          `"${tab}" holds data under a header that is not the ${QUERY_LAYOUT.header.length}-column `
          + 'query layout. Nothing was written — a mirror row appended under a different header '
          + 'would put every value in the wrong column.',
      }
    }

    const layout = await layoutFor(ref, tab, MIRROR_LAYOUT)

    const result = EMPTY(tab)
    await appendMissingRows(ref, tab, layout, sessionId, cfg, deps, limit, result)

    // Only when colouring is switched on at all. With it off every answered row
    // wants no fill, which is what it already has — so the pass would read the
    // fill of every one of them, sweep after sweep, to decide to do nothing.
    if (cfg.highlightReplied) {
      await repaintOurRows(ref, tab, layout, sessionId, deps, limit, result)
    }
    return result
  } catch (err) {
    return { ...EMPTY(tab), error: message(err) }
  } finally {
    await closeSession(ref, sessionId)
  }
}

// ── Appending ────────────────────────────────────────────────────────────────

/**
 * Copy across every query the mirror has not seen yet.
 *
 * The candidates are queries that are **already on the live sheet**. The mirror
 * follows the live tab rather than racing it: a row that is still PENDING there
 * may yet be folded into another as a duplicate, and a mirror that had already
 * copied it would be holding a line the live sheet decided against — which,
 * because nothing here is ever deleted, it would then hold for ever.
 */
async function appendMissingRows(
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  cfg: Awaited<ReturnType<typeof getConfig>>, deps: MirrorDeps, limit: number,
  result: MirrorResult,
): Promise<void> {
  const cutoff = startDateBoundary(cfg.startDate)
  const note   = deps.note ?? (() => {})

  const pending = await prisma.queryMonitorEntry.findMany({
    where: {
      mailKind:         'QUERY',
      mergedIntoId:     null,
      // On the live sheet already — see the note above.
      sheetRow:         { not: null },
      syncStatus:       'SYNCED',
      manualSheetRow:   null,
      manualSyncStatus: { in: ['PENDING', 'FAILED'] },
      ...(cutoff ? { receivedAt: { gte: cutoff } } : {}),
    },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take:    limit,
  })
  if (pending.length === 0) return

  try {
    // Two guards before a single cell is written, both of which exist because
    // this tab has no way back: a row appended twice cannot be deleted out again.
    const block   = await foldWithinBlock(pending, deps)
    const toWrite = await dropRowsAlreadyThere(ref, tab, layout, sessionId, block, deps)

    if (toWrite.length === 0) return

    const appended = await appendRows(toWrite.map(deps.rowFor), { sessionId, ref, sheetName: tab, layout })

    await Promise.all(toWrite.map((entry, i) =>
      prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data: {
          manualSheetRow:   appended.firstRow + i,
          manualSyncStatus: 'SYNCED',
          manualSyncError:  null,
          // Appended rows inherit no fill, so that is what we remember having
          // painted. The first repaint compares against it.
          manualHighlight:  null,
        },
      }),
    ))

    result.appended += appended.rows
    note('success', `Copied ${appended.rows} row(s) into "${tab}" at rows ${appended.firstRow}–${appended.lastRow}`)
  } catch (err) {
    result.failed += pending.length
    await prisma.queryMonitorEntry.updateMany({
      where: { id: { in: pending.map(e => e.id) } },
      data:  { manualSyncStatus: 'FAILED', manualSyncError: message(err).slice(0, 500) },
    })
    note('error', `Could not copy ${pending.length} row(s) into "${tab}": ${message(err)}`)
  }
}

/**
 * Two entries in one block that are the same query — one of them keeps the row.
 *
 * The loser is marked SKIPPED rather than FAILED: it is not an error and there
 * is nothing to retry. It has no line of its own on the mirror and never will,
 * which is the same answer the live sheet gave it.
 */
async function foldWithinBlock(
  entries: QueryMonitorEntry[], deps: MirrorDeps,
): Promise<QueryMonitorEntry[]> {
  const seen: Set<string> = new Set()
  const kept: QueryMonitorEntry[] = []
  const folded: string[] = []

  for (const entry of entries) {
    const keys = deps.keysFor(entry)
    if (keys.some(k => seen.has(k))) { folded.push(entry.id); continue }
    for (const key of keys) seen.add(key)
    kept.push(entry)
  }

  // Recorded, not just skipped. Left PENDING they would come back in the next
  // block, be recognised as already on the tab, and be pointed at the row the
  // winner owns — two entries claiming one line, and the colour of that line
  // then decided by whichever of them the paint pass reached last.
  if (folded.length > 0) {
    await prisma.queryMonitorEntry.updateMany({
      where: { id: { in: folded } },
      data:  { manualSyncStatus: 'SKIPPED', manualSyncError: null },
    })
  }
  return kept
}

/**
 * Anything in the block that is standing on the tab already.
 *
 * The same hole `claimAlreadyWrittenRows` closes for the live sheet: the append
 * lands, the database write recording it does not, and the next pass copies the
 * lot again. There it matters because duplicates are ugly; here it matters more,
 * because the clean-up sweep that removes duplicates from the live tabs is not
 * allowed anywhere near this one.
 *
 * The tail is read, not the whole tab — a row this pass is about to append can
 * only have been written by a pass that reached the workbook, which puts it at
 * the bottom. An entry found there is pointed at the row it turns out to own.
 */
async function dropRowsAlreadyThere(
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  entries: QueryMonitorEntry[], deps: MirrorDeps, tailRows = 300,
): Promise<QueryMonitorEntry[]> {
  if (entries.length === 0) return entries

  let rows: (string | number | boolean | null)[][]
  let firstRow: number
  try {
    const lastDataRow = await findLastDataRow(ref, tab, sessionId, layout)
    if (lastDataRow < 2) return entries
    firstRow = Math.max(2, lastDataRow - tailRows + 1)
    rows = await readValuesRange(ref, tab, firstRow, lastDataRow, layout, sessionId)
  } catch {
    // Unreadable tail. On the live sheet the call is "write anyway, a duplicate
    // is recoverable". Here it is not recoverable, so the block waits: the
    // entries stay PENDING and the next pass tries again with a readable tail.
    throw new Error('The tab could not be read back before appending — nothing was copied, so nothing was copied twice')
  }

  const rowByKey = new Map<string, number>()
  rows.forEach((cells, i) => {
    if (String(cells[2] ?? '').trim() === '') return
    for (const key of deps.rowKeys(cells, layout)) {
      if (!rowByKey.has(key)) rowByKey.set(key, firstRow + i)
    }
  })

  const toWrite: QueryMonitorEntry[] = []
  for (const entry of entries) {
    const row = deps.keysFor(entry).map(k => rowByKey.get(k)).find(r => r !== undefined)
    if (row === undefined) { toWrite.push(entry); continue }

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data:  { manualSheetRow: row, manualSyncStatus: 'SYNCED', manualSyncError: null },
    })
  }
  return toWrite
}

// ── Colour ───────────────────────────────────────────────────────────────────

/**
 * Bring the fill of rows that are still ours up to date, and let go of the rest.
 *
 * The rule the team asked for, in the order it is applied to each row:
 *
 *   1. **Where is it now?** A hand-inserted line above pushes every row below it
 *      down, and the stored number then points at somebody else's work. So the
 *      span is read once and each row is re-found by its identity. A row that
 *      cannot be found is left entirely alone — painting a row we cannot
 *      identify is exactly how a hand-typed line gets marked up wrongly.
 *   2. **Is it still the colour we left?** If not, the team has coloured it.
 *      That row is locked, permanently, and we never look at its fill again.
 *   3. **Only then**, paint it — green if the query has been answered.
 *
 * Failures are swallowed per row. The values on this tab are the deliverable and
 * the colour is a reading aid.
 */
async function repaintOurRows(
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  deps: MirrorDeps, limit: number, result: MirrorResult,
): Promise<void> {
  const note = deps.note ?? (() => {})

  const candidates = await prisma.queryMonitorEntry.findMany({
    where: {
      mailKind:          'QUERY',
      mergedIntoId:      null,
      manualSheetRow:    { not: null },
      manualColorLocked: false,
      // Only rows whose colour is actually out of date. This is what stops a
      // sweep reading the fill of two thousand rows that have not moved.
      OR: [
        { replyStatus: 'REPLIED',          manualHighlight: null },
        { replyStatus: { not: 'REPLIED' }, manualHighlight: { not: null } },
      ],
    },
    orderBy: { manualSheetRow: 'asc' },
    take:    limit,
  })
  if (candidates.length === 0) return

  const where = await locateRows(ref, tab, layout, sessionId, candidates, deps)

  for (const entry of candidates) {
    const wanted = normalizeFill(deps.fillFor(entry))
    const row    = where.get(entry.id)
    if (row === undefined) continue          // span unreadable — try again next pass
    if (row === null) {                      // moved further than we looked, or gone
      note('warn', `"${tab}": the row for "${entry.subject.slice(0, 50)}" is not where it was — its colour was left as it is`)
      continue
    }

    try {
      const seen       = await readRowFill(ref, tab, row, layout, sessionId)
      const remembered = normalizeFill(entry.manualHighlight)

      if (seen !== remembered) {
        // Somebody has marked this line themselves. From here on it is theirs.
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { manualColorLocked: true, manualSheetRow: row },
        })
        result.locked += 1
        continue
      }

      if (seen === wanted) {
        // Already right; only the remembered row number needed correcting.
        if (row !== entry.manualSheetRow) {
          await prisma.queryMonitorEntry.update({ where: { id: entry.id }, data: { manualSheetRow: row } })
        }
        continue
      }

      await setRowFill(ref, tab, row, layout, wanted, sessionId)
      await prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data:  { manualHighlight: wanted, manualSheetRow: row },
      })
      result.painted += 1
    } catch (err) {
      note('warn', `"${tab}" row ${row} could not be coloured: ${message(err)}`)
    }
  }

  if (result.locked > 0) {
    note('info', `${result.locked} row(s) on "${tab}" carry a colour of the team's own — left untouched from now on`)
  }
}

/**
 * Where each of these entries' rows actually is now, by identity rather than by
 * the number we last wrote down.
 *
 * `undefined` for an entry means the read failed and nothing may be assumed;
 * `null` means the row is genuinely not in the span looked at. The two are kept
 * apart because they call for opposite behaviour — retry next pass, versus stop
 * looking — and collapsing them is how a colour ends up on a stranger's row.
 */
async function locateRows(
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  entries: QueryMonitorEntry[], deps: MirrorDeps,
  margin = 250, maxSpan = 3000,
): Promise<Map<string, number | null>> {
  const found = new Map<string, number | null>()
  const held  = entries
    .map(e => e.manualSheetRow)
    .filter((r): r is number => typeof r === 'number' && r > 1)
  if (held.length === 0) return found

  // Padded both ways: the rows are looked for around where they were, not only
  // where they were. Hand-inserted lines are what move them, and the margin is
  // what a morning's editing realistically shifts a row by.
  const first = Math.max(2, Math.min(...held) - margin)
  const last  = Math.max(...held) + margin
  if (last - first + 1 > maxSpan) return found

  let rows: (string | number | boolean | null)[][]
  try {
    rows = await readValuesRange(ref, tab, first, last, layout, sessionId)
  } catch {
    return found
  }

  // The exact key only. The looser "same query" keys match more than one row by
  // design — two rounds of a thread, a genuine repeat — and one of those is not
  // a row this entry may be repointed at.
  const byExactKey = new Map<string, number>()
  rows.forEach((cells, i) => {
    if (String(cells[2] ?? '').trim() === '') return
    const [exact] = deps.rowKeys(cells, layout)
    if (exact && !byExactKey.has(exact)) byExactKey.set(exact, first + i)
  })

  for (const entry of entries) {
    if (typeof entry.manualSheetRow !== 'number') continue
    const [exact] = deps.keysFor(entry)
    found.set(entry.id, (exact ? byExactKey.get(exact) : undefined) ?? null)
  }
  return found
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ── The all-mail mirror ──────────────────────────────────────────────────────

export interface AllMailsMirrorResult {
  tab:      string
  appended: number
  failed:   number
  skipped?: string
  error?:   string
}

/**
 * The same promise as the query mirror, over the all-mail ledger.
 *
 * The app's own "All Mails" tab cannot be the one the team writes in: it is
 * cleared and laid out again from scratch on every sweep, because a row's
 * Status, SLA and thread summary all move as replies land. Anything typed into
 * it is gone within the hour. This tab is the copy that is safe to edit.
 *
 * **What makes a deleted line stay deleted.** What gets appended is decided
 * entirely from `mirrorRow` in the database — never from what is on the tab. A
 * message that has a row number is one we have written, and it is never a
 * candidate again: not if the line was edited past recognition, not if it was
 * deleted this morning, not if the whole tab were cleared. The query mirror can
 * afford to read its tail back and claim rows it finds there, because a query
 * row is one per thread and re-finding one is useful. Doing that here would be
 * the exact mechanism that puts every hand-deleted line back, so it is not done
 * at all — the tail is read once per pass for one purpose only, to find where
 * the end of the tab is.
 *
 * Beyond that the rules are the query mirror's, for the same reasons: a row is
 * written once and never rewritten, nothing is ever deleted, and a failure here
 * can never fail the sweep that called it.
 */
export async function syncAllMailsMirror(
  note: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void = () => {},
  limit = 400,
): Promise<AllMailsMirrorResult> {
  const cfg = await getConfig()
  const tab = cfg.allMailsManualSheetName

  if (!cfg.allMailsMirrorEnabled) {
    return { tab, appended: 0, failed: 0, skipped: 'The all-mail mirror is switched off' }
  }

  // Writing it onto the ledger the app rewrites would clear the team's edits on
  // the next sweep — the one outcome this tab exists to prevent.
  if (tab.trim().toLowerCase() === cfg.allMailsSheetName.trim().toLowerCase()) {
    return {
      tab, appended: 0, failed: 0,
      error: `The mirror and the all-mail ledger are both "${tab}" — set a different name in Configuration`,
    }
  }

  let ref: SheetRef
  try {
    ref = await resolveSheetRef()
  } catch (err) {
    return { tab, appended: 0, failed: 0, error: message(err) }
  }

  const sessionId = await openSession(ref)
  try {
    const { created, headerMismatch } = await ensureWorksheet(ref, tab, ALL_MAILS_LAYOUT, sessionId)
    if (created) note('info', `Created the hand-editable "${tab}" tab`)
    if (headerMismatch) {
      return {
        tab, appended: 0, failed: 0,
        error:
          `"${tab}" holds data under a header that is not the ${ALL_MAILS_LAYOUT.header.length}-column `
          + 'all-mail layout. Nothing was written — a row appended under a different header would put '
          + 'every value in the wrong column.',
      }
    }

    const layout = await layoutFor(ref, tab, ALL_MAILS_LAYOUT)
    return await appendMissingMails(ref, tab, layout, sessionId, cfg, note, limit)
  } catch (err) {
    return { tab, appended: 0, failed: 0, error: message(err) }
  } finally {
    await closeSession(ref, sessionId)
  }
}

/**
 * Copy across every message the mirror has never been given a row for.
 *
 * Oldest first, so the tab reads as a ledger: the order mail arrived in, top to
 * bottom, the same way the app's own all-mail tab is laid out. A batch limit
 * keeps one sweep's write bounded; the rest go on the next pass, and the
 * ordering means the backlog drains in the order it was received rather than in
 * whatever order the database happened to return it.
 */
async function appendMissingMails(
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  cfg: Awaited<ReturnType<typeof getConfig>>,
  note: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void,
  limit: number,
): Promise<AllMailsMirrorResult> {
  const cutoff = startDateBoundary(cfg.startDate)

  const pending = await prisma.queryMonitorMail.findMany({
    where: {
      // The pointer, and only the pointer. See the note on this function's
      // caller: a message that has a row is never written again.
      mirrorRow:    null,
      mirrorStatus: { in: ['PENDING', 'FAILED'] },
      // The mirror starts where the workbook starts, like every other tab —
      // mail older than the cut-off is deliberately absent from all of them.
      ...(cutoff ? { receivedAt: { gte: cutoff } } : {}),
    },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take:    limit,
  })
  if (pending.length === 0) return { tab, appended: 0, failed: 0 }

  try {
    const built = await buildRowsForMails(pending)
    const cells = built.map(({ row }) => allMailsRowToCells(row))

    const result = await appendCellRows(cells, layout, { sessionId, ref, sheetName: tab })

    // Recorded one by one against the message each row was built from, so a row
    // number always means the line that message is actually on.
    await Promise.all(built.map(({ mail }, i) =>
      prisma.queryMonitorMail.update({
        where: { id: mail.id },
        data:  { mirrorRow: result.firstRow + i, mirrorStatus: 'SYNCED', mirrorError: null },
      }),
    ))

    note('success', `Copied ${result.rows} mail(s) into "${tab}" at rows ${result.firstRow}–${result.lastRow}`)
    return { tab, appended: result.rows, failed: 0 }
  } catch (err) {
    await prisma.queryMonitorMail.updateMany({
      where: { id: { in: pending.map(m => m.id) } },
      data:  { mirrorStatus: 'FAILED', mirrorError: message(err).slice(0, 500) },
    })
    note('error', `Could not copy ${pending.length} mail(s) into "${tab}": ${message(err)}`)
    return { tab, appended: 0, failed: pending.length, error: message(err) }
  }
}
