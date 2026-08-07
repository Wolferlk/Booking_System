/**
 * Driver Log (Sri Lanka) — printable "Driver Advance Sheet".
 *
 * Two renderers over the same effective view (see driver-log-server.ts):
 *
 *   renderDriverLogHtml()  — the on-screen / print-preview HTML. Served by
 *                            GET /api/bookings/[ref]/driver-log/print so staff can
 *                            "Save as PDF" straight from the browser's print dialog.
 *   generateDriverLogPdf() — a real PDF buffer for the WhatsApp attachment.
 *
 * The PDF is drawn with PDFKit, deliberately NOT Chromium/puppeteer: the
 * serverless host is arm64 and @sparticuz/chromium ships x64 binaries only, so
 * the html→pdf route died at launch with ENOEXEC and every download/send failed
 * with a 500. Same reasoning (and the same helpers) as generate-agenda-pdf.ts.
 */
import { ensurePdfkitDataFiles, loadPdfDocumentCtor, loadLogo } from '@/lib/pdfkit-boot'
import { sanitizeText } from '@/lib/generate-agenda-pdf'
import { CATEGORY_LABEL, formatDetailMeta, type DriverLogCategory, type DriverLogLine, type LineDetailMeta } from '@/lib/driver-log'
import type { DriverLogView } from '@/lib/driver-log-server'

// ── Palette / geometry (matches generate-agenda-pdf.ts) ──────────────────────
const HEADER_BG = '#0F172A'
const BRAND     = '#D97706'
const DARK      = '#1E293B'
const MUTED     = '#64748B'
const LINE      = '#E2E8F0'
const GREEN     = '#059669'
const BLUE      = '#2563EB'
const PURPLE    = '#7C3AED'
const AMBER     = '#B45309'
const RED       = '#DC2626'

const PAGE_W    = 595
const PAGE_H    = 842
const MARGIN    = 40
const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM    = PAGE_H - MARGIN

/**
 * Money for both renderers. `style: 'currency'` only accepts valid ISO-4217
 * codes; Sri Lanka sheets often carry "Rs", "Rs." or an empty string, which make
 * Intl throw a RangeError and take the whole sheet down. Fall back to a plain
 * grouped number prefixed with the raw label.
 */
export function formatSheetMoney(n: number, currency: string): string {
  const amount = Number.isFinite(n) ? n : 0
  const raw    = (currency ?? '').trim()
  const code   = raw.toUpperCase()

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

const money = formatSheetMoney

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Filename used for the download and the WhatsApp document. */
export function driverLogFilename(bookingRef: string): string {
  return `DriverAdvance-${bookingRef}-${Date.now()}.pdf`
}

// ── HTML renderer (print view) ───────────────────────────────────────────────

function lineRows(
  lines: { label: string; detail: string; amount: number; category: DriverLogCategory; meta?: LineDetailMeta }[],
  currency: string,
): string {
  if (lines.length === 0) {
    return `<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:10px;">No items</td></tr>`
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
        ${esc(money(l.amount, currency))}
      </td>
    </tr>`
  }).join('')
}

/**
 * `autoPrint` opens the browser's print dialog on load — that is the "download"
 * path staff use (Save as PDF), so no server-side Chromium is involved.
 */
export function renderDriverLogHtml(view: DriverLogView, opts: { autoPrint?: boolean } = {}): string {
  const c = view.computation
  const cur = c.currency

  const summaryCard = (
    title: string, total: number, pct: number, advance: number, accent: string,
  ) => `
    <div style="flex:1;border:1px solid ${accent}33;background:${accent}0d;border-radius:12px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${accent};">${title}</div>
      <table style="width:100%;margin-top:8px;font-size:12px;color:#475569;">
        <tr><td style="padding:2px 0;">Total</td><td style="text-align:right;font-family:monospace;font-weight:600;">${esc(money(total, cur))}</td></tr>
        <tr><td style="padding:2px 0;">Advance %</td><td style="text-align:right;font-family:monospace;font-weight:600;">${pct}%</td></tr>
        <tr><td style="padding:6px 0 0;font-weight:800;color:#0f172a;border-top:1px solid ${accent}33;">Advance Amount</td>
            <td style="padding:6px 0 0;text-align:right;font-family:monospace;font-weight:800;font-size:15px;color:${accent};border-top:1px solid ${accent}33;">${esc(money(advance, cur))}</td></tr>
      </table>
    </div>`

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Driver Advance Sheet — ${esc(view.bookingRef)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; padding:24px 32px; }
  h1 { font-size:20px; margin:0; }
  table { border-collapse: collapse; width:100%; }
  .section-title { font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:18px 0 6px; }
  .meta td { font-size:12px; color:#475569; padding:2px 12px 2px 0; }
  .meta td b { color:#0f172a; }
  .toolbar { margin-bottom:14px; }
  .toolbar button { font:600 12px Arial, Helvetica, sans-serif; padding:7px 14px; border-radius:8px;
                    border:1px solid #d97706; background:#d97706; color:#fff; cursor:pointer; }
  @page { size: A4; margin: 12mm 10mm; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Download / Print PDF</button></div>

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
      <div style="font-family:monospace;font-weight:800;font-size:22px;color:#15803d;margin-top:6px;">${esc(money(c.grandAdvance, cur))}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px;">of ${esc(money(c.grandTotal, cur))} total</div>
    </div>
  </div>

  <div style="margin-top:12px;border:1px solid #fbbf2433;background:#fbbf240d;border-radius:12px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <span style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#b45309;">Rest Payment</span>
      <span style="font-size:11px;color:#94a3b8;margin-left:8px;">balance after advance${c.excludedTotal > 0 ? ` · incl. excluded ${esc(money(c.excludedTotal, cur))}` : ''}</span>
    </div>
    <div style="font-family:monospace;font-weight:800;font-size:16px;color:#92400e;">${esc(money(c.restPayment, cur))}</div>
  </div>

  <div class="section-title">Tour Advance — Lunch &amp; Entrance Tickets</div>
  <table style="border:1px solid #ede9fe;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.tourLines, cur)}</tbody>
    <tfoot><tr style="background:#f5f3ff;">
      <td style="padding:8px 10px;font-weight:800;color:#6d28d9;">Tour Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#6d28d9;">${esc(money(c.tourTotal, cur))}</td>
    </tr></tfoot>
  </table>

  <div class="section-title">Fuel Advance — Accommodation, Travel (KM × Rate) &amp; Water</div>
  <table style="border:1px solid #dbeafe;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.fuelLines, cur)}</tbody>
    <tfoot><tr style="background:#eff6ff;">
      <td style="padding:8px 10px;font-weight:800;color:#1d4ed8;">Fuel Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#1d4ed8;">${esc(money(c.fuelTotal, cur))}</td>
    </tr></tfoot>
  </table>

  ${c.otherLines.length > 0 ? `
  <div class="section-title">Other — Advanced as Tour</div>
  <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <tbody>${lineRows(c.otherLines, cur)}</tbody>
    <tfoot><tr style="background:#f8fafc;">
      <td style="padding:8px 10px;font-weight:800;color:#475569;">Other Total</td>
      <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:800;color:#475569;">${esc(money(c.otherTotal, cur))}</td>
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
${opts.autoPrint ? `  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 400) })</script>` : ''}
</body></html>`
}

/**
 * A one-page placeholder PDF. Meta wants a sample attachment before it will
 * review a DOCUMENT-header template, and it never reaches a driver — it only
 * shows reviewers what the header slot carries.
 */
export async function sampleAdvanceSheetPdf(): Promise<Buffer> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new (PDFDocument as any)({ margin: MARGIN, size: 'A4' })
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.rect(0, 0, PAGE_W, 74).fill(HEADER_BG)
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
      .text('Driver Advance Sheet', MARGIN, 20, { lineBreak: false })
    doc.fillColor('#CBD5E1').font('Helvetica').fontSize(9)
      .text('Sri Lanka Operations - Apple Holidays', MARGIN, 42, { lineBreak: false })
    doc.rect(0, 74, PAGE_W, 3).fill(BRAND)

    doc.fillColor(DARK).font('Helvetica').fontSize(11)
      .text(
        'Sample document. The live sheet lists the tour and fuel advance line items, ' +
        'the advance percentages, the total advance and the rest payment for one booking.',
        MARGIN, 120, { width: CONTENT_W },
      )
    doc.end()
  })
}

// ── PDF renderer (WhatsApp attachment / server-side download) ────────────────

function txt(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return '—'
  return sanitizeText(String(value))
}

export async function generateDriverLogPdf(
  view: DriverLogView,
): Promise<{ buffer: Buffer; filename: string }> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()
  const logo = await loadLogo()

  const c   = view.computation
  const cur = c.currency

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new (PDFDocument as any)({
      margin: MARGIN, size: 'A4', bufferPages: true, autoFirstPage: true,
    })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    /** Start a new page when `needed` points don't fit below the cursor. */
    function ensureSpace(needed: number) {
      if (doc.y + needed > BOTTOM) {
        doc.addPage()
        doc.y = MARGIN
      }
    }

    function drawHeader() {
      doc.rect(0, 0, PAGE_W, 74).fill(HEADER_BG)

      let nameX = 16
      if (logo) {
        try {
          doc.image(logo, 12, 9, { height: 54, fit: [54, 54] })
          nameX = 78
        } catch { /* unsupported logo format — text header still renders */ }
      }

      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
        .text('Driver Advance Sheet', nameX, 15, { lineBreak: false })
      doc.fillColor('#CBD5E1').font('Helvetica').fontSize(8)
        .text('Sri Lanka Operations - Apple Holidays', nameX, 36, { lineBreak: false })

      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(15)
        .text(txt(view.bookingRef), MARGIN, 14, { width: CONTENT_W, align: 'right', lineBreak: false })
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7.5)
        .text(`Generated ${fmtDate(new Date())}`, MARGIN, 34, { width: CONTENT_W, align: 'right', lineBreak: false })

      doc.rect(0, 74, PAGE_W, 3).fill(BRAND)
      doc.y = 90
    }

    function sectionTitle(title: string) {
      ensureSpace(40)
      doc.moveDown(0.5)
      const sy = doc.y
      doc.rect(MARGIN, sy, 4, 18).fill(BRAND)
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
        .text(sanitizeText(title).toUpperCase(), MARGIN + 10, sy + 3, { width: CONTENT_W - 10 })
      doc.moveDown(0.3)
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
        .strokeColor(LINE).lineWidth(0.5).stroke()
      doc.moveDown(0.4)
    }

    /** Two-column key/value strip, three pairs per row. */
    function metaGrid(pairs: [string, string][]) {
      const colW = CONTENT_W / 3
      for (let i = 0; i < pairs.length; i += 3) {
        const row = pairs.slice(i, i + 3)
        ensureSpace(28)
        const ry = doc.y
        row.forEach(([label, value], ci) => {
          const x = MARGIN + ci * colW
          doc.fillColor(MUTED).font('Helvetica').fontSize(7)
            .text(label.toUpperCase(), x, ry, { width: colW - 8, lineBreak: false })
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
            .text(txt(value), x, ry + 10, { width: colW - 8, lineBreak: false })
        })
        doc.y = ry + 26
      }
    }

    /** Advance summary card (tour / fuel / total), laid out three across. */
    function summaryCards() {
      const gap  = 10
      const cw   = (CONTENT_W - gap * 2) / 3
      const ch   = 72
      ensureSpace(ch + 10)
      const cy = doc.y

      const card = (i: number, title: string, accent: string, rows: [string, string][], big?: string) => {
        const x = MARGIN + i * (cw + gap)
        doc.roundedRect(x, cy, cw, ch, 6).fillAndStroke('#FFFFFF', accent)
        doc.fillColor(accent).font('Helvetica-Bold').fontSize(7)
          .text(title.toUpperCase(), x + 8, cy + 7, { width: cw - 16, lineBreak: false })

        if (big) {
          doc.fillColor(accent).font('Helvetica-Bold').fontSize(13)
            .text(big, x + 8, cy + 26, { width: cw - 16, lineBreak: false })
          if (rows[0]) {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7)
              .text(rows[0][1], x + 8, cy + 48, { width: cw - 16, lineBreak: false })
          }
          return
        }

        let ry = cy + 22
        rows.forEach(([label, value], idx) => {
          const last = idx === rows.length - 1
          doc.fillColor(last ? DARK : MUTED).font(last ? 'Helvetica-Bold' : 'Helvetica').fontSize(last ? 9 : 7.5)
            .text(label, x + 8, ry, { width: (cw - 16) * 0.5, lineBreak: false })
          doc.fillColor(last ? accent : DARK).font('Helvetica-Bold').fontSize(last ? 9 : 7.5)
            .text(value, x + 8 + (cw - 16) * 0.45, ry, { width: (cw - 16) * 0.55, align: 'right', lineBreak: false })
          ry += last ? 14 : 13
        })
      }

      card(0, 'Tour Advance', PURPLE, [
        ['Total', money(c.tourAdvanceBase, cur)],
        ['Advance %', `${c.tourPct}%`],
        ['Advance', money(c.tourAdvance, cur)],
      ])
      card(1, 'Fuel Advance', BLUE, [
        ['Total', money(c.fuelTotal, cur)],
        ['Advance %', `${c.fuelPct}%`],
        ['Advance', money(c.fuelAdvance, cur)],
      ])
      card(2, 'Total Advance', GREEN, [
        ['', `of ${money(c.grandTotal, cur)} total`],
      ], money(c.grandAdvance, cur))

      doc.y = cy + ch + 8
    }

    /** Rest-payment strip. */
    function restStrip() {
      ensureSpace(34)
      const ry = doc.y
      doc.roundedRect(MARGIN, ry, CONTENT_W, 26, 6).fillAndStroke('#FFFBEB', '#FCD34D')
      doc.fillColor(AMBER).font('Helvetica-Bold').fontSize(8)
        .text('REST PAYMENT', MARGIN + 10, ry + 6, { width: 120, lineBreak: false })
      doc.fillColor(MUTED).font('Helvetica').fontSize(7)
        .text(
          `balance after advance${c.excludedTotal > 0 ? ` - incl. excluded ${money(c.excludedTotal, cur)}` : ''}`,
          MARGIN + 100, ry + 7, { width: CONTENT_W - 240, lineBreak: false },
        )
      doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(11)
        .text(money(c.restPayment, cur), MARGIN, ry + 5, { width: CONTENT_W - 10, align: 'right', lineBreak: false })
      doc.y = ry + 32
    }

    /** Line-item table with an optional coloured total row. */
    function lineTable(
      lines: DriverLogLine[],
      accent: string,
      totalLabel: string | null,
      totalValue: number | null,
    ) {
      const amountW = 110
      const labelW  = CONTENT_W - amountW

      if (lines.length === 0) {
        ensureSpace(22)
        doc.fillColor('#94A3B8').font('Helvetica-Oblique').fontSize(8)
          .text('No items', MARGIN + 4, doc.y + 4, { width: labelW })
        doc.y += 20
      }

      lines.forEach((l, i) => {
        const detail  = formatDetailMeta(l.meta) || l.detail
        const sub     = sanitizeText(
          `${CATEGORY_LABEL[l.category] ?? l.category}${detail ? ` - ${detail}` : ''}`,
        )
        const label   = sanitizeText(l.label || CATEGORY_LABEL[l.category] || '')
        const labelH  = doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(label, { width: labelW - 8 })
        const subH    = doc.font('Helvetica').fontSize(7).heightOfString(sub, { width: labelW - 8 })
        const rowH    = Math.max(22, labelH + subH + 9)

        if (doc.y + rowH > BOTTOM) { doc.addPage(); doc.y = MARGIN }

        const ry = doc.y
        if (i % 2 === 1) doc.rect(MARGIN, ry, CONTENT_W, rowH).fill('#F8FAFC')

        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
          .text(label, MARGIN + 4, ry + 4, { width: labelW - 8 })
        doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
          .text(sub, MARGIN + 4, ry + 4 + labelH + 1, { width: labelW - 8 })
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
          .text(money(l.amount, cur), MARGIN + labelW, ry + 5, { width: amountW - 6, align: 'right', lineBreak: false })

        doc.y = ry + rowH
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
          .strokeColor('#F1F5F9').lineWidth(0.5).stroke()
      })

      if (totalLabel !== null && totalValue !== null) {
        ensureSpace(22)
        const ty = doc.y
        doc.rect(MARGIN, ty, CONTENT_W, 18).fill('#F1F5F9')
        doc.fillColor(accent).font('Helvetica-Bold').fontSize(8.5)
          .text(sanitizeText(totalLabel), MARGIN + 4, ty + 5, { width: labelW - 8, lineBreak: false })
        doc.fillColor(accent).font('Helvetica-Bold').fontSize(9)
          .text(money(totalValue, cur), MARGIN + labelW, ty + 5, { width: amountW - 6, align: 'right', lineBreak: false })
        doc.y = ty + 22
      }
    }

    // ── Render ─────────────────────────────────────────────────────────────
    drawHeader()

    metaGrid([
      ['Driver',     view.driverName ?? ''],
      ['WhatsApp',   view.driverPhone ?? ''],
      ['Lead Guest', view.leadPassenger ?? ''],
      ['Tour Start', fmtDate(view.arrivalDate)],
      ['Tour End',   fmtDate(view.departureDate)],
      ['Pax',        `${view.paxAdults ?? 0} adult(s), ${view.paxChildren ?? 0} child(ren)`],
    ])

    doc.moveDown(0.4)
    summaryCards()
    restStrip()

    sectionTitle('Tour Advance - Lunch & Entrance Tickets')
    lineTable(c.tourLines, PURPLE, 'Tour Total', c.tourTotal)

    sectionTitle('Fuel Advance - Accommodation, Travel (KM x Rate) & Water')
    lineTable(c.fuelLines, BLUE, 'Fuel Total', c.fuelTotal)

    if (c.otherLines.length > 0) {
      sectionTitle('Other - Advanced as Tour')
      lineTable(c.otherLines, DARK, 'Other Total', c.otherTotal)
    }

    if (c.excludedLines.length > 0) {
      sectionTitle('Excluded (not advanced) - Bata & Guide Fee')
      lineTable(c.excludedLines, RED, null, null)
    }

    if (view.notes?.trim()) {
      sectionTitle('Notes')
      ensureSpace(30)
      doc.fillColor('#475569').font('Helvetica').fontSize(8.5)
        .text(sanitizeText(view.notes.trim()), MARGIN + 4, doc.y, { width: CONTENT_W - 8 })
      doc.moveDown(0.5)
    }

    ensureSpace(50)
    doc.moveDown(1.5)
    const sy = doc.y
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
      .text('Driver signature: ________________________', MARGIN, sy, { width: CONTENT_W / 2, lineBreak: false })
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
      .text('Ground team: ________________________', MARGIN, sy, { width: CONTENT_W, align: 'right', lineBreak: false })

    doc.end()
  })

  return { buffer, filename: driverLogFilename(view.bookingRef) }
}
