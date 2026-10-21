/**
 * Trans-Reconsultation — database side. See ./shared.ts for what a sheet is.
 *
 * Writes only trans_recon_sheets / trans_recon_lines. Bookings, agendas,
 * assignments and P&Ls are read, never written. The Accounts system writes the
 * approval columns of trans_recon_lines and the lock columns of the sheet; this
 * file resets a line's approval when the figure that was approved changes.
 */
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computePNLLineTotal } from '@/lib/utils'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import { matchMovements, scorePair, type MatchMovement, type MatchPnlLine } from './match'
import { accountsPnlLines, resolveAccountsLine } from './accounts-pnl'
import { getConversionRate, isExchangeConfigured } from '@/lib/currency'
import { loadMcSuppliers } from '@/lib/mc-supplier'
import { getAccountsSupplier, isSupplierSource } from '@/lib/accounts-suppliers-db'
import {
  EDITABLE_FIELDS, RECON_COUNTRIES, RECON_COUNTRY_META, formatPax, parseRate, periodOf, sheetTitle, sortLines,
  type ApprovalStatus, type EditableField, type Half, type LineSource, type PnlMatch, type ReconCountry,
  type ReconLine, type ReconSheet, type ReconSupplierSource, type SheetStatus,
} from './shared'

export class ReconError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /trans_recon_.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

export interface Actor { id?: string | null; name?: string | null }

const dec = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v))
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const cut = (s: string | null | undefined, n: number) => { const c = clean(s); return c ? c.slice(0, n) : null }
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

// ── Who may see which country ───────────────────────────────────────────────

/** The recon countries a user may open. Admins and ALL users get all four. */
export function allowedCountries(role: string, userCountry: string | null | undefined): ReconCountry[] {
  if (canSeeAllCountries(role as never, userCountry as never)) return [...RECON_COUNTRIES]
  const scope = countryScope(userCountry) as string[] | null
  if (!scope) return [...RECON_COUNTRIES]
  return RECON_COUNTRIES.filter(c => scope.includes(c) || (scope.includes('SINGAPORE_MALAYSIA') && (c === 'SINGAPORE' || c === 'MALAYSIA')))
}

export function assertCountry(country: string, allowed: ReconCountry[]): ReconCountry {
  const c = String(country).toUpperCase() as ReconCountry
  if (!RECON_COUNTRIES.includes(c)) throw new ReconError('Unknown country')
  if (!allowed.includes(c)) throw new ReconError('That country is outside your scope', 403)
  return c
}

// ── Row mapping ─────────────────────────────────────────────────────────────

type SheetRow = Prisma.TransReconSheetGetPayload<object>
type LineRow = Prisma.TransReconLineGetPayload<object>

function toSheet(s: SheetRow): ReconSheet {
  const fx = (s.fxRates && typeof s.fxRates === 'object' && !Array.isArray(s.fxRates)) ? s.fxRates as Record<string, unknown> : {}
  return {
    id: s.id,
    country: s.country as ReconCountry,
    periodYear: s.periodYear,
    periodMonth: s.periodMonth,
    half: (s.half === 2 ? 2 : 1) as Half,
    periodStart: day(s.periodStart)!,
    periodEnd: day(s.periodEnd)!,
    title: s.title,
    currency: s.currency,
    fxRates: Object.fromEntries(Object.entries(fx).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)),
    status: (['DRAFT', 'SUBMITTED', 'LOCKED'].includes(s.status) ? s.status : 'DRAFT') as SheetStatus,
    note: s.note,
    accountsNote: s.accountsNote,
    createdByName: s.createdByName,
    submittedAt: s.submittedAt?.toISOString() ?? null,
    submittedByName: s.submittedByName,
    lockedAt: s.lockedAt?.toISOString() ?? null,
    lockedByName: s.lockedByName,
    lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    lastImportAt: s.lastImportAt?.toISOString() ?? null,
    lastImportFile: s.lastImportFile,
    lastImportBy: s.lastImportBy,
    updatedByName: s.updatedByName,
    updatedAt: s.updatedAt?.toISOString() ?? null,
  }
}

function toLine(r: LineRow): ReconLine {
  const edited = Array.isArray(r.editedFields) ? (r.editedFields as unknown[]).map(String) : []
  return {
    id: r.id,
    position: r.position,
    source: (r.source === 'MANUAL' ? 'MANUAL' : 'MC') as LineSource,
    agendaItemId: r.agendaItemId,
    bookingRef: r.bookingRef,
    serviceDate: day(r.serviceDate)!,
    tourNo: r.tourNo,
    guestName: r.guestName,
    pax: r.pax,
    pickUp: r.pickUp,
    dropOff: r.dropOff,
    time: r.time,
    details: r.details,
    mcDescription: r.mcDescription,
    serviceType: r.serviceType,
    vendorName: r.vendorName,
    mcDriverRate: dec(r.mcDriverRate),
    mcRateCurrency: r.mcRateCurrency,
    pnlLineItemId: r.pnlLineItemId,
    pnlDescription: r.pnlDescription,
    pnlCategory: r.pnlCategory,
    pnlValue: dec(r.pnlValue),
    pnlCurrency: r.pnlCurrency,
    pnlMatch: (['AUTO', 'MANUAL', 'EXCEL'].includes(r.pnlMatch) ? r.pnlMatch : 'NONE') as PnlMatch,
    pnlScore: dec(r.pnlScore),
    rateText: r.rateText,
    rate: dec(r.rate),
    remarks: r.remarks,
    editedFields: edited,
    bookingCancelled: r.bookingCancelled,
    mcMissing: r.mcMissing,
    isRemoved: r.isRemoved,
    approvalStatus: (['APPROVED', 'REJECTED'].includes(r.approvalStatus) ? r.approvalStatus : 'PENDING') as ApprovalStatus,
    approvalNote: r.approvalNote,
    approvedRate: dec(r.approvedRate),
    approvedByName: r.approvedByName,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    importedFrom: r.importedFrom,
    importRow: r.importRow,
    updatedByName: r.updatedByName,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }
}

// ── Driver and supplier (trans_recon_line_parties) ──────────────────────────
//
// Own table, read only by the code below, so a database where
// prisma/sql/2026-10-21-transport-suppliers.sql has not been run yet still
// opens every sheet — just without the two columns.

export const PARTIES_NOT_READY =
  'Driver and supplier are not set up on this database yet — run prisma/sql/apply-transport-suppliers.sh.'

export function isPartiesMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /trans_recon_line_parties.*(doesn't exist|does not exist)/i.test(e?.message ?? '')
}

type PartyRow = Prisma.TransReconLinePartyGetPayload<object>
export interface SupplierPick { source: ReconSupplierSource; id: number; name: string; country: string | null }

const pickOf = (p: PartyRow | null | undefined): SupplierPick | null =>
  p?.supplierSource && p.supplierId != null && isSupplierSource(p.supplierSource)
    ? { source: p.supplierSource, id: Number(p.supplierId), name: p.supplierName ?? '', country: p.supplierCountry ?? null }
    : null
const samePick = (a: SupplierPick | null, b: SupplierPick | null) =>
  (a?.source ?? null) === (b?.source ?? null) && (a?.id ?? null) === (b?.id ?? null)

/** Party rows by line id, or null when the table is not there yet. */
async function loadParties(where: Prisma.TransReconLinePartyWhereInput): Promise<Map<string, PartyRow> | null> {
  try {
    return new Map((await prisma.transReconLineParty.findMany({ where })).map(p => [p.lineId, p]))
  } catch (err) {
    if (isPartiesMissing(err)) return null
    throw err
  }
}

function withParty(l: ReconLine, p: PartyRow | undefined): ReconLine {
  const pick = pickOf(p)
  return {
    ...l,
    driverName: p?.driverName ?? null,
    supplierSource: pick?.source ?? null,
    supplierId: pick?.id ?? null,
    supplierName: pick?.name ?? null,
    supplierCountry: pick?.country ?? null,
    driverEdited: p?.driverEdited ?? false,
    supplierEdited: p?.supplierEdited ?? false,
  }
}

type PartyLine = { id: string; sheetId: string } & Pick<LineRow, 'approvalStatus' | 'approvedByName' | 'approvalNote'>

/**
 * The write that moves a line's party row to `next`, or nothing when it is
 * already there. `supplierMoved` says a supplier was replaced or taken off —
 * Accounts approved paying this line to one supplier, and paying another is a
 * new decision, so callers send the line back to pending (approvalReset).
 */
function partyWrite(line: PartyLine, current: PartyRow | undefined, next: {
  driverName: string | null; supplier: SupplierPick | null; driverEdited: boolean; supplierEdited: boolean
}, actor: Actor): { op: Prisma.PrismaPromise<unknown> | null; supplierMoved: boolean } {
  const cur = pickOf(current)
  const unchanged = (current?.driverName ?? null) === next.driverName && samePick(cur, next.supplier)
    && (cur?.name ?? null) === (next.supplier?.name ?? null)
    && (current?.driverEdited ?? false) === next.driverEdited && (current?.supplierEdited ?? false) === next.supplierEdited
  if (unchanged || (!current && !next.driverName && !next.supplier && !next.driverEdited && !next.supplierEdited)) {
    return { op: null, supplierMoved: false }
  }
  const data = {
    sheetId: line.sheetId,
    driverName: next.driverName,
    supplierSource: next.supplier?.source ?? null,
    supplierId: next.supplier ? BigInt(next.supplier.id) : null,
    supplierName: next.supplier ? next.supplier.name.slice(0, 191) : null,
    supplierCountry: next.supplier?.country ?? null,
    driverEdited: next.driverEdited,
    supplierEdited: next.supplierEdited,
    updatedByName: actor.name ?? null,
  }
  return {
    op: prisma.transReconLineParty.upsert({ where: { lineId: line.id }, create: { lineId: line.id, ...data }, update: data }),
    supplierMoved: cur !== null && !samePick(cur, next.supplier),
  }
}

/**
 * An MC Report supplier pick, carried straight onto the lines already made
 * from those movements — so the sheet does not wait for a refresh. Lines whose
 * supplier was set on the sheet, and locked sheets, are left alone. Never
 * throws: the MC pick is saved whether or not this part can run.
 */
export async function applyMcSupplierToLines(agendaItemIds: string[], supplier: SupplierPick | null, actor: Actor): Promise<number> {
  if (!agendaItemIds.length) return 0
  try {
    const lines = await prisma.transReconLine.findMany({
      where: { agendaItemId: { in: agendaItemIds }, sheet: { status: { not: 'LOCKED' } } },
      select: { id: true, sheetId: true, approvalStatus: true, approvedByName: true, approvalNote: true },
    })
    if (!lines.length) return 0
    const parties = await loadParties({ lineId: { in: lines.map(l => l.id) } })
    if (!parties) return 0
    const ops: Prisma.PrismaPromise<unknown>[] = []
    let n = 0
    for (const l of lines) {
      const p = parties.get(l.id)
      if (p?.supplierEdited) continue
      const w = partyWrite(l, p, { driverName: p?.driverName ?? null, supplier, driverEdited: p?.driverEdited ?? false, supplierEdited: false }, actor)
      if (!w.op) continue
      ops.push(w.op); n++
      if (w.supplierMoved) {
        const reset = approvalReset(l, actor, `Supplier changed to ${supplier?.name ?? 'none'} on the MC Report`)
        if (Object.keys(reset).length) ops.push(prisma.transReconLine.update({ where: { id: l.id }, data: reset }))
      }
    }
    for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100))
    return n
  } catch (err) {
    if (!isPartiesMissing(err) && !isMissingTable(err)) console.error('[trans-recon] MC supplier carry failed (non-fatal):', err)
    return 0
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listSheets(year: number, month: number | null, allowed: ReconCountry[]) {
  const sheets = await prisma.transReconSheet.findMany({
    where: { periodYear: year, ...(month ? { periodMonth: month } : {}), country: { in: allowed } },
    orderBy: [{ periodMonth: 'asc' }, { half: 'asc' }, { country: 'asc' }],
  })
  const lines = sheets.length
    ? await prisma.transReconLine.findMany({ where: { sheetId: { in: sheets.map(s => s.id) } } })
    : []
  const by = new Map<string, ReconLine[]>()
  for (const l of lines) { const a = by.get(l.sheetId); const m = toLine(l); if (a) a.push(m); else by.set(l.sheetId, [m]) }
  return sheets.map(s => ({ sheet: toSheet(s), lines: by.get(s.id) ?? [] }))
}

export async function loadSheet(id: string, allowed: ReconCountry[]) {
  const s = await prisma.transReconSheet.findUnique({ where: { id } })
  if (!s) throw new ReconError('Sheet not found', 404)
  if (!allowed.includes(s.country as ReconCountry)) throw new ReconError('That country is outside your scope', 403)
  const [lines, parties] = await Promise.all([
    prisma.transReconLine.findMany({ where: { sheetId: id }, orderBy: [{ serviceDate: 'asc' }, { position: 'asc' }] }),
    loadParties({ sheetId: id }),
  ])
  return {
    sheet: toSheet(s),
    lines: sortLines(lines.map(l => (parties ? withParty(toLine(l), parties.get(l.id)) : toLine(l)))),
    /** False until trans_recon_line_parties exists — the page then hides Driver / Supplier. */
    partiesReady: parties !== null,
  }
}

/**
 * The P&L lines a desk can point a movement at, from both places a booking's
 * costing can live: OPS's own P&L, and the Accounts system's Detailed P&L.
 * With a line id, each option is scored against that movement (the same
 * scorer the automatic pairing uses) and counted by how many live lines of
 * the sheet already point at it — so a shared transport line reads as such.
 */
export async function pnlOptions(bookingRef: string, sheetId?: string, lineId?: string) {
  const [b, accounts, line, sheetLines] = await Promise.all([
    prisma.booking.findUnique({
      where: { bookingRef },
      select: { bookingRef: true, currency: true, arrivalDate: true, pnl: { select: { paxAdults: true, paxChildren: true, lineItems: { orderBy: { sortOrder: 'asc' } } } } },
    }),
    accountsPnlLines(bookingRef),
    lineId ? prisma.transReconLine.findUnique({ where: { id: lineId } }) : Promise.resolve(null),
    sheetId ? prisma.transReconLine.findMany({ where: { sheetId, isRemoved: false, bookingCancelled: false, pnlLineItemId: { not: null } }, select: { pnlLineItemId: true } }) : Promise.resolve([]),
  ])
  const ops = (b?.pnl?.lineItems ?? []).map(li => ({
    id: li.id, activity: li.activity, category: li.category,
    value: Math.round(computePNLLineTotal(li, b!.pnl!.paxAdults, b!.pnl!.paxChildren) * 100) / 100,
  }))

  const usedBy: Record<string, number> = {}
  for (const l of sheetLines) usedBy[l.pnlLineItemId!] = (usedBy[l.pnlLineItemId!] ?? 0) + 1

  let suggested: { id: string; score: number }[] = []
  if (line) {
    const arrival = b?.arrivalDate ? day(b.arrivalDate) : null
    const mv: MatchMovement = {
      key: line.id, date: day(line.serviceDate)!,
      dayNumber: arrival ? Math.round((line.serviceDate.getTime() - dateOnly(arrival).getTime()) / 86_400_000) + 1 : null,
      fromPoint: line.pickUp, toPoint: line.dropOff, details: [line.details, line.mcDescription].filter(Boolean).join(' '),
      location: null, serviceType: line.serviceType,
    }
    suggested = [...ops, ...accounts.lines]
      .map(o => ({ id: o.id, score: scorePair(mv, { id: o.id, activity: o.activity, category: o.category }) }))
      .filter(s => s.score >= 0.16)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3)
  }

  return {
    bookingRef,
    currency: b?.currency ?? null,
    lines: ops,
    accounts,
    usedBy,
    suggested,
  }
}

/** Today's rate for converting a P&L currency into the sheet's, when one is configured. */
export async function suggestFx(from: string, to: string): Promise<{ rate: number; fetchedAt: string } | null> {
  try {
    if (!isExchangeConfigured()) return null
    const r = await getConversionRate(from, to)
    return { rate: Math.round(r.rate * 1e6) / 1e6, fetchedAt: r.fetchedAt }
  } catch (err) {
    console.error('[trans-recon] FX lookup failed:', err)
    return null
  }
}

/**
 * Pair every line that has no P&L with its booking's Accounts P&L, in one
 * go — the movement matcher over the Detailed P&L's rows instead of OPS's.
 * Lines a person paired, and lines the Excel named, are left alone.
 */
export async function pairFromAccounts(sheetId: string, actor: Actor) {
  const sheet = await prisma.transReconSheet.findUnique({ where: { id: sheetId } })
  if (!sheet) throw new ReconError('Sheet not found', 404)
  if (sheet.status === 'LOCKED') throw new ReconError('This sheet is locked by Accounts.', 409)

  const lines = await prisma.transReconLine.findMany({ where: { sheetId, isRemoved: false, bookingRef: { not: null } } })
  const todo = lines.filter(l => l.pnlValue == null && l.pnlMatch !== 'MANUAL' && l.pnlMatch !== 'EXCEL')
  const refs = Array.from(new Set(todo.map(l => l.bookingRef!)))
  const result = { paired: 0, bookings: refs.length, noAccountsPnl: [] as string[] }
  if (!refs.length) return result

  const bookings = await prisma.booking.findMany({ where: { bookingRef: { in: refs } }, select: { bookingRef: true, arrivalDate: true } })
  const arrivalBy = new Map(bookings.map(b => [b.bookingRef, day(b.arrivalDate)]))
  const ops: Prisma.PrismaPromise<unknown>[] = []

  for (const ref of refs) {
    const acc = await accountsPnlLines(ref)
    if (!acc.available || !acc.lines.length) { result.noAccountsPnl.push(ref); continue }
    const arrival = arrivalBy.get(ref)
    // Every live line of the booking takes part, so a row one line already
    // holds is not handed out twice.
    const mine = lines.filter(l => l.bookingRef === ref && !l.bookingCancelled)
    const movements: MatchMovement[] = mine.map(l => ({
      key: l.id, date: day(l.serviceDate)!,
      dayNumber: arrival ? Math.round((l.serviceDate.getTime() - dateOnly(arrival).getTime()) / 86_400_000) + 1 : null,
      fromPoint: l.pickUp, toPoint: l.dropOff, details: [l.details, l.mcDescription].filter(Boolean).join(' '),
      location: null, serviceType: l.serviceType,
    }))
    const picks = matchMovements(movements, acc.lines.map(a => ({ id: a.id, activity: a.activity, category: a.category })))
    for (const l of todo.filter(t => t.bookingRef === ref)) {
      const m = picks.get(l.id)
      if (!m) continue
      const a = acc.lines.find(x => x.id === m.pnlLineId)!
      ops.push(prisma.transReconLine.update({
        where: { id: l.id },
        data: {
          pnlLineItemId: a.id, pnlDescription: a.activity, pnlCategory: a.category, pnlValue: a.value,
          pnlCurrency: acc.currency || 'USD', pnlMatch: 'AUTO', pnlScore: m.score, updatedByName: actor.name ?? null,
          ...approvalReset(l, actor, 'A P&L line was added from the Accounts P&L'),
        },
      }))
      result.paired++
    }
  }
  for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100))
  return result
}

// ── Building lines from the MC Report ───────────────────────────────────────

/** Movements a transport sheet never carries: nothing is driven on them. */
const NOT_TRANSPORT = new Set(['FLIGHT', 'ACCOMMODATION', 'INTERNAL_TOUR', 'MEAL_COUPON'])

const MY_RE = /\bmala[iy]sia\b|\bkuala\s*lumpur\b|\bklia\b|\bkl\b|\bgenting\b|\bpenang\b|\blangkawi\b|\bmalacca\b|\bmelaka\b|\bputrajaya\b|\bbatu\s*caves?\b|\bjohor\b|\bcameron\b|\bkota\s*kinabalu\b|\bipoh\b|\bsepang\b/i
const SG_RE = /\bsingapore\b|\bchangi\b|\bsentosa\b|\bmarina\s*bay\b|\borchard\b|\bjewel\b|\bclarke\s*quay\b|\bjurong\b/i

/**
 * Which desk drives this movement. Vietnam and Sri Lanka files are one country
 * each. Singapore and Malaysia are one team selling cross-border tours, so a
 * Singapore file's day in Kuala Lumpur is paid by the Malaysia desk: the MC
 * Report's location decides, then the file's own country, then its ref prefix.
 */
function movementCountry(
  b: { operationCountry: string | null; bookingRef: string; tourDestination: string | null },
  item: { location: string | null; fromPoint: string | null },
): ReconCountry | null {
  const oc = b.operationCountry
  if (oc === 'VIETNAM' || oc === 'SRILANKA') return oc
  if (oc !== 'SINGAPORE' && oc !== 'MALAYSIA' && oc !== 'SINGAPORE_MALAYSIA') return null
  const loc = clean(item.location)
  const my = MY_RE.test(loc), sg = SG_RE.test(loc)
  if (my !== sg) return my ? 'MALAYSIA' : 'SINGAPORE'
  const from = clean(item.fromPoint)
  if (MY_RE.test(from) !== SG_RE.test(from)) return MY_RE.test(from) ? 'MALAYSIA' : 'SINGAPORE'
  if (oc === 'SINGAPORE' || oc === 'MALAYSIA') return oc
  const ref = b.bookingRef.toUpperCase()
  if (ref.startsWith('MY')) return 'MALAYSIA'
  if (ref.startsWith('SG')) return 'SINGAPORE'
  const dest = clean(b.tourDestination)
  if (MY_RE.test(dest) !== SG_RE.test(dest)) return MY_RE.test(dest) ? 'MALAYSIA' : 'SINGAPORE'
  return null
}

const AIRPORT_RE = /airport|\bklia\b|changi|\bapt\b|terminal|\bkul\b|\bsin\b|\bcmb\b|\bsgn\b|\bhan\b|\bdad\b|\bpqc\b|\bcxr\b/i
const minutes = (t: string | null | undefined) => {
  const m = String(t ?? '').match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i)
  if (!m) return null
  let h = Number(m[1]); if (/pm/i.test(m[3] ?? '') && h < 12) h += 12; if (/am/i.test(m[3] ?? '') && h === 12) h = 0
  return h * 60 + Number(m[2])
}

type FlightRow = { bookingId: string; flightNo: string | null; date: Date; depTime: string | null; arrTime: string | null }

/** "FLIGHT : AK6307 ETA : 11:10" on an airport pickup, "… ETD : …" on a drop — as the desk writes it. */
function flightNote(flights: FlightRow[], date: string, meet: string | null, fromPoint: string | null, toPoint: string | null): string | null {
  const arriving = AIRPORT_RE.test(fromPoint ?? ''), leaving = AIRPORT_RE.test(toPoint ?? '')
  if (arriving === leaving) return null
  const next = day(new Date(dateOnly(date).getTime() + 86_400_000))
  const meetM = minutes(meet)
  if (arriving) {
    const same = flights.filter(f => day(f.date) === date && clean(f.arrTime))
    if (!same.length) return null
    const before = meetM == null ? same : same.filter(f => (minutes(f.arrTime) ?? 0) <= meetM + 30)
    const f = (before.length ? before : same).sort((a, b) => (minutes(b.arrTime) ?? 0) - (minutes(a.arrTime) ?? 0))[0]
    return `FLIGHT : ${clean(f.flightNo)} ETA : ${clean(f.arrTime)}`
  }
  const cands = flights.filter(f => (day(f.date) === date || day(f.date) === next) && clean(f.depTime))
    .map(f => ({ f, at: (day(f.date) === next ? 1440 : 0) + (minutes(f.depTime) ?? 0) }))
    .filter(x => meetM == null || x.at >= meetM)
    .sort((a, b) => a.at - b.at)
  return cands.length ? `FLIGHT : ${clean(cands[0].f.flightNo)} ETD : ${clean(cands[0].f.depTime)}` : null
}

/** The first sentence or so of a movement's description — what the Excel DETAILS cell carried. */
function shortDetails(text: string | null): string | null {
  const t = clean(text)
  if (!t) return null
  const first = t.split(/(?<=[.!?])\s+/)[0]
  return (first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first) || null
}

export interface Snapshot {
  agendaItemId: string
  bookingRef: string
  /** Agent booking id and IS number — the other names a desk writes a tour under. */
  aliases: string[]
  bookingId: string
  cancelled: boolean
  serviceDate: string
  fields: Record<EditableField, string | null>
  mcDescription: string | null
  serviceType: string | null
  vendorName: string | null
  /** The driver alone — vendorName above falls back to the driver when there is no vendor. */
  driverName: string | null
  mcDriverRate: number | null
  mcRateCurrency: string | null
  fromPoint: string | null
  toPoint: string | null
}

interface PnlPick { id: string; activity: string; category: string; value: number; currency: string; score: number | null }

/**
 * Every in-scope movement for a country and half month, plus each booking's
 * P&L pairing worked out over the WHOLE agenda — matching only the fifteen days
 * on this sheet would let a movement in the other half steal a line.
 */
export async function collectMovements(country: ReconCountry, start: string, end: string) {
  const group = country === 'MALAYSIA' || country === 'SINGAPORE'
    ? ['SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA'] : [country]

  const items = await prisma.agendaItem.findMany({
    where: {
      date: { gte: dateOnly(start), lte: new Date(`${end}T23:59:59.999Z`) },
      agenda: { booking: { operationCountry: { in: group as never[] }, hotelOnly: false } },
    },
    include: {
      agenda: {
        select: {
          booking: {
            select: {
              id: true, bookingRef: true, agentBookingId: true, isNumber: true, status: true, cancelledAt: true,
              operationCountry: true, tourDestination: true, arrivalDate: true, currency: true,
              paxAdults: true, paxChildren: true, paxInfants: true,
              passengers: { select: { name: true }, orderBy: [{ isLead: 'desc' }, { id: 'asc' }], take: 1 },
            },
          },
        },
      },
      assignment: {
        select: {
          driverRate: true, rateCurrency: true, vendorName: true, driverName: true,
          vendor: { select: { name: true } },
          driver: { select: { name: true, vehicle: { select: { vendor: { select: { name: true } } } } } },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
  })

  let unplaced = 0
  const inScope = items.filter(i => {
    if (resolveIsLeisure(i) || resolveIsHotelOnly(i) || NOT_TRANSPORT.has(String(i.serviceType))) return false
    const c = movementCountry(i.agenda.booking, i)
    if (c === null) { unplaced++; return false }
    return c === country
  })

  const bookingIds = Array.from(new Set(inScope.map(i => i.agenda.booking.id)))
  // Every query below is keyed by these ids; with none, each returns nothing.
  const [flights, allItems, pnls] = await Promise.all([
    prisma.flight.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { bookingId: true, flightNo: true, date: true, depTime: true, arrTime: true },
    }),
    prisma.agendaItem.findMany({
      where: { agenda: { booking: { id: { in: bookingIds } } } },
      select: { id: true, date: true, fromPoint: true, toPoint: true, details: true, location: true, serviceType: true, isLeisure: true, isHotelOnly: true, agenda: { select: { booking: { select: { id: true } } } } },
    }),
    prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, currency: true, pnl: { select: { paxAdults: true, paxChildren: true, lineItems: true } } },
    }),
  ])

  const flightsBy = new Map<string, FlightRow[]>()
  for (const f of flights) { const a = flightsBy.get(f.bookingId); if (a) a.push(f); else flightsBy.set(f.bookingId, [f]) }

  // P&L pairing, booking by booking.
  const pnlById = new Map<string, PnlPick>()
  const pick = new Map<string, PnlPick>()
  const arrivalBy = new Map(inScope.map(i => [i.agenda.booking.id, day(i.agenda.booking.arrivalDate)!]))
  for (const b of pnls) {
    const lines = b.pnl?.lineItems ?? []
    if (!lines.length) continue
    const opts: MatchPnlLine[] = lines.map(li => ({ id: li.id, activity: li.activity, category: li.category }))
    for (const li of lines) {
      pnlById.set(li.id, {
        id: li.id, activity: li.activity, category: li.category, currency: b.currency || 'USD', score: null,
        value: Math.round(computePNLLineTotal(li, b.pnl!.paxAdults, b.pnl!.paxChildren) * 100) / 100,
      })
    }
    const arrival = arrivalBy.get(b.id)
    const movements: MatchMovement[] = allItems
      .filter(i => i.agenda.booking.id === b.id &&!resolveIsLeisure(i) && !resolveIsHotelOnly(i) && !NOT_TRANSPORT.has(String(i.serviceType)))
      .map(i => ({
        key: i.id, date: day(i.date)!,
        dayNumber: arrival ? Math.round((dateOnly(day(i.date)!).getTime() - dateOnly(arrival).getTime()) / 86_400_000) + 1 : null,
        fromPoint: i.fromPoint, toPoint: i.toPoint, details: i.details, location: i.location, serviceType: i.serviceType,
      }))
    for (const [key, r] of Array.from(matchMovements(movements, opts))) {
      pick.set(key, { ...pnlById.get(r.pnlLineId)!, score: r.score })
    }
  }

  const snapshots: Snapshot[] = inScope.map(i => {
    const b = i.agenda.booking
    const date = day(i.date)!
    const time = clean(i.meetingTime) || clean(i.timeFrom) || null
    const note = flightNote(flightsBy.get(b.id) ?? [], date, time, i.fromPoint, i.toPoint)
    const short = shortDetails(i.details)
    const a = i.assignment
    return {
      agendaItemId: i.id,
      bookingRef: b.bookingRef,
      aliases: [b.agentBookingId, b.isNumber].map(v => clean(v)).filter(Boolean),
      bookingId: b.id,
      cancelled: b.status === 'CANCELLED' || b.cancelledAt !== null,
      serviceDate: date,
      fields: {
        serviceDate: date,
        tourNo: b.bookingRef,
        guestName: cut(b.passengers[0]?.name, 191),
        pax: formatPax(b.paxAdults, b.paxChildren, b.paxInfants),
        pickUp: clean(i.fromPoint) || null,
        dropOff: clean(i.toPoint) || null,
        time: time ? time.slice(0, 32) : null,
        details: [note, short].filter(Boolean).join(' - ') || null,
        rateText: null,
        remarks: null,
      },
      mcDescription: clean(i.details) || null,
      serviceType: i.serviceType,
      vendorName: cut(a?.vendor?.name ?? a?.vendorName ?? a?.driver?.vehicle?.vendor?.name ?? a?.driverName ?? a?.driver?.name, 191),
      driverName: cut(a?.driverName ?? a?.driver?.name, 191),
      mcDriverRate: a?.driverRate != null ? Number(a.driverRate) : null,
      mcRateCurrency: a?.rateCurrency ?? null,
      fromPoint: i.fromPoint,
      toPoint: i.toPoint,
    }
  })

  return { snapshots, pick, pnlById, unplaced }
}

export function approvalReset(line: Pick<LineRow, 'approvalStatus' | 'approvedByName' | 'approvalNote'>, actor: Actor, why: string) {
  if (line.approvalStatus === 'PENDING') return {}
  return {
    approvalStatus: 'PENDING',
    approvalNote: `${why} after it was ${line.approvalStatus.toLowerCase()}${line.approvedByName ? ` by ${line.approvedByName}` : ''} — needs a fresh decision.${line.approvalNote ? ` Previous note: ${line.approvalNote}` : ''}`.slice(0, 2000),
  }
}

const pnlData = (p: PnlPick | null, match: PnlMatch) => p
  ? { pnlLineItemId: p.id, pnlDescription: p.activity, pnlCategory: p.category, pnlValue: p.value, pnlCurrency: p.currency, pnlMatch: match, pnlScore: p.score }
  : { pnlLineItemId: null, pnlDescription: null, pnlCategory: null, pnlValue: null, pnlCurrency: null, pnlMatch: 'NONE', pnlScore: null }

export interface SyncResult { added: number; updated: number; cancelled: number; missing: number; unplaced: number; repaired: number; suppliers: number }

/**
 * Bring a sheet up to date with the MC Report.
 *
 *  • New movements become lines. Cancelled files are never added.
 *  • A line keeps every field the desk typed over (editedFields); the rest
 *    follow the movement. Hand-picked P&L lines are kept and re-valued.
 *  • A line whose file was cancelled is flagged, not deleted — it may already
 *    have been paid. A line whose movement left the chart is flagged too.
 *  • Lines the desk struck off stay struck off.
 */
export async function syncSheet(sheetId: string, actor: Actor): Promise<SyncResult> {
  const sheet = await prisma.transReconSheet.findUnique({ where: { id: sheetId } })
  if (!sheet) throw new ReconError('Sheet not found', 404)
  if (sheet.status === 'LOCKED') throw new ReconError('This sheet is locked by Accounts — ask them to unlock it first.', 409)

  const { snapshots, pick, pnlById, unplaced } = await collectMovements(sheet.country as ReconCountry, day(sheet.periodStart)!, day(sheet.periodEnd)!)
  const existing = await prisma.transReconLine.findMany({ where: { sheetId } })
  const byAgenda = new Map(existing.filter(l => l.agendaItemId).map(l => [l.agendaItemId!, l]))
  const live = new Set(snapshots.map(s => s.agendaItemId))

  // A chart saved without the carry-over (or before it existed) re-created its
  // movements under new ids. Re-attach an orphaned line to the movement that
  // has its booking, day and route instead of adding a duplicate.
  const orphans = existing.filter(l => l.source === 'MC' && l.agendaItemId && !live.has(l.agendaItemId))
  const keyOf = (ref: string | null, date: string, from: string | null, to: string | null) =>
    `${ref}|${date}|${clean(from).toLowerCase()}|${clean(to).toLowerCase()}`
  const orphanBy = new Map<string, LineRow>()
  for (const o of orphans) orphanBy.set(keyOf(o.bookingRef, day(o.serviceDate)!, o.pickUp, o.dropOff), o)

  const res: SyncResult = { added: 0, updated: 0, cancelled: 0, missing: 0, unplaced, repaired: 0, suppliers: 0 }
  const ops: Prisma.PrismaPromise<unknown>[] = []
  const claimed = new Set<string>()
  let position = existing.reduce((m, l) => Math.max(m, l.position), 0)

  for (const s of snapshots) {
    let line = byAgenda.get(s.agendaItemId)
    if (!line) {
      const o = orphanBy.get(keyOf(s.bookingRef, s.serviceDate, s.fromPoint, s.toPoint))
      if (o && !claimed.has(o.id)) { line = o; res.repaired++ }
    }
    const auto = pick.get(s.agendaItemId) ?? null

    if (!line) {
      if (s.cancelled) continue
      ops.push(prisma.transReconLine.create({
        data: {
          sheetId, position: ++position, source: 'MC', agendaItemId: s.agendaItemId, bookingRef: s.bookingRef,
          ...s.fields, serviceDate: dateOnly(s.serviceDate),
          mcDescription: s.mcDescription, serviceType: s.serviceType, vendorName: s.vendorName,
          mcDriverRate: s.mcDriverRate, mcRateCurrency: s.mcRateCurrency,
          ...pnlData(auto, auto ? 'AUTO' : 'NONE'),
          updatedByName: actor.name ?? null,
        },
      }))
      res.added++
      continue
    }
    claimed.add(line.id)

    const edited = new Set(Array.isArray(line.editedFields) ? (line.editedFields as unknown[]).map(String) : [])
    const data: Prisma.TransReconLineUpdateInput = {
      agendaItemId: s.agendaItemId,
      bookingRef: s.bookingRef,
      mcDescription: s.mcDescription,
      serviceType: s.serviceType,
      vendorName: s.vendorName,
      mcDriverRate: s.mcDriverRate,
      mcRateCurrency: s.mcRateCurrency,
      bookingCancelled: s.cancelled,
      mcMissing: false,
    }
    for (const f of EDITABLE_FIELDS) {
      if (f === 'rateText' || f === 'remarks' || edited.has(f)) continue
      const v = s.fields[f]
      if (f === 'serviceDate') { if (v) data.serviceDate = dateOnly(v) } else (data as Record<string, unknown>)[f] = v
    }

    // P&L: a hand pick, or one the desk's workbook named, is kept (and
    // re-valued if the P&L moved); an automatic pairing follows the matcher.
    let next: PnlPick | null
    // Accounts-P&L rows and typed figures are not in OPS's P&L at all, so the
    // matcher below could only ever take them away: they are kept as they are.
    const offOps = !!line.pnlLineItemId && (line.pnlLineItemId.startsWith(ACCOUNTS_PREFIX) || line.pnlLineItemId.startsWith(CUSTOM_PREFIX))
    if (offOps) {
      next = null
    } else if (line.pnlMatch === 'MANUAL' || line.pnlMatch === 'EXCEL') {
      next = line.pnlLineItemId ? pnlById.get(line.pnlLineItemId) ?? null : null
      if (line.pnlLineItemId && !next) {
        // The P&L was re-imported under new ids: find the same activity again.
        const same = Array.from(pnlById.values()).find(p => clean(p.activity).toLowerCase() === clean(line!.pnlDescription).toLowerCase())
        next = same ?? null
      }
      Object.assign(data, next ? { ...pnlData(next, line.pnlMatch as PnlMatch), pnlScore: line.pnlScore } : {})
    } else {
      next = auto
      Object.assign(data, pnlData(next, next ? 'AUTO' : 'NONE'))
    }
    const kept = offOps || line.pnlMatch === 'MANUAL' || line.pnlMatch === 'EXCEL'
    const newValue = next ? next.value : (kept ? dec(line.pnlValue) : null)
    if (newValue !== dec(line.pnlValue)) Object.assign(data, approvalReset(line, actor, 'The P&L value changed'))

    if (s.cancelled && !line.bookingCancelled) res.cancelled++
    ops.push(prisma.transReconLine.update({ where: { id: line.id }, data }))
    res.updated++
  }

  // MC lines whose movement is gone from this half and this country.
  for (const l of existing) {
    if (l.source !== 'MC' || claimed.has(l.id) || l.mcMissing) continue
    if (l.agendaItemId && live.has(l.agendaItemId)) continue
    ops.push(prisma.transReconLine.update({ where: { id: l.id }, data: { mcMissing: true } }))
    res.missing++
  }

  ops.push(prisma.transReconSheet.update({ where: { id: sheetId }, data: { lastSyncedAt: new Date(), updatedByName: actor.name ?? null } }))
  // Chunked: a busy half month is a few hundred lines.
  for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100))
  res.suppliers = await syncParties(sheetId, snapshots, actor)
  return res
}

/**
 * Driver and supplier follow the MC Report like any untyped field: the
 * movement's driver, and the supplier picked for it on the chart. A value set
 * on the sheet stays. Runs after the lines exist, so new lines get theirs on
 * the same refresh. Returns how many lines' supplier was filled or changed.
 * Non-fatal — the lines are already saved when this runs.
 */
async function syncParties(sheetId: string, snapshots: Snapshot[], actor: Actor): Promise<number> {
  try {
    const snapBy = new Map(snapshots.map(s => [s.agendaItemId, s]))
    const lines = (await prisma.transReconLine.findMany({
      where: { sheetId, agendaItemId: { not: null } },
      select: { id: true, sheetId: true, agendaItemId: true, approvalStatus: true, approvedByName: true, approvalNote: true },
    })).filter(l => snapBy.has(l.agendaItemId!))
    if (!lines.length) return 0
    const [parties, picks] = await Promise.all([
      loadParties({ lineId: { in: lines.map(l => l.id) } }),
      loadMcSuppliers(lines.map(l => l.agendaItemId!)),
    ])
    if (!parties) return 0

    const ops: Prisma.PrismaPromise<unknown>[] = []
    let suppliers = 0
    for (const l of lines) {
      const p = parties.get(l.id), mc = picks[l.agendaItemId!]
      const supplier = p?.supplierEdited ? pickOf(p) : mc ? { source: mc.source, id: mc.id, name: mc.name, country: mc.country } : null
      const w = partyWrite(l, p, {
        driverName: p?.driverEdited ? p.driverName : snapBy.get(l.agendaItemId!)!.driverName,
        supplier, driverEdited: p?.driverEdited ?? false, supplierEdited: p?.supplierEdited ?? false,
      }, actor)
      if (!w.op) continue
      ops.push(w.op)
      if (!samePick(pickOf(p), supplier)) suppliers++
      if (w.supplierMoved) {
        const reset = approvalReset(l, actor, `Supplier changed to ${supplier?.name ?? 'none'} on the MC Report`)
        if (Object.keys(reset).length) ops.push(prisma.transReconLine.update({ where: { id: l.id }, data: reset }))
      }
    }
    for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100))
    return suppliers
  } catch (err) {
    if (!isPartiesMissing(err)) console.error('[trans-recon] driver / supplier refresh failed (non-fatal):', err)
    return 0
  }
}

export async function createSheet(country: ReconCountry, year: number, month: number, half: Half, actor: Actor) {
  if (!(year >= 2024 && year <= 2100) || !(month >= 1 && month <= 12)) throw new ReconError('Pick a valid month')
  const p = periodOf(year, month, half)
  const found = await prisma.transReconSheet.findUnique({
    where: { country_periodYear_periodMonth_half: { country, periodYear: year, periodMonth: month, half } },
  })
  if (found) return { id: found.id, created: false, sync: null as SyncResult | null }
  let sheet
  try {
    sheet = await prisma.transReconSheet.create({
      data: {
        country, periodYear: year, periodMonth: month, half,
        periodStart: dateOnly(p.start), periodEnd: dateOnly(p.end),
        title: sheetTitle(country, p), currency: RECON_COUNTRY_META[country].currency,
        createdById: actor.id ?? null, createdByName: actor.name ?? null, updatedByName: actor.name ?? null,
      },
    })
  } catch (err) {
    // Two people pressed Generate at once — the unique key answered for us.
    if ((err as { code?: string }).code === 'P2002') {
      const again = await prisma.transReconSheet.findUnique({
        where: { country_periodYear_periodMonth_half: { country, periodYear: year, periodMonth: month, half } },
      })
      if (again) return { id: again.id, created: false, sync: null }
    }
    throw err
  }
  const sync = await syncSheet(sheet.id, actor)
  return { id: sheet.id, created: true, sync }
}

// ── Header edits and the hand-over to Accounts ──────────────────────────────

export async function updateSheet(id: string, patch: {
  currency?: string; fxRates?: Record<string, unknown>; note?: string | null; action?: 'SUBMIT' | 'RECALL'
}, actor: Actor) {
  const s = await prisma.transReconSheet.findUnique({ where: { id } })
  if (!s) throw new ReconError('Sheet not found', 404)
  if (s.status === 'LOCKED') throw new ReconError('This sheet is locked by Accounts.', 409)

  const data: Prisma.TransReconSheetUpdateInput = { updatedByName: actor.name ?? null }
  if (patch.currency !== undefined) {
    const c = String(patch.currency).trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(c)) throw new ReconError('Currency must be a 3-letter code')
    data.currency = c
  }
  if (patch.fxRates !== undefined) {
    const fx: Record<string, number> = {}
    for (const [k, v] of Object.entries(patch.fxRates ?? {})) {
      const code = k.trim().toUpperCase(), n = Number(v)
      if (/^[A-Z]{3}$/.test(code) && Number.isFinite(n) && n > 0) fx[code] = Math.round(n * 1e6) / 1e6
    }
    data.fxRates = fx
  }
  if (patch.note !== undefined) data.note = clean(patch.note).slice(0, 4000) || null
  if (patch.action === 'SUBMIT') {
    data.status = 'SUBMITTED'; data.submittedAt = new Date(); data.submittedByName = actor.name ?? null
  } else if (patch.action === 'RECALL') {
    data.status = 'DRAFT'
  }
  await prisma.transReconSheet.update({ where: { id }, data })
}

// ── Line edits ──────────────────────────────────────────────────────────────

export interface LineInput {
  id?: string
  /** Set on a row added on the page and not yet saved. */
  tempId?: string
  serviceDate?: string
  tourNo?: string | null
  guestName?: string | null
  pax?: string | null
  pickUp?: string | null
  dropOff?: string | null
  time?: string | null
  details?: string | null
  rateText?: string | null
  remarks?: string | null
  /** '' clears the pairing; an id picks that P&L line by hand. */
  pnlLineItemId?: string | null
  /** A P&L line typed by hand — used when neither OPS nor Accounts holds one. Wins over pnlLineItemId. */
  pnlCustom?: { description: string; value: number | string; currency: string; id?: string } | null
  /** New rows only: the booking this row belongs to, when the tour cell names it by an alias. */
  bookingRef?: string | null
  /** Excel import: the workbook row this line was read from. */
  importRow?: number
  /** The driver, as the desk names them. '' clears; a refresh then leaves it alone. */
  driverName?: string | null
  /** The Accounts supplier this line is paid to; null takes it off. Re-read from Accounts before saving. */
  supplier?: { source: string; id: number } | null
}

const LIMITS: Record<EditableField, number> = {
  serviceDate: 10, tourNo: 191, guestName: 191, pax: 32, pickUp: 2000, dropOff: 2000, time: 32,
  details: 4000, rateText: 191, remarks: 2000,
}

export const CUSTOM_PREFIX = 'custom:'
export const ACCOUNTS_PREFIX = 'acc:'

/** A P&L figure typed on the page because neither system holds one. */
function customPnl(c: { description?: unknown; value?: unknown; currency?: unknown; id?: unknown }): PnlPick {
  // One typed figure given to several movements carries one id, so they split
  // it like any shared P&L line instead of each counting it in full.
  const given = typeof c.id === 'string' && /^custom:[a-z0-9]{6,24}$/.test(c.id) ? c.id : null
  const description = String(c.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const value = Number(String(c.value ?? '').replace(/,/g, ''))
  const currency = String(c.currency ?? '').trim().toUpperCase()
  if (!description) throw new ReconError('Give the P&L line a description')
  if (!Number.isFinite(value) || value < 0 || value > 1e10) throw new ReconError('The P&L value must be a positive number')
  if (!/^[A-Z]{3}$/.test(currency)) throw new ReconError('The P&L currency must be a 3-letter code')
  return {
    id: given ?? `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    activity: description, category: 'CUSTOM', value: Math.round(value * 100) / 100, currency, score: null,
  }
}

async function resolvePnl(bookingRef: string | null, pnlLineItemId: string): Promise<PnlPick> {
  if (pnlLineItemId.startsWith(ACCOUNTS_PREFIX)) {
    if (!bookingRef) throw new ReconError('Name the booking (tour no) before picking from its Accounts P&L.')
    const a = await resolveAccountsLine(bookingRef, pnlLineItemId)
    if (!a) throw new ReconError('That Accounts P&L row changed since the picker opened — open it again.')
    return { id: a.id, activity: a.activity, category: a.category, value: a.value, currency: a.currency, score: null }
  }
  const li = await prisma.pNLLineItem.findUnique({
    where: { id: pnlLineItemId },
    include: { pnl: { select: { paxAdults: true, paxChildren: true, booking: { select: { bookingRef: true, currency: true } } } } },
  })
  if (!li) throw new ReconError('That P&L line no longer exists — reopen the picker.')
  if (bookingRef && li.pnl.booking.bookingRef !== bookingRef) throw new ReconError('That P&L line belongs to another booking.')
  return {
    id: li.id, activity: li.activity, category: li.category, currency: li.pnl.booking.currency || 'USD', score: null,
    value: Math.round(computePNLLineTotal(li, li.pnl.paxAdults, li.pnl.paxChildren) * 100) / 100,
  }
}

/**
 * One Save from the page: edited rows, new rows, rows struck off and rows put
 * back, applied together. A rate or P&L change on a line Accounts already
 * decided sends it back to them as pending, with the reason.
 */
export async function saveLines(
  sheetId: string,
  body: { lines?: LineInput[]; remove?: string[]; restore?: string[] },
  actor: Actor,
  opts: { importedFrom?: string } = {},
) {
  const importedFrom = opts.importedFrom ? opts.importedFrom.slice(0, 191) : null
  const sheet = await prisma.transReconSheet.findUnique({ where: { id: sheetId } })
  if (!sheet) throw new ReconError('Sheet not found', 404)
  if (sheet.status === 'LOCKED') throw new ReconError('This sheet is locked by Accounts — ask them to unlock it first.', 409)
  const start = day(sheet.periodStart)!, end = day(sheet.periodEnd)!

  const existing = new Map((await prisma.transReconLine.findMany({ where: { sheetId } })).map(l => [l.id, l]))
  const ops: Prisma.PrismaPromise<unknown>[] = []
  let position = Array.from(existing.values()).reduce((m, l) => Math.max(m, l.position), 0)
  const created: Record<string, number> = {}

  // Driver / supplier: checked before anything is written, so a save that
  // cannot store them fails whole instead of half.
  const touchesParty = (body.lines ?? []).some(l => 'driverName' in l || 'supplier' in l)
  let parties = new Map<string, PartyRow>()
  const suppliers = new Map<string, SupplierPick>()
  if (touchesParty) {
    const found = await loadParties({ sheetId })
    if (!found) throw new ReconError(PARTIES_NOT_READY, 503)
    parties = found
    for (const l of body.lines ?? []) {
      if (!l.supplier) continue
      const key = `${l.supplier.source}:${l.supplier.id}`
      if (suppliers.has(key)) continue
      if (!isSupplierSource(l.supplier.source)) throw new ReconError('Unknown supplier type')
      let a
      try { a = await getAccountsSupplier(l.supplier.source, Number(l.supplier.id)) }
      catch (err) {
        console.error('[trans-recon] supplier lookup failed:', err)
        throw new ReconError('Could not reach the Accounts supplier list — try again.', 502)
      }
      if (!a) throw new ReconError('That supplier is no longer in Suppliers Manage — pick it again.')
      if (!a.active) throw new ReconError(`"${a.name}" is switched off in Suppliers Manage — pick another or ask Accounts.`)
      suppliers.set(key, { source: a.source, id: a.id, name: a.name, country: a.country })
    }
  }
  const supplierFor = (v: LineInput['supplier']) => (v ? suppliers.get(`${v.source}:${v.id}`)! : null)
  const driverFor = (v: unknown) => cut(String(v ?? ''), 191)

  const val = (f: EditableField, v: unknown) => {
    const s = String(v ?? '').trim()
    if (f === 'details' || f === 'pickUp' || f === 'dropOff' || f === 'remarks') return s.replace(/[ \t]+/g, ' ').slice(0, LIMITS[f]) || null
    return s.replace(/\s+/g, ' ').slice(0, LIMITS[f]) || null
  }
  const checkDate = (iso: string | null) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new ReconError('Every line needs a date')
    if (iso < start || iso > end) throw new ReconError(`${iso} is outside this sheet (${start} → ${end})`)
    return iso
  }

  const refs = new Set<string>()
  for (const l of body.lines ?? []) {
    if (l.id) continue
    if (l.tourNo) refs.add(String(l.tourNo).trim())
    if (l.bookingRef) refs.add(String(l.bookingRef).trim())
  }
  const knownRefs = refs.size
    ? new Set((await prisma.booking.findMany({ where: { bookingRef: { in: Array.from(refs) } }, select: { bookingRef: true } })).map(b => b.bookingRef))
    : new Set<string>()

  for (const input of body.lines ?? []) {
    if (!input.id) {
      const date = checkDate(val('serviceDate', input.serviceDate))
      const tourNo = val('tourNo', input.tourNo)
      const hint = clean(input.bookingRef)
      const bookingRef = hint && knownRefs.has(hint) ? hint : tourNo && knownRefs.has(tourNo) ? tourNo : null
      const rateText = val('rateText', input.rateText)
      const pnl = input.pnlCustom ? customPnl(input.pnlCustom)
        : input.pnlLineItemId ? await resolvePnl(bookingRef, input.pnlLineItemId) : null
      // The id is chosen here so the row's driver / supplier can be written beside it.
      const lineId = randomUUID()
      const party = 'driverName' in input || 'supplier' in input
        ? partyWrite({ id: lineId, sheetId, approvalStatus: 'PENDING', approvedByName: null, approvalNote: null }, undefined, {
            driverName: driverFor(input.driverName), supplier: supplierFor(input.supplier),
            driverEdited: true, supplierEdited: true,
          }, actor).op
        : null
      if (party) ops.push(party)
      ops.push(prisma.transReconLine.create({
        data: {
          id: lineId, sheetId, position: ++position, source: 'MANUAL', bookingRef,
          serviceDate: dateOnly(date), tourNo,
          guestName: val('guestName', input.guestName), pax: val('pax', input.pax),
          pickUp: val('pickUp', input.pickUp), dropOff: val('dropOff', input.dropOff),
          time: val('time', input.time), details: val('details', input.details),
          rateText, rate: parseRate(rateText), remarks: val('remarks', input.remarks),
          ...pnlData(pnl, pnl ? 'MANUAL' : 'NONE'),
          editedFields: [...EDITABLE_FIELDS],
          ...(importedFrom ? { importedFrom, importRow: input.importRow ?? null } : {}),
          updatedByName: actor.name ?? null,
        },
      }))
      if (input.tempId) created[input.tempId] = position
      continue
    }

    const line = existing.get(input.id)
    if (!line) throw new ReconError('A line on this page was removed by someone else — reload the sheet.', 409)
    const edited = new Set(Array.isArray(line.editedFields) ? (line.editedFields as unknown[]).map(String) : [])
    const data: Record<string, unknown> = {}
    for (const f of EDITABLE_FIELDS) {
      if (!(f in input)) continue
      const v = f === 'serviceDate' ? checkDate(val(f, input[f])) : val(f, input[f])
      const cur = f === 'serviceDate' ? day(line.serviceDate) : (line as unknown as Record<string, string | null>)[f]
      if ((v ?? null) === (cur ?? null)) continue
      data[f] = f === 'serviceDate' ? dateOnly(v!) : v
      edited.add(f)
    }
    if ('rateText' in data) data.rate = parseRate(data.rateText as string | null)

    if (input.pnlCustom) {
      // A typed figure replaces whatever the line pointed at — or edits the
      // one typed before, keeping its id so a shared group stays together.
      const c = customPnl(input.pnlCustom)
      if (!input.pnlCustom.id && line.pnlLineItemId?.startsWith(CUSTOM_PREFIX)) c.id = line.pnlLineItemId
      Object.assign(data, pnlData(c, 'MANUAL'))
    } else if (input.pnlLineItemId !== undefined && (input.pnlLineItemId || null) !== (line.pnlLineItemId || null)) {
      const pnl = input.pnlLineItemId ? await resolvePnl(line.bookingRef, input.pnlLineItemId) : null
      Object.assign(data, pnlData(pnl, 'MANUAL'))
      if (!pnl) data.pnlMatch = 'MANUAL' // "no P&L line" is a decision too — keep the matcher off it
    } else if (input.pnlLineItemId !== undefined && line.pnlMatch === 'AUTO' && input.pnlLineItemId) {
      // Confirming the automatic pick by choosing it again makes it a hand pick.
      data.pnlMatch = 'MANUAL'
    }

    if (importedFrom && input.importRow != null) {
      // Provenance is recorded even when the workbook agreed with every cell.
      data.importedFrom = importedFrom
      data.importRow = input.importRow
    }

    let supplierMoved = false
    if ('driverName' in input || 'supplier' in input) {
      const cur = parties.get(line.id)
      const w = partyWrite(line, cur, {
        driverName: 'driverName' in input ? driverFor(input.driverName) : cur?.driverName ?? null,
        supplier: 'supplier' in input ? supplierFor(input.supplier) : pickOf(cur),
        driverEdited: 'driverName' in input || (cur?.driverEdited ?? false),
        supplierEdited: 'supplier' in input || (cur?.supplierEdited ?? false),
      }, actor)
      if (w.op) ops.push(w.op)
      supplierMoved = w.supplierMoved
    }

    const rateChanged = 'rate' in data && (data.rate as number | null) !== dec(line.rate)
    const pnlChanged = 'pnlValue' in data && (data.pnlValue as number | null) !== dec(line.pnlValue)
    if (!Object.keys(data).length && !supplierMoved) continue
    if (rateChanged || pnlChanged || supplierMoved) {
      const next = supplierFor(input.supplier)
      Object.assign(data, approvalReset(line, actor, rateChanged ? `Rate changed to ${data.rateText ?? '—'} by ${actor.name ?? 'OPS'}`
        : pnlChanged ? 'P&L line changed' : `Supplier changed to ${next?.name ?? 'none'} by ${actor.name ?? 'OPS'}`))
    }
    data.editedFields = Array.from(edited)
    data.updatedByName = actor.name ?? null
    ops.push(prisma.transReconLine.update({ where: { id: line.id }, data }))
  }

  for (const id of body.remove ?? []) {
    const line = existing.get(id)
    if (!line) continue
    // A hand-typed row is deleted; an MC row is struck off so a refresh does
    // not bring it back.
    ops.push(line.source === 'MANUAL'
      ? prisma.transReconLine.delete({ where: { id } })
      : prisma.transReconLine.update({ where: { id }, data: { isRemoved: true, updatedByName: actor.name ?? null } }))
  }
  for (const id of body.restore ?? []) {
    if (existing.has(id)) ops.push(prisma.transReconLine.update({ where: { id }, data: { isRemoved: false, updatedByName: actor.name ?? null } }))
  }

  ops.push(prisma.transReconSheet.update({ where: { id: sheetId }, data: { updatedByName: actor.name ?? null } }))
  for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100))

  // A deleted hand-typed row takes its driver / supplier with it.
  const deleted = (body.remove ?? []).filter(id => existing.get(id)?.source === 'MANUAL')
  if (deleted.length) {
    await prisma.transReconLineParty.deleteMany({ where: { lineId: { in: deleted } } }).catch(err => {
      if (!isPartiesMissing(err)) console.error('[trans-recon] party clean-up failed (non-fatal):', err)
    })
  }
  return { saved: ops.length - 1 }
}

/**
 * A chart save recreated this booking's movements under new ids: move each
 * reconciled line across. Same rules as carryMcDetails. Non-fatal.
 */
export async function carryTransRecon(bookingRef: string, pairs: [string, string][]): Promise<void> {
  if (!pairs.length) return
  try {
    const rows = await prisma.transReconLine.findMany({
      where: { bookingRef, agendaItemId: { in: pairs.map(([o]) => o) } },
      select: { id: true, agendaItemId: true },
    })
    if (!rows.length) return
    const next = new Map(pairs)
    await prisma.$transaction(rows.map(r => prisma.transReconLine.update({
      where: { id: r.id }, data: { agendaItemId: next.get(r.agendaItemId!)! },
    })))
  } catch (err) {
    if (!isMissingTable(err)) console.error('[trans-recon] carry-over failed (non-fatal):', err)
  }
}
