/**
 * Query Monitor — push the reviewed rows to the workbook on demand.
 *
 * This is the button a review-first team presses: sweeps collect and enrich with
 * auto-write off, someone checks the rows, then this writes them.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { syncEntriesToSheet } from '@/lib/query-monitor/run'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const result = await syncEntriesToSheet()

  // A sweep is writing the same rows right now. Saying so beats appending them
  // a second time, which is what pressing this mid-sweep used to do.
  if (result.skipped) {
    return buildApiSuccess(
      result,
      'A write to the workbook is already running — nothing was written twice. '
      + 'Give it a moment and check the sheet.',
    )
  }

  if (result.failed > 0 && result.appended === 0 && result.updated === 0) {
    return buildApiError(
      `Nothing was written — ${result.failed} row(s) failed. Open the log for the Graph error.`,
      502,
    )
  }

  // The headline numbers are the live workbook's. The backup is reported only
  // when it went wrong — a mirror that worked is not news.
  const backup = result.workbooks.find(w => w.target === 'backup')
  const backupNote = backup && (backup.failed > 0 || backup.error)
    ? ` — backup lagging: ${backup.error ?? `${backup.failed} row(s) failed`}`
    : ''

  // The hand-editable copy, on the same principle: its appends are worth
  // reporting because they are the rows the team will find waiting for them,
  // and a mirror that could not be written is worth reporting because nothing
  // else on this screen would ever say so.
  const mirror = result.manual
  const mirrorNote = !mirror ? ''
    : mirror.error ? ` — "${mirror.tab}" not updated: ${mirror.error}`
    : mirror.appended > 0 || mirror.locked > 0
      ? ` — "${mirror.tab}": ${mirror.appended} copied`
        + (mirror.locked > 0 ? `, ${mirror.locked} row(s) you have coloured left alone` : '')
      : ''

  const ledger = result.allMails
  const ledgerNote = !ledger ? ''
    : ledger.error ? ` — "${ledger.tab}" not updated: ${ledger.error}`
    : ledger.appended > 0 ? ` — "${ledger.tab}": ${ledger.appended} copied`
    : ''

  return buildApiSuccess(
    result,
    `${result.appended} row(s) appended, ${result.updated} updated`
    + (result.failed ? `, ${result.failed} failed` : '')
    + backupNote
    + mirrorNote
    + ledgerNote,
  )
}
