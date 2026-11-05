/**
 * Excel import for Trans-Reconsultation — a desk's own half-month workbook
 * becomes (or fills) the system sheet for that country and period.
 *
 * Two steps, both re-reading the uploaded file so the server never trusts rows
 * echoed back by the browser:
 *
 *   preview  read the workbook, say which country and half month it is and
 *            why, pair every Excel row with its MC Report movement, and list
 *            what would change — nothing is written;
 *   commit   create the sheet if it does not exist (from the MC Report, as
 *            Generate does), then write the workbook into it through the same
 *            saveLines() a desk's Save uses — so typed fields are protected
 *            from later refreshes and an approved line whose rate moves goes
 *            back to Accounts with the reason.
 *
 * The workbook is treated as the desk's word: a paired line takes the Excel
 * rate and (unless told otherwise) its wording; an Excel row with no movement
 * becomes a hand-added line; an MC line the workbook does not mention is kept
 * unless the desk asks for it to be struck off.
 *
 * OpenAI is used only where the file itself cannot answer: a sheet whose
 * header row is not recognisable (it maps the columns), and — on request —
 * pairing rows the scorer could not place.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { prisma } from '@/lib/prisma'
import { computePNLLineTotal } from '@/lib/utils'
import { matchMovements, tokens, type MatchMovement } from './match'
import { accountsPnlLines } from './accounts-pnl'
import {
  IMPORT_FIELDS, detectContext, gridSample, parseWorkbook,
  type ColumnMap, type DetectedContext, type ImportRow,
} from './excel-parse'
import {
  ReconError, approvalReset, collectMovements, createSheet, saveLines,
  type Actor, type LineInput,
} from './server'
import {
  RECON_COUNTRIES, periodOf, sheetTitle, timeMinutes,
  type Half, type ReconCountry,
} from './shared'

const AI_MODEL = 'gpt-4o-mini'
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

// ── Candidates: the MC side of the pairing ──────────────────────────────────

export interface Candidate {
  /** `l:<lineId>` for a line already on the sheet, `a:<agendaItemId>` for an MC movement not yet on one. */
  key: string
  kind: 'MC' | 'MANUAL'
  lineId: string | null
  agendaItemId: string | null
  bookingRef: string | null
  aliases: string[]
  date: string
  tourNo: string | null
  guestName: string | null
  pickUp: string | null
  dropOff: string | null
  time: string | null
  details: string | null
  mcDescription: string | null
  rate: number | null
  rateText: string | null
  approvalStatus: string
  cancelled: boolean
}

async function sheetCandidates(sheetId: string): Promise<Candidate[]> {
  const lines = await prisma.transReconLine.findMany({ where: { sheetId, isRemoved: false } })
  const refs = Array.from(new Set(lines.map(l => l.bookingRef).filter((r): r is string => !!r)))
  const bookings = refs.length
    ? await prisma.booking.findMany({ where: { bookingRef: { in: refs } }, select: { bookingRef: true, agentBookingId: true, isNumber: true } })
    : []
  const aliasBy = new Map(bookings.map(b => [b.bookingRef, [b.agentBookingId, b.isNumber].map(v => clean(v)).filter(Boolean)]))
  return lines.map(l => ({
    key: `l:${l.id}`, kind: l.source === 'MANUAL' ? 'MANUAL' : 'MC', lineId: l.id, agendaItemId: l.agendaItemId,
    bookingRef: l.bookingRef, aliases: l.bookingRef ? aliasBy.get(l.bookingRef) ?? [] : [],
    date: day(l.serviceDate)!, tourNo: l.tourNo, guestName: l.guestName, pickUp: l.pickUp, dropOff: l.dropOff,
    time: l.time, details: l.details, mcDescription: l.mcDescription,
    rate: l.rate == null ? null : Number(l.rate), rateText: l.rateText, approvalStatus: l.approvalStatus,
    cancelled: l.bookingCancelled,
  }))
}

async function movementCandidates(country: ReconCountry, start: string, end: string): Promise<Candidate[]> {
  const { snapshots } = await collectMovements(country, start, end)
  return snapshots.filter(s => !s.cancelled).map(s => ({
    key: `a:${s.agendaItemId}`, kind: 'MC', lineId: null, agendaItemId: s.agendaItemId,
    bookingRef: s.bookingRef, aliases: s.aliases, date: s.serviceDate,
    tourNo: s.fields.tourNo, guestName: s.fields.guestName, pickUp: s.fields.pickUp, dropOff: s.fields.dropOff,
    time: s.fields.time, details: s.fields.details, mcDescription: s.mcDescription,
    rate: null, rateText: null, approvalStatus: 'PENDING', cancelled: false,
  }))
}

// ── Pairing rows with candidates ────────────────────────────────────────────

/** "14417 / AH505437" → ["14417", "AH505437"]; "IS 48218" → ["IS48218"]. */
export function tourTokens(tour: string | null | undefined): string[] {
  const s = clean(tour).toUpperCase().replace(/\b(VN|IS|SG|MY)\s+(\d{3,})/g, '$1$2')
  return Array.from(new Set(s.split(/[\s/,;|&+()]+/).map(t => t.replace(/[^A-Z0-9-]/g, '')).filter(t => t.length >= 3)))
}
const digits = (t: string) => t.replace(/\D/g, '')

function tourScore(row: ImportRow, c: Candidate): number {
  const mine = tourTokens(row.tourNo)
  if (!mine.length) return 0
  const theirs = [c.bookingRef, ...c.aliases, c.tourNo].flatMap(v => tourTokens(v))
  if (mine.some(t => theirs.includes(t))) return 0.5
  const md = mine.map(digits).filter(d => d.length >= 4), td = theirs.map(digits).filter(d => d.length >= 4)
  return md.some(d => td.includes(d)) ? 0.4 : 0
}

function overlap(a: string, b: string): number {
  const x = tokens(a), y = tokens(b)
  if (!x.size || !y.size) return 0
  let n = 0
  x.forEach(w => { if (y.has(w)) n++ })
  return n / Math.min(x.size, y.size)
}

const shiftDay = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

export function scoreRow(row: ImportRow, c: Candidate): { score: number; why: string[] } {
  if (!row.serviceDate) return { score: 0, why: [] }
  const why: string[] = []
  let s = 0
  const tour = tourScore(row, c)
  if (row.serviceDate === c.date) { s += 0.1; why.push('same day') }
  else if ((row.serviceDate === shiftDay(c.date, 1) || row.serviceDate === shiftDay(c.date, -1)) && tour) { s -= 0.05; why.push('a day apart') }
  else return { score: 0, why: [] }
  if (tour) { s += tour; why.push('tour no') }
  const route = overlap(`${row.pickUp ?? ''} ${row.dropOff ?? ''}`, `${c.pickUp ?? ''} ${c.dropOff ?? ''}`)
  if (route > 0) { s += 0.25 * route; if (route >= 0.5) why.push('route') }
  const det = overlap(row.details ?? '', `${c.details ?? ''} ${c.mcDescription ?? ''}`)
  if (det > 0) { s += 0.15 * det; if (det >= 0.4) why.push('details') }
  if (row.time && c.time) {
    const d = Math.abs(timeMinutes(row.time) - timeMinutes(c.time))
    if (d <= 15) { s += 0.12; why.push('time') } else if (d <= 60) s += 0.05
  }
  if (!tour && row.guestName && c.guestName) {
    const g = overlap(row.guestName, c.guestName)
    if (g >= 0.5) { s += 0.25 * g; why.push('guest name') }
  }
  return { score: Math.round(Math.min(1, s) * 1000) / 1000, why }
}

const ACCEPT = 0.45

export interface RowMatch { key: string | null; score: number; why: string[]; by: 'AUTO' | 'AI' | 'YOU' | null; alternatives: { key: string; score: number }[] }

/** Best-first, one row per candidate. */
export function pairRows(rows: ImportRow[], cands: Candidate[]): Map<number, RowMatch> {
  const pairs: { row: number; key: string; score: number; why: string[] }[] = []
  const alts = new Map<number, { key: string; score: number }[]>()
  for (const r of rows) {
    const list: { key: string; score: number }[] = []
    for (const c of cands) {
      const { score, why } = scoreRow(r, c)
      if (score <= 0.1) continue
      list.push({ key: c.key, score })
      if (score >= ACCEPT) pairs.push({ row: r.row, key: c.key, score, why })
    }
    alts.set(r.row, list.sort((a, b) => b.score - a.score).slice(0, 5))
  }
  pairs.sort((a, b) => b.score - a.score)
  const out = new Map<number, RowMatch>()
  const used = new Set<string>()
  for (const p of pairs) {
    if (out.has(p.row) || used.has(p.key)) continue
    out.set(p.row, { key: p.key, score: p.score, why: p.why, by: 'AUTO', alternatives: alts.get(p.row) ?? [] })
    used.add(p.key)
  }
  for (const r of rows) if (!out.has(r.row)) out.set(r.row, { key: null, score: 0, why: [], by: null, alternatives: alts.get(r.row) ?? [] })
  return out
}

// ── The P&L line the desk wrote into DETAILS ────────────────────────────────

export interface PnlChoice { id: string; activity: string; category: string; value: number; currency: string }
export interface PnlHit extends PnlChoice { score: number; via: 'exact' | 'words' }

const NOT_TRANSPORT_PNL = new Set(['HOTEL', 'FLIGHT_TICKETS', 'TAX_FEES'])
const norm = (s: string | null | undefined) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The desks copy the P&L line's own wording into DETAILS ("Private Kuala Lumpur
 * Half Day City Tour", "Full-Day Genting Highlands Day Trip with Two-Way Cable
 * Car…"), sometimes with a flight or a dinner tacked on after a " - ". So the
 * text is tried whole and segment by segment: an activity contained in it (or
 * containing it) is an exact hit; otherwise shared words decide, after the same
 * synonyms the movement matcher uses (KLIA = airport, H/D = half day, PVT = private).
 */
export function pnlFromDetails(details: string | null, lines: PnlChoice[]): PnlHit | null {
  const whole = norm(details)
  if (whole.length < 6 || !lines.length) return null
  const segments = Array.from(new Set([clean(details), ...clean(details).split(/\s+[-–|]\s+|>>|\s\+\s|;|\n/)].map(s => s.trim()).filter(s => norm(s).length >= 6)))
  let best: PnlHit | null = null
  for (const l of lines) {
    if (NOT_TRANSPORT_PNL.has(l.category)) continue
    const a = norm(l.activity)
    if (a.length < 4) continue
    let score = 0, via: PnlHit['via'] = 'words'
    for (const seg of segments) {
      const s = norm(seg)
      if ((a.length >= 8 && s.includes(a)) || (s.length >= 12 && a.includes(s))) { score = Math.max(score, 0.96); via = 'exact'; continue }
      const x = tokens(seg), y = tokens(l.activity)
      if (!x.size || !y.size) continue
      let n = 0
      y.forEach(w => { if (x.has(w)) n++ })
      // Both directions count: the activity's words must be in the text, and
      // a one-word activity must not win on a long description.
      const cover = n / y.size, precision = n / x.size
      score = Math.max(score, Math.round((0.7 * cover + 0.3 * precision) * 1000) / 1000)
    }
    if (l.category === 'TRANSPORT' && score > 0) score = Math.min(1, Math.round((score + 0.03) * 1000) / 1000)
    if (!best || score > best.score) best = { ...l, score, via }
  }
  return best && best.score >= 0.55 ? best : null
}

async function loadPnls(refs: string[]): Promise<Map<string, PnlChoice[]>> {
  const out = new Map<string, PnlChoice[]>()
  if (!refs.length) return out
  const bs = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: { bookingRef: true, currency: true, pnl: { select: { paxAdults: true, paxChildren: true, lineItems: { orderBy: { sortOrder: 'asc' } } } } },
  })
  for (const b of bs) {
    out.set(b.bookingRef, (b.pnl?.lineItems ?? []).map(li => ({
      id: li.id, activity: li.activity, category: li.category, currency: b.currency || 'USD',
      value: Math.round(computePNLLineTotal(li, b.pnl!.paxAdults, b.pnl!.paxChildren) * 100) / 100,
    })))
  }
  // A booking with no OPS P&L is usually costed in the Accounts system — its
  // Detailed P&L rows are what DETAILS was copied from.
  for (const ref of refs.filter(r => !(out.get(r)?.length)).slice(0, 40)) {
    const acc = await accountsPnlLines(ref)
    if (acc.available && acc.lines.length) {
      out.set(ref, acc.lines.map(a => ({ id: a.id, activity: a.activity, category: a.category, value: a.value, currency: acc.currency || 'USD' })))
    }
  }
  return out
}

// ── OpenAI, where the file cannot answer ────────────────────────────────────

/** The column map for a sheet whose header row was not recognised. */
async function aiColumnMap(grid: unknown[][], fileName: string): Promise<{ headerRow: number; columns: ColumnMap } | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const prompt = `This is the top of a travel company's transport reconciliation worksheet ("${fileName}").
Each data row is one vehicle movement for a tour: a service date, the tour/booking number, the lead guest, pax count,
pick-up place, drop-off place, pick-up time, a description, and the rate paid to the transport vendor.

Find the header row and which column letter holds each field. Fields:
serviceDate, tourNo, guestName, pax, pickUp, dropOff, time, details, rateText, remarks.
Leave out a field the sheet does not have. If there is no header row, give the row number just above the first data row.

Return JSON: {"headerRow": <row number>, "columns": {"serviceDate": "A", ...}}

${gridSample(grid)}`
  try {
    const res = await openai.chat.completions.create({
      model: AI_MODEL, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'You map spreadsheet columns. Return only JSON.' }, { role: 'user', content: prompt }],
    })
    await logAiUsage({ callType: 'trans_recon_column_map', model: AI_MODEL, usage: res.usage, source: 'trans-recon-import' })
    const j = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { headerRow?: number; columns?: Record<string, string> }
    const columns: ColumnMap = {}
    for (const f of IMPORT_FIELDS) {
      const c = String(j.columns?.[f] ?? '').trim().toUpperCase()
      if (/^[A-Z]{1,2}$/.test(c)) columns[f] = c
    }
    if (!columns.serviceDate || Object.keys(columns).length < 3) return null
    return { headerRow: Math.max(1, Math.floor(Number(j.headerRow) || 1)), columns }
  } catch (err) {
    console.error('[trans-recon import] AI column map failed:', err)
    return null
  }
}

/** Pairs for rows the scorer left alone, among candidates nobody took — same-day only. */
async function aiPairs(rows: ImportRow[], cands: Candidate[], fileName: string): Promise<Map<number, { key: string; score: number }>> {
  const out = new Map<number, { key: string; score: number }>()
  if (!process.env.OPENAI_API_KEY || !rows.length || !cands.length) return out
  const days = new Set(rows.map(r => r.serviceDate))
  const pool = cands.filter(c => days.has(c.date)).slice(0, 120)
  if (!pool.length) return out
  const ids = new Map(pool.map((c, i) => [`M${i + 1}`, c.key]))
  const prompt = `Pair each Excel row with the MC movement it describes (same tour, same day). An Excel row may have no movement.
Excel rows (from "${fileName}"):
${rows.slice(0, 80).map(r => `R${r.row} | ${r.serviceDate} | tour ${r.tourNo ?? '-'} | ${r.guestName ?? '-'} | ${r.pickUp ?? '-'} → ${r.dropOff ?? '-'} | ${r.time ?? '-'} | ${(r.details ?? '').slice(0, 120)}`).join('\n')}

MC movements:
${pool.map((c, i) => `M${i + 1} | ${c.date} | tour ${[c.bookingRef, ...c.aliases].filter(Boolean).join('/')} | ${c.guestName ?? '-'} | ${c.pickUp ?? '-'} → ${c.dropOff ?? '-'} | ${c.time ?? '-'} | ${(c.details ?? '').slice(0, 120)}`).join('\n')}

Return JSON: {"pairs": [{"row": "R12", "movement": "M3", "confidence": 0.0-1.0}]}. Use each movement at most once. Leave out rows you are unsure of.`
  try {
    const res = await openai.chat.completions.create({
      model: AI_MODEL, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'You reconcile transport records. Return only JSON.' }, { role: 'user', content: prompt }],
    })
    await logAiUsage({ callType: 'trans_recon_ai_pair', model: AI_MODEL, usage: res.usage, source: 'trans-recon-import' })
    const j = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { pairs?: { row?: string; movement?: string; confidence?: number }[] }
    const used = new Set<string>()
    for (const p of j.pairs ?? []) {
      const row = Number(String(p.row ?? '').replace(/\D/g, ''))
      const key = ids.get(String(p.movement ?? '').toUpperCase())
      const conf = Number(p.confidence)
      if (!row || !key || used.has(key) || !(conf >= 0.6)) continue
      if (!rows.some(r => r.row === row)) continue
      used.add(key); out.set(row, { key, score: Math.round(conf * 1000) / 1000 })
    }
  } catch (err) {
    console.error('[trans-recon import] AI pairing failed:', err)
  }
  return out
}

// ── Preview ─────────────────────────────────────────────────────────────────

export interface ImportOptions {
  country?: string | null
  year?: number | null
  month?: number | null
  half?: number | null
  sheet?: string | null
  headerRow?: number | null
  columns?: ColumnMap | null
  /** Ask OpenAI to pair the rows the scorer could not place. */
  aiPair?: boolean
  /** Row number → candidate key, 'NEW' (add as a new line) or 'SKIP'. */
  links?: Record<string, string>
}

interface ResolvedBooking { bookingRef: string; cancelled: boolean; country: string | null }

/** Which booking each Excel tour cell names — by ref, agent booking id or IS number. */
async function resolveBookings(rows: ImportRow[]): Promise<Map<number, ResolvedBooking>> {
  const toks = Array.from(new Set(rows.flatMap(r => tourTokens(r.tourNo))))
  const out = new Map<number, ResolvedBooking>()
  if (!toks.length) return out
  const found = await prisma.booking.findMany({
    where: { OR: [{ bookingRef: { in: toks } }, { agentBookingId: { in: toks } }, { isNumber: { in: toks } }] },
    select: { bookingRef: true, agentBookingId: true, isNumber: true, status: true, cancelledAt: true, operationCountry: true },
  })
  const by = new Map<string, ResolvedBooking>()
  for (const b of found) {
    const v = { bookingRef: b.bookingRef, cancelled: b.status === 'CANCELLED' || b.cancelledAt !== null, country: b.operationCountry }
    for (const k of [b.bookingRef, b.agentBookingId, b.isNumber]) if (k) by.set(clean(k).toUpperCase(), v)
  }
  for (const r of rows) {
    // The booking ref outranks an alias when a cell names both.
    const ts = tourTokens(r.tourNo)
    const hit = ts.map(t => by.get(t)).find(v => v && ts.includes(v.bookingRef.toUpperCase())) ?? ts.map(t => by.get(t)).find(Boolean)
    if (hit) out.set(r.row, hit)
  }
  return out
}

export async function previewImport(buffer: Buffer, fileName: string, opts: ImportOptions, allowed: ReconCountry[]) {
  // 1. Read the workbook — with the AI column map when the header is unreadable.
  let parsed = parseWorkbook(buffer, fileName, opts.columns ? { sheet: opts.sheet ?? undefined, headerRow: opts.headerRow ?? 1, columns: opts.columns } : opts.sheet ? { sheet: opts.sheet } : undefined)
  let usedAi = false
  if (!parsed.sheet || (!parsed.sheet.headerRow && !opts.columns)) {
    const target = parsed.grids.find(g => g.name === (opts.sheet ?? parsed.sheet?.name)) ?? parsed.grids[0]
    const ai = target ? await aiColumnMap(target.grid, fileName) : null
    if (ai) {
      parsed = parseWorkbook(buffer, fileName, { sheet: target.name, headerRow: ai.headerRow, columns: ai.columns })
      usedAi = true
    }
  }
  const sheet = parsed.sheet
  if (!sheet || !sheet.columns.serviceDate) {
    throw new ReconError('Could not find the DATE / TOUR NO / RATES columns in this workbook. Check it has a header row.', 422)
  }
  if (!sheet.rows.length) throw new ReconError(`The sheet "${sheet.name}" has a header but no rows under it.`, 422)

  // 2. Which country and half month.
  const detected: DetectedContext = detectContext(fileName, sheet.name, sheet.rows)
  const country = (opts.country && RECON_COUNTRIES.includes(opts.country.toUpperCase() as ReconCountry) ? opts.country.toUpperCase() : detected.country) as ReconCountry | null
  const year = Number(opts.year) || detected.year
  const month = Number(opts.month) || detected.month
  const half = (opts.half === 1 || opts.half === 2 ? opts.half : detected.half) as Half | null
  if (country && !allowed.includes(country)) throw new ReconError(`${country} is outside your country scope.`, 403)

  const base = {
    file: fileName,
    sheets: parsed.sheets.map(s => ({ name: s.name, rows: s.rows.length, headerRow: s.headerRow })),
    sheetName: sheet.name, headerRow: sheet.headerRow, columns: sheet.columns, headers: sheet.headers, usedAi, detected,
  }
  if (!country || !year || !month || !half) {
    return { ...base, ready: false as const, chosen: { country, year, month, half }, rows: sheet.rows.map(r => ({ ...r, inPeriod: false, booking: null, match: null, pnl: null as PnlHit | null, pnlBooking: null as string | null, warnings: [] as string[] })) }
  }

  // 3. The MC side: the sheet's own lines when it exists, the MC Report otherwise.
  const p = periodOf(year, month, half)
  const existing = await prisma.transReconSheet.findUnique({
    where: { country_periodYear_periodMonth_half: { country, periodYear: year, periodMonth: month, half } },
    select: { id: true, status: true, lastImportFile: true, lastImportAt: true, _count: { select: { lines: true } } },
  })
  const cands = existing ? await sheetCandidates(existing.id) : await movementCandidates(country, p.start, p.end)
  const candBy = new Map(cands.map(c => [c.key, c]))

  const inPeriod = sheet.rows.filter(r => r.serviceDate && r.serviceDate >= p.start && r.serviceDate <= p.end)
  const matches = pairRows(inPeriod, cands)

  // AI for the leftovers, only when asked.
  if (opts.aiPair) {
    const taken = new Set(Array.from(matches.values()).map(m => m.key).filter(Boolean))
    const left = inPeriod.filter(r => !matches.get(r.row)?.key)
    const ai = await aiPairs(left, cands.filter(c => !taken.has(c.key)), fileName)
    for (const [row, m] of Array.from(ai)) {
      const prev = matches.get(row)
      matches.set(row, { key: m.key, score: m.score, why: ['AI'], by: 'AI', alternatives: prev?.alternatives ?? [] })
    }
  }
  // The desk's own choices win.
  for (const [rowKey, link] of Object.entries(opts.links ?? {})) {
    const row = Number(rowKey)
    const m = matches.get(row)
    if (!m) continue
    if (link === 'NEW' || link === 'SKIP') matches.set(row, { ...m, key: null, by: 'YOU', why: [link === 'SKIP' ? 'skipped' : 'new line'] })
    else if (candBy.has(link)) {
      // Whoever held that candidate before gives it up.
      for (const [r2, m2] of Array.from(matches)) if (r2 !== row && m2.key === link) matches.set(r2, { ...m2, key: null, by: null, why: [] })
      matches.set(row, { ...m, key: link, score: 1, by: 'YOU', why: ['picked'] })
    }
  }

  const booking = await resolveBookings(sheet.rows)
  const usedKeys = new Set(Array.from(matches.values()).map(m => m.key).filter((k): k is string => !!k))

  // The booking each row belongs to — its paired movement's, else the one its
  // tour cell names — and the P&L line its DETAILS text names.
  const refFor = (r: ImportRow) => {
    const m = matches.get(r.row)
    return (m?.key ? candBy.get(m.key)?.bookingRef : null) ?? booking.get(r.row)?.bookingRef ?? null
  }
  const pnls = await loadPnls(Array.from(new Set(sheet.rows.map(refFor).filter((v): v is string => !!v))))

  let approvedChanges = 0, rateChanges = 0
  const rows = sheet.rows.map(r => {
    const warnings: string[] = []
    const inside = !!r.serviceDate && r.serviceDate >= p.start && r.serviceDate <= p.end
    if (!inside) warnings.push(r.serviceDate ? `outside ${p.start} → ${p.end} — will be skipped` : 'no readable date — will be skipped')
    const b = booking.get(r.row) ?? null
    if (b?.cancelled) warnings.push(`booking ${b.bookingRef} is cancelled`)
    if (b?.country && !(b.country === country || (b.country === 'SINGAPORE_MALAYSIA' && (country === 'SINGAPORE' || country === 'MALAYSIA')) || ((b.country === 'SINGAPORE' || b.country === 'MALAYSIA') && (country === 'SINGAPORE' || country === 'MALAYSIA')))) {
      warnings.push(`booking ${b.bookingRef} is a ${b.country.toLowerCase()} file`)
    }
    if (r.tourNo && !b) warnings.push('tour no not found in OPS')
    const m = inside ? matches.get(r.row) ?? null : null
    const c = m?.key ? candBy.get(m.key) : undefined
    if (c && r.rate != null && c.rate != null && Math.abs(c.rate - r.rate) > 0.005) {
      rateChanges++
      if (c.approvalStatus !== 'PENDING') { approvedChanges++; warnings.push(`changes a rate Accounts already ${c.approvalStatus === 'APPROVED' ? 'approved' : 'refused'} (${c.rate} → ${r.rate}) — it goes back to them`) }
    }
    if (opts.links?.[String(r.row)] === 'SKIP') warnings.push('you chose to skip this row')

    const ref = refFor(r)
    const choices = ref ? pnls.get(ref) ?? [] : []
    const pnl = inside ? pnlFromDetails(r.details, choices) : null
    if (inside && ref && !choices.length) warnings.push(`booking ${ref} has no P&L lines in OPS`)
    else if (inside && ref && !pnl && r.details) warnings.push('DETAILS does not name a P&L line of this booking — the movement matcher will pair it')
    return { ...r, inPeriod: inside, booking: b, match: m, pnl, pnlBooking: ref, warnings }
  })

  // Duplicate rows inside the workbook.
  const seen = new Map<string, number>()
  for (const r of rows) {
    const k = [r.serviceDate, tourTokens(r.tourNo).join('/'), clean(r.pickUp).toLowerCase(), clean(r.dropOff).toLowerCase(), r.time].join('|')
    if (seen.has(k)) r.warnings.push(`looks like a repeat of row ${seen.get(k)}`)
    else seen.set(k, r.row)
  }

  const mcOnly = cands.filter(c => c.kind === 'MC' && !usedKeys.has(c.key) && !c.cancelled)
  const live = rows.filter(r => r.inPeriod && opts.links?.[String(r.row)] !== 'SKIP')
  return {
    ...base,
    ready: true as const,
    chosen: { country, year, month, half, start: p.start, end: p.end, title: sheetTitle(country, p) },
    existing: existing ? { id: existing.id, status: existing.status, lines: existing._count.lines, lastImportFile: existing.lastImportFile, lastImportAt: existing.lastImportAt?.toISOString() ?? null } : null,
    rows,
    candidates: cands.map(c => ({ key: c.key, kind: c.kind, date: c.date, bookingRef: c.bookingRef, tourNo: c.tourNo, guestName: c.guestName, pickUp: c.pickUp, dropOff: c.dropOff, time: c.time, details: c.details, rate: c.rate, approvalStatus: c.approvalStatus })),
    mcOnly: mcOnly.map(c => c.key),
    summary: {
      rows: sheet.rows.length,
      importable: live.length,
      paired: live.filter(r => r.match?.key).length,
      newLines: live.filter(r => !r.match?.key).length,
      outside: rows.filter(r => !r.inPeriod).length,
      mcOnly: mcOnly.length,
      totalRate: Math.round(live.reduce((s, r) => s + (r.rate ?? 0), 0) * 100) / 100,
      pnlNamed: live.filter(r => r.pnl).length,
      unrated: live.filter(r => r.rate == null).length,
      rateChanges, approvedChanges,
    },
  }
}

// ── Commit ──────────────────────────────────────────────────────────────────

export interface CommitOptions extends ImportOptions {
  /** Use the workbook's wording for date, tour, guest, pax, places, time and details (default true). */
  applyText?: boolean
  /** MC lines the workbook does not mention: keep them, or strike them off (restorable). */
  unmatchedMc?: 'keep' | 'remove'
}

export async function commitImport(buffer: Buffer, fileName: string, opts: CommitOptions, allowed: ReconCountry[], actor: Actor) {
  const pv = await previewImport(buffer, fileName, opts, allowed)
  if (!pv.ready) throw new ReconError('Pick the country and the half month first.', 422)
  const { country, year, month, half } = pv.chosen

  const existing = pv.existing
  if (existing?.status === 'LOCKED') throw new ReconError('That sheet is locked by Accounts — ask them to unlock it first.', 409)
  const sheetId = existing ? existing.id : (await createSheet(country, year, month, half as Half, actor)).id

  // A preview made before the sheet existed pointed at MC movements; resolve
  // those to the lines Generate has just made from them.
  const lines = await prisma.transReconLine.findMany({ where: { sheetId }, select: { id: true, agendaItemId: true, source: true, isRemoved: true, bookingCancelled: true } })
  const lineByAgenda = new Map(lines.filter(l => l.agendaItemId).map(l => [l.agendaItemId!, l.id]))
  const toLineId = (key: string | null | undefined) => !key ? null
    : key.startsWith('l:') ? key.slice(2) : key.startsWith('a:') ? lineByAgenda.get(key.slice(2)) ?? null : null

  const applyText = opts.applyText !== false
  const inputs: LineInput[] = []
  const usedLines = new Set<string>()
  const skipped: number[] = []
  for (const r of pv.rows) {
    if (!r.inPeriod || opts.links?.[String(r.row)] === 'SKIP') { skipped.push(r.row); continue }
    const lineId = toLineId(r.match?.key)
    const fields: LineInput = { importRow: r.row }
    if (r.rateText) fields.rateText = r.rateText
    if (r.remarks) fields.remarks = r.remarks
    const text = { serviceDate: r.serviceDate, tourNo: r.tourNo, guestName: r.guestName, pax: r.pax, pickUp: r.pickUp, dropOff: r.dropOff, time: r.time, details: r.details }
    if (lineId && !usedLines.has(lineId)) {
      usedLines.add(lineId)
      if (applyText) for (const [k, v] of Object.entries(text)) if (v) (fields as Record<string, unknown>)[k] = v
      inputs.push({ id: lineId, ...fields })
    } else {
      // In-period rows always carry a date (rows without one are outside it).
      inputs.push({ ...text, serviceDate: r.serviceDate!, ...fields, bookingRef: r.booking?.bookingRef ?? null })
    }
  }

  const remove = opts.unmatchedMc === 'remove'
    ? lines.filter(l => l.source === 'MC' && !l.isRemoved && !l.bookingCancelled && !usedLines.has(l.id)).map(l => l.id)
    : []

  await saveLines(sheetId, { lines: inputs, remove }, actor, { importedFrom: fileName })
  const fromDetails = await applyDetailsPnl(sheetId, fileName, pv.rows, actor)
  const paired = await pairManualLines(sheetId)
  await prisma.transReconSheet.update({
    where: { id: sheetId },
    data: { lastImportAt: new Date(), lastImportFile: fileName.slice(0, 191), lastImportBy: actor.name ?? null },
  })

  return {
    sheetId,
    created: !existing,
    updated: inputs.filter(i => i.id).length,
    added: inputs.filter(i => !i.id).length,
    removed: remove.length,
    skipped: skipped.length,
    pnlPaired: paired,
    pnlFromDetails: fromDetails,
  }
}

/**
 * Put the P&L line each row's DETAILS named onto the line the row became.
 * It outranks an automatic guess — the desk wrote it — but never a pick made
 * by hand on the page. A decided line whose P&L value moves goes back to
 * Accounts as pending, as any other change would.
 */
async function applyDetailsPnl(
  sheetId: string, fileName: string,
  rows: { row: number; inPeriod: boolean; pnl: PnlHit | null; pnlBooking: string | null }[],
  actor: Actor,
): Promise<number> {
  const named = rows.filter(r => r.inPeriod && r.pnl)
  if (!named.length) return 0
  const lines = await prisma.transReconLine.findMany({
    where: { sheetId, importedFrom: fileName.slice(0, 191), importRow: { in: named.map(r => r.row) } },
    select: { id: true, importRow: true, bookingRef: true, pnlMatch: true, pnlLineItemId: true, pnlValue: true, approvalStatus: true, approvedByName: true, approvalNote: true },
  })
  const byRow = new Map(lines.map(l => [l.importRow!, l]))
  const ops = []
  for (const r of named) {
    const l = byRow.get(r.row)
    const p = r.pnl!
    if (!l || l.pnlMatch === 'MANUAL') continue
    // Only a P&L line of the booking this line belongs to.
    if (l.bookingRef && r.pnlBooking && l.bookingRef !== r.pnlBooking) continue
    if (l.pnlLineItemId === p.id && l.pnlMatch === 'EXCEL') continue
    const valueMoved = (l.pnlValue == null ? null : Number(l.pnlValue)) !== p.value
    ops.push(prisma.transReconLine.update({
      where: { id: l.id },
      data: {
        pnlLineItemId: p.id, pnlDescription: p.activity, pnlCategory: p.category, pnlValue: p.value,
        pnlCurrency: p.currency, pnlMatch: 'EXCEL', pnlScore: p.score,
        ...(l.bookingRef ? {} : { bookingRef: r.pnlBooking }),
        ...(valueMoved ? approvalReset(l, actor, `P&L line set from the Excel ("${p.activity.slice(0, 80)}")`) : {}),
      },
    }))
  }
  if (ops.length) await prisma.$transaction(ops)
  return ops.length
}

/**
 * Give hand-added lines that name a booking a P&L line, the same way MC lines
 * get one — matched over every live line of that booking on the sheet, so a
 * P&L line an MC movement already holds is not taken twice. Never touches a
 * line whose pairing someone chose.
 */
export async function pairManualLines(sheetId: string): Promise<number> {
  const all = await prisma.transReconLine.findMany({ where: { sheetId, isRemoved: false, bookingRef: { not: null } } })
  const todo = all.filter(l => l.source === 'MANUAL' && l.pnlMatch === 'NONE' && !l.pnlLineItemId)
  if (!todo.length) return 0
  const refs = Array.from(new Set(todo.map(l => l.bookingRef!)))
  const bookings = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: { bookingRef: true, currency: true, arrivalDate: true, pnl: { select: { paxAdults: true, paxChildren: true, lineItems: true } } },
  })
  let n = 0
  const ops = []
  for (const b of bookings) {
    const items = b.pnl?.lineItems ?? []
    if (!items.length) continue
    const arrival = day(b.arrivalDate)!
    const mine = all.filter(l => l.bookingRef === b.bookingRef)
    const movements: MatchMovement[] = mine.map(l => ({
      key: l.id, date: day(l.serviceDate)!,
      dayNumber: Math.round((Date.parse(`${day(l.serviceDate)}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000) + 1,
      fromPoint: l.pickUp, toPoint: l.dropOff, details: [l.details, l.mcDescription].filter(Boolean).join(' '), location: null, serviceType: l.serviceType,
    }))
    const result = matchMovements(movements, items.map(li => ({ id: li.id, activity: li.activity, category: li.category })))
    for (const l of todo.filter(t => t.bookingRef === b.bookingRef)) {
      const m = result.get(l.id)
      if (!m) continue
      const li = items.find(i => i.id === m.pnlLineId)!
      ops.push(prisma.transReconLine.update({
        where: { id: l.id },
        data: {
          pnlLineItemId: li.id, pnlDescription: li.activity, pnlCategory: li.category, pnlCurrency: b.currency || 'USD',
          pnlValue: Math.round(computePNLLineTotal(li, b.pnl!.paxAdults, b.pnl!.paxChildren) * 100) / 100,
          pnlMatch: 'AUTO', pnlScore: m.score,
        },
      }))
      n++
    }
  }
  if (ops.length) await prisma.$transaction(ops)
  return n
}
