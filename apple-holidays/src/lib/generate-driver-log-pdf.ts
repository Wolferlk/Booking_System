/**
 * Driver Log (Sri Lanka) — printable "Driver Advance Sheet" PDF.
 *
 * Renders the effective driver-log view (see driver-log-server.ts) as a clean,
 * driver-facing A4 sheet and hands it to the shared Puppeteer html→pdf pipeline.
 * The same HTML is reused as the receipt body sent over WhatsApp.
 */
import { htmlToPdf } from '@/lib/html-to-pdf'
import { CATEGORY_LABEL, formatDetailMeta, type DriverLogCategory, type LineDetailMeta } from '@/lib/driver-log'
import type { DriverLogView } from '@/lib/driver-log-server'

function money(n: number, currency: string): string {
  const amount = Number.isFinite(n) ? n : 0
  const raw    = (currency ?? '').trim()
  const code   = raw.toUpperCase()

  // `style: 'currency'` only accepts valid ISO-4217 codes. Sri Lanka sheets often
  // carry "Rs", "Rs.", "US$" or an empty string, which make Intl throw a
  // RangeError and blow up the whole PDF. Guard against that and fall back to a
  // plain grouped number prefixed with the raw label.
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: code, minimumFractionDigits: 2,
      }).format(amount)
    } catch {
      /* invalid ISO code — fall through to the plain format below */
    }
  }

  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
  return raw ? `${raw} ${num}` : num
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function lineRows(
  lines: { label: string; detail: string; amount: number; category: DriverLogCategory; meta?: LineDetailMeta }[],
  currency: string,
): string {
  if (lines.length === 0) {
    return `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:10px;">No items</td></tr>`
  }
  return lines.map(l => {
    const detail = formatDetailMeta(l.meta) || l.detail
    return `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;">
        <div style="font-weight:600;color:#1e293b;">${esc(l.label)}</div>
        <div style="font-size:10px;color:#94a3b8;">${esc(CATEGORY_LABEL[l.category])}${detail ? ' · ' + esc(detail) : ''}</div>
      </td>
      <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;font-weight:600;color:#334155;white-space:nowrap;">
        ${money(l.amount, currency)}
      </td>
    </tr>`
  }).join('')
}

export function renderDriverLogHtml(view: DriverLogView): string {
  const c = view.computation
  const cur = c.currency

  const summaryCard = (
    title: string, total: number, pct: number, advance: number, accent: string,
  ) => `
    <div style="flex:1;border:1px solid ${accent}33;background:${accent}0d;border-radius:12px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${accent};">${title}</div>
      <table style="width:100%;margin-top:8px;font-size:12px;color:#475569;">
        <tr><td style="padding:2px 0;">Total</td><td style="text-align:right;font-family:monospace;font-weight:600;">${money(total, cur)}</td></tr>
        <tr><td style="padding:2px 0;">Advance %</td><td style="text-align:right;font-family:monospace;font-weight:600;">${pct}%</td></tr>
        <tr><td style="padding:6px 0 0;font-weight:800;color:#0f172a;border-top:1px solid ${accent}33;">Advance Amount</td>
            <td style="padding:6px 0 0;text-align:right;font-family:monospace;font-weight:800;font-size:15px;color:${accent};border-top:1px solid ${accent}33;">${money(advance, cur)}</td></tr>
      </table>
    </div>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; padding:24px 32px; }
  h1 { font-size:20px; margin:0; }
  table { border-collapse: collapse; width:100%; }
  .section-title { font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:18px 0 6px; }
  .meta td { font-size:12px; color:#475569; padding:2px 12px 2px 0; }
  .meta td b { color:#0f172a; }
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #eab308;padding-bottom:10px;">
    <div>
      <h1>Driver Advance Sheet</h1>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">Sri Lanka Operations · Apple Holidays</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:13px;font-weight:800;font-family:monospace;color:#b45309;">${esc(view.bookingRef)}</div>
      <div style="font-size:11px;color:#94a3b8;">Generated ${fmtDate(new Date())}</div>
    </div>
  </div>

  <table class="meta" style="margin-top:12px;">
    <tr>
      <td><b>Driver:</b> ${esc(view.driverName ?? '—')}</td>
      <td><b>WhatsApp:</b> ${esc(view.driverPhone ?? '—')}</td>
      <td><b>Lead Guest:</b> ${esc(view.leadPassenger ?? '—')}</td>
    </tr>
    <tr>
      <td><b>Tour Start:</b> ${fmtDate(view.arrivalDate)}</td>
      <td><b>Tour End:</b> ${fmtDate(view.departureDate)}</td>
      <td><b>Pax:</b> ${view.paxAdults ?? 0} adult(s), ${view.paxChildren ?? 0} child(ren)</td>
    </tr>
  </table>

  <div style="display:flex;gap:14px;margin-top:16px;">
    ${summaryCard('Tour Advance', c.tourAdvanceBase, c.tourPct, c.tourAdvance, '#7c3aed')}
    ${summaryCard('Fuel Advance', c.fuelTotal, c.fuelPct, c.fuelAdvance, '#2563eb')}
    <div style="flex:1;border:1px solid #16a34a33;background:#16a34a0d;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:center;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#16a34a;">Total Advance</div>
      <div style="font-family:monospace;font-weight:800;font-size:22px;color:#15803d;margin-top:6px;">${money(c.grandAdvance, cur)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px;">of ${money(c.grandTotal, cur)} total</div>
    </div>
  </div>

  <div style="margin-top:12px;border:1px solid #fbbf2433;background:#fbbf240d;border-radius:12px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <span style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#b45309;">Rest Payment</span>
      <span style="font-size:11px;color:#94a3b8;margin-left:8px;">balance after advance${c.excludedTotal > 0 ? ` · incl. excluded ${money(c.excludedTotal, cur)}` : ''}</span>
    </div>
    <div style="font-family:monospace;font-weight:800;font-size:16px;color:#92400e;">${money(c.restPayment, cur)}</div>
  </div>

  <div class="section-title">Tour Advance — Lunch &amp; Entrance Tickets</div>
  <table style="border:1px solid #ede9fe;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.tourLines, cur)}</tbody>
    <tfoot><tr style="background:#f5f3ff;">
      <td style="padding:8px 10px;font-weight:800;color:#6d28d9;">Tour Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#6d28d9;">${money(c.tourTotal, cur)}</td>
    </tr></tfoot>
  </table>

  <div class="section-title">Fuel Advance — Accommodation, Travel (KM × Rate) &amp; Water</div>
  <table style="border:1px solid #dbeafe;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.fuelLines, cur)}</tbody>
    <tfoot><tr style="background:#eff6ff;">
      <td style="padding:8px 10px;font-weight:800;color:#1d4ed8;">Fuel Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#1d4ed8;">${money(c.fuelTotal, cur)}</td>
    </tr></tfoot>
  </table>

  ${c.otherLines.length > 0 ? `
  <div class="section-title">Other — Advanced as Tour</div>
  <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.otherLines, cur)}</tbody>
    <tfoot><tr style="background:#f8fafc;">
      <td style="padding:8px 10px;font-weight:800;color:#475569;">Other Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#475569;">${money(c.otherTotal, cur)}</td>
    </tr></tfoot>
  </table>` : ''}

  ${c.excludedLines.length > 0 ? `
  <div class="section-title">Excluded (not advanced) — Bata &amp; Guide Fee</div>
  <table style="border:1px solid #fee2e2;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.excludedLines, cur)}</tbody>
  </table>` : ''}

  ${view.notes ? `
  <div class="section-title">Notes</div>
  <div style="font-size:12px;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;">${esc(view.notes)}</div>` : ''}

  <div style="margin-top:28px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">
    <div>Driver signature: ________________________</div>
    <div>Ground team: ________________________</div>
  </div>
</body></html>`
}

export async function generateDriverLogPdf(view: DriverLogView): Promise<{ buffer: Buffer; filename: string }> {
  const html = renderDriverLogHtml(view)
  const filename = `DriverAdvance-${view.bookingRef}-${Date.now()}.pdf`
  const buffer = await htmlToPdf(html, filename, { bookingRef: view.bookingRef })
  return { buffer, filename }
}
