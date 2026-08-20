/**
 * Printing the four Sri Lankan settlement sheets.
 *
 * The forms are reproductions of the paper ones the desk fills in today — same
 * blocks, same column order, same wording — so a driver who has handled the
 * printed version recognises what he is handed and a shop knows where to stamp.
 * Blank rows are printed on purpose: the sheet goes out with the tour and comes
 * back written on, and a form with no room to write is not the same document.
 *
 * ---- One PDF, two orientations ----
 *
 * The name board is landscape and the three settlement forms are portrait, and
 * the whole pack is expected to come down as *one* file. Chromium is asked for
 * `preferCSSPageSize`, and each section names a `@page` box of its own — so the
 * board is an A4 landscape page and the forms are A4 portrait pages inside a
 * single document. Nothing is rotated and nothing is scaled to fit; each sheet
 * prints at the size it was drawn for.
 *
 * ---- Rendered from the pack, never from the databases ----
 *
 * Everything printed here comes off the `SettlementDocPack` it is handed. What
 * the desk edited is what prints — this file has no access to a booking, a
 * driver or the accounts figures and cannot quietly substitute one.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import { launchBrowser } from './html-to-pdf'
import {
  DOC_LABEL, docDate, money, tourLineTotal, tourTotal, transportTotals,
  type SettlementDocKind, type SettlementDocPack,
} from './sl-settlement-docs'

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Line breaks the desk typed survive onto the paper. */
const escLines = (v: unknown): string => esc(v).replace(/\n/g, '<br>')

const COMPANY = {
  site:  'appleholidaysds.com',
  line:  '# 148, Aluthmawatha Road, Colombo 15, Telephone No : 0117423700',
}

// ── The logo ──────────────────────────────────────────────────────────────────

let logoCache: string | null | undefined

/**
 * The Apple Holidays mark, inlined as a data URI.
 *
 * Chromium renders the page with no network and no origin, so a `/logo.png`
 * would silently print as a broken image. Read once per process and cached;
 * a missing file is not an error — the sheets fall back to the wordmark, which
 * is what the paper forms carry anyway.
 */
async function logoDataUri(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'logo.png'))
    logoCache = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    logoCache = null
  }
  return logoCache
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** The masthead the printed forms carry. */
function masthead(title: string, logo: string | null): string {
  return `<div class="masthead">
    ${logo ? `<img class="mark" src="${logo}" alt="">` : ''}
    <div class="brand">
      <div class="site">${esc(COMPANY.site)}</div>
      <div class="addr">${esc(COMPANY.line)}</div>
    </div>
  </div>
  <h1 class="doc-title">${esc(title)}</h1>`
}

/** The six-line block that heads each settlement form. */
function headerTable(pack: SettlementDocPack, labels: Record<string, string>): string {
  const h = pack.header
  const rows: [string, string][] = [
    [labels.tourNo ?? 'Tour No', h.tourNo],
    [labels.arrival ?? 'Arrival Date', docDate(h.arrivalDate)],
    [labels.departure ?? 'Departure Date', docDate(h.departureDate)],
    [labels.pax ?? 'No of Pax', h.pax === null ? '' : String(h.pax)],
    [labels.handler ?? 'Tour Handler', h.tourHandler],
    [labels.driver ?? 'Driver Details', [h.driverName, h.vehiclePlate].filter(Boolean).join(' · ')],
  ]
  return `<table class="hdr">${rows
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')}</table>`
}

/** Rows to pad a table out to a full page, so there is somewhere to write. */
function blankRows(count: number, cells: number, cls = ''): string {
  if (count <= 0) return ''
  const tds = `<td${cls ? ` class="${cls}"` : ''}>&nbsp;</td>`.repeat(cells)
  return `<tr class="blank">${tds}</tr>`.repeat(count)
}

// ── Name board ────────────────────────────────────────────────────────────────

/**
 * The arrivals-hall board.
 *
 * One name, as large as the sheet allows, because it is read across a crowded
 * hall — everything else on the page is deliberately small, the logo included.
 * The type size steps down as the name gets longer so a four-word name still
 * fits on one line rather than wrapping to three.
 */
function nameBoardHtml(pack: SettlementDocPack, logo: string | null): string {
  const nb = pack.nameBoard
  const name = nb.guestName || '—'
  const size = name.length > 34 ? 68 : name.length > 24 ? 88 : name.length > 16 ? 110 : 132

  return `<section class="board">
    <div class="board-inner">
      ${logo ? `<img class="board-logo" src="${logo}" alt="">` : `<div class="board-wordmark">${esc(COMPANY.site)}</div>`}
      <div class="board-name" style="font-size:${size}px">${esc(name)}</div>
      ${nb.subtitle ? `<div class="board-sub">${esc(nb.subtitle)}</div>` : ''}
      <div class="board-foot">
        ${nb.footnote ? `<span>${esc(nb.footnote)}</span>` : ''}
        ${nb.showReference && pack.header.tourNo ? `<span class="board-ref">${esc(pack.header.tourNo)}</span>` : ''}
      </div>
    </div>
  </section>`
}

// ── Transport settlement ──────────────────────────────────────────────────────

function transportHtml(pack: SettlementDocPack, logo: string | null): string {
  const t = pack.transport
  const totals = transportTotals(t)

  const lines = t.lines.map(l => `<tr>
      <td class="dt">${esc(docDate(l.date) || l.date)}</td>
      <td class="desc">${escLines(l.description)}</td>
      <td class="amt">${esc(money(l.amount))}</td>
    </tr>`).join('')

  // The paper form is a full page of ruled lines. Keep it that way: the driver
  // and the desk write the tour's extras into it together at the counter.
  const pad = blankRows(Math.max(0, 16 - t.lines.length), 3)

  const foot = (label: string, rate: string, value: string) => `<tr>
      <th>${esc(label)}</th><td class="rate">${esc(rate)}</td><td class="amt">${esc(value)}</td>
    </tr>`

  return `<section class="form">
    ${masthead('TRANSPORT SETTLEMENT', logo)}
    ${headerTable(pack, {})}

    <table class="meta">
      <tr>
        <th>Vehicle Type &amp; Per KM Rate</th>
        <td>${esc([t.vehicleType, t.perKmRate !== null ? `LKR ${money(t.perKmRate)} / km` : ''].filter(Boolean).join(' — '))}</td>
        <th>Max Mileage</th><td>${esc(t.maxMileage === null ? '' : money(t.maxMileage))}</td>
        <th>Km</th><td>${esc(t.km === null ? '' : money(t.km))}</td>
        <th>Package Cost</th><td class="strong">${esc(money(t.packageCost))}</td>
      </tr>
    </table>

    <table class="grid">
      <thead><tr><th class="dt">Date</th><th class="desc">Description</th><th class="amt">Amount</th></tr></thead>
      <tbody>${lines}${pad}</tbody>
    </table>

    <div class="split">
      <table class="totals">
        ${foot('Total Mileage × Rs.', t.totals.totalMileageRate === null ? '' : money(t.totals.totalMileageRate), money(t.totals.totalMileageAmount))}
        ${foot('Batta × Rs.', t.totals.battaRate === null ? '' : `${money(t.totals.battaRate)}  ×  ${t.totals.battaCount ?? ''}`, money(t.totals.battaAmount))}
        <tr><th>Highway Tickets</th><td class="rate"></td><td class="amt">${esc(money(t.totals.highwayTickets))}</td></tr>
        <tr><th>Parking Tickets</th><td class="rate"></td><td class="amt">${esc(money(t.totals.parkingTickets))}</td></tr>
        <tr class="sum"><th>Total Cost</th><td class="rate"></td><td class="amt">${esc(money(totals.totalCost))}</td></tr>
        <tr><th>Fuel Advance</th><td class="rate"></td><td class="amt">${esc(money(t.totals.fuelAdvance))}</td></tr>
        <tr><th>Tour Advance</th><td class="rate"></td><td class="amt">${esc(money(t.totals.tourAdvance))}</td></tr>
        <tr class="sum"><th>Total Amount</th><td class="rate"></td><td class="amt">${esc(money(totals.balance))}</td></tr>
      </table>

      <table class="bank">
        <tr><th>Issue the cheque in favour of</th></tr>
        <tr><td class="pad">${escLines(t.chequeFavour)}</td></tr>
        <tr><th>Bank Details</th></tr>
        <tr><td class="pad">${escLines(t.bankDetails)}</td></tr>
        <tr><th>ID No</th></tr>
        <tr><td class="pad">${escLines(t.idNo)}</td></tr>
      </table>
    </div>

    ${t.note ? `<p class="note">${escLines(t.note)}</p>` : ''}

    <div class="signs">
      <div class="sign">Authorized By Operations Department</div>
      <div class="sign">Guide / Chauffeur</div>
    </div>
  </section>`
}

// ── Local visit settlement ────────────────────────────────────────────────────

function localVisitHtml(pack: SettlementDocPack, logo: string | null): string {
  const lv = pack.localVisit

  const sections = lv.sections.map(sec => {
    const shops = sec.shops.map((shop, i) => `<tr>
        ${i === 0 ? `<th class="cat" rowspan="${sec.shops.length}">${esc(sec.title)}</th>` : ''}
        <td class="shop">${esc(shop.name)}</td>
        <td class="sig">${escLines(shop.note)}</td>
      </tr>`).join('')
    // A section with no shops still prints — the stop exists, the name is
    // written in by hand.
    return shops || `<tr><th class="cat">${esc(sec.title)}</th><td class="shop">&nbsp;</td><td class="sig">&nbsp;</td></tr>`
  }).join('')

  return `<section class="form">
    ${masthead('LOCAL VISIT SETTLEMENT', logo)}
    ${headerTable(pack, {
      tourNo: 'Tour No', arrival: 'Arrival', departure: 'Departure',
      pax: 'Pax Count', handler: 'Tour Handler', driver: 'Driver / Supplier',
    })}
    ${lv.driverRef ? `<table class="meta"><tr><th>Driver</th><td colspan="7">${esc(lv.driverRef)}</td></tr></table>` : ''}

    <table class="grid visits">
      <thead><tr><th class="cat">Stop</th><th class="shop">Shop</th><th class="sig">Signature / Seal &amp; Date</th></tr></thead>
      <tbody>${sections}</tbody>
    </table>

    ${lv.note ? `<p class="note">${escLines(lv.note)}</p>` : ''}

    <div class="signs">
      <div class="sign">Authorized By Operations Department</div>
      <div class="sign">Guide / Chauffeur</div>
    </div>
  </section>`
}

// ── Tour settlement ───────────────────────────────────────────────────────────

function tourHtml(pack: SettlementDocPack, logo: string | null): string {
  const to = pack.tour
  const total = tourTotal(to)

  const lines = to.lines.map(l => `<tr>
      <td class="ent">${esc(l.name)}</td>
      <td class="amt">${esc(money(l.perPersonRate))}</td>
      <td class="cnt">${esc(l.count === null ? '' : String(l.count))}</td>
      <td class="amt">${esc(money(tourLineTotal(l)))}</td>
    </tr>`).join('')

  const pad = blankRows(Math.max(0, 18 - to.lines.length), 4)

  return `<section class="form">
    ${masthead('TOUR SETTLEMENT', logo)}

    <table class="hdr">
      <tr><th>Tour No</th><td>${esc(pack.header.tourNo)}</td></tr>
      <tr><th>Guide Name</th><td>${esc(to.guideName)}</td></tr>
      <tr><th>Chauffeur Name</th><td>${esc(to.chauffeurName)}</td></tr>
      <tr><th>Tour Handler</th><td>${esc(pack.header.tourHandler)}</td></tr>
    </table>

    <table class="grid">
      <thead><tr>
        <th class="ent">Entrance Tickets</th>
        <th class="amt">Per Person Rate</th>
        <th class="cnt">Count</th>
        <th class="amt">Total Cost</th>
      </tr></thead>
      <tbody>
        ${lines}${pad}
        <tr class="sum"><th colspan="3">Total Tour Cost</th><td class="amt">${esc(money(total))}</td></tr>
      </tbody>
    </table>

    ${to.note ? `<p class="note">${escLines(to.note)}</p>` : ''}

    <div class="signs">
      <div class="sign">Authorized By Operations Department</div>
      <div class="sign">Guide / Chauffeur</div>
    </div>
  </section>`
}

// ── The document ──────────────────────────────────────────────────────────────

const RENDERERS: Record<SettlementDocKind, (p: SettlementDocPack, logo: string | null) => string> = {
  name_board:  nameBoardHtml,
  transport:   transportHtml,
  local_visit: localVisitHtml,
  tour:        tourHtml,
}

const STYLES = `
  /* These are printed forms: they are white paper with black ink whatever the
     reader's system theme is, and the preview iframe inherits the same rule. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Two page boxes in one document — the board is landscape, the forms are not. */
  @page board { size: A4 landscape; margin: 0; }
  @page form  { size: A4 portrait;  margin: 10mm 9mm 12mm; }

  section.board { page: board; break-after: page; height: 100vh; width: 100%;
                  display: flex; align-items: center; justify-content: center; }
  section.form  { page: form; break-after: page; }
  section:last-child { break-after: auto; }

  /* ── Name board ── */
  .board-inner { text-align: center; padding: 0 18mm; width: 100%; }
  .board-logo { height: 62px; margin-bottom: 26px; }
  .board-wordmark { font-size: 20px; font-weight: 700; color: #d1002a; letter-spacing: -.5px; margin-bottom: 26px; }
  .board-name { font-weight: 800; line-height: 1.06; letter-spacing: -1.5px; word-break: break-word; }
  .board-sub { margin-top: 20px; font-size: 26px; color: #444; font-weight: 500; }
  .board-foot { margin-top: 34px; font-size: 13px; color: #8a8f98; display: flex;
                gap: 16px; justify-content: center; }
  .board-ref { font-family: "Courier New", monospace; }

  /* ── Forms ── */
  .masthead { display: flex; align-items: center; gap: 10px; justify-content: center; }
  .masthead .mark { height: 26px; }
  .masthead .brand { text-align: center; }
  .masthead .site { font-size: 21px; font-weight: 800; letter-spacing: -.6px; }
  .masthead .addr { font-size: 8px; color: #444; margin-top: 1px; }
  .doc-title { text-align: center; font-size: 13px; letter-spacing: 1px; margin: 7px 0 9px;
               text-decoration: underline; text-underline-offset: 3px; }

  table { width: 100%; border-collapse: collapse; }
  .hdr, .meta, .grid, .totals, .bank { border: 1px solid #111; }
  .hdr th, .hdr td, .meta th, .meta td, .grid th, .grid td,
  .totals th, .totals td, .bank th, .bank td { border: 1px solid #111; padding: 3px 5px; }

  .hdr { margin-bottom: 8px; }
  .hdr th { width: 130px; text-align: left; font-weight: 600; background: #fafafa; }
  .hdr td { height: 15px; }

  .meta { margin-bottom: 8px; }
  .meta th { text-align: left; font-weight: 600; background: #fafafa; white-space: nowrap; }
  .meta td { min-width: 46px; }
  .meta .strong { font-weight: 700; text-align: right; }

  .grid thead th { background: #f2f2f2; font-size: 9px; text-align: center; }
  .grid td { height: 15px; vertical-align: top; }
  .grid .dt  { width: 74px; }
  .grid .amt { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
  .grid .cnt { width: 60px; text-align: center; }
  .grid .ent { text-align: left; }
  .grid .sum th, .grid .sum td { font-weight: 800; background: #f7f7f7; text-align: right; }
  .blank td { height: 15px; }

  .visits .cat  { width: 150px; text-align: left; font-weight: 700; vertical-align: top; background: #fafafa; }
  .visits .shop { width: 150px; }
  .visits .sig  { height: 30px; }

  .split { display: flex; gap: 8px; margin-top: 9px; align-items: flex-start; }
  .totals { flex: 1; }
  .totals th { text-align: left; font-weight: 600; }
  .totals .rate { width: 96px; text-align: right; }
  .totals .amt  { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
  .totals .sum th, .totals .sum td { font-weight: 800; background: #f7f7f7; }
  .bank { width: 42%; }
  .bank th { text-align: left; background: #fafafa; font-weight: 600; }
  .bank .pad { height: 26px; vertical-align: top; }

  .note { margin-top: 8px; font-size: 9px; color: #333; white-space: pre-wrap;
          border: 1px dashed #bbb; padding: 5px 6px; }

  .signs { display: flex; justify-content: space-between; margin-top: 26px; font-size: 9px; }
  .sign { width: 44%; border-top: 1px dotted #111; padding-top: 3px; text-align: center; }
`

/**
 * The whole pack as one HTML document.
 *
 * Exported so the editor can preview exactly what will print, in an iframe,
 * rather than a second hand-built approximation of the same layout that would
 * drift from it within a week.
 */
export async function buildDocsHtml(
  pack: SettlementDocPack,
  kinds: SettlementDocKind[],
): Promise<string> {
  const logo = await logoDataUri()
  const body = kinds.map(k => RENDERERS[k](pack, logo)).join('\n')
  const title = kinds.length === 1
    ? `${DOC_LABEL[kinds[0]]} · ${pack.header.tourNo || pack.bookingRef}`
    : `Settlement documents · ${pack.header.tourNo || pack.bookingRef}`

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head><body>${body}</body></html>`
}

/** The pack as a PDF: landscape board, portrait forms, one file. */
export async function buildDocsPdf(
  pack: SettlementDocPack,
  kinds: SettlementDocKind[],
): Promise<Buffer> {
  const html = await buildDocsHtml(pack, kinds)

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    // `preferCSSPageSize` is what makes the mixed orientation work — without it
    // Chromium applies one page box to the whole document and the board is
    // squeezed onto a portrait sheet.
    const raw = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
