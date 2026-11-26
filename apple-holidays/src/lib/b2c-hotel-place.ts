/**
 * Where a B2C hotel line actually is — pure helpers, no I/O.
 *
 * The store keeps hotel places in three shapes, and none is reliable alone:
 *  - Aahaas-contracted hotels (`provider = 'aahaas'`): `hotels.country` / `hotels.city`,
 *    but `city` is sometimes a street ("88 Đường Bùi Thị Xuân" for Queen Ann Hotel).
 *  - Ratehawk hotels: no product row (`product_id = 0`) and the booked
 *    `hotelData` has `city: null, country: null`; the place lives in
 *    `ratehawk_hotels.region` ({"name":"Da Nang","country_code":"VN",…}).
 *  - Everything has a free-text address ("k4/52 Dang Thuy Tram, Da Nang").
 *
 * Getting this wrong is not cosmetic: a hotel with no city used to inherit the
 * booking's destination, which once came from an unrelated lifestyle product
 * (order 16404 — a Hanoi hotel's id matched "Archery in Negombo", so a Da Nang
 * homestay was filed under Negombo, Sri Lanka).
 */

const COUNTRY_WORDS = /^(viet\s*nam|vietnam|sri\s*lanka|singapore|malaysia|thailand|india|indonesia|maldives|cambodia|laos|japan|china|philippines|united arab emirates|uae)$/i

/** A street, house number or ward rather than a city: "88 Đường Bùi Thị Xuân", "k4/52 …". */
export function looksLikeStreet(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  if (!v) return false
  if (/\d/.test(v) || /\b(street|st\.|road|rd\.|lane|avenue|ave\.|soi|jalan|jln)(\s|$)/i.test(v)) return true
  // `\b` treats "đ" as a non-word character, so Vietnamese words are matched whole.
  return hasWord(v, ['đường', 'ngõ', 'hẻm'])
}

function hasWord(text: string, words: string[]): boolean {
  const tokens = text.toLowerCase().split(/[\s,./-]+/)
  return words.some((w) => tokens.indexOf(w) >= 0)
}

/** A usable city, or null when the value is empty or a street. */
export function cleanCity(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim()
  return v && !looksLikeStreet(v) ? v : null
}

/**
 * The city named in an address: the last comma part that is not the country,
 * a postal code or a street. "…, Bến Thành, District 01, Ho Chi Minh City, Vietnam"
 * → "Ho Chi Minh City"; "k4/52 Dang Thuy Tram, Da Nang" → "Da Nang".
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const parts = (address ?? '').split(',').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (COUNTRY_WORDS.test(p)) continue
    if (hasWord(p, ['district', 'ward', 'quận', 'phường'])) continue
    const city = cleanCity(p)
    if (city) return city
    // "Colombo 00300" — keep the name, drop the postcode.
    const named = p.replace(/\s*\d{4,6}\s*$/, '').trim()
    if (named && named !== p && cleanCity(named)) return named
  }
  return null
}

/** `ratehawk_hotels.region` → { city, country }. Tolerates a JSON string or object. */
export function placeFromRatehawkRegion(raw: unknown): { city: string | null; country: string | null } {
  let r: any = raw
  if (typeof r === 'string') { try { r = JSON.parse(r) } catch { r = null } }
  if (!r || typeof r !== 'object') return { city: null, country: null }
  const country = typeof r.country_code === 'string' && /^[A-Za-z]{2}$/.test(r.country_code) ? r.country_code.toUpperCase() : null
  return { city: cleanCity(typeof r.name === 'string' ? r.name : null), country }
}

/** A `hotel_prebooking.bookingdataset` value, which is sometimes JSON-encoded twice. */
export function parseStayBlob(raw: unknown): any {
  let v: any = raw
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v) } catch { return null }
  }
  return v && typeof v === 'object' ? v : null
}
