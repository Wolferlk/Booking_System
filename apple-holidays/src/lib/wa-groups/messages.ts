/**
 * The guest-facing text for the flight, accommodation, itinerary and driver
 * sends. Pure functions. Carries no brand, like the daily plan: most guests are
 * white-labelled (lib/super-partners.ts). Rates are never an input here.
 */

function day(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function shortDay(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

const clean = (v: string | null | undefined) => (v ?? '').trim()
const FOOTER = 'Reply here if anything looks wrong and we will fix it 🙏'

export interface FlightLine {
  flightNo: string; date: Date | string; fromApt: string; toApt: string
  depTime: string; arrTime: string; airline: string | null
}

export function formatFlightDetails(ref: string, flights: FlightLine[]): string {
  const blocks = flights.map(f => {
    const title = [clean(f.flightNo), clean(f.airline)].filter(Boolean).join(' · ')
    const dep = [clean(f.fromApt), clean(f.depTime)].filter(Boolean).join(' ')
    const arr = [clean(f.toApt), clean(f.arrTime)].filter(Boolean).join(' ')
    return `*${title || 'Flight'}*\n📅 ${day(f.date)}\n🛫 ${dep} → 🛬 ${arr}`
  })
  return [`✈️ *Your Flight Details*\nBooking ${ref}`, ...blocks, FOOTER].join('\n\n')
}

export interface HotelLine {
  hotel: string; city: string; checkIn: Date | string; checkOut: Date | string; nights: number
  roomType: string | null; mealType: string | null; address: string | null; contact: string | null
}

export function formatHotelDetails(ref: string, hotels: HotelLine[]): string {
  const blocks = hotels.map(h => {
    const lines = [
      `*${clean(h.hotel)}*${clean(h.city) ? `, ${clean(h.city)}` : ''}`,
      `📅 ${shortDay(h.checkIn)} → ${shortDay(h.checkOut)} (${h.nights} night${h.nights === 1 ? '' : 's'})`,
    ]
    if (clean(h.roomType)) lines.push(`🛏 ${clean(h.roomType)}`)
    if (clean(h.mealType)) lines.push(`🍽 ${clean(h.mealType)}`)
    if (clean(h.address))  lines.push(`📍 ${clean(h.address)}`)
    if (clean(h.contact))  lines.push(`📞 ${clean(h.contact)}`)
    return lines.join('\n')
  })
  return [`🏨 *Your Accommodation*\nBooking ${ref}`, ...blocks, FOOTER].join('\n\n')
}

const TITLE_LIMIT = 90

export function formatItinerary(ref: string, items: { dayNo: number; date: Date | string; title: string }[]): string {
  const lines = items.map(i => {
    const title = clean(i.title).replace(/\s+/g, ' ')
    const short = title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title
    return `*Day ${i.dayNo}* (${shortDay(i.date)}): ${short}`
  })
  return [`🗺 *Your Itinerary*\nBooking ${ref}`, lines.join('\n'), FOOTER].join('\n\n')
}

export interface DriverLine {
  name: string; phone: string | null; vehicle: string | null; plate: string | null
  dates: (Date | string)[]
}

export function formatDriverDetails(ref: string, drivers: DriverLine[]): string {
  const blocks = drivers.map(d => {
    const days = Array.from(new Set(d.dates.map(shortDay)))
    const lines = [`*${clean(d.name)}*`]
    if (clean(d.phone)) lines.push(`📞 ${clean(d.phone)}`)
    const vehicle = [clean(d.vehicle), clean(d.plate)].filter(Boolean).join(' · ')
    if (vehicle) lines.push(`🚐 ${vehicle}`)
    if (days.length) lines.push(`📅 ${days.length > 6 ? `${days[0]} to ${days[days.length - 1]}` : days.join(', ')}`)
    return lines.join('\n')
  })
  return [`🚗 *Your Driver Details*\nBooking ${ref}`, ...blocks, FOOTER].join('\n\n')
}
