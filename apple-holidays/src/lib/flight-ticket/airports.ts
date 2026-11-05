/**
 * IATA code → city for the ticket's big FROM / TO lettering.
 *
 * `ops-geo.ts` holds the airports OPS maps; this adds the ones a B2C flight
 * reaches that it lacks. Kept separate on purpose: ops-geo also carries
 * coordinates other screens depend on, and this list needs only a name.
 */
import { airport } from '@/lib/ops-geo'

const EXTRA: Record<string, string> = {
  IXM: 'Madurai', IXZ: 'Port Blair', IXE: 'Mangalore', IXB: 'Bagdogra', IXR: 'Ranchi', IXA: 'Agartala',
  CCJ: 'Kozhikode', CNN: 'Kannur', TIR: 'Tirupati', IXJ: 'Jammu', SXR: 'Srinagar', VNS: 'Varanasi',
  PAT: 'Patna', BBI: 'Bhubaneswar', GAU: 'Guwahati', NAG: 'Nagpur', IDR: 'Indore', ATQ: 'Amritsar',
  GAN: 'Gan', HAQ: 'Hanimaadhoo', PKR: 'Pokhara', CGP: 'Chittagong', KHH: 'Kaohsiung', CJU: 'Jeju',
  FUK: 'Fukuoka', CTS: 'Sapporo', OKA: 'Okinawa', HKT: 'Phuket', USM: 'Koh Samui', KBV: 'Krabi',
  LOP: 'Lombok', JOG: 'Yogyakarta', KNO: 'Medan', CRK: 'Clark', PPS: 'Puerto Princesa', DOH: 'Doha',
  MED: 'Madinah', DMM: 'Dammam', AMM: 'Amman', BEY: 'Beirut', SLL: 'Salalah', MXP: 'Milan',
}

export function cityForAirport(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(c)) return null
  return airport(c)?.city ?? EXTRA[c] ?? null
}
