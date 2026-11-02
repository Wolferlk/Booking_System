/**
 * The booking scope every report section reads through: the country filter,
 * plus the shared test-booking register — a booking marked as a test is not in
 * any figure a report prints.
 *
 * Moved out of `report-data.ts` when the weekly / monthly insights collector
 * started reading tours operated and cancellations itself: both files have to
 * hide exactly the same bookings, or the delivery block counts a test the
 * intake block left out. Fail-open — an unreadable register hides nothing.
 */
import type { Prisma } from '@prisma/client'
import { testBookingWhere } from '@/lib/test-bookings'
import { countryWhere } from './booking-lines'

export async function reportScope(countries: string[]): Promise<Prisma.BookingWhereInput | null> {
  const country = countryWhere(countries)
  const { clause } = await testBookingWhere('exclude')
  if (!clause) return country
  if (!country) return clause as Prisma.BookingWhereInput
  return { AND: [country, clause as Prisma.BookingWhereInput] }
}
