/**
 * Direct ticket issuing — the switch that takes Accounts out of the loop.
 *
 * Normally a ticket on Malaysia, Singapore or Vietnam is bought only after two
 * separate answers come back from Accounts:
 *
 *   G2 — the P&L line this ticket costs against has been paid, with a
 *        reference number against it; and
 *   G4 — the ticket itself was submitted, approved, and the portal paid
 *        (see lib/ticket-approvals).
 *
 * Both exist because the money is Accounts' to release. There are periods when
 * that is not how the business wants to run — a board buying out of its own
 * float, a backlog being cleared, an Accounts system being migrated — and the
 * ground team needs to issue tickets without waiting on either answer.
 *
 * This is the switch for that. One key in `system_settings`, off unless
 * somebody with the critical-services password turns it on, and when it is on
 * both gates stand down and the Purchase button opens.
 *
 * Two things it deliberately does NOT do:
 *
 *   · it never deletes or rewrites an approval that already exists. A request
 *     already with Accounts stays exactly as it is, and if the switch goes
 *     back off the queue picks up where it left off; and
 *   · it is never cached. A gate that decides whether money can be spent must
 *     read the switch as it stands, not as it stood ten seconds ago — turning
 *     it back off has to take effect on the next click, not on the next
 *     deploy. It is one primary-key lookup on a table with a handful of rows.
 *
 * The Accounts side reads this same row over its `ops` connection, so the two
 * systems cannot disagree about whether the queue is live.
 *
 * @see Accounts: app/Services/TicketApprovalService.php::opsDirectIssuing()
 */
import { prisma } from './prisma'

/** The `system_settings` key. Shared with Accounts — changing it breaks them. */
export const DIRECT_ISSUE_KEY = 'ticket_direct_issue'

/**
 * Is direct issuing on right now?
 *
 * Fails closed. An unreadable setting leaves the approval gates standing,
 * which is the same answer the system gave before this switch existed — the
 * failure mode of "we could not check" must never be "spend the money".
 */
export async function directIssueEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: DIRECT_ISSUE_KEY } })
    return row?.value === 'true'
  } catch (err) {
    console.warn(
      '[ticket-direct-issue] switch unreadable, keeping the approval gates shut:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
