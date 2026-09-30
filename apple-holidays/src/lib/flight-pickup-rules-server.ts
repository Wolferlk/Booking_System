import { prisma } from './prisma'
import {
  DEFAULT_FLIGHT_PICKUP_RULES, FLIGHT_PICKUP_KEY, parseFlightPickupRules,
  type FlightPickupRules,
} from './flight-pickup-rules'

/**
 * The airport pickup rules as they stand in `system_settings`. A failed read
 * falls back to the shipped defaults: a PDF with the usual three-hour pickup
 * is better than no PDF.
 */
export async function loadFlightPickupRules(): Promise<FlightPickupRules> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: FLIGHT_PICKUP_KEY } })
    return parseFlightPickupRules(row?.value)
  } catch (err) {
    console.warn('[flight-pickup-rules] unreadable, using defaults:', err instanceof Error ? err.message : err)
    return DEFAULT_FLIGHT_PICKUP_RULES
  }
}
