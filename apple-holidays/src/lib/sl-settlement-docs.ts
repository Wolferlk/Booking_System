/**
 * The Sri Lankan settlement paperwork — the four sheets that travel with a
 * driver and come back signed.
 *
 * ---- What this is ----
 *
 * The desk currently fills these in by hand: a name board for the airport, a
 * Transport Settlement, a Local Visit Settlement and a Tour Settlement. This
 * file is the *vocabulary* for all four — the shape of a pack, the empty pack,
 * the fixed shop list the Local Visit sheet is printed with, and the
 * arithmetic each sheet totals itself with. It is pure: no Prisma, no accounts
 * database, no React, so the editor on screen, the saved record, the HTML
 * preview and the PDF all describe a document with the same words and can
 * never disagree about what is on it.
 *
 * `sl-settlement-docs-server.ts` prefills a pack from the booking and the
 * accounts figures; `sl-settlement-docs-pdf.ts` prints it.
 *
 * ---- Why a pack is stored rather than re-derived ----
 *
 * Almost everything on these sheets is *not* in either database and never will
 * be: the extra mileage a driver claims, the reason it was approved, who
 * signed at the wood-carving shop, the batta rate agreed for this tour. The
 * derived figures are a starting point — a courtesy — and the desk's typing is
 * the document. So the pack is saved whole, and a saved pack always wins over
 * a freshly derived one. `derivePack()` is offered alongside it so a user can
 * see what the systems currently say and pull a figure back in deliberately,
 * but nothing is ever overwritten under them.
 *
 * ---- Money ----
 *
 * Rupees throughout, because rupees are what a driver is handed and what the
 * shops sign for. Figures are plain numbers, and `null` means "nobody has
 * written one down" — printed as a blank on paper, never as a zero, because a
 * zero on a settlement sheet is a statement that nothing is owed.
 */

// ── Documents ─────────────────────────────────────────────────────────────────

export type SettlementDocKind = 'name_board' | 'transport' | 'local_visit' | 'tour'

export const DOC_KINDS: SettlementDocKind[] = ['name_board', 'transport', 'local_visit', 'tour']

export const DOC_LABEL: Record<SettlementDocKind, string> = {
  name_board:  'Name board',
  transport:   'Transport settlement',
  local_visit: 'Local visit settlement',
  tour:        'Tour settlement',
}

export const DOC_BLURB: Record<SettlementDocKind, string> = {
  name_board:  'Landscape sheet for the arrivals hall — the guest name large, the logo small.',
  transport:   'What the driver is owed for the vehicle: package, extras, batta, tickets and advances.',
  local_visit: 'The shopping stops, for each one to sign and seal as the tour passes through.',
  tour:        'Entrance tickets and the guide, per person, totalled for the tour.',
}

/** The file name one document downloads under. */
export const DOC_SLUG: Record<SettlementDocKind, string> = {
  name_board:  'name-board',
  transport:   'transport-settlement',
  local_visit: 'local-visit-settlement',
  tour:        'tour-settlement',
}

// ── Shapes ────────────────────────────────────────────────────────────────────

/**
 * The block that heads three of the four sheets.
 *
 * One header, filled once, printed on each — the paper versions repeat the same
 * six lines and the desk writes them out three times. Dates are `yyyy-mm-dd`
 * calendar days, formatted at print time.
 */
export interface SettlementDocHeader {
  tourNo: string
  arrivalDate: string | null
  departureDate: string | null
  pax: number | null
  tourHandler: string
  driverName: string
  driverPhone: string
  guideName: string
  vehicleType: string
  vehiclePlate: string
}

/** One line of the Transport sheet's itinerary — a day, what was driven, what it cost. */
export interface TransportLine {
  id: string
  date: string
  description: string
  amount: number | null
}

/**
 * The Transport sheet's footer block.
 *
 * Deliberately a flat set of typed-in figures rather than a calculation: the
 * paper form has a rate column and an amount column side by side, and the desk
 * writes both. `transportTotals()` adds them up for the reader; it never
 * decides them.
 */
export interface TransportTotals {
  totalMileageRate: number | null
  totalMileageAmount: number | null
  battaRate: number | null
  battaCount: number | null
  battaAmount: number | null
  highwayTickets: number | null
  parkingTickets: number | null
  fuelAdvance: number | null
  tourAdvance: number | null
}

export interface TransportDoc {
  vehicleType: string
  perKmRate: number | null
  maxMileage: number | null
  km: number | null
  packageCost: number | null
  lines: TransportLine[]
  totals: TransportTotals
  /** Who the cheque is made out to, and where the transfer goes. */
  chequeFavour: string
  bankDetails: string
  idNo: string
  note: string
}

/** One shop on the Local Visit sheet — a printed name and a box to sign in. */
export interface LocalVisitShop {
  id: string
  name: string
  /** Anything typed in place of a signature — a reference, a note, an initial. */
  note: string
}

export interface LocalVisitSection {
  id: string
  title: string
  shops: LocalVisitShop[]
}

export interface LocalVisitDoc {
  driverRef: string
  sections: LocalVisitSection[]
  note: string
}

/** One entrance ticket line on the Tour sheet. */
export interface TourLine {
  id: string
  name: string
  perPersonRate: number | null
  count: number | null
  /** Left null to mean rate × count; typed in when the desk overrides it. */
  totalCost: number | null
}

export interface TourDoc {
  guideName: string
  chauffeurName: string
  lines: TourLine[]
  note: string
}

export interface NameBoardDoc {
  /** The line printed large. Usually the lead passenger. */
  guestName: string
  /** Under it, smaller — "Welcome to Sri Lanka", the agent, whatever the desk wants. */
  subtitle: string
  /** Smaller still, at the foot — pax count, IS number, flight. */
  footnote: string
  /** Off for a guest who should not see a booking reference on a board. */
  showReference: boolean
  /** The mark printed at the top. Null means the house default. */
  logoUrl: string | null
  /** The small row of company marks along the foot. On unless switched off. */
  showSubLogos: boolean
  /** Which of the printed layouts the board uses. */
  theme: NameBoardTheme
  /** The one colour the layout is drawn in, as `#rrggbb`. */
  accent: string
}

// ── How the board is printed ──────────────────────────────────────────────────

/**
 * The board layouts.
 *
 * A name board is read across an arrivals hall from ten metres away, so every
 * one of these keeps the name enormous and everything else quiet; they differ
 * in how the sheet is dressed around it, not in how loud the name is. Choosing
 * a layout is the desk's decision — a corporate arrival and a honeymoon
 * transfer want different paper.
 */
export type NameBoardTheme = 'spotlight' | 'ribbon' | 'frame' | 'minimal'

export const NAME_BOARD_THEMES: { id: NameBoardTheme; label: string; blurb: string }[] = [
  { id: 'spotlight', label: 'Spotlight', blurb: 'A soft wash of colour behind the name, logo above it, centred.' },
  { id: 'ribbon',    label: 'Ribbon',    blurb: 'A colour band top and bottom, the logo reversed out of it.' },
  { id: 'frame',     label: 'Frame',     blurb: 'A ruled border with corner ticks — the formal, hotel-desk look.' },
  { id: 'minimal',   label: 'Minimal',   blurb: 'White paper, the name set left, one hairline. Nothing else.' },
]

const THEME_IDS = NAME_BOARD_THEMES.map(t => t.id)

/** The colour the board is drawn in. Apple red is the house mark. */
export const NAME_BOARD_ACCENTS: { label: string; value: string }[] = [
  { label: 'Apple red', value: '#d1002a' },
  { label: 'Ink',       value: '#111827' },
  { label: 'Ceylon',    value: '#0f766e' },
  { label: 'Midnight',  value: '#1e3a8a' },
  { label: 'Saffron',   value: '#b45309' },
  { label: 'Orchid',    value: '#7e22ce' },
]

export const DEFAULT_ACCENT = NAME_BOARD_ACCENTS[0].value

/** The mark the board carries when nobody has chosen another. */
export const DEFAULT_LOGO = '/png/AppleHolidaysLogo.png'

/** The marks that ship with the app — always in the gallery, never deletable. */
export const BUILTIN_LOGOS: { url: string; label: string }[] = [
  { url: '/png/AppleHolidaysLogo.png', label: 'Apple Holidays' },
  { url: '/png/aahaas.png',            label: 'aahaas' },
  { url: '/png/aahaslogo.png',         label: 'aahaas mark' },
  { url: '/logo.png',                  label: 'Apple mark' },
]

/**
 * The small marks along the foot of the board.
 *
 * Both houses appear on the sheet a guest is met with, whichever single logo is
 * printed large at the top. Fixed rather than editable: this is a branding
 * rule, not a per-booking decision.
 */
export const SUB_LOGOS: string[] = [
  '/png/aahaas.png',
  '/png/aahaslogo.png',
  '/png/AppleHolidaysLogo.png',
]

/** Where an uploaded logo lives under the uploads prefix. */
export const LOGO_UPLOAD_DIR = 'branding/logos'

/**
 * Is this a logo path we are willing to print?
 *
 * The value arrives from a browser and is turned into a file read on the
 * server, so it is whitelisted rather than sanitised: one of the marks shipped
 * in `public/png`, the Apple mark, or something previously uploaded into the
 * bucket under `uploads/branding/logos/`. Anything else — an absolute URL, a
 * traversal, a path into the rest of `public` — is refused and the board falls
 * back to the default.
 */
export function isSafeLogoPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 300) return false
  if (v.includes('..') || v.includes('\0')) return false
  if (/^\/png\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|svg)$/i.test(v)) return true
  if (v === '/logo.png') return true
  return new RegExp(`^/api/uploads/${LOGO_UPLOAD_DIR}/[A-Za-z0-9._-]+\\.(png|jpg|jpeg|webp|svg)$`, 'i').test(v)
}

export interface SettlementDocPack {
  /** Bumped when the shape changes, so an old saved pack can be recognised. */
  version: 1
  bookingRef: string
  isNumber: string | null
  header: SettlementDocHeader
  nameBoard: NameBoardDoc
  transport: TransportDoc
  localVisit: LocalVisitDoc
  tour: TourDoc
}

/** What the API hands the editor: the pack in force, and what the systems say today. */
export interface SettlementDocState {
  pack: SettlementDocPack
  /** The pack as the booking and the accounts figures would build it right now. */
  derived: SettlementDocPack
  /** True when `pack` is the desk's saved version rather than the derived one. */
  saved: boolean
  savedAt: string | null
  savedBy: string | null
  /** Why a figure is missing, when the accounts system could not be read. */
  notices: string[]
}

// ── The fixed shop list ───────────────────────────────────────────────────────

/**
 * The Local Visit sheet as it is printed.
 *
 * These are the stops the tours actually pass through, in the order the paper
 * form lists them, and they are the *default* only: a saved pack keeps whatever
 * the desk edited, so a new shop is added on the sheet and not in this file.
 */
export const LOCAL_VISIT_SECTIONS: { title: string; shops: string[] }[] = [
  { title: 'Spice Garden',           shops: ['Susantha', 'Lakgrow'] },
  { title: 'Gem & Jewelry Shop',     shops: ['Ishini', 'Pure Gem', 'Opanima Gem'] },
  { title: 'Water Sports',           shops: ['Diyakawa'] },
  { title: 'Wood Craft',             shops: ['Rajanima Craft'] },
  { title: 'Tea Tasting',            shops: ['Tea Bush', 'Ebilimeegama'] },
  { title: 'Madu River Boat Riding', shops: ['Mangrove Cave'] },
]

// ── Identity ──────────────────────────────────────────────────────────────────

let seq = 0

/**
 * A row id that is stable inside one pack and unique across it.
 *
 * Rows are added, deleted and reordered in the editor, so React needs a key
 * that is not the array index. It never leaves this document, so a counter and
 * a timestamp are enough — no randomness is wanted, because a derived pack
 * should be byte-comparable with itself when nothing has changed.
 */
export function rowId(prefix: string, n?: number): string {
  return `${prefix}-${n ?? ++seq}`
}

// ── Empty and default packs ───────────────────────────────────────────────────

export function emptyHeader(): SettlementDocHeader {
  return {
    tourNo: '', arrivalDate: null, departureDate: null, pax: null,
    tourHandler: '', driverName: '', driverPhone: '', guideName: '',
    vehicleType: '', vehiclePlate: '',
  }
}

export function defaultLocalVisit(): LocalVisitDoc {
  return {
    driverRef: '',
    sections: LOCAL_VISIT_SECTIONS.map((s, i) => ({
      id: rowId('sec', i + 1),
      title: s.title,
      shops: s.shops.map((name, j) => ({ id: rowId(`shop-${i + 1}`, j + 1), name, note: '' })),
    })),
    note: '',
  }
}

export function emptyTransportTotals(): TransportTotals {
  return {
    totalMileageRate: null, totalMileageAmount: null,
    battaRate: null, battaCount: null, battaAmount: null,
    highwayTickets: null, parkingTickets: null,
    fuelAdvance: null, tourAdvance: null,
  }
}

export function emptyPack(bookingRef: string, isNumber: string | null = null): SettlementDocPack {
  return {
    version: 1,
    bookingRef,
    isNumber,
    header: emptyHeader(),
    nameBoard: {
      guestName: '', subtitle: 'Welcome to Sri Lanka', footnote: '', showReference: true,
      logoUrl: null, showSubLogos: true, theme: 'spotlight', accent: DEFAULT_ACCENT,
    },
    transport: {
      vehicleType: '', perKmRate: null, maxMileage: null, km: null, packageCost: null,
      lines: [], totals: emptyTransportTotals(),
      chequeFavour: '', bankDetails: '', idNo: '', note: '',
    },
    localVisit: defaultLocalVisit(),
    tour: { guideName: '', chauffeurName: '', lines: [], note: '' },
  }
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Sum of the figures actually written down. Null when none were. */
function sum(values: (number | null | undefined)[]): number | null {
  const present = values.filter(isNum)
  if (present.length === 0) return null
  return Math.round(present.reduce((a, b) => a + b, 0) * 100) / 100
}

/** What one Tour line comes to: the typed total, or rate × count. */
export function tourLineTotal(l: TourLine): number | null {
  if (isNum(l.totalCost)) return l.totalCost
  if (isNum(l.perPersonRate) && isNum(l.count)) return Math.round(l.perPersonRate * l.count * 100) / 100
  return null
}

export function tourTotal(doc: TourDoc): number | null {
  return sum(doc.lines.map(tourLineTotal))
}

/**
 * The Transport sheet's three totals.
 *
 * `extras` is the itinerary column — the extra mileage and the one-off charges
 * the desk writes in by hand. `totalCost` is the whole obligation before any
 * advance, and `balance` is what is left to pay. Every one of them is null
 * until something has been written down, so an untouched sheet prints blank
 * boxes for the driver and the desk to fill in together, exactly as it does now.
 */
export function transportTotals(doc: TransportDoc): {
  extras: number | null
  totalCost: number | null
  advances: number | null
  balance: number | null
} {
  const t = doc.totals
  const extras = sum(doc.lines.map(l => l.amount))

  const totalCost = sum([
    doc.packageCost, extras,
    t.totalMileageAmount, t.battaAmount, t.highwayTickets, t.parkingTickets,
  ])
  const advances = sum([t.fuelAdvance, t.tourAdvance])
  const balance = isNum(totalCost)
    ? Math.round((totalCost - (advances ?? 0)) * 100) / 100
    : null

  return { extras, totalCost, advances, balance }
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** A rupee figure for paper, or a blank — never a zero standing in for silence. */
export function money(v: number | null | undefined): string {
  if (!isNum(v)) return ''
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "02-12-2025" — the day format the printed forms already use. */
export function docDate(day: string | null | undefined): string {
  if (!day) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!m) return day
  return `${m[3]}-${m[2]}-${m[1]}`
}

// ── Parsing what comes back from the browser ──────────────────────────────────

const str = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.slice(0, max) : ''

const dayOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null

/**
 * A number off the wire, or null.
 *
 * "" is silence, not zero. A figure that cannot be read is dropped rather than
 * guessed — a settlement sheet with a made-up number on it is worse than one
 * with a gap, and the editor shows the gap straight back to the person typing.
 */
function figure(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

const MAX_LINES = 200

/**
 * Rebuild a pack from untrusted JSON.
 *
 * Everything is clamped: unknown keys are dropped, strings are truncated,
 * numbers are parsed or nulled, and the row lists are capped — this is what a
 * browser POSTs and it is written to the database, so the shape has to be
 * decided here and nowhere else. `fallback` supplies the identity fields, which
 * the client is never allowed to choose.
 */
export function parsePack(raw: unknown, fallback: SettlementDocPack): SettlementDocPack {
  const src = (raw ?? {}) as Record<string, any>
  const base = emptyPack(fallback.bookingRef, fallback.isNumber)

  const h = (src.header ?? {}) as Record<string, unknown>
  const header: SettlementDocHeader = {
    tourNo:        str(h.tourNo, 60)      || base.header.tourNo,
    arrivalDate:   dayOrNull(h.arrivalDate),
    departureDate: dayOrNull(h.departureDate),
    pax:           figure(h.pax),
    tourHandler:   str(h.tourHandler, 120),
    driverName:    str(h.driverName, 120),
    driverPhone:   str(h.driverPhone, 60),
    guideName:     str(h.guideName, 120),
    vehicleType:   str(h.vehicleType, 80),
    vehiclePlate:  str(h.vehiclePlate, 40),
  }

  const nb = (src.nameBoard ?? {}) as Record<string, unknown>
  const nameBoard: NameBoardDoc = {
    guestName:     str(nb.guestName, 120),
    subtitle:      str(nb.subtitle, 120),
    footnote:      str(nb.footnote, 200),
    showReference: nb.showReference !== false,
    logoUrl:       isSafeLogoPath(nb.logoUrl) ? nb.logoUrl : null,
    showSubLogos:  nb.showSubLogos !== false,
    theme:         THEME_IDS.includes(nb.theme as NameBoardTheme) ? (nb.theme as NameBoardTheme) : 'spotlight',
    accent:        /^#[0-9a-f]{6}$/i.test(String(nb.accent ?? '')) ? String(nb.accent) : DEFAULT_ACCENT,
  }

  const tr = (src.transport ?? {}) as Record<string, any>
  const trTotals = (tr.totals ?? {}) as Record<string, unknown>
  const transport: TransportDoc = {
    vehicleType: str(tr.vehicleType, 120),
    perKmRate:   figure(tr.perKmRate),
    maxMileage:  figure(tr.maxMileage),
    km:          figure(tr.km),
    packageCost: figure(tr.packageCost),
    lines: (Array.isArray(tr.lines) ? tr.lines : []).slice(0, MAX_LINES).map((l: any, i: number) => ({
      id:          str(l?.id, 40) || rowId('t', i + 1),
      date:        str(l?.date, 40),
      description: str(l?.description, 600),
      amount:      figure(l?.amount),
    })),
    totals: {
      totalMileageRate:   figure(trTotals.totalMileageRate),
      totalMileageAmount: figure(trTotals.totalMileageAmount),
      battaRate:          figure(trTotals.battaRate),
      battaCount:         figure(trTotals.battaCount),
      battaAmount:        figure(trTotals.battaAmount),
      highwayTickets:     figure(trTotals.highwayTickets),
      parkingTickets:     figure(trTotals.parkingTickets),
      fuelAdvance:        figure(trTotals.fuelAdvance),
      tourAdvance:        figure(trTotals.tourAdvance),
    },
    chequeFavour: str(tr.chequeFavour, 200),
    bankDetails:  str(tr.bankDetails, 400),
    idNo:         str(tr.idNo, 60),
    note:         str(tr.note, 1000),
  }

  const lv = (src.localVisit ?? {}) as Record<string, any>
  const sections = (Array.isArray(lv.sections) ? lv.sections : []).slice(0, 40)
  const localVisit: LocalVisitDoc = {
    driverRef: str(lv.driverRef, 80),
    sections: sections.length
      ? sections.map((s: any, i: number) => ({
          id:    str(s?.id, 40) || rowId('sec', i + 1),
          title: str(s?.title, 120),
          shops: (Array.isArray(s?.shops) ? s.shops : []).slice(0, 40).map((p: any, j: number) => ({
            id:   str(p?.id, 40) || rowId(`shop-${i + 1}`, j + 1),
            name: str(p?.name, 160),
            note: str(p?.note, 300),
          })),
        }))
      : base.localVisit.sections,
    note: str(lv.note, 1000),
  }

  const to = (src.tour ?? {}) as Record<string, any>
  const tour: TourDoc = {
    guideName:     str(to.guideName, 120),
    chauffeurName: str(to.chauffeurName, 120),
    lines: (Array.isArray(to.lines) ? to.lines : []).slice(0, MAX_LINES).map((l: any, i: number) => ({
      id:            str(l?.id, 40) || rowId('e', i + 1),
      name:          str(l?.name, 200),
      perPersonRate: figure(l?.perPersonRate),
      count:         figure(l?.count),
      totalCost:     figure(l?.totalCost),
    })),
    note: str(to.note, 1000),
  }

  return { version: 1, bookingRef: fallback.bookingRef, isNumber: fallback.isNumber, header, nameBoard, transport, localVisit, tour }
}

/** The documents a request asked for, defaulting to all four in printing order. */
export function parseDocKinds(raw: string | null): SettlementDocKind[] {
  if (!raw) return [...DOC_KINDS]
  const asked = raw.split(',').map(s => s.trim()).filter(Boolean)
  const picked = DOC_KINDS.filter(k => asked.includes(k))
  return picked.length ? picked : [...DOC_KINDS]
}
