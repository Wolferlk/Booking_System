/**
 * The single list of movement service types offered on the agenda (MC) screen.
 *
 * `ServiceType` in the Prisma schema is the storage side of this; everything a
 * user reads — the agenda dropdown, the ground board chips, the Word/PDF
 * exports, the MC report — labels those values from here so a new type only has
 * to be added in one place.
 *
 * Two of the values predate the current list and are reused rather than
 * duplicated: `INTERNAL_TOUR` is "Ticket Only" and `ACCOMMODATION` is
 * "Hotel Only". Renaming them would have meant migrating live rows for no gain.
 */

export const SERVICE_TYPE_VALUES = [
  'SIC_TOUR',
  'PVT_TOUR',
  'PVT_TRANSFER',
  'PVT_TRANSFER_TICKET',
  'PVT_TRANSFER_SPA',
  'INTERNAL_TOUR',
  'ACCOMMODATION',
  'MEAL_COUPON',
  'PVT_TRANSFER_SIC_TOUR',
  'OWN_ARRANGEMENT',
  'SIC_TRANSFER',
  'PVT_TRANSFER_MEAL',
  'FLIGHT',
] as const

export type ServiceTypeValue = (typeof SERVICE_TYPE_VALUES)[number]

/** Full labels — the agenda dropdown, exports and guest-facing documents. */
export const SERVICE_TYPE_LABELS: Record<string, string> = {
  SIC_TOUR:              'SIC Tour',
  PVT_TOUR:              'Private Tour',
  PVT_TRANSFER:          'Private Transfer',
  PVT_TRANSFER_TICKET:   'Private Transfer + Ticket',
  PVT_TRANSFER_SPA:      'Private Transfer + Spa',
  INTERNAL_TOUR:         'Ticket Only',
  ACCOMMODATION:         'Hotel Only',
  MEAL_COUPON:           'Meal Coupon',
  PVT_TRANSFER_SIC_TOUR: 'Private Transfer + SIC Tour',
  OWN_ARRANGEMENT:       'Own Arrangement or Booked with another vendor',
  SIC_TRANSFER:          'SIC Transfer',
  PVT_TRANSFER_MEAL:     'Private Transfer + Meal',
  FLIGHT:                'Flight',
}

/**
 * Short labels for dense views — report tables, board chips, PDF columns.
 *
 * "PVT" was expanded to "Private Transfer" everywhere by request: the movement
 * chart is read by guests and drivers, not only by the desk that wrote it, and
 * the abbreviation meant nothing to either. The stored `ServiceType` values are
 * untouched — this is a label change only.
 */
export const SERVICE_TYPE_SHORT_LABELS: Record<string, string> = {
  SIC_TOUR:              'SIC Tour',
  PVT_TOUR:              'Private Tour',
  PVT_TRANSFER:          'Private Transfer',
  PVT_TRANSFER_TICKET:   'Private Transfer + Ticket',
  PVT_TRANSFER_SPA:      'Private Transfer + Spa',
  INTERNAL_TOUR:         'Ticket',
  ACCOMMODATION:         'Hotel',
  MEAL_COUPON:           'Meal',
  PVT_TRANSFER_SIC_TOUR: 'Private Transfer + SIC Tour',
  OWN_ARRANGEMENT:       'Own Arr.',
  SIC_TRANSFER:          'SIC Transfer',
  PVT_TRANSFER_MEAL:     'Private Transfer + Meal',
  FLIGHT:                'Flight',
}

export function serviceTypeLabel(value: string | null | undefined): string {
  if (!value) return ''
  return SERVICE_TYPE_LABELS[value] ?? value.replace(/_/g, ' ')
}

export function serviceTypeShortLabel(value: string | null | undefined): string {
  if (!value) return ''
  return SERVICE_TYPE_SHORT_LABELS[value] ?? serviceTypeLabel(value)
}

/**
 * Types that carry a private vehicle we book — everything prefixed PVT plus the
 * legacy `PVT_TRANSFER`. Used where the UI treats private movements as a group.
 */
export function isPrivateTransferType(value: string | null | undefined): boolean {
  return String(value ?? '').startsWith('PVT_')
}

/** Types that run on a seat-in-coach basis. */
export function isSicType(value: string | null | undefined): boolean {
  const v = String(value ?? '')
  return v === 'SIC_TRANSFER' || v === 'SIC_TOUR' || v === 'PVT_TRANSFER_SIC_TOUR'
}

/**
 * Custom service types — anything typed into the agenda's Service Type box that
 * is not one of the built-in values is stored as the typed text itself (the
 * column is VARCHAR since prisma/sql/2026-09-25-agenda-custom-service-types.sql).
 * Every label lookup above already falls back to the raw value, so a custom
 * type reads as typed everywhere it is shown.
 */
export const CUSTOM_SERVICE_TYPE_MAX = 64

export function isBuiltInServiceType(value: string | null | undefined): boolean {
  return (SERVICE_TYPE_VALUES as readonly string[]).includes(String(value ?? ''))
}

/**
 * Map what an operator typed (or an API sent) to the value we store: a built-in
 * code when the text is one of the codes or its label (any case), otherwise the
 * tidied text itself. Empty → null, so callers pick their own default.
 */
export function normaliseServiceType(raw: unknown): string | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (isBuiltInServiceType(text)) return text
  const lower = text.toLowerCase()
  for (const code of SERVICE_TYPE_VALUES) {
    if (code.toLowerCase() === lower || SERVICE_TYPE_LABELS[code]?.toLowerCase() === lower) return code
  }
  return text.slice(0, CUSTOM_SERVICE_TYPE_MAX)
}
