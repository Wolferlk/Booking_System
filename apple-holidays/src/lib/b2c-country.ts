/**
 * Resolving an Aahaas B2C order's operating country.
 *
 * The store records destination in three different shapes depending on what was
 * sold, so resolution is a chain of decreasing confidence:
 *
 *   1. `tbl_lifestyle.country` — an ISO alpha-2 code. Covers ~100% of Lifestyle
 *      products and ~81% of Hotels.
 *   2. Arrival airport — the only signal a flight-only order carries, since
 *      flights are stored with `product_id = 0` and a blank product name.
 *   3. Free text (product name / city / vendor / location) — catches
 *      Ratehawk-style hotel rows such as "Amari Colombo Sri Lanka", which have
 *      no product record but name the destination.
 *
 * When nothing resolves, callers must treat the order as un-importable rather
 * than guessing: `operationCountry` drives who can see a booking, so a wrong
 * value hides it from the team that should be operating it.
 */
import { detectCountryFromText } from './country-detection'
import type { OperationCountry } from './country-detection'

/**
 * ISO alpha-2 → ops country, for the markets ops actually operates.
 *
 * The store uses alpha-2 throughout ('LK', 'VN', …) but a handful of legacy rows
 * carry names or the odd alpha-3 ('EGY'), so {@link normalizeCountryToken}
 * folds those in too.
 *
 * Aahaas sells travel in ~70 countries; only these four map to an ops team. An
 * order for anywhere else resolves to null and is imported unscoped, with its
 * destination preserved in `tourDestination` — see `resolveOrderCountry`.
 *
 * UPGRADE PATH: to bring another market into ops, add its `OperationCountry` enum
 * value (Prisma schema + the matching live ENUM columns — see
 * `scripts/b2c-migration-plan.ts`) and add one line here. The airport table below
 * already covers Thailand, Maldives, UAE, Indonesia and Mauritius, so those light
 * up as soon as the enum value exists.
 */
const ISO_TO_OPERATION: Record<string, OperationCountry> = {
  LK: 'SRILANKA',
  VN: 'VIETNAM',
  SG: 'SINGAPORE',
  MY: 'MALAYSIA',
}

/** Names / alternate codes seen in the live data, folded onto an alpha-2 code. */
const NAME_TO_ISO: Record<string, string> = {
  SRILANKA: 'LK', CEYLON: 'LK', LKA: 'LK',
  VIETNAM: 'VN', VIETNAMSOCIALISTREPUBLIC: 'VN', VNM: 'VN',
  SINGAPORE: 'SG', SGP: 'SG',
  MALAYSIA: 'MY', MYS: 'MY',
  THAILAND: 'TH', THA: 'TH',
  MALDIVES: 'MV', MDV: 'MV',
  UAE: 'AE', UNITEDARABEMIRATES: 'AE', ARE: 'AE', DUBAI: 'AE',
  INDONESIA: 'ID', IDN: 'ID', BALI: 'ID',
  MAURITIUS: 'MU', MUS: 'MU',
}

/**
 * Arrival-airport IATA → ISO alpha-2, limited to the markets ops supports.
 * A code that isn't here resolves to null, which is the correct outcome: an
 * order flying to an unsupported country should be skipped, not mis-filed.
 */
const AIRPORT_TO_ISO: Record<string, string> = {
  // Sri Lanka
  CMB: 'LK', HRI: 'LK', JAF: 'LK', RML: 'LK', TRR: 'LK',
  // Vietnam
  SGN: 'VN', HAN: 'VN', DAD: 'VN', HPH: 'VN', CXR: 'VN', PQC: 'VN',
  HUI: 'VN', VCA: 'VN', VDO: 'VN', DLI: 'VN', UIH: 'VN', THD: 'VN',
  // Singapore
  SIN: 'SG', XSP: 'SG',
  // Malaysia
  KUL: 'MY', PEN: 'MY', LGK: 'MY', BKI: 'MY', KCH: 'MY', JHB: 'MY',
  SZB: 'MY', IPH: 'MY', TGG: 'MY', KBR: 'MY', MYY: 'MY', LBU: 'MY',
  SDK: 'MY', TWU: 'MY', AOR: 'MY', MKZ: 'MY',
  // Thailand
  BKK: 'TH', DMK: 'TH', HKT: 'TH', CNX: 'TH', USM: 'TH', KBV: 'TH',
  UTP: 'TH', HDY: 'TH', CEI: 'TH', URT: 'TH', CJM: 'TH', TDX: 'TH',
  // Maldives
  MLE: 'MV', GAN: 'MV', HAQ: 'MV', KDO: 'MV',
  // UAE
  DXB: 'AE', AUH: 'AE', SHJ: 'AE', RKT: 'AE', AAN: 'AE', DWC: 'AE', FJR: 'AE',
  // Indonesia
  CGK: 'ID', DPS: 'ID', SUB: 'ID', JOG: 'ID', UPG: 'ID', BPN: 'ID',
  MDC: 'ID', LOP: 'ID', KNO: 'ID', PDG: 'ID', HLP: 'ID', SRG: 'ID', BDO: 'ID',
  // Mauritius
  MRU: 'MU', RRG: 'MU',
}

/** Strip punctuation/spaces and upper-case, so "Sri Lanka" and "sri-lanka" agree. */
function foldToken(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '')
}

/**
 * Normalize any country token from the store to an ISO alpha-2 code.
 * Handles alpha-2 ('LK'), names ('Sri Lanka', 'srilanka') and the stray
 * alpha-3 values present in `tbl_lifestyle.country`.
 */
export function normalizeCountryToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const folded = foldToken(raw)
  if (!folded) return null
  if (folded.length === 2 && ISO_TO_OPERATION[folded]) return folded
  if (NAME_TO_ISO[folded]) return NAME_TO_ISO[folded]
  // A valid-looking alpha-2 for a country ops does not operate — recognised, unsupported.
  if (folded.length === 2) return folded
  return null
}

/** ISO alpha-2 (or a country name) → ops country. Null when unsupported. */
export function operationCountryFromIso(raw: string | null | undefined): OperationCountry | null {
  const iso = normalizeCountryToken(raw)
  return iso ? ISO_TO_OPERATION[iso] ?? null : null
}

/**
 * Pull IATA codes out of an `arrival_airports` value. The column is free-form —
 * observed as a JSON array, a comma/pipe list, or a single code — so this
 * tolerates all of them rather than assuming one shape.
 */
export function parseAirportCodes(raw: string | null | undefined): string[] {
  if (!raw) return []
  let text = raw
  // A JSON array/object flattens to its scalar values before code extraction.
  if (/^\s*[[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text) as unknown
      const flat: string[] = []
      const walk = (v: unknown): void => {
        if (typeof v === 'string' || typeof v === 'number') flat.push(String(v))
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
      }
      walk(parsed)
      text = flat.join(',')
    } catch {
      /* not valid JSON — fall through to plain tokenising */
    }
  }
  const codes = text.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []
  // De-duplicate but keep order: the itinerary's final arrival is the destination.
  return Array.from(new Set(codes))
}

/**
 * Destination country for a flight order, from its arrival airports.
 *
 * Return-trip itineraries arrive back at the origin, so the *last* recognised
 * foreign airport is a poor signal; instead take the first arrival airport that
 * maps to a supported country. For a Colombo-based store, "CMB → DXB → CMB"
 * should resolve to UAE, so a code matching `homeIso` is only used as a last resort.
 */
export function operationCountryFromAirports(
  raw: string | null | undefined,
  homeIso = 'LK',
): OperationCountry | null {
  const codes = parseAirportCodes(raw)
  let homeMatch: OperationCountry | null = null
  for (const code of codes) {
    const iso = AIRPORT_TO_ISO[code]
    if (!iso) continue
    const country = ISO_TO_OPERATION[iso]
    if (!country) continue
    if (iso === homeIso) { homeMatch ??= country; continue }
    return country
  }
  return homeMatch
}

/**
 * Ops country for a single IATA code, or null when the airport is outside the
 * markets ops operates (e.g. NRT, BOM, TLV — Aahaas sells flights worldwide).
 */
export function operationCountryFromAirportCode(code: string | null | undefined): OperationCountry | null {
  if (!code) return null
  const iso = AIRPORT_TO_ISO[code.trim().toUpperCase()]
  return iso ? ISO_TO_OPERATION[iso] ?? null : null
}

/**
 * Best-effort country from free text, reusing the keyword matcher the email
 * pipeline already relies on ({@link detectCountryFromText}).
 *
 * This is what rescues Ratehawk-style hotel rows, which have no product record but
 * name the destination — "Amari Colombo Sri Lanka" resolves to SRILANKA, "The Clan
 * Hotel Singapore" to SINGAPORE.
 */
export function operationCountryFromText(...parts: (string | null | undefined)[]): OperationCountry | null {
  const text = parts.filter(Boolean).join(' ')
  if (!text.trim()) return null
  return detectCountryFromText(text, '')
}
