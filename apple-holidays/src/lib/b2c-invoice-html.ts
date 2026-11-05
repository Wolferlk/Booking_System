/**
 * The Aahaas B2C invoice (INV-<order>), rendered by OPS from the store's own
 * figures — the same document AahaasFlow issues, so a guest who forwards theirs
 * and the desk's copy agree line for line.
 *
 * Amounts are in the order currency (what the customer paid in). The base-
 * currency equivalent is printed underneath at the store's order-day rate,
 * labelled as such — it is a reference, not a second bill.
 *
 * Every value is escaped: product names and passenger names come from the
 * storefront and must never become markup.
 */
import type { B2cOrderMoney } from './b2c-order-money'

export const AAHAAS_COMPANY = {
  name: 'Aahaas',
  address: 'L27/ET/02, 27th Floor, East Tower, World Trade Center, Bank of Ceylon Mawatha, Colombo 1, Sri Lanka',
  phone: '+94 71 222 4227',
  email: 'info@aahaas.com',
  web: 'aahaas.com',
}

export const b2cInvoiceNo = (orderId: number) => `INV-${orderId}`

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmt(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${n}` : n
}

function longDate(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T00:00:00Z` : String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' })
}

export interface B2cInvoiceParties {
  /** Who the order is billed to. A shared desk login reads "Aahaas customer". */
  billTo: { name: string; email?: string | null; phone?: string | null }
  /** The traveller, as OPS holds them (lead passenger + the guest's contact). */
  lead: { name: string | null; email?: string | null; phone?: string | null }
}

export function renderB2cInvoiceHtml(
  money: B2cOrderMoney,
  parties: B2cInvoiceParties,
  opts: { issuedAt?: Date; forPdf?: boolean } = {},
): string {
  const cur = money.orderCurrency
  const base = money.baseCurrency
  const showBase = Boolean(base && cur && base !== cur && money.rate)
  const issued = longDate(opts.issuedAt ?? new Date())
  const booked = longDate(money.bookedAt)
  const no = b2cInvoiceNo(money.orderId)

  const stamp = money.settled
    ? { label: 'PAID', cls: 'ok' }
    : (money.paid.order ?? 0) > 0 ? { label: 'PART PAID', cls: 'wait' } : { label: 'PAYMENT DUE', cls: 'bad' }

  const rows = money.lines.map((l, i) => `
      <tr class="${l.cancelled ? 'cancelled' : ''}">
        <td class="idx">${i + 1}</td>
        <td><span class="what">${esc(l.title)}</span>${l.detail ? `<small>${esc(l.detail)}</small>` : ''}${l.cancelled ? '<small class="bad">Cancelled</small>' : ''}</td>
        <td class="num">${l.quantity > 0 ? esc(l.quantity) : '—'}</td>
        <td class="num keep">${fmt(l.cancelled ? 0 : l.total, l.currency || cur)}</td>
      </tr>`).join('')

  // The rows must add up to the total. A recorded discount explains the gap;
  // otherwise whatever separates services from the order value is shown as is.
  const gap = (money.productTotal.order ?? 0) - (money.orderValue.order ?? 0)
  const discount = money.discount.order && money.discount.order > 0.005
    ? { label: 'Discount', amount: money.discount.order }
    : Math.abs(gap) > 0.005 ? { label: 'Adjustment', amount: gap } : null
  const travel = money.firstService
    ? `${longDate(money.firstService)}${money.lastService && money.lastService !== money.firstService ? ` → ${longDate(money.lastService)}` : ''}`
    : 'Dates on each service'

  const baseBlock = showBase ? `
  <div class="fx">
    <div class="fx-head">Equivalent in ${esc(base)} <span>at the order-day rate · ${esc(money.rateLabel)}</span></div>
    <div class="fx-grid">
      <div><label>Total</label><b>${fmt(money.orderValue.base, base)}</b></div>
      <div><label>Paid</label><b>${fmt(money.paid.base, base)}</b></div>
      <div><label>Balance due</label><b>${fmt(money.balance.base, base)}</b></div>
    </div>
  </div>` : ''

  const printBar = opts.forPdf ? '' : `
<div class="bar"><span>${esc(no)} · ${esc(money.channelLabel)}</span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button></div>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(no)} · Aahaas</title>
<style>
  :root { --ink:#0f1f33; --ink-2:#475569; --ink-3:#64748b; --line:#e2e8f0; --red:#ef3b4a; --navy:#1b2b44; --ok:#047857; }
  * { box-sizing:border-box; }
  body { margin:0; background:#e8ecf2; color:var(--ink); font:13px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .bar { max-width:800px; margin:16px auto 0; display:flex; justify-content:space-between; align-items:center; color:var(--ink-3); font-size:12px; padding:0 4px; }
  .bar button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:6px 12px; font:inherit; color:var(--ink); cursor:pointer; }
  .page { max-width:800px; margin:12px auto 32px; background:#fff; padding:44px 44px 36px; border-top:5px solid var(--navy); position:relative; box-shadow:0 2px 12px rgba(15,31,51,.08); }
  .page::before { content:""; position:absolute; top:-5px; right:0; width:30%; height:5px; background:var(--red); }
  header { display:flex; justify-content:space-between; gap:24px; padding-bottom:18px; border-bottom:1px solid var(--line); }
  .brand { font-size:30px; font-weight:800; color:var(--red); letter-spacing:-.5px; }
  .co { color:var(--ink-3); font-size:11px; max-width:290px; margin-top:6px; }
  .doc { text-align:right; font-size:11.5px; color:var(--ink-2); }
  .doc h1 { margin:0 0 4px; font-size:22px; color:var(--ink); }
  .doc b { color:var(--ink); }
  .stamp { display:inline-block; margin-top:6px; padding:2px 10px; border-radius:999px; font-size:10.5px; font-weight:700; letter-spacing:.6px; border:1.5px solid; }
  .stamp.ok { color:var(--ok); border-color:var(--ok); background:#ecfdf5; }
  .stamp.wait { color:#b45309; border-color:#b45309; background:#fffbeb; }
  .stamp.bad { color:#b91c1c; border-color:#b91c1c; background:#fef2f2; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:18px 0; }
  .party { border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .party.soft { background:#f4f6fa; border-color:#f4f6fa; }
  .party label, .fx label { display:block; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; color:var(--ink-3); font-weight:700; margin-bottom:5px; }
  .party b { display:block; font-size:13.5px; }
  .party div { color:var(--ink-2); font-size:11.5px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; color:var(--ink-3); padding:8px 6px; border-bottom:1.5px solid var(--navy); }
  td { padding:10px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.idx { width:24px; color:var(--ink-3); }
  .num { text-align:right; } .keep { white-space:nowrap; }
  .what { font-weight:600; display:block; }
  td small { display:block; color:var(--ink-3); font-size:11px; margin-top:2px; }
  td small.bad { color:#b91c1c; }
  tr.cancelled .what { text-decoration:line-through; color:var(--ink-3); }
  .totals { margin:14px 0 0 auto; width:290px; }
  .totals div { display:flex; justify-content:space-between; padding:6px 6px; }
  .totals .grand { border-top:1.5px solid var(--navy); font-weight:800; font-size:14px; margin-top:4px; padding-top:9px; }
  .totals .paid { color:var(--ok); }
  .fx { margin-top:18px; border:1px dashed #cbd5e1; border-radius:8px; padding:10px 14px; }
  .fx-head { font-weight:700; font-size:12px; margin-bottom:8px; }
  .fx-head span { font-weight:400; color:var(--ink-3); }
  .fx-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .note { margin-top:18px; background:#f4f6fa; border-radius:6px; padding:10px 12px; font-size:11px; color:var(--ink-2); }
  footer { margin-top:28px; display:flex; justify-content:space-between; color:var(--ink-3); font-size:10.5px; border-top:1px solid var(--line); padding-top:10px; }
  @media (max-width:640px) { .page { padding:24px 16px; } header, .parties { display:block; } .doc { text-align:left; margin-top:12px; } .party { margin-bottom:10px; } .totals { width:100%; } .fx-grid { grid-template-columns:1fr; } }
  @media print { body { background:#fff; } .bar { display:none; } .page { margin:0; box-shadow:none; max-width:none; } }
</style></head>
<body>${printBar}
<div class="page">
  <header>
    <div>
      <div class="brand">${esc(AAHAAS_COMPANY.name)}</div>
      <div class="co">${esc(AAHAAS_COMPANY.address)}<br>${esc(AAHAAS_COMPANY.phone)} · ${esc(AAHAAS_COMPANY.email)} · ${esc(AAHAAS_COMPANY.web)}</div>
    </div>
    <div class="doc">
      <h1>Invoice</h1>
      <b>${esc(no)}</b><br>Order #${esc(money.orderId)}<br>
      ${issued ? `Issued ${esc(issued)}<br>` : ''}${booked ? `Booked ${esc(booked)}<br>` : ''}
      <span class="stamp ${stamp.cls}">${stamp.label}</span>
    </div>
  </header>

  <div class="parties">
    <div class="party">
      <label>Bill to</label>
      <b>${esc(parties.billTo.name)}</b>
      ${parties.billTo.email ? `<div>${esc(parties.billTo.email)}</div>` : ''}${parties.billTo.phone ? `<div>${esc(parties.billTo.phone)}</div>` : ''}
    </div>
    <div class="party soft">
      <label>Lead passenger</label>
      <b>${esc(parties.lead.name || '—')}</b>
      ${parties.lead.email ? `<div>${esc(parties.lead.email)}</div>` : ''}${parties.lead.phone ? `<div>${esc(parties.lead.phone)}</div>` : ''}
      <div>${esc(travel)}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Service</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No services on this order.</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <div><span>Services</span><span class="keep">${fmt(money.productTotal.order, cur)}</span></div>
    ${discount ? `<div><span>${discount.label}</span><span class="keep">${discount.amount >= 0 ? '−' : '+'} ${fmt(Math.abs(discount.amount), cur)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span class="keep">${fmt(money.orderValue.order, cur)}</span></div>
    <div class="paid"><span>Paid</span><span class="keep">${fmt(money.paid.order, cur)}</span></div>
    <div><span>Balance due</span><span class="keep">${fmt(money.balance.order, cur)}</span></div>
  </div>
  ${baseBlock}

  <div class="note"><b>Payment method:</b> ${esc(money.payCategory || money.paymentType || '—')}. Please quote <b>${esc(no)}</b> with any payment or question about this booking. Service vouchers and travel details are sent separately for each service.</div>

  <footer><span>${esc(AAHAAS_COMPANY.name)} · ${esc(AAHAAS_COMPANY.email)}</span><span>Thank you for travelling with Aahaas · ${esc(no)}</span></footer>
</div>
</body></html>`
}
