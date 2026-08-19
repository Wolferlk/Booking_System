/**
 * WhatsApp call-approval status, as the Daily Update sheet reports it.
 *
 * The AI voice bot may not dial a guest until that guest has tapped **Allow**
 * on a WhatsApp approval message. Until now the only place to see that was the
 * booking's Traveller Experience panel, one file at a time — so the desk had no
 * way to scan a day's arrivals and spot the numbers that were never asked. This
 * column answers exactly that, and offers the one action that follows from it:
 * send the approval message.
 *
 * Three states, resolved from the approval ledger (`te_call_approvals`) plus
 * evidence from the call log — the same rules the ops day report uses, see
 * `call-approvals.ts`:
 *
 *   • `approved`  — the customer accepted, or a call actually connected (the
 *                   bot cannot dial at all otherwise, so a real call is proof).
 *   • `sent`      — the approval message went out; they have not accepted yet.
 *                   This is the "not approved (yet)" state on the sheet.
 *   • `not_sent`  — nobody has asked this number. The cell offers the button.
 *
 * A *live* per-number check exists upstream (`GET approval?to=…`) and the cell's
 * modal uses it, but it answers one number per request — far too slow for a
 * sheet of several hundred rows, which is why the scan-level chip comes from the
 * ledger instead.
 *
 * Prisma-free on purpose: the sheet is a client component and imports these
 * labels and types. The loader lives in `daily-update-calls-data.ts`.
 */

export const CALL_APPROVAL_STATES = ['approved', 'sent', 'not_sent'] as const
export type CallApprovalState = typeof CALL_APPROVAL_STATES[number]

export const CALL_APPROVAL_LABEL: Record<CallApprovalState, string> = {
  approved: 'Approved',
  sent:     'Not approved yet',
  not_sent: 'Not sent',
}

export const CALL_APPROVAL_HINT: Record<CallApprovalState, string> = {
  approved: 'The guest allows WhatsApp calls — the AI bot can dial this number',
  sent:     'The approval message was sent; the guest has not tapped Allow yet',
  not_sent: 'Nobody has asked this guest for call permission yet',
}

/** What one row's Call approval column knows. */
export type CallApprovalCell = {
  state: CallApprovalState
  /** The number the approval applies to — digits only, as the bot dials it. */
  phone: string | null
  /** When the approval message last went out. */
  requestedAt: string | null
  /** When the guest accepted. */
  approvedAt: string | null
}

export const emptyCallApproval = (): CallApprovalCell => ({
  state: 'not_sent', phone: null, requestedAt: null, approvedAt: null,
})

/** One line for the exports, where there is no room for a chip and a date. */
export function callApprovalSummary(cell: CallApprovalCell): string {
  if (cell.state === 'approved') {
    return cell.approvedAt ? `Approved ${cell.approvedAt.slice(0, 10)}` : 'Approved'
  }
  if (cell.state === 'sent') {
    return cell.requestedAt ? `Sent ${cell.requestedAt.slice(0, 10)} — not approved yet` : 'Sent — not approved yet'
  }
  return 'Not sent'
}

// ─── Filtering the sheet by approval state ────────────────────────────────────

/**
 * The desk works this column as a worklist, not as a report: "who still has to
 * be asked", "who was asked and never answered", "who cannot be asked at all".
 * Scanning several hundred rows for that is exactly what the column was meant
 * to stop, so the header offers the same four buckets as a filter.
 *
 * `no_phone` is not a fourth ledger state — it is the `not_sent` rows the send
 * button cannot help, because the booking carries no number to send to. Those
 * belong with the contact desk rather than with whoever is clicking *Send*, so
 * `not_sent` deliberately excludes them.
 */
export const CALL_APPROVAL_FILTERS = ['all', 'approved', 'sent', 'not_sent', 'no_phone'] as const
export type CallApprovalFilter = typeof CALL_APPROVAL_FILTERS[number]

export const CALL_APPROVAL_FILTER_LABEL: Record<CallApprovalFilter, string> = {
  all:      'All call approvals',
  approved: 'Approved',
  sent:     'Sent — not approved yet',
  not_sent: 'Not sent',
  no_phone: 'No contact number to send',
}

/** Short form for the context strip, where "All …" is never shown. */
export const CALL_APPROVAL_FILTER_CHIP: Record<CallApprovalFilter, string> = {
  all:      '',
  approved: 'Approved only',
  sent:     'Sent — not approved yet',
  not_sent: 'Not sent',
  no_phone: 'No contact number',
}

export function isCallApprovalFilter(v: string | null | undefined): v is CallApprovalFilter {
  return !!v && (CALL_APPROVAL_FILTERS as readonly string[]).includes(v)
}

/** Does one row's cell belong in the chosen bucket? */
export function matchesCallApprovalFilter(cell: CallApprovalCell, f: CallApprovalFilter): boolean {
  const hasPhone = Boolean(cell.phone && cell.phone.trim())
  switch (f) {
    case 'approved': return cell.state === 'approved'
    case 'sent':     return cell.state === 'sent'
    case 'not_sent': return cell.state === 'not_sent' && hasPhone
    case 'no_phone': return !hasPhone
    default:         return true
  }
}
