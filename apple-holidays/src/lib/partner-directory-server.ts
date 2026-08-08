/**
 * Guides & Tour Vendors — server-side helpers.
 *
 * Both kinds live in separate tables with an identical column set apart from
 * one free-text field (`languages` vs `services`). Rather than duplicating every
 * route, the delegate is picked here and the differing field is normalised to
 * `speciality` on the way out and back in, so `/api/ground/guides` and
 * `/api/ground/tour-vendors` share one implementation.
 */

import { prisma } from '@/lib/prisma'
import { countryScope } from '@/lib/country-detection'
import {
  PARTNER_CONFIG, parseCountryList,
  type PartnerKind, type PartnerRecord,
} from '@/lib/partner-directory'
import type { OperationCountry, Prisma } from '@prisma/client'

/** Roles allowed to create, edit and delete directory entries. */
export const PARTNER_WRITE_ROLES = [
  'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
] as const

export function canWritePartners(role: string): boolean {
  return (PARTNER_WRITE_ROLES as readonly string[]).includes(role)
}

/** The Prisma delegate backing a partner kind. */
export function partnerDelegate(kind: PartnerKind) {
  return kind === 'guide' ? prisma.guide : prisma.tourVendor
}

/**
 * Columns selected for every partner read. Written out rather than using
 * `include` so the `languages` / `services` split stays contained here.
 */
function selectFor(kind: PartnerKind) {
  return {
    id: true, name: true, country: true, phone: true, whatsappPhone: true,
    email: true, photoUrl: true, nicNo: true, additionalInfo: true,
    specialNote: true, bankName: true, bankAccountNo: true, bankHolder: true,
    bankBranch: true, bankCode: true, isActive: true, source: true,
    createdAt: true,
    [PARTNER_CONFIG[kind].specialityField]: true,
    _count: { select: { assignments: true } },
  } as const
}

type RawPartner = Record<string, unknown> & { _count?: { assignments: number } }

/** DB row → the flat shape every client component consumes. */
export function toPartnerRecord(kind: PartnerKind, row: RawPartner): PartnerRecord {
  const specialityField = PARTNER_CONFIG[kind].specialityField
  return {
    id: String(row.id),
    name: String(row.name),
    country: (row.country as string | null) ?? null,
    phone: String(row.phone ?? ''),
    whatsappPhone: (row.whatsappPhone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    photoUrl: (row.photoUrl as string | null) ?? null,
    nicNo: (row.nicNo as string | null) ?? null,
    speciality: (row[specialityField] as string | null) ?? null,
    additionalInfo: (row.additionalInfo as string | null) ?? null,
    specialNote: (row.specialNote as string | null) ?? null,
    bankName: (row.bankName as string | null) ?? null,
    bankAccountNo: (row.bankAccountNo as string | null) ?? null,
    bankHolder: (row.bankHolder as string | null) ?? null,
    bankBranch: (row.bankBranch as string | null) ?? null,
    bankCode: (row.bankCode as string | null) ?? null,
    isActive: Boolean(row.isActive),
    source: (row.source as PartnerRecord['source']) ?? 'STAFF',
    createdAt: (row.createdAt as Date)?.toISOString?.() ?? String(row.createdAt),
    assignmentCount: row._count?.assignments ?? 0,
  }
}

/**
 * Request body → Prisma data. Blank strings are stored as NULL, never as "",
 * because an empty string reads as a real value everywhere it is displayed.
 */
export function toPartnerData(
  kind: PartnerKind,
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): Prisma.GuideUncheckedCreateInput | Prisma.TourVendorUncheckedCreateInput {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const nullable = (v: unknown) => str(v) || null

  const fields: Record<string, unknown> = {
    name: str(body.name),
    phone: str(body.phone),
    country: (body.country as OperationCountry) || null,
    whatsappPhone: nullable(body.whatsappPhone),
    email: str(body.email).toLowerCase() || null,
    photoUrl: nullable(body.photoUrl),
    nicNo: nullable(body.nicNo),
    [PARTNER_CONFIG[kind].specialityField]: nullable(body.speciality),
    additionalInfo: nullable(body.additionalInfo),
    specialNote: nullable(body.specialNote),
    bankName: nullable(body.bankName),
    bankAccountNo: nullable(body.bankAccountNo),
    bankHolder: nullable(body.bankHolder),
    bankBranch: nullable(body.bankBranch),
    bankCode: nullable(body.bankCode),
  }
  if (body.isActive !== undefined) fields.isActive = Boolean(body.isActive)

  // On PUT, a key the client never sent must not be blanked — only keys present
  // in the body are written, so a partial edit cannot wipe bank details.
  if (opts.partial) {
    for (const key of Object.keys(fields)) {
      const bodyKey = key === PARTNER_CONFIG[kind].specialityField ? 'speciality' : key
      if (!(bodyKey in body)) delete fields[key]
    }
  }

  return fields as Prisma.GuideUncheckedCreateInput
}

/**
 * Country filter for a listing. Matches the target country plus entries with no
 * country set, which are treated as available everywhere — the same rule the
 * driver and vehicle-vendor listings use.
 */
export function partnerCountryWhere(country: OperationCountry | null) {
  if (!country) return {}
  return {
    OR: [
      { country: { in: countryScope(country) as OperationCountry[] } },
      { country: null },
      { country: 'ALL' as OperationCountry },
    ],
  }
}

/** List partners for a country, newest-registered first within an A→Z ordering. */
export async function listPartners(
  kind: PartnerKind,
  opts: { country?: OperationCountry | null; activeOnly?: boolean } = {},
): Promise<PartnerRecord[]> {
  const rows = await (partnerDelegate(kind) as {
    findMany: (args: unknown) => Promise<RawPartner[]>
  }).findMany({
    where: {
      ...partnerCountryWhere(opts.country ?? null),
      ...(opts.activeOnly ? { isActive: true } : {}),
    },
    select: selectFor(kind),
    orderBy: { name: 'asc' },
  })
  return rows.map(r => toPartnerRecord(kind, r))
}

export async function findPartner(kind: PartnerKind, id: string): Promise<PartnerRecord | null> {
  const row = await (partnerDelegate(kind) as {
    findUnique: (args: unknown) => Promise<RawPartner | null>
  }).findUnique({ where: { id }, select: selectFor(kind) })
  return row ? toPartnerRecord(kind, row) : null
}

/** The countries Settings has switched this partner kind on for. */
export async function getEnabledCountries(kind: PartnerKind): Promise<string[]> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: PARTNER_CONFIG[kind].settingKey },
  })
  return parseCountryList(row?.value)
}

export async function getAllEnabledCountries(): Promise<Record<PartnerKind, string[]>> {
  const [guide, tourVendor] = await Promise.all([
    getEnabledCountries('guide'),
    getEnabledCountries('tourVendor'),
  ])
  return { guide, tourVendor }
}

/**
 * Find an existing partner by phone (or, failing that, an exact name match)
 * within a country, so a name typed straight into a movement chart reuses the
 * record it already has instead of piling up duplicates.
 */
export async function findPartnerByContact(
  kind: PartnerKind,
  { name, phone, country }: { name: string; phone?: string | null; country?: OperationCountry | null },
): Promise<{ id: string } | null> {
  const delegate = partnerDelegate(kind) as { findFirst: (args: unknown) => Promise<{ id: string } | null> }
  const digits = (phone ?? '').replace(/\D/g, '')

  if (digits.length >= 7) {
    const byPhone = await delegate.findFirst({
      where: { OR: [{ phone: { contains: digits } }, { whatsappPhone: { contains: digits } }] },
      select: { id: true },
    })
    if (byPhone) return byPhone
  }

  if (!name.trim()) return null
  return delegate.findFirst({
    where: { name: name.trim(), ...(country ? { country } : {}) },
    select: { id: true },
  })
}

/**
 * Upsert a partner typed by hand into a movement chart.
 *
 * "Once typed, details save in the system" — the ad-hoc entry becomes a real
 * directory row (marked `MANUAL_ENTRY`) so it is pickable next time, while an
 * existing match is reused and left untouched rather than overwritten by
 * whatever partial details the movement happened to carry.
 */
export async function upsertManualPartner(
  kind: PartnerKind,
  { name, phone, country }: { name: string; phone?: string | null; country?: OperationCountry | null },
): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const existing = await findPartnerByContact(kind, { name: trimmed, phone, country })
  if (existing) return existing.id

  const created = await (partnerDelegate(kind) as {
    create: (args: unknown) => Promise<{ id: string }>
  }).create({
    data: {
      name: trimmed,
      phone: (phone ?? '').trim() || '—',
      country: country ?? null,
      source: 'MANUAL_ENTRY',
      isActive: true,
    },
    select: { id: true },
  })
  return created.id
}
