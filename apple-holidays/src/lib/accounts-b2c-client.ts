/**
 * Calls the Accounts system's B2C "Update booking" endpoint
 * (`POST {ACCOUNTS_APP_URL}/api/integrations/b2c-order-update`).
 *
 * The Accounts system keeps its own copy of every store order — a P&L record
 * and an AHS- invoice — so an update pressed here also refreshes those, and the
 * reverse call (`/api/integrations/b2c-update`) does the same for OPS when the
 * button is pressed there. Both directions use the one shared secret:
 * ACCOUNTS_INTEGRATION_SECRET here, OPS_REPAIR_SECRET / OPS_INTEGRATION_SECRET
 * there.
 *
 * Never throws. By the time Accounts is called the OPS half has already been
 * written, so a failure is reported, not rolled back.
 */

export interface AccountsPreview {
  order_id: number
  currency: string
  store: { sale: number; cost: number; profit: number; pax: number; lines: number; service_date: string | null; is_cancelled: boolean }
  pnl: {
    exists: boolean
    protected: boolean
    needs_update: boolean
    changes: { field: string; label: string; from: unknown; to: unknown }[]
    lines: {
      added: { line_id: number; product: string | null; sale: number; cost: number }[]
      removed: { line_id: number; product: string | null; sale: number; cost: number }[]
      changed: { line_id: number; product: string | null; from: { sale: number; cost: number; status: string | null }; to: { sale: number; cost: number; status: string | null } }[]
    }
  }
  invoice: {
    current: string | null
    current_total: number | null
    store_total: number
    action: 'none' | 'revise' | 'create' | 'blocked'
    next: string | null
    reason: string | null
    mail_mode: string | null
  }
  warnings: string[]
  unchanged: boolean
  available: boolean
  versions: { version_no: number; origin: string; triggered_by: string | null; ops_version: number | null; invoice_after: string | null; created_at: string | null }[]
}

export interface AccountsApplyResult {
  changed: boolean
  pnl_updated: boolean
  invoice: { status: string; message: string; invoice_number: string | null; revision_number: number | null } | null
  version_no: number | null
  sync_id: string
}

export type AccountsCall<T> =
  | { status: 'ok'; message: string | null; data: T }
  | { status: 'failed' | 'skipped'; message: string; data: null }

function config() {
  const url = (process.env.ACCOUNTS_APP_URL ?? 'https://invoice-processor.aahaas.com').replace(/\/+$/, '')
  const secret = process.env.ACCOUNTS_INTEGRATION_SECRET || ''
  return { url, secret }
}

async function call<T>(body: Record<string, unknown>): Promise<AccountsCall<T>> {
  const { url, secret } = config()
  if (!secret) {
    return { status: 'skipped', message: 'Accounts integration is not configured (ACCOUNTS_INTEGRATION_SECRET).', data: null }
  }
  try {
    const res = await fetch(`${url}/api/integrations/b2c-order-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
    })
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; message?: string; data?: T }
    if (res.status === 404) return { status: 'skipped', message: json.error || 'Accounts has no record of this order.', data: null }
    if (!res.ok || !json.success) {
      return { status: 'failed', message: json.error || json.message || `Accounts answered HTTP ${res.status}`, data: null }
    }
    return { status: 'ok', message: json.message ?? null, data: json.data as T }
  } catch (err) {
    return { status: 'failed', message: `Accounts unreachable: ${err instanceof Error ? err.message : String(err)}`, data: null }
  }
}

export function previewAccountsB2c(orderId: number) {
  return call<AccountsPreview>({ order_id: orderId, mode: 'preview' })
}

export function applyAccountsB2c(
  orderId: number,
  opts: { syncId: string; opsVersion: number | null; actor: string; pnl: boolean; invoice: boolean },
) {
  return call<AccountsApplyResult>({
    order_id: orderId,
    mode: 'apply',
    sync_id: opts.syncId,
    ops_version: opts.opsVersion ?? undefined,
    actor: opts.actor,
    pnl: opts.pnl,
    invoice: opts.invoice,
  })
}
