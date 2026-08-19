/**
 * Suggestion lists for the agenda (MC) movement editor.
 *
 * Every field these feed stays a free-text field: the list is a shortcut, never
 * a constraint. A tour, hotel or pickup point that is not on the list is typed
 * in as-is and saved as-is — nothing here validates or rewrites what the user
 * enters, so a new product never has to wait for a code change.
 *
 * Route / activity lists are Vietnam-only by request: those are the files the
 * Vietnam desk repeats daily. Other operation countries get no seed list and
 * simply behave as the plain text boxes they were before. Meal plans are the
 * one list that applies to every country.
 */

/** Meal plan codes — used for every operation country. */
export const MEAL_PLAN_OPTIONS: { value: string; label: string }[] = [
  { value: 'B',   label: 'B — Breakfast' },
  { value: 'L',   label: 'L — Lunch' },
  { value: 'D',   label: 'D — Dinner' },
  { value: 'BL',  label: 'BL — Breakfast + Lunch' },
  { value: 'BD',  label: 'BD — Breakfast + Dinner' },
  { value: 'LD',  label: 'LD — Lunch + Dinner' },
  { value: 'BLD', label: 'BLD — Breakfast + Lunch + Dinner' },
  { value: 'HB',  label: 'HB — Half Board' },
  { value: 'FB',  label: 'FB — Full Board' },
  { value: 'AI',  label: 'AI — All Inclusive' },
  { value: 'RO',  label: 'RO — Room Only / No Meals' },
]

/** Cities / regions a Vietnam movement is centred on. */
export const VIETNAM_LOCATIONS: string[] = [
  'Hanoi', 'Ha Long', 'Lan Ha Bay', 'Cat Ba', 'Hai Phong', 'Ninh Binh', 'Tam Coc',
  'Trang An', 'Hoa Lu', 'Mai Chau', 'Sapa', 'Lao Cai', 'Ha Giang', 'Bac Ha',
  'Perfume Pagoda', 'Bat Trang', 'Hue', 'Phong Nha', 'Da Nang', 'Ba Na Hills',
  'Hoi An', 'My Son', 'Quy Nhon', 'Nha Trang', 'Cam Ranh', 'Da Lat', 'Mui Ne',
  'Phan Thiet', 'Ho Chi Minh City', 'Cu Chi', 'Vung Tau', 'My Tho', 'Ben Tre',
  'Can Tho', 'Chau Doc', 'Phu Quoc', 'Con Dao', 'Buon Ma Thuot', 'Pleiku',
]

/** Common pickup / drop points — airports, piers, stations, landmarks. */
export const VIETNAM_POINTS: string[] = [
  'Hotel in Hanoi', 'Hotel in Ha Long', 'Hotel in Hue', 'Hotel in Da Nang',
  'Hotel in Hoi An', 'Hotel in Nha Trang', 'Hotel in Da Lat',
  'Hotel in Ho Chi Minh City', 'Hotel in Phu Quoc',
  'Noi Bai International Airport (HAN)',
  'Tan Son Nhat International Airport (SGN)',
  'Da Nang International Airport (DAD)',
  'Cam Ranh International Airport (CXR)',
  'Phu Quoc International Airport (PQC)',
  'Phu Bai International Airport (HUE)',
  'Cat Bi International Airport (HPH)',
  'Lien Khuong Airport (DLI)', 'Van Don International Airport (VDO)',
  'Hanoi Old Quarter', 'Hanoi Railway Station', 'Thang Long Water Puppet Theatre',
  'Tuan Chau Marina', 'Ha Long International Cruise Port', 'Got Pier',
  'Beo Pier (Cat Ba)', 'Sapa Town Centre', 'Hue Imperial City',
  'Hoi An Ancient Town', 'Da Nang Beach', 'Nha Trang Beach',
  'Da Lat Market', 'Ben Thanh Market', 'Saigon Port',
  'Duong Dong Town', 'An Thoi Port', 'Rach Gia Ferry Terminal',
]

/** Tours, tickets and activities that fill the To / Activity box. */
export const VIETNAM_ACTIVITIES: string[] = [
  'Hanoi City Tour', 'Hanoi Old Quarter Walking Tour', 'Hanoi Street Food Tour',
  'Vespa Food Tour', 'Ho Chi Minh Mausoleum & Temple of Literature',
  'Train Street', 'Thang Long Water Puppet Show', 'Bat Trang Pottery Village',
  'Perfume Pagoda Day Tour', 'Halong Bay Day Cruise',
  'Halong Bay Overnight Cruise (1N)', 'Halong Bay Overnight Cruise (2N)',
  'Lan Ha Bay Day Cruise', 'Bai Tu Long Bay Cruise', 'Sung Sot (Surprise) Cave',
  'Titop Island', 'Kayaking in Halong Bay', 'Halong Bay Seaplane',
  'Ninh Binh Day Tour (Hoa Lu – Tam Coc)', 'Trang An Boat Tour',
  'Bai Dinh Pagoda', 'Mua Cave', 'Cuc Phuong National Park',
  'Sapa Trekking Tour', 'Cat Cat Village', 'Fansipan Cable Car',
  'Muong Hoa Valley', 'Bac Ha Sunday Market', 'Ha Giang Loop Tour',
  'Mai Chau Day Tour', 'Hue Imperial City Tour', 'Perfume River Dragon Boat Cruise',
  'Khai Dinh & Tu Duc Royal Tombs', 'Hai Van Pass Scenic Drive',
  'Phong Nha Cave Tour', 'Paradise Cave', 'Ba Na Hills & Golden Bridge',
  'Marble Mountains', 'Son Tra Peninsula & Lady Buddha',
  'Hoi An Ancient Town Walking Tour', 'Basket Boat Ride (Cam Thanh Coconut Village)',
  'Hoi An Cooking Class', 'Hoi An Lantern Boat Ride', 'My Son Sanctuary',
  'Nha Trang Island Hopping', 'VinWonders Nha Trang', 'Nha Trang Mud Bath',
  'Da Lat City Tour', 'Datanla Falls & Alpine Coaster', 'Langbiang Mountain',
  'Mui Ne Sand Dunes Jeep Tour', 'Fairy Stream',
  'Saigon City Tour', 'War Remnants Museum', 'Cu Chi Tunnels Half Day Tour',
  'Mekong Delta Day Tour (My Tho – Ben Tre)', 'Cai Rang Floating Market',
  'Can Tho Day Tour', 'Vung Tau Day Trip',
  '4 Island Tour (Phu Quoc)', 'Hon Thom Cable Car (One-way)',
  'Hon Thom Cable Car (Return)', 'VinWonders Phu Quoc', 'Phu Quoc Safari',
  'Grand World Phu Quoc', 'Kiss Bridge Show', 'Sunset Sanato Beach Club',
  'Phu Quoc Squid Fishing', 'Con Dao Island Tour',
  'Airport Pick-up & Transfer to Hotel', 'Hotel to Airport Transfer',
  'Free & Easy / At Leisure',
]

/** True when this booking's operation country gets the Vietnam seed lists. */
export function isVietnamCountry(country?: string | null): boolean {
  return (country ?? '').toUpperCase() === 'VIETNAM'
}

export type AgendaSuggestionField = 'location' | 'fromPoint' | 'toPoint'

/**
 * Seed list for one movement field. Empty for non-Vietnam countries, which
 * leaves the box a plain text field.
 */
export function seedSuggestions(field: AgendaSuggestionField, country?: string | null): string[] {
  if (!isVietnamCountry(country)) return []
  if (field === 'location')  return VIETNAM_LOCATIONS
  if (field === 'fromPoint') return [...VIETNAM_POINTS, ...VIETNAM_LOCATIONS]
  return [...VIETNAM_ACTIVITIES, ...VIETNAM_POINTS, ...VIETNAM_LOCATIONS]
}

/** De-duplicate case-insensitively, keeping the first spelling seen. */
export function mergeSuggestions(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const raw of list ?? []) {
      const value = raw.trim()
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(value)
    }
  }
  return out
}
