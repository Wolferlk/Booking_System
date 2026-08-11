/**
 * Shapes shared across the Detailed P&L port.
 *
 * The Apple System quotation payload is deeply optional — a live booking leaves
 * most sections `false`, an empty array or absent altogether — so it is typed
 * loosely on purpose and every reader goes through the defensive accessors in
 * derive.ts rather than trusting a path to exist.
 */

/** Anything the payload can hold at a given key. */
export type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json }

export type JsonRecord = { [key: string]: Json }

/** The whole `pnl_records.as_payload` blob. */
export interface AsPayload extends JsonRecord {
  pnl?: JsonRecord
  itinerary?: Json
  parties?: Json
  accommodation?: Json
  confirmation_voucher?: Json
  revision?: Json
}

export interface VehicleRecord {
  name: string
  pax_min: number
  pax_max: number
  country: string
}

export interface Catalogues {
  attraction: Record<string, string>
  city_tour: Record<string, string>
  excursion: Record<string, string>
  vehicle: Record<string, VehicleRecord>
}

/** AppleSystemApiService::extractPnlSummary. */
export interface PnlSummary {
  agent_name: string | null
  is_number: string | null
  total_pax: number
  nights: number
  days: number
  currency: string
  exchange_rate: number
  is_local: boolean
  selling_total: number | null
  cost_total: number | null
  profit_loss: number | null
}

/** One row of AppleSystemApiService::extractPnlBreakdown. */
export interface BreakdownRow {
  key: string
  label: string
  sell: number
  buy: number
  margin: number
}

/** One row of AsPnlController::productRows — an attraction or a tour transfer. */
export interface ProductRow {
  type: string
  id: string
  name: string
  day: string
  city: string
  adultCount: number
  adultRate: number
  childCount: number
  childRate: number
  transferRate: number
  entranceRate: number
  childEntranceRate: number
  total: number
}

/** One grouped journey out of the mileage details. */
export interface TransportLeg {
  from: string
  to: string
  km: number | null
  hops: number
}

export interface ResolvedNames {
  vehicle: string | null
  cities: Record<string, string>
  legs: TransportLeg[]
}

/**
 * The payload DbPnlController::detail answers with — the input the renderer
 * takes. Field for field the same JSON, so the ported renderer reads it
 * unchanged.
 */
export interface DetailPayload {
  success: true
  quotation_no: string | null
  reference_id: string | null
  revision: number | null
  country_code: string | null
  is_number: string | null
  tour_ref: string | null
  agent_name: string | null
  country_name: string | null
  country_flag: string | null
  approval_status: string | null
  summary: PnlSummary
  breakdown: BreakdownRow[]
  hotels: Json
  parties: Json
  accommodation: Json
  itinerary: Json
  pax: JsonRecord
  per_person: JsonRecord
  products: ProductRow[]
  transfers: ProductRow[]
  names: ResolvedNames
  pnl: JsonRecord
}
