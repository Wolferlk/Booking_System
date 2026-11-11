/**
 * VN Vendor Register — server side.
 *
 * The Excel names a vendor ("Alova"); the register gives that name a number.
 * Three things live here:
 *   - the register list: every vendor name in the Excel, and whether it
 *     resolves to a registered vendor with a number;
 *   - register / edit / link-an-Excel-spelling (aliases, kept in
 *     system_settings, so no migration is needed);
 *   - filling the number onto upcoming movements. Only `tourVendorPhone`
 *     (and `tourVendorId` when it is empty) is written, only on today-onwards
 *     Vietnam movements, only when the movement has no number or still holds
 *     this vendor's previous number, and compare-and-set against what was read.
 *     The vendor NAME on a movement is never changed here.
 */
import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/hotel-contact'
import { fold, matchDirectory, vendorNameScore, type DirectoryEntry } from './match'
import {
  VENDOR_ALIAS_SETTING, findPhoneInText, stripPhone,
  type ExcelVendorRow, type ExcelVendorState, type RegisteredVendorRow, type VendorAlias, type VendorRegisterPayload, type VendorSuggestion,
} from './registry-shared'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Same key for "ALOVA ", "Alova" and "alová". */
export const aliasKey = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, '')

function vnToday(): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(`${s}T00:00:00Z`)
}

/** A Vietnamese number in +84 form when it can be read as one; otherwise the trimmed input. */
export function normaliseVnPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = normalizePhone(s, 'VN')
  return n.e164 ?? s
}

function bigramSim(a: string, b: string): number {
  const grams = (s: string) => { const out: string[] = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out }
  const A = grams(a), B = grams(b)
  if (!A.length || !B.length) return a === b ? 1 : 0
  const pool = new Map<string, number>()
  for (const x of A) pool.set(x, (pool.get(x) ?? 0) + 1)
  let hit = 0
  for (const x of B) { const n = pool.get(x) ?? 0; if (n) { hit++; pool.set(x, n - 1) } }
  return (2 * hit) / (A.length + B.length)
}

// ── Aliases ──────────────────────────────────────────────────────────────────

export async function getAliases(): Promise<VendorAlias[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: VENDOR_ALIAS_SETTING } })
  if (!row?.value) return []
  try {
    const list = JSON.parse(row.value)
    return Array.isArray(list) ? list.filter(a => a && typeof a.alias === 'string' && typeof a.vendorId === 'string') : []
  } catch { return [] }
}

async function saveAliases(list: VendorAlias[]): Promise<void> {
  const value = JSON.stringify(list)
  await prisma.systemSetting.upsert({ where: { key: VENDOR_ALIAS_SETTING }, create: { key: VENDOR_ALIAS_SETTING, value }, update: { value } })
}

// ── The directory, with aliases ──────────────────────────────────────────────

export interface VendorDirectory {
  entries: DirectoryEntry[]
  byId: Map<string, DirectoryEntry>
  /** aliasKey(Excel spelling) → tour vendor entry. */
  alias: Map<string, DirectoryEntry>
}

export async function loadVendorDirectory(): Promise<VendorDirectory> {
  const [tour, vehicle, aliases] = await Promise.all([
    prisma.tourVendor.findMany({
      where: { isActive: true, OR: [{ country: 'VIETNAM' }, { country: null }] },
      select: { id: true, name: true, phone: true, whatsappPhone: true },
    }),
    prisma.vehicleVendor.findMany({
      where: { isActive: true, OR: [{ country: 'VIETNAM' }, { country: null }] },
      select: { id: true, name: true, phone: true, whatsappPhone: true },
    }),
    getAliases(),
  ])
  const pick = (v: { whatsappPhone: string | null; phone: string | null }) => v.whatsappPhone?.trim() || v.phone?.trim() || null
  const entries: DirectoryEntry[] = [
    ...tour.map(v => ({ id: v.id, name: v.name, phone: pick(v), source: 'TOUR_VENDOR' as const })),
    ...vehicle.map(v => ({ id: v.id, name: v.name, phone: pick(v), source: 'VEHICLE_VENDOR' as const })),
  ]
  const byId = new Map(entries.filter(e => e.source === 'TOUR_VENDOR').map(e => [e.id, e]))
  const alias = new Map<string, DirectoryEntry>()
  for (const a of aliases) {
    const e = byId.get(a.vendorId)
    if (e) alias.set(aliasKey(a.alias), e)
  }
  return { entries, byId, alias }
}

export type Resolved = { entry: DirectoryEntry; viaAlias: boolean; ambiguous: boolean }

/** Which registered vendor an Excel / movement name means. A linked spelling wins over fuzzy matching. */
export function resolveVendorName(name: string | null | undefined, dir: VendorDirectory): Resolved | null {
  const n = String(name ?? '').trim()
  if (!n) return null
  const viaAlias = dir.alias.get(aliasKey(n)) ?? dir.alias.get(aliasKey(stripPhone(n)))
  if (viaAlias) return { entry: viaAlias, viaAlias: true, ambiguous: false }
  const m = matchDirectory(n, dir.entries) ?? (stripPhone(n) !== n ? matchDirectory(stripPhone(n), dir.entries) : null)
  return m ? { entry: m.entry, viaAlias: false, ambiguous: m.ambiguous } : null
}

/**
 * Numbers for vendor names, for guest messages: the registered vendor's
 * number, or a number typed into the name itself. Unknown / unclear → absent.
 */
export async function resolveVendorPhones(names: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = Array.from(new Set(names.map(n => String(n ?? '').trim()).filter(Boolean)))
  if (!wanted.length) return out
  const dir = await loadVendorDirectory()
  for (const n of wanted) {
    const r = resolveVendorName(n, dir)
    const phone = r && !r.ambiguous ? r.entry.phone : findPhoneInText(n)
    if (phone) out.set(n, phone)
  }
  return out
}

function suggestionsFor(name: string, dir: VendorDirectory, exclude?: string): VendorSuggestion[] {
  const k = fold(stripPhone(name)).replace(/[^a-z0-9]+/g, ' ').trim()
  return dir.entries
    .filter(e => e.id !== exclude)
    .map(e => {
      const strict = vendorNameScore(name, e.name)
      const loose = bigramSim(k.replace(/ /g, ''), fold(e.name).replace(/[^a-z0-9]+/g, ''))
      const tokens = k.split(' ').filter(t => t.length >= 3)
      const shared = tokens.filter(t => fold(e.name).includes(t)).length
      const score = Math.max(strict, loose, tokens.length ? 0.55 + 0.35 * (shared / tokens.length) * (shared ? 1 : 0) : 0)
      return { id: e.id, name: e.name, phone: e.phone, source: e.source, score: shared || strict || loose >= 0.5 ? Math.min(0.99, score) : 0 }
    })
    .filter(s => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || (a.source === 'TOUR_VENDOR' ? -1 : 1))
    .slice(0, 3)
}

// ── Upcoming movements ───────────────────────────────────────────────────────

type MovementRow = { id: string; tourVendorId: string | null; tourVendorName: string | null; tourVendorPhone: string | null }

async function upcomingVendorMovements(): Promise<MovementRow[]> {
  return prisma.assignment.findMany({
    where: {
      AND: [
        { OR: [{ tourVendorId: { not: null } }, { tourVendorName: { not: null } }] },
        { agendaItem: { date: { gte: vnToday() }, agenda: { booking: { operationCountry: 'VIETNAM', status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] } } } } },
      ],
    },
    select: { id: true, tourVendorId: true, tourVendorName: true, tourVendorPhone: true },
  })
}

const hasNumber = (s: string | null | undefined) => Boolean(s && /\d{6,}/.test(s.replace(/[^\d]/g, '')))

/** Which tour vendor (id) a movement belongs to: its id, else its name through the register. */
function movementVendorId(m: MovementRow, dir: VendorDirectory): string | null {
  if (m.tourVendorId && dir.byId.has(m.tourVendorId)) return m.tourVendorId
  const r = resolveVendorName(m.tourVendorName, dir)
  return r && !r.ambiguous && r.entry.source === 'TOUR_VENDOR' ? r.entry.id : null
}

/**
 * Put a vendor's number on its upcoming movements. `previous` = numbers this
 * vendor had before an edit; movements still holding one of those are updated.
 */
export async function fillVendorPhones(vendorIds: string[] | 'ALL', previous: Record<string, string[]> = {}): Promise<{ filled: number; vendors: number }> {
  const dir = await loadVendorDirectory()
  const ids = vendorIds === 'ALL' ? Array.from(dir.byId.keys()) : vendorIds
  const want = new Set(ids.filter(id => dir.byId.get(id)?.phone))
  if (!want.size) return { filled: 0, vendors: 0 }
  const rows = await upcomingVendorMovements()
  let filled = 0
  const touched = new Set<string>()
  for (const m of rows) {
    const vid = movementVendorId(m, dir)
    if (!vid || !want.has(vid)) continue
    const phone = dir.byId.get(vid)!.phone!
    const cur = m.tourVendorPhone?.trim() || null
    if (cur === phone) {
      if (!m.tourVendorId) await prisma.assignment.updateMany({ where: { id: m.id, tourVendorId: null, tourVendorName: m.tourVendorName }, data: { tourVendorId: vid } })
      continue
    }
    const old = (previous[vid] ?? []).map(p => p.trim()).filter(Boolean)
    if (cur && hasNumber(cur) && !old.includes(cur)) continue // a number someone typed: theirs wins
    const res = await prisma.assignment.updateMany({
      where: { id: m.id, tourVendorName: m.tourVendorName, tourVendorPhone: m.tourVendorPhone },
      data: { tourVendorPhone: phone, ...(m.tourVendorId ? {} : { tourVendorId: vid }) },
    })
    if (res.count) { filled++; touched.add(vid) }
  }
  return { filled, vendors: touched.size }
}

// ── The register list ────────────────────────────────────────────────────────

export async function vendorRegister(canEdit: boolean): Promise<VendorRegisterPayload> {
  const today = vnToday()
  const tours = await prisma.vnSheetTour.findMany({
    where: { isActive: true, OR: [{ departureDate: null }, { departureDate: { gte: new Date(today.getTime() - 14 * 86_400_000) } }] },
    select: { tourCode: true, arrivalDate: true },
  })
  const tourDate = new Map(tours.map(t => [t.tourCode, t.arrivalDate]))
  const [lines, dir, aliases, movements, vendorRows] = await Promise.all([
    tours.length
      ? prisma.vnSheetLine.findMany({ where: { tourCode: { in: tours.map(t => t.tourCode) }, vendor: { not: null } }, select: { tourCode: true, vendor: true, details: true } })
      : Promise.resolve([]),
    loadVendorDirectory(),
    getAliases(),
    upcomingVendorMovements(),
    prisma.tourVendor.findMany({
      where: { isActive: true, OR: [{ country: 'VIETNAM' }, { country: null }] },
      select: { id: true, name: true, phone: true, whatsappPhone: true, services: true, updatedAt: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // Group the Excel cells by spelling-insensitive key.
  type Acc = { names: Map<string, number>; lines: number; tours: Set<string>; next: Date | null; sample: string | null }
  const groups = new Map<string, Acc>()
  for (const l of lines) {
    const v = l.vendor?.trim()
    if (!v || !/[a-z]/i.test(fold(v))) continue
    const k = aliasKey(v)
    if (!k) continue
    const g = groups.get(k) ?? { names: new Map(), lines: 0, tours: new Set(), next: null, sample: null }
    g.names.set(v, (g.names.get(v) ?? 0) + 1)
    g.lines++
    g.tours.add(l.tourCode)
    const d = tourDate.get(l.tourCode) ?? null
    if (d && d >= today && (!g.next || d < g.next)) g.next = d
    if (!g.sample && l.details) g.sample = l.details.slice(0, 160)
    groups.set(k, g)
  }

  // Movement tallies: by spelling key, and by resolved vendor.
  const movByKey = new Map<string, number>()
  const movByVendor = new Map<string, { n: number; withPhone: number }>()
  let movTotal = 0, movWithNumber = 0
  for (const m of movements) {
    if (!m.tourVendorName?.trim() && !m.tourVendorId) continue
    movTotal++
    const k = aliasKey(m.tourVendorName)
    if (k) movByKey.set(k, (movByKey.get(k) ?? 0) + 1)
    const vid = movementVendorId(m, dir)
    if (vid) {
      const t = movByVendor.get(vid) ?? { n: 0, withPhone: 0 }
      t.n++
      if (hasNumber(m.tourVendorPhone)) t.withPhone++
      movByVendor.set(vid, t)
    }
    const r = resolveVendorName(m.tourVendorName, dir)
    if (hasNumber(m.tourVendorPhone) || (r && !r.ambiguous && r.entry.phone) || findPhoneInText(m.tourVendorName)) movWithNumber++
  }

  const excel: ExcelVendorRow[] = Array.from(groups.entries()).map(([k, g]) => {
    const spellings = Array.from(g.names.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n)
    const excelName = spellings[0]
    const r = resolveVendorName(excelName, dir)
    let state: ExcelVendorState
    if (!r) state = 'NEW'
    else if (r.ambiguous) state = 'AMBIGUOUS'
    else if (r.entry.source === 'VEHICLE_VENDOR') state = r.entry.phone ? 'TRANSPORT' : 'NEW'
    else state = r.entry.phone ? 'READY' : 'NO_NUMBER'
    return {
      excelName, spellings: spellings.slice(1, 6), cleanName: stripPhone(excelName) || excelName, phoneInCell: findPhoneInText(excelName),
      lines: g.lines, tours: g.tours.size, movements: movByKey.get(k) ?? 0,
      nextDate: g.next ? g.next.toISOString().slice(0, 10) : null, sampleLine: g.sample, state,
      vendor: r && !r.ambiguous ? { id: r.entry.id, name: r.entry.name, phone: r.entry.phone, source: r.entry.source, viaAlias: r.viaAlias } : null,
      suggestions: state === 'READY' || state === 'NO_NUMBER' ? [] : suggestionsFor(excelName, dir),
    }
  })
  const rank: Record<ExcelVendorState, number> = { NEW: 0, AMBIGUOUS: 1, NO_NUMBER: 2, TRANSPORT: 3, READY: 4 }
  excel.sort((a, b) => rank[a.state] - rank[b.state] || b.movements - a.movements || b.lines - a.lines || a.excelName.localeCompare(b.excelName))

  const aliasBy = new Map<string, string[]>()
  for (const a of aliases) aliasBy.set(a.vendorId, [...(aliasBy.get(a.vendorId) ?? []), a.alias])
  const vendors: RegisteredVendorRow[] = vendorRows.map(v => ({
    id: v.id, name: v.name,
    phone: v.phone?.trim() || dir.byId.get(v.id)?.phone || null,
    whatsappPhone: v.whatsappPhone?.trim() || dir.byId.get(v.id)?.phone || null,
    phoneSource: v.whatsappPhone?.trim() || v.phone?.trim() ? 'REGISTERED' : dir.byId.get(v.id)?.phone ? 'MESSAGE_HISTORY' : 'NONE',
    aliases: aliasBy.get(v.id) ?? [], movements: movByVendor.get(v.id)?.n ?? 0, movementsWithPhone: movByVendor.get(v.id)?.withPhone ?? 0,
    services: v.services, updatedAt: v.updatedAt.toISOString(),
  }))

  return {
    excel, vendors, canEdit,
    coverage: {
      excelNames: excel.length,
      excelReady: excel.filter(e => e.state === 'READY' || e.state === 'TRANSPORT').length,
      movements: movTotal, movementsWithNumber: movWithNumber,
    },
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

type Ok = { ok: true; message: string; vendorId?: string; filled?: number } | { ok: false; message: string }

async function addAlias(alias: string, vendorId: string, actor: string): Promise<void> {
  const a = alias.trim()
  if (!a) return
  const list = (await getAliases()).filter(x => aliasKey(x.alias) !== aliasKey(a))
  list.push({ alias: a.slice(0, 191), vendorId, by: actor, at: new Date().toISOString() })
  await saveAliases(list)
}

export async function registerVendor(input: { name: string; phone?: string | null; whatsappPhone?: string | null; excelName?: string | null; services?: string | null }, actor: string): Promise<Ok> {
  const name = stripPhone(input.name ?? '').trim() || (input.name ?? '').trim()
  if (!name) return { ok: false, message: 'Give the vendor a name' }
  if (name.length > 191) return { ok: false, message: 'That name is too long' }
  const phone = normaliseVnPhone(input.phone) ?? normaliseVnPhone(findPhoneInText(input.name))
  const wa = normaliseVnPhone(input.whatsappPhone) ?? phone
  const dir = await loadVendorDirectory()
  const dupe = dir.entries.find(e => e.source === 'TOUR_VENDOR' && aliasKey(e.name) === aliasKey(name))
  if (dupe) {
    if (input.excelName && aliasKey(input.excelName) !== aliasKey(dupe.name)) await addAlias(input.excelName, dupe.id, actor)
    if (phone && !dupe.phone) return updateVendor(dupe.id, { phone, whatsappPhone: wa }, actor)
    return { ok: false, message: `"${dupe.name}" is already registered — edit its number instead` }
  }
  const created = await prisma.tourVendor.create({
    data: {
      name, country: 'VIETNAM', phone: phone ?? '', whatsappPhone: wa, services: input.services?.trim() || null,
      source: 'STAFF', additionalInfo: input.excelName ? `Registered from the VN Excel ("${input.excelName.trim().slice(0, 150)}") by ${actor}` : `Registered in VN Vendor Sync by ${actor}`,
    },
    select: { id: true, name: true },
  })
  if (input.excelName && aliasKey(input.excelName) !== aliasKey(name)) await addAlias(input.excelName, created.id, actor)
  const fill = phone ? await fillVendorPhones([created.id]) : { filled: 0 }
  return { ok: true, vendorId: created.id, filled: fill.filled, message: `${created.name} registered${fill.filled ? ` · number added to ${fill.filled} upcoming movement(s)` : ''}` }
}

export async function updateVendor(id: string, input: { name?: string | null; phone?: string | null; whatsappPhone?: string | null; services?: string | null }, _actor: string): Promise<Ok> {
  const v = await prisma.tourVendor.findUnique({ where: { id }, select: { id: true, name: true, phone: true, whatsappPhone: true } })
  if (!v) return { ok: false, message: 'Vendor not found — refresh' }
  const data: { name?: string; phone?: string; whatsappPhone?: string | null; services?: string | null } = {}
  if (input.name !== undefined && input.name !== null) {
    const n = input.name.trim()
    if (!n) return { ok: false, message: 'The name cannot be empty' }
    if (n.length > 191) return { ok: false, message: 'That name is too long' }
    data.name = n
  }
  if (input.phone !== undefined) data.phone = normaliseVnPhone(input.phone) ?? ''
  if (input.whatsappPhone !== undefined) data.whatsappPhone = normaliseVnPhone(input.whatsappPhone)
  else if (input.phone !== undefined && (!v.whatsappPhone || v.whatsappPhone === v.phone)) data.whatsappPhone = data.phone || null
  if (input.services !== undefined) data.services = input.services?.trim() || null
  await prisma.tourVendor.update({ where: { id }, data })
  // A changed name keeps the old one as an Excel spelling, so nothing un-matches.
  if (data.name && aliasKey(data.name) !== aliasKey(v.name)) await addAlias(v.name, id, _actor)
  const previous = [v.whatsappPhone, v.phone].map(p => p?.trim()).filter((p): p is string => Boolean(p))
  const fill = await fillVendorPhones([id], { [id]: previous })
  return { ok: true, vendorId: id, filled: fill.filled, message: `Saved${fill.filled ? ` · ${fill.filled} upcoming movement(s) now carry the number` : ''}` }
}

export async function linkExcelName(excelName: string, vendorId: string, actor: string): Promise<Ok> {
  const v = await prisma.tourVendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } })
  if (!v) return { ok: false, message: 'Only a registered tour vendor can be linked — register it first' }
  await addAlias(excelName, vendorId, actor)
  const fill = await fillVendorPhones([vendorId])
  return { ok: true, vendorId, filled: fill.filled, message: `"${excelName}" now means ${v.name}${fill.filled ? ` · number added to ${fill.filled} movement(s)` : ''}` }
}

export async function unlinkExcelName(excelName: string): Promise<Ok> {
  const list = await getAliases()
  const next = list.filter(a => aliasKey(a.alias) !== aliasKey(excelName))
  if (next.length === list.length) return { ok: false, message: 'That spelling was not linked' }
  await saveAliases(next)
  return { ok: true, message: `"${excelName}" unlinked` }
}

/** Paste "Name<TAB>number" lines: registers new names, adds numbers to known ones. */
export async function registerMany(rows: { name: string; phone: string | null }[], actor: string): Promise<{ created: number; updated: number; skipped: string[]; filled: number }> {
  let created = 0, updated = 0, filled = 0
  const skipped: string[] = []
  for (const r of rows.slice(0, 300)) {
    const dir = await loadVendorDirectory()
    const hit = resolveVendorName(r.name, dir)
    if (hit && !hit.ambiguous && hit.entry.source === 'TOUR_VENDOR') {
      if (!r.phone) { skipped.push(`${r.name} (no number)`); continue }
      const res = await updateVendor(hit.entry.id, { phone: r.phone }, actor)
      if (res.ok) { updated++; filled += res.filled ?? 0 } else skipped.push(`${r.name} (${res.message})`)
      continue
    }
    const res = await registerVendor({ name: r.name, phone: r.phone }, actor)
    if (res.ok) { created++; filled += res.filled ?? 0 } else skipped.push(`${r.name} (${res.message})`)
  }
  return { created, updated, skipped, filled }
}
