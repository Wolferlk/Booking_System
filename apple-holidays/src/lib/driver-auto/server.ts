/**
 * Driver-Auto — settings, signed links and small server helpers.
 *
 * Settings live in ONE `system_settings` row (`driver_auto_settings`, JSON), so
 * the component needs no column on any existing table. Every read merges onto
 * DEFAULT_SETTINGS, so a missing or partial row still yields the safe defaults:
 * approval required, nothing sent automatically.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  DA_COUNTRIES, DA_COUNTRY_META, DEFAULT_COUNTRY_SETTINGS, DEFAULT_SETTINGS,
  type DaCountry, type DaSettings, type PartyType, partyKey,
} from './shared'

export const SETTINGS_KEY = 'driver_auto_settings'

// ── Settings ─────────────────────────────────────────────────────────────────

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Normalises any stored / submitted shape into a complete, valid DaSettings. */
export function normaliseSettings(raw: unknown): DaSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DaSettings>
  const countries = {} as DaSettings['countries']
  for (const c of DA_COUNTRIES) {
    const given = (r.countries as Record<string, Partial<DaSettings['countries'][DaCountry]>> | undefined)?.[c] ?? {}
    countries[c] = {
      requireApproval: typeof given.requireApproval === 'boolean' ? given.requireApproval : DEFAULT_COUNTRY_SETTINGS.requireApproval,
      autoSend:        typeof given.autoSend        === 'boolean' ? given.autoSend        : DEFAULT_COUNTRY_SETTINGS.autoSend,
      includeVendors:  typeof given.includeVendors  === 'boolean' ? given.includeVendors  : DEFAULT_COUNTRY_SETTINGS.includeVendors,
      emailEnabled:    typeof given.emailEnabled    === 'boolean' ? given.emailEnabled    : DEFAULT_COUNTRY_SETTINGS.emailEnabled,
    }
  }
  const epochs: Record<string, number> = {}
  if (r.linkEpochs && typeof r.linkEpochs === 'object') {
    for (const [k, v] of Object.entries(r.linkEpochs)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) epochs[k] = Math.round(n)
    }
  }
  return {
    horizonDays:        clampInt(r.horizonDays, 1, 60, DEFAULT_SETTINGS.horizonDays),
    sendHour:           clampInt(r.sendHour, 0, 23, DEFAULT_SETTINGS.sendHour),
    maxPendingPerParty: clampInt(r.maxPendingPerParty, 1, 100, DEFAULT_SETTINGS.maxPendingPerParty),
    countries,
    excluded: Array.isArray(r.excluded) ? Array.from(new Set(r.excluded.filter(x => typeof x === 'string'))) : [],
    linkEpochs: epochs,
  }
}

export async function readSettings(): Promise<DaSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } })
  if (!row) return normaliseSettings(null)
  try {
    return normaliseSettings(JSON.parse(row.value))
  } catch {
    return normaliseSettings(null)
  }
}

export async function writeSettings(next: DaSettings): Promise<DaSettings> {
  const clean = normaliseSettings(next)
  const value = JSON.stringify(clean)
  await prisma.systemSetting.upsert({
    where:  { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  })
  return clean
}

// ── Signed links ─────────────────────────────────────────────────────────────

const SECRET =
  process.env.DRIVER_BOARD_LINK_SECRET ||
  process.env.PORTAL_LINK_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'apple-holidays-driver-board'

/**
 * HMAC of the party key and its epoch. Bumping the epoch (Settings → "Reset
 * link") invalidates every link sent so far without any table of tokens.
 */
export function boardToken(key: string, epoch = 0): string {
  return crypto.createHmac('sha256', SECRET).update(`driver-board:${key}:${epoch}`).digest('hex').slice(0, 32)
}

export function verifyBoardToken(key: string, token: string, epoch = 0): boolean {
  if (!token || token.length !== 32) return false
  const expected = boardToken(key, epoch)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

export function appBaseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://ops.aahaas.com').replace(/\/$/, '')
}

export function boardPath(key: string, settings: DaSettings): string {
  return `/driver-board/${encodeURIComponent(key)}?t=${boardToken(key, settings.linkEpochs[key] ?? 0)}`
}

export function boardUrl(key: string, settings: DaSettings): string {
  return `${appBaseUrl()}${boardPath(key, settings)}`
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** Today's calendar date in a country's timezone, as YYYY-MM-DD. */
export function localToday(country: DaCountry, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DA_COUNTRY_META[country].tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function localHour(country: DaCountry, now = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: DA_COUNTRY_META[country].tz, hour: '2-digit', hour12: false,
  }).format(now)
  return Number(h) % 24
}

/** Calendar arithmetic on YYYY-MM-DD strings (UTC, so no DST drift). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function ymdOf(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

export function dayDiff(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000)
}

// ── Missing-table detection ──────────────────────────────────────────────────

/**
 * True when the error is "table doesn't exist" for the Driver-Auto tables —
 * i.e. prisma/sql/apply-driver-auto.sh has not been run on this database yet.
 */
export function isDaTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (e?.code === 'P2021') return true
  return /driver_(trip_claims|board_sends).*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

export const SETUP_MESSAGE =
  'Driver-Auto is not set up on this database yet — run `bash prisma/sql/apply-driver-auto.sh` (additive: creates two new tables).'

// ── Parties ──────────────────────────────────────────────────────────────────

/** Which booking-level countries a partner registered under may serve. */
export function partnerServes(partnerCountry: string | null | undefined, tab: DaCountry): boolean {
  if (!partnerCountry) return false
  if (partnerCountry === 'ALL') return true
  if (partnerCountry === tab) return true
  if (partnerCountry === 'SINGAPORE_MALAYSIA') return tab === 'SINGAPORE' || tab === 'MALAYSIA'
  return false
}

/** The tabs a partner registered under a country shows up in. */
export function tabsForPartner(partnerCountry: string | null | undefined): DaCountry[] {
  return DA_COUNTRIES.filter(c => partnerServes(partnerCountry, c))
}

export interface ResolvedParty {
  key: string
  type: PartyType
  id: string
  name: string
  phone: string | null
  email: string | null
  country: string | null
  isActive: boolean
  vehicleType: string | null
  vehiclePlate: string | null
  capacity: number | null
}

export async function resolveParty(type: PartyType, id: string): Promise<ResolvedParty | null> {
  if (type === 'DRIVER') {
    const d = await prisma.driver.findUnique({
      where: { id },
      select: {
        id: true, name: true, phone: true, email: true, country: true, isActive: true,
        vehicle: { select: { type: true, plateNo: true, capacity: true } },
      },
    })
    if (!d) return null
    return {
      key: partyKey('DRIVER', d.id), type, id: d.id, name: d.name,
      phone: d.phone || null, email: d.email || null, country: d.country ?? null,
      isActive: d.isActive,
      vehicleType: d.vehicle?.type ?? null, vehiclePlate: d.vehicle?.plateNo ?? null,
      capacity: d.vehicle?.capacity ?? null,
    }
  }
  const v = await prisma.vehicleVendor.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, whatsappPhone: true, email: true, country: true, isActive: true },
  })
  if (!v) return null
  return {
    key: partyKey('VENDOR', v.id), type, id: v.id, name: v.name,
    phone: v.whatsappPhone || v.phone || null, email: v.email || null, country: v.country ?? null,
    isActive: v.isActive, vehicleType: null, vehiclePlate: null, capacity: null,
  }
}
