/**
 * What Meta says happened to a message we sent.
 *
 * ---- Why this is its own module ----
 *
 * A send returning 200 means Meta accepted the call, nothing more. The number
 * may not be on WhatsApp; the template may be unapproved; the 24-hour window
 * may have shut between our check and the send. Meta reports the truth minutes
 * later as a *status* against the message id, and until that status is written
 * down, "I sent the driver his documents" and "the driver has his documents"
 * are the same sentence in this system — which is exactly how a driver ends up
 * at the airport at 4am without a name board.
 *
 * ---- Why two callers ----
 *
 * A WhatsApp number delivers its webhook to exactly one endpoint, and on the
 * Operations number that endpoint is n8n's (see `whatsapp-shared-inbox-sync`).
 * So statuses can reach this system two ways, and both land here:
 *
 *   /api/webhooks/whatsapp          when Meta points at us directly
 *   /api/webhooks/whatsapp-status-signal
 *                                   when n8n forwards them, the same way it
 *                                   already forwards inbound replies
 *
 * One implementation behind both, so the two paths cannot drift into disagreeing
 * about what "delivered" means.
 */
import { prisma } from '@/lib/prisma'

/** A delivery receipt, in Meta's own shape. */
export interface MetaDeliveryStatus {
  /** The wamid of the outbound message this is about. */
  id: string
  /** sent | delivered | read | failed. */
  status: string
  /** Unix seconds. */
  timestamp?: string | number
  recipient_id?: string
  errors?: Array<{
    code?: number
    title?: string
    message?: string
    error_data?: { details?: string }
  }>
}

/**
 * The ladder only ever climbs.
 *
 * Statuses arrive out of order and are re-sent — a `sent` landing after a
 * `read` is normal traffic, not a regression — so a lower rank never walks a
 * row backwards. `failed` is the exception: it is always the last word, because
 * a message that failed after appearing to be sent is precisely the news the
 * desk needs and the one a rank comparison would throw away.
 */
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

/** Meta's error blob, flattened into a sentence an operator can act on. */
function reasonOf(status: MetaDeliveryStatus): string | null {
  if (!status.errors?.length) return null
  return status.errors
    .map(e =>
      [e.title, e.message, e.error_data?.details].filter(Boolean).join(' — ') ||
      `Meta error ${e.code ?? ''}`.trim())
    .join('; ')
}

/**
 * Pull the statuses out of whatever shape arrived.
 *
 * Accepts a full Meta webhook payload, a bare `{ statuses: [...] }` value
 * object, a single status, or an array of them — because the forwarder on the
 * other side is somebody else's workflow and will send whichever of those is
 * easiest for it. Anything unrecognisable yields an empty list rather than an
 * error: a malformed receipt must never look like a failed delivery.
 */
export function extractStatuses(payload: unknown): MetaDeliveryStatus[] {
  if (!payload || typeof payload !== 'object') return []

  const asRecord = payload as Record<string, unknown>
  const out: MetaDeliveryStatus[] = []

  const push = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const s = value as Record<string, unknown>
    if (typeof s.id === 'string' && typeof s.status === 'string') out.push(s as unknown as MetaDeliveryStatus)
  }

  if (Array.isArray(payload)) {
    for (const item of payload) push(item)
    return out
  }

  // A full webhook payload.
  const entries = asRecord.entry
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const changes = (entry as Record<string, unknown>)?.changes
      if (!Array.isArray(changes)) continue
      for (const change of changes) {
        const value = (change as Record<string, unknown>)?.value as Record<string, unknown> | undefined
        if (Array.isArray(value?.statuses)) for (const s of value!.statuses as unknown[]) push(s)
      }
    }
  }

  // A bare value object, or a wrapper carrying one.
  if (Array.isArray(asRecord.statuses)) for (const s of asRecord.statuses as unknown[]) push(s)

  // A single status.
  push(payload)

  // The same receipt can be reached by two of the branches above.
  const seen = new Set<string>()
  return out.filter(s => {
    const key = `${s.id}:${s.status}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface ApplyResult {
  /** Receipts we understood. */
  seen: number
  /** Chat messages moved. */
  messages: number
  /** Driver-document receipts moved. */
  documents: number
}

/**
 * Record what Meta reported.
 *
 * Two things move: the chat message, so a thread shows its ticks, and the
 * driver-document receipt, so the Drive Log can say that this morning's
 * settlement pack never reached the driver's phone.
 *
 * Never throws. This runs behind a webhook that must answer 200 or Meta will
 * retry the whole payload, and a receipt we failed to file is not worth
 * replaying a hundred others for.
 */
export async function applyDeliveryStatuses(statuses: MetaDeliveryStatus[]): Promise<ApplyResult> {
  const result: ApplyResult = { seen: 0, messages: 0, documents: 0 }

  for (const s of statuses) {
    if (!s?.id || !s.status) continue

    const status = String(s.status).toLowerCase()
    const rank   = RANK[status]
    if (rank === undefined) continue

    result.seen += 1

    const stamp = Number(s.timestamp)
    const at = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000) : new Date()
    const reason = reasonOf(s)

    // The chat log. `updateMany` because a wamid is unique in practice but not
    // by constraint, and a receipt for a message we never stored is a no-op
    // rather than an error.
    try {
      const moved = await prisma.whatsAppMessage.updateMany({
        where: { waMessageId: s.id },
        data:  { status },
      })
      result.messages += moved.count
    } catch (err) {
      console.warn('[WA status] chat log update failed:', err instanceof Error ? err.message : err)
    }

    // The document receipt.
    try {
      const row = await prisma.driverDocSend.findFirst({
        where:  { waMessageId: s.id },
        select: { id: true, status: true },
      })
      if (!row) continue
      if (status !== 'failed' && (RANK[row.status] ?? 0) >= rank) continue

      await prisma.driverDocSend.update({
        where: { id: row.id },
        data: {
          status,
          ...(status === 'sent'      ? { sentAt: at }      : {}),
          ...(status === 'delivered' ? { deliveredAt: at } : {}),
          ...(status === 'read'      ? { readAt: at }      : {}),
          ...(status === 'failed'
            ? { failedAt: at, failureReason: reason ?? 'WhatsApp could not deliver this message.' }
            : {}),
        },
      })
      result.documents += 1
    } catch (err) {
      console.warn('[WA status] delivery receipt update failed:', err instanceof Error ? err.message : err)
    }
  }

  return result
}
