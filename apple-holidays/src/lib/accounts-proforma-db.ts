/**
 * Read-only window onto what Accounts has done with a proforma invoice.
 *
 * The paper and its values belong to this app (`proforma_invoices`). The money
 * belongs to the Accounts app: the payment slip, the Payable 1.0 line the
 * invoice was matched to, and the payment itself all live in
 * `invoice_processor.proforma_settlements`, written only there.
 *
 * That split is the point. If this app could write "paid", there would be two
 * places claiming to know whether a supplier has been paid, and they would
 * disagree the first time one of them failed halfway. So the booking screen
 * *asks* rather than remembers, and a settlement row that has not been written
 * yet reads as "no answer", never as "unpaid but definitely so".
 *
 * **Nothing in this file writes.** Every statement is a SELECT.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from './accounts-db'
import type { ProformaSettlement } from './proforma'

interface SettlementRow extends RowDataPacket {
  proforma_id: string
  hotel_name: string | null
  currency: string | null
  status: string
  payable_status: string | null
  payable_record_id: number | null
  paid_amount: string | number | null
  paid_at: Date | null
  paid_by: string | null
  payment_reference: string | null
  note: string | null
  slip_path: string | null
  slip_name: string | null
  updated_at: Date | null
}

const SELECT_COLS = [
  'proforma_id', 'hotel_name', 'currency', 'status', 'payable_status',
  'payable_record_id', 'paid_amount', 'paid_at', 'paid_by',
  'payment_reference', 'note', 'slip_path', 'slip_name', 'updated_at',
].join(', ')

function toSettlement(r: SettlementRow): ProformaSettlement {
  const hasReceipt = Boolean(r.slip_path)
  const accountsUrl = (process.env.ACCOUNTS_APP_URL ?? 'https://invoice-processor.aahaas.com').replace(/\/+$/, '')
  return {
    status: r.status,
    payableStatus: r.payable_status,
    payableMatched: r.payable_record_id != null,
    hotelName: r.hotel_name,
    currency: r.currency,
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    paidBy: r.paid_by,
    reference: r.payment_reference,
    note: r.note,
    hasReceipt,
    receiptName: r.slip_name,
    receiptUrl: hasReceipt
      ? `${accountsUrl}/proforma-invoices/${encodeURIComponent(r.proforma_id)}/slip`
      : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }
}

/**
 * Settlements for the given proforma ids, keyed by id.
 *
 * A failure here — the Accounts database unreachable, the table not created
 * yet — returns an empty map rather than throwing. The booking screen's job is
 * to show the invoices this app holds; Accounts' answer is an enrichment, and
 * losing it must degrade the screen, not break it.
 */
export async function settlementsFor(proformaIds: string[]): Promise<Map<string, ProformaSettlement>> {
  const ids = Array.from(new Set(proformaIds.filter(Boolean)))
  if (ids.length === 0) return new Map()

  try {
    const placeholders = ids.map(() => '?').join(', ')
    const rows = await accountsQuery<SettlementRow>(
      `SELECT ${SELECT_COLS} FROM proforma_settlements WHERE proforma_id IN (${placeholders})`,
      ids,
    )
    return new Map(rows.map(r => [r.proforma_id, toSettlement(r)]))
  } catch (err) {
    console.error('[accounts-proforma] settlement lookup failed:', err)
    return new Map()
  }
}
