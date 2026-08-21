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
 * The name board is landscape and the three settlement forms are portrait by
 * default — and any one of them can be turned round and saved that way — while
 * the whole pack is expected to come down as *one* file. Chromium is asked for
 * `preferCSSPageSize`, and each document names a `@page` box of its own, sized
 * from the orientation saved on the pack, so a mixed-orientation pack prints as
 * a single document. Nothing is rotated and nothing is scaled to fit; each sheet
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
import { getUpload } from './storage'
import {
  DEFAULT_LOGO, DOC_LABEL, SUB_LOGOS, docDate, isSafeLogoPath, money, orientationOf,
  tourLineTotal, tourPrintedLines, tourTotal, transportTotals,
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

// ── The logos ─────────────────────────────────────────────────────────────────

const logoCache = new Map<string, string | null>()

/**
 * One mark, inlined as a data URI.
 *
 * Chromium renders the page with no network and no origin, so a `/png/x.png`
 * would silently print as a broken image, and the editor's preview — which is
 * this same HTML in a sandboxed iframe — has no origin either. So every mark is
 * read on the server and embedded in the document.
 *
 * Two kinds of path are understood, and nothing else: a file shipped in
 * `public`, and something uploaded into the bucket under `uploads/`. The path
 * has already been whitelisted by `isSafeLogoPath`; this re-checks it anyway,
 * because it is the function that actually opens a file. A mark that cannot be
 * read is not an error — the sheet falls back to the wordmark, which is what
 * the paper forms carry.
 */
async function logoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  if (logoCache.has(url)) return logoCache.get(url) ?? null
  if (!isSafeLogoPath(url)) { logoCache.set(url, null); return null }

  let uri: string | null = null
  try {
    if (url.startsWith('/api/uploads/')) {
      const stored = await getUpload(url.slice('/api/uploads/'.length))
      if (stored) uri = `data:${stored.contentType};base64,${stored.buffer.toString('base64')}`
    } else {
      const buf = await readFile(path.join(process.cwd(), 'public', ...url.slice(1).split('/')))
      const ext = url.split('.').pop()?.toLowerCase()
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/png'
      uri = `data:${mime};base64,${buf.toString('base64')}`
    }
  } catch {
    uri = null
  }

  logoCache.set(url, uri)
  return uri
}

/** Every mark one render needs, read once and handed to each sheet. */
interface Marks {
  /** The house mark on the settlement forms' masthead. */
  house: string | null
  /** The mark printed large at the top of the name board. */
  board: string | null
  /** The small row of company marks along the foot of the board. */
  subs: string[]
}

async function readMarks(pack: SettlementDocPack): Promise<Marks> {
  const [house, board, subs] = await Promise.all([
    logoDataUri('/logo.png'),
    logoDataUri(pack.nameBoard.logoUrl ?? DEFAULT_LOGO),
    Promise.all(SUB_LOGOS.map(logoDataUri)),
  ])
  return { house, board, subs: subs.filter((s): s is string => !!s) }
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
 * The type size for the name.
 *
 * One line if it can possibly be one line: the board is read across a crowded
 * hall, and a name broken over three lines reads as three names. The size steps
 * down with the longest word as well as the whole string, because "Wickramasinghe"
 * cannot be hyphenated on an arrivals board.
 */
function nameSize(name: string, base: number): number {
  const longest = name.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0)
  const byLength = name.length > 34 ? 0.52 : name.length > 24 ? 0.68 : name.length > 16 ? 0.84 : 1
  const byWord   = longest > 16 ? 0.6 : longest > 12 ? 0.78 : 1
  return Math.round(base * Math.min(byLength, byWord))
}

/** The small row of house marks along the foot, when the desk leaves it on. */
function subLogoRow(pack: SettlementDocPack, marks: Marks): string {
  if (!pack.nameBoard.showSubLogos || marks.subs.length === 0) return ''
  return `<div class="board-marks">
    ${marks.subs.map(src => `<img src="${src}" alt="">`).join('<span class="dot"></span>')}
  </div>`
}

/**
 * The arrivals-hall board.
 *
 * One name, as large as the sheet allows, because it is read across a crowded
 * hall — everything else on the page is deliberately small, the logos included.
 * The four layouts differ only in how the sheet is dressed around that name:
 * the accent colour and the type scale are the same decisions in each, so a
 * board is recognisably ours whichever one the desk picks.
 */
function nameBoardHtml(pack: SettlementDocPack, marks: Marks): string {
  const nb = pack.nameBoard
  const name = nb.guestName || '—'
  const ref = nb.showReference && pack.header.tourNo ? pack.header.tourNo : ''
  const logo = marks.board

  const mark = logo
    ? `<img class="board-logo" src="${logo}" alt="">`
    : `<div class="board-wordmark">${esc(COMPANY.site)}</div>`

  const foot = `<div class="board-foot">
      ${nb.footnote ? `<span>${esc(nb.footnote)}</span>` : ''}
      ${ref ? `<span class="board-ref">${esc(ref)}</span>` : ''}
    </div>`

  const sub = nb.subtitle ? `<div class="board-sub">${esc(nb.subtitle)}</div>` : ''
  // A portrait board is 210mm across instead of 297mm, so the name starts from
  // a smaller base before the length stepping is applied to it.
  const portrait = orientationOf(pack, 'name_board') === 'portrait'
  const base = portrait ? (nb.theme === 'minimal' ? 84 : 90) : (nb.theme === 'minimal' ? 124 : 132)
  const size = nameSize(name, base)
  const nameEl = `<div class="board-name" style="font-size:${size}px">${esc(name)}</div>`

  const body = (() => {
    switch (nb.theme) {
      case 'ribbon':
        return `<div class="ribbon-top">
            ${logo ? `<span class="chip"><img src="${logo}" alt=""></span>` : ''}
            <span class="ribbon-site">${esc(COMPANY.site)}</span>
          </div>
          <div class="board-inner">
            ${nameEl}
            ${sub}
            ${foot}
          </div>
          ${subLogoRow(pack, marks)}
          <div class="ribbon-bottom"></div>`

      case 'frame': {
        // The arrival day rather than a company name: whichever mark is printed
        // at the top may not be ours, and a board must never greet a guest in
        // the wrong house's name.
        const arrival = docDate(pack.header.arrivalDate)
        return `<div class="frame-rule"></div>
          <div class="board-inner">
            ${mark}
            <div class="frame-eyebrow">${arrival ? `Arrival · ${esc(arrival)}` : 'Welcome'}</div>
            ${nameEl}
            <div class="board-rule"></div>
            ${sub}
            ${foot}
          </div>
          ${subLogoRow(pack, marks)}`
      }

      case 'minimal':
        return `<div class="board-inner">
            ${mark}
            <div class="board-name min-name" style="font-size:${size}px">${esc(name)}<span class="min-dot"></span></div>
            <div class="board-rule"></div>
            ${sub}
            ${foot}
          </div>
          ${subLogoRow(pack, marks)}`

      default:
        return `<div class="wash"></div>
          <div class="board-inner">
            ${mark}
            ${nameEl}
            <div class="board-rule"></div>
            ${sub}
            ${foot}
          </div>
          ${subLogoRow(pack, marks)}`
    }
  })()

  return `<section class="board pg-name_board${portrait ? ' portrait' : ''} board-${esc(nb.theme)}" style="--accent:${esc(nb.accent)}">${body}</section>`
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

  return `<section class="form pg-transport">
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

  return `<section class="form pg-local_visit">
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

/**
 * The Tour Settlement sheet.
 *
 * Six columns, because every gate in the country charges adults and children
 * differently and the desk has always written both by hand in the margin. The
 * lines the tour did not take print greyed when the pack asks for them —
 * "considered, not settled" — and are simply absent when it does not, which is
 * what a driver is normally handed.
 *
 * The blank rows at the foot are on purpose: the sheet goes out with the tour
 * and comes back with a ticket price written into it that nobody costed.
 */
function tourHtml(pack: SettlementDocPack, logo: string | null): string {
  const to = pack.tour
  const total = tourTotal(to)
  const printed = tourPrintedLines(to)

  const cell = (v: number | null): string => esc(v === null ? '' : money(v))
  const whole = (v: number | null): string => esc(v === null ? '' : String(v))

  const lines = printed.map(l => `<tr class="${l.active ? 'on' : 'off'}">
      <td class="ent">${esc(l.name)}</td>
      <td class="amt">${cell(l.perPersonRate)}</td>
      <td class="cnt">${whole(l.count)}</td>
      <td class="amt">${cell(l.childRate)}</td>
      <td class="cnt">${whole(l.childCount)}</td>
      <td class="amt">${l.active ? esc(money(tourLineTotal(l))) : ''}</td>
    </tr>`).join('')

  // A full catalogue fills the page on its own; a short sheet keeps the room to
  // write that the paper form has always had.
  const pad = blankRows(to.showUnusedOnPrint ? 2 : Math.max(4, 16 - printed.length), 6)

  const paxLine = [
    pack.header.paxAdults !== null ? `${pack.header.paxAdults} adult${pack.header.paxAdults === 1 ? '' : 's'}` : '',
    pack.header.paxChildren ? `${pack.header.paxChildren} child${pack.header.paxChildren === 1 ? '' : 'ren'}` : '',
  ].filter(Boolean).join(' · ') || (pack.header.pax === null ? '' : `${pack.header.pax} pax`)

  return `<section class="form pg-tour">
    ${masthead('TOUR SETTLEMENT', logo)}

    <table class="hdr">
      <tr><th>Tour No</th><td>${esc(pack.header.tourNo)}</td></tr>
      <tr><th>No of Pax</th><td>${esc(paxLine)}</td></tr>
      <tr><th>Guide Name</th><td>${esc(to.guideName)}</td></tr>
      <tr><th>Chauffeur Name</th><td>${esc(to.chauffeurName)}</td></tr>
      <tr><th>Tour Handler</th><td>${esc(pack.header.tourHandler)}</td></tr>
    </table>

    <table class="grid tour">
      <thead><tr>
        <th class="ent" rowspan="2">Entrance Tickets</th>
        <th colspan="2">Adult</th>
        <th colspan="2">Child</th>
        <th class="amt" rowspan="2">Total Cost</th>
      </tr><tr>
        <th class="amt">Rate</th>
        <th class="cnt">Count</th>
        <th class="amt">Rate</th>
        <th class="cnt">Count</th>
      </tr></thead>
      <tbody>
        ${lines}${pad}
        <tr class="sum"><th colspan="5">Total Tour Cost</th><td class="amt">${esc(money(total))}</td></tr>
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

const RENDERERS: Record<SettlementDocKind, (p: SettlementDocPack, m: Marks) => string> = {
  name_board:  nameBoardHtml,
  transport:   (p, m) => transportHtml(p, m.house),
  local_visit: (p, m) => localVisitHtml(p, m.house),
  tour:        (p, m) => tourHtml(p, m.house),
}

const STYLES = `
  /* These are printed forms: they are white paper with black ink whatever the
     reader's system theme is, and the preview iframe inherits the same rule. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* The @page boxes themselves are generated per document from the pack's
     saved orientation - see pageBoxes(). These are the parts that hold
     whichever way up the sheet is printed. */
  section.board { break-after: page; height: 100vh; width: 100%;
                  display: flex; align-items: center; justify-content: center; }
  section.form  { break-after: page; }
  section:last-child { break-after: auto; }

  /* ── Name board ──
     Four dressings of one idea: an enormous name, one accent colour, and the
     house marks kept small. Everything below is measured from that. */
  section.board { position: relative; overflow: hidden; }
  .board-inner { text-align: center; padding: 0 18mm; width: 100%; position: relative; z-index: 1; }
  .board-logo { height: 66px; margin-bottom: 26px; object-fit: contain; }
  .board-wordmark { font-size: 20px; font-weight: 700; color: var(--accent); letter-spacing: -.5px; margin-bottom: 26px; }
  .board-name { font-weight: 800; line-height: 1.04; letter-spacing: -2px; word-break: break-word; color: #0b1020; }
  .board-rule { width: 88px; height: 4px; background: var(--accent); border-radius: 4px; margin: 22px auto 0; }
  .board-sub { margin-top: 20px; font-size: 26px; color: #3f4654; font-weight: 500; }
  .board-foot { margin-top: 26px; font-size: 13px; color: #8a8f98; display: flex;
                gap: 16px; justify-content: center; letter-spacing: .4px; }
  .board-ref { font-family: "Courier New", monospace; }

  /* The row of house marks along the foot — small on purpose, and the same
     size on every layout so the board is recognisable at a glance. */
  .board-marks { position: absolute; left: 0; right: 0; bottom: 11mm; z-index: 1;
                 display: flex; align-items: center; justify-content: center; gap: 16px; }
  .board-marks img { height: 24px; max-width: 130px; object-fit: contain; opacity: .85; }
  .board-marks .dot { width: 3px; height: 3px; border-radius: 50%; background: #c8ccd4; }

  /* Spotlight — a wash of the accent behind the name. */
  /* Tinting is done with opacity over white rather than a mixed colour, so the
     wash is the accent whatever colour the desk picked and needs no colour
     arithmetic from the print engine. */
  .board-spotlight .wash { position: absolute; inset: 0; opacity: .12;
    background: radial-gradient(58% 62% at 50% 40%, var(--accent) 0%, #fff 70%); }
  .board-spotlight::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 6px;
    background: linear-gradient(90deg, var(--accent), rgba(255,255,255,0)); }

  /* Ribbon — a band top and bottom, the mark reversed out of the top one. */
  .board-ribbon .ribbon-top { position: absolute; top: 0; left: 0; right: 0; height: 26mm;
    background: var(--accent); display: flex; align-items: center; gap: 14px; padding: 0 16mm; }
  .board-ribbon .chip { background: #fff; border-radius: 10px; padding: 7px 12px; display: inline-flex; }
  .board-ribbon .chip img { height: 34px; object-fit: contain; }
  .board-ribbon .ribbon-site { color: #fff; font-size: 15px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; opacity: .92; }
  .board-ribbon .ribbon-bottom { position: absolute; bottom: 0; left: 0; right: 0; height: 7mm; background: var(--accent); }
  .board-ribbon .board-inner { padding-top: 12mm; }
  .board-ribbon .board-marks { bottom: 12mm; }

  /* Frame — ruled border and corner ticks; the formal, hotel-desk sheet. */
  .board-frame .frame-rule { position: absolute; inset: 9mm; border: 2px solid var(--accent); }
  .board-frame .frame-rule::before {
    content: ''; position: absolute; inset: 3mm; border: 1px solid var(--accent); opacity: .35; }
  .board-frame .board-name { font-family: Georgia, "Times New Roman", serif; letter-spacing: -1px; }
  .board-frame .frame-eyebrow { font-size: 14px; letter-spacing: 5px; text-transform: uppercase;
    color: var(--accent); font-weight: 700; margin-bottom: 16px; }
  .board-frame .board-sub { font-style: italic; }
  .board-frame .board-marks { bottom: 15mm; }

  /* Minimal — white paper, the name set left, one hairline. */
  .board-minimal { align-items: stretch; }
  .board-minimal .board-inner { text-align: left; padding: 18mm 20mm; display: flex;
    flex-direction: column; justify-content: center; }
  .board-minimal .board-logo { height: 44px; margin-bottom: 34px; align-self: flex-start; }
  .board-minimal .board-wordmark { text-align: left; }
  /* The full stop after the name sits *in* the line, so it follows the last
     word however the name wraps rather than drifting to the margin. */
  .board-minimal .min-dot { display: inline-block; width: .12em; height: .12em; border-radius: 50%;
    background: var(--accent); margin-left: .08em; vertical-align: baseline; }
  .board-minimal .board-rule { margin: 24px 0 0; width: 120px; height: 3px; }
  .board-minimal .board-foot { justify-content: flex-start; }
  .board-minimal .board-marks { justify-content: flex-end; right: 20mm; left: auto; bottom: 12mm; }

  /* A board turned portrait: the same sheet, with the type and the padding
     taken in so an arrivals-hall name still fits the narrower paper. The name
     size itself is set inline, measured from the orientation. */
  .board.portrait .board-inner { padding: 0 12mm; }
  .board.portrait .board-sub { font-size: 21px; margin-top: 16px; }
  .board.portrait .board-logo { height: 56px; margin-bottom: 20px; }
  .board.portrait .board-foot { font-size: 12px; }
  .board.portrait.board-ribbon .ribbon-top { height: 22mm; padding: 0 10mm; }

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

  /* The tour sheet's two-tier head, and the two states a ticket line has:
     settled, which is what the driver is signing for, and considered, which is
     printed grey so it reads as a blank rather than as a claim. */
  .grid.tour thead th { vertical-align: middle; }
  .grid.tour .ent { width: 34%; }
  .grid.tour .amt { width: 78px; }
  .grid.tour .cnt { width: 48px; }
  .grid.tour tr.on  td.ent { font-weight: 700; }
  .grid.tour tr.off td { color: #9aa0a6; }
  /* A long catalogue runs onto a second sheet; the head is repeated on it. */
  .grid.tour thead { display: table-header-group; }
  .grid.tour tr { break-inside: avoid; }
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
 * One `@page` box per document, sized from the pack.
 *
 * Named boxes rather than one document-wide page rule: a pack is printed as a
 * single file and the sheets in it need not agree about which way up they are,
 * so each document names its own box and Chromium is asked to honour it
 * (`preferCSSPageSize`). The board is printed edge to edge; the forms keep the
 * margins the paper originals are typed inside.
 */
function pageBoxes(pack: SettlementDocPack, kinds: SettlementDocKind[]): string {
  return kinds.map(k => {
    const margin = k === 'name_board' ? '0' : '10mm 9mm 12mm'
    return `@page ${k} { size: A4 ${orientationOf(pack, k)}; margin: ${margin}; }
  section.pg-${k} { page: ${k}; }`
  }).join('\n  ')
}

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
  const marks = await readMarks(pack)
  const body = kinds.map(k => RENDERERS[k](pack, marks)).join('\n')
  const title = kinds.length === 1
    ? `${DOC_LABEL[kinds[0]]} · ${pack.header.tourNo || pack.bookingRef}`
    : `Settlement documents · ${pack.header.tourNo || pack.bookingRef}`

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${STYLES}
  ${pageBoxes(pack, kinds)}</style>
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
