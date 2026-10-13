/** Booking status labels and tones — same names as the web's STATUS_LABELS. */
export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', BT_CONFIRMED: 'Booking Confirmed', GT_REVIEW: 'Need Review by TE', CHANGE_REQUESTED: 'Changes Requested',
  GT_VERIFIED: 'Client Confirmed', AWAITING_PAYMENT_CONFIRM: 'Awaiting Payment', OPERATIONS_READY: 'Operations Ready',
  CLIENT_LIVE: 'Portal Live', IN_PROGRESS: 'In Progress', TE_REVIEWED: 'TE Reviewed', DRIVER_ALLOCATED: 'Driver Allocated',
  QC1_PASS: 'QC1 Pass', TICKETS_ISSUED: 'Tickets Issued', QC2_PASS: 'QC2 Pass', MSG_SENT_CUSTOMER: 'Message Sent',
  FEEDBACK_DONE: 'Feedback Done', COMPLETED: 'Completed', PENDING_CANCELLATION: 'Cancelling (Accounts)',
  CANCELLED: 'Cancelled', AMENDED: 'Amended',
};

export type Tone = 'red' | 'gold' | 'green' | 'blue' | 'dim';

export function statusTone(s: string): Tone {
  if (['CANCELLED', 'PENDING_CANCELLATION', 'CHANGE_REQUESTED'].includes(s)) return 'red';
  if (['COMPLETED', 'FEEDBACK_DONE', 'QC2_PASS'].includes(s)) return 'green';
  if (['IN_PROGRESS', 'CLIENT_LIVE', 'OPERATIONS_READY', 'DRIVER_ALLOCATED', 'TICKETS_ISSUED', 'TE_REVIEWED', 'QC1_PASS', 'MSG_SENT_CUSTOMER'].includes(s)) return 'blue';
  if (['DRAFT', 'AMENDED'].includes(s)) return 'dim';
  return 'gold';
}

/** The operation checklist strip on the booking page, in order. */
export const CHECKLIST: { status: string; label: string; icon: string }[] = [
  { status: 'GT_REVIEW', label: 'TE review', icon: 'person' },
  { status: 'GT_VERIFIED', label: 'Client verified', icon: 'checkmark-done' },
  { status: 'DRIVER_ALLOCATED', label: 'Driver', icon: 'car' },
  { status: 'QC1_PASS', label: 'QC1', icon: 'shield-checkmark' },
  { status: 'TICKETS_ISSUED', label: 'Tickets', icon: 'ticket' },
  { status: 'QC2_PASS', label: 'QC2', icon: 'search' },
  { status: 'MSG_SENT_CUSTOMER', label: 'Message', icon: 'chatbubble' },
  { status: 'FEEDBACK_DONE', label: 'Feedback', icon: 'star' },
  { status: 'COMPLETED', label: 'Completed', icon: 'flag' },
];

const ORDER = ['DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED', 'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS', 'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS', 'TICKETS_ISSUED', 'QC2_PASS', 'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE', 'COMPLETED'];
export function reached(current: string, step: string): boolean {
  const a = ORDER.indexOf(current), b = ORDER.indexOf(step);
  return a >= 0 && b >= 0 && a >= b;
}

export const FLAG: Record<string, string> = { SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬', ALL: '🌏' };

export function money(v: unknown, cur = 'USD') {
  const n = Number(v ?? 0);
  return `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
