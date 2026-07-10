/**
 * Server-side assembly of a booking's Driver Log (Sri Lanka advance sheet).
 *
 * Combines three sources into one effective view:
 *   1. Global percentage settings (SystemSetting) — the tour/fuel advance %.
 *   2. The linked Accounts-PNL line items (ExternalPnlLink.cachedItems) — the
 *      raw money the advances are derived from.
 *   3. A saved, hand-edited snapshot (SystemSetting `driver_log_{ref}`) — once a
 *      user edits & saves the sheet, that snapshot wins over the raw PNL compute.
 *
 * The driver's WhatsApp number is auto-fetched from the Sri Lanka driver
 * allocation, but a saved snapshot may override it.
 *
 * Persistence deliberately uses SystemSetting rows (the same additive,
 * migration-free key/value pattern the codebase already uses for dedupe and
 * settings) so this feature needs no schema change.
 */
import { prisma } from '@/lib/prisma'
import {
  computeDriverLog,
  linesFromPnlItems,
  pickCurrency,
  settingKeyForBooking,
  clampPct,
  SETTING_TOUR_PCT,
  SETTING_FUEL_PCT,
  SETTING_AUTO_SEND,
  DEFAULT_TOUR_PCT,
  DEFAULT_FUEL_PCT,
  type DriverLogComputation,
  type DriverLogLine,
  type DriverLogSnapshot,
  type PnlItemLike,
} from '@/lib/driver-log'

export interface DriverLogView {
  bookingRef: string
  operationCountry: string | null
  leadPassenger: string | null
  arrivalDate: Date | null
  departureDate: Date | null
  paxAdults: number | null
  paxChildren: number | null

  pnlLinked: boolean
  isSaved: boolean

  driverName: string | null
  driverPhone: string | null   // effective (saved override, else allocation)
  allocationPhone: string | null

  autoSend: boolean
  autoSendGlobal: boolean       // master switch in Settings
  waSentAt: string | null
  notes: string

  defaults: { tourPct: number; fuelPct: number }

  /** Effective computation (saved snapshot if present, else fresh from PNL). */
  computation: DriverLogComputation
  /** Always-fresh compute from the current PNL — used for "recompute". */
  freshLines: DriverLogLine[]
}

async function readGlobalSettings() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_TOUR_PCT, SETTING_FUEL_PCT, SETTING_AUTO_SEND] } },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const parsePct = (v: string | undefined, dflt: number) => {
    const n = v == null ? NaN : parseFloat(v)
    return Number.isFinite(n) ? clampPct(n) : dflt
  }
  return {
    tourPct:  parsePct(map.get(SETTING_TOUR_PCT), DEFAULT_TOUR_PCT),
    fuelPct:  parsePct(map.get(SETTING_FUEL_PCT), DEFAULT_FUEL_PCT),
    autoSend: map.get(SETTING_AUTO_SEND) === 'true',
  }
}

export async function readSnapshot(bookingRef: string): Promise<DriverLogSnapshot | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: settingKeyForBooking(bookingRef) },
  })
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as DriverLogSnapshot
  } catch {
    return null
  }
}

export async function saveSnapshot(bookingRef: string, snap: DriverLogSnapshot): Promise<void> {
  const key = settingKeyForBooking(bookingRef)
  const value = JSON.stringify(snap)
  await prisma.systemSetting.upsert({
    where:  { key },
    update: { value },
    create: { key, value },
  })
}

/**
 * Build the full effective Driver Log view for a booking. Returns null when the
 * booking does not exist. Works whether or not a PNL is linked (empty compute).
 */
export async function buildDriverLogView(bookingRef: string): Promise<DriverLogView | null> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      bookingRef:       true,
      operationCountry: true,
      arrivalDate:      true,
      departureDate:    true,
      paxAdults:        true,
      paxChildren:      true,
      passengers: {
        where: { isLead: true },
        take: 1,
        select: { name: true, contact: true },
      },
      externalPnlLink: { select: { cachedItems: true } },
      slDriverAllocation: {
        select: { driver: { select: { name: true, phone: true } } },
      },
    },
  })
  if (!booking) return null

  const globals  = await readGlobalSettings()
  const snapshot = await readSnapshot(bookingRef)

  const pnlItems = (booking.externalPnlLink?.cachedItems as unknown as PnlItemLike[] | null) ?? []
  const pnlLinked = !!booking.externalPnlLink
  const freshLines = linesFromPnlItems(pnlItems)
  const pnlCurrency = pickCurrency(pnlItems)

  // Effective percentages / lines / currency: saved snapshot wins, else defaults.
  const tourPct  = snapshot ? clampPct(snapshot.tourPct) : globals.tourPct
  const fuelPct  = snapshot ? clampPct(snapshot.fuelPct) : globals.fuelPct
  const currency = snapshot?.currency || pnlCurrency
  const lines    = snapshot ? snapshot.lines : freshLines

  const computation = computeDriverLog(lines, { currency, tourPct, fuelPct })

  const allocationPhone = booking.slDriverAllocation?.driver?.phone ?? null
  const driverName      = booking.slDriverAllocation?.driver?.name ?? null

  return {
    bookingRef:       booking.bookingRef,
    operationCountry: booking.operationCountry ?? null,
    leadPassenger:    booking.passengers[0]?.name ?? null,
    arrivalDate:      booking.arrivalDate ?? null,
    departureDate:    booking.departureDate ?? null,
    paxAdults:        booking.paxAdults ?? null,
    paxChildren:      booking.paxChildren ?? null,

    pnlLinked,
    isSaved: !!snapshot,

    driverName,
    driverPhone:     snapshot?.driverPhone ?? allocationPhone,
    allocationPhone,

    autoSend:        snapshot?.autoSend ?? false,
    autoSendGlobal:  globals.autoSend,
    waSentAt:        snapshot?.waSentAt ?? null,
    notes:           snapshot?.notes ?? '',

    defaults: { tourPct: globals.tourPct, fuelPct: globals.fuelPct },

    computation,
    freshLines,
  }
}
