/**
 * Ops Geo — a static gazetteer for the live operations map.
 *
 * The journey map geocodes through Nominatim and the model because it draws one
 * booking's itinerary and can afford a slow, cached, best-effort resolve. The
 * dashboard hero cannot: it draws *every* file on the ground and *every* flight
 * today, on first paint, for every user who opens the page. A network geocode
 * per pin would turn the landing page into a rate-limited crawl.
 *
 * So this file is deliberately offline and deliberately narrow — the airports
 * our files actually fly through and the towns our files actually sleep in, plus
 * the source markets that feed them. A place that is missing simply gets no pin;
 * nothing else on the dashboard depends on it.
 *
 * Coordinates are decimal degrees, WGS84. Airport coordinates are the field
 * itself, not the city it serves — a flight arc must land on the runway.
 */

export interface GeoPoint { lat: number; lng: number }

export interface AirportRef extends GeoPoint {
  iata: string
  city: string
  /** Country name as written for a human, not an ISO code. */
  country: string
}

export interface CityRef extends GeoPoint {
  name: string
  /** The OperationCountry this place belongs to. */
  country: OpCountry
}

export type OpCountry = 'VIETNAM' | 'SRILANKA' | 'SINGAPORE' | 'MALAYSIA'

// ─── Airports ──────────────────────────────────────────────────────────────
//
// Ordered by relevance to us: the countries we operate in first, then the
// regional hubs and source markets our inbound sectors come from.

const AIRPORT_ROWS: [iata: string, lat: number, lng: number, city: string, country: string][] = [
  // Sri Lanka
  ['CMB',  7.1808,  79.8841, 'Colombo',        'Sri Lanka'],
  ['HRI',  6.2843,  81.1240, 'Hambantota',     'Sri Lanka'],
  ['RML',  6.8221,  79.8862, 'Ratmalana',      'Sri Lanka'],
  ['JAF',  9.7923,  80.0700, 'Jaffna',         'Sri Lanka'],
  ['TRR',  8.5385,  81.1819, 'Trincomalee',    'Sri Lanka'],
  // Vietnam
  ['SGN', 10.8188, 106.6520, 'Ho Chi Minh City', 'Vietnam'],
  ['HAN', 21.2212, 105.8072, 'Hanoi',          'Vietnam'],
  ['DAD', 16.0439, 108.1994, 'Da Nang',        'Vietnam'],
  ['CXR', 11.9982, 109.2193, 'Nha Trang',      'Vietnam'],
  ['PQC', 10.2270, 103.9670, 'Phu Quoc',       'Vietnam'],
  ['HPH', 20.8194, 106.7247, 'Hai Phong',      'Vietnam'],
  ['HUI', 16.4015, 107.7030, 'Hue',            'Vietnam'],
  ['VCA', 10.0851, 105.7118, 'Can Tho',        'Vietnam'],
  ['DLI', 11.7500, 108.3667, 'Da Lat',         'Vietnam'],
  ['VDO', 21.1178, 107.4142, 'Van Don',        'Vietnam'],
  ['UIH', 13.9550, 109.0422, 'Quy Nhon',       'Vietnam'],
  ['VII', 18.7376, 105.6712, 'Vinh',           'Vietnam'],
  // Singapore
  ['SIN',  1.3644, 103.9915, 'Singapore',      'Singapore'],
  ['XSP',  1.4212, 103.8686, 'Seletar',        'Singapore'],
  // Malaysia
  ['KUL',  2.7456, 101.7072, 'Kuala Lumpur',   'Malaysia'],
  ['SZB',  3.1307, 101.5495, 'Subang',         'Malaysia'],
  ['PEN',  5.2971, 100.2769, 'Penang',         'Malaysia'],
  ['LGK',  6.3298,  99.7287, 'Langkawi',       'Malaysia'],
  ['BKI',  5.9372, 116.0511, 'Kota Kinabalu',  'Malaysia'],
  ['KCH',  1.4849, 110.3469, 'Kuching',        'Malaysia'],
  ['JHB',  1.6411, 103.6698, 'Johor Bahru',    'Malaysia'],
  ['MKZ',  2.2634, 102.2519, 'Malacca',        'Malaysia'],
  ['KBR',  6.1668, 102.2933, 'Kota Bharu',     'Malaysia'],
  ['KUA',  3.7754, 103.2093, 'Kuantan',        'Malaysia'],
  ['MYY',  4.3220, 113.9865, 'Miri',           'Malaysia'],
  ['SDK',  5.9007, 118.0594, 'Sandakan',       'Malaysia'],
  ['TWU',  4.3200, 118.1228, 'Tawau',          'Malaysia'],
  // Thailand / Indochina
  ['BKK', 13.6900, 100.7501, 'Bangkok',        'Thailand'],
  ['DMK', 13.9126, 100.6068, 'Bangkok',        'Thailand'],
  ['HKT',  8.1132,  98.3169, 'Phuket',         'Thailand'],
  ['CNX', 18.7669,  98.9626, 'Chiang Mai',     'Thailand'],
  ['USM',  9.5478, 100.0623, 'Koh Samui',      'Thailand'],
  ['KBV',  8.0992,  98.9862, 'Krabi',          'Thailand'],
  ['PNH', 11.5466, 104.8441, 'Phnom Penh',     'Cambodia'],
  ['REP', 13.4107, 103.8130, 'Siem Reap',      'Cambodia'],
  ['SAI', 13.5670, 103.9950, 'Siem Reap',      'Cambodia'],
  ['VTE', 17.9884, 102.5633, 'Vientiane',      'Laos'],
  ['LPQ', 19.8973, 102.1608, 'Luang Prabang',  'Laos'],
  ['RGN', 16.9073,  96.1332, 'Yangon',         'Myanmar'],
  // Maritime SEA
  ['CGK', -6.1256, 106.6559, 'Jakarta',        'Indonesia'],
  ['DPS', -8.7482, 115.1672, 'Bali',           'Indonesia'],
  ['SUB', -7.3798, 112.7871, 'Surabaya',       'Indonesia'],
  ['MNL', 14.5086, 121.0198, 'Manila',         'Philippines'],
  ['CEB', 10.3075, 123.9790, 'Cebu',           'Philippines'],
  ['BWN',  4.9442, 114.9283, 'Bandar Seri Begawan', 'Brunei'],
  // South Asia
  ['DEL', 28.5562,  77.1000, 'Delhi',          'India'],
  ['BOM', 19.0887,  72.8679, 'Mumbai',         'India'],
  ['MAA', 12.9941,  80.1709, 'Chennai',        'India'],
  ['BLR', 13.1986,  77.7066, 'Bengaluru',      'India'],
  ['HYD', 17.2403,  78.4294, 'Hyderabad',      'India'],
  ['CCU', 22.6547,  88.4467, 'Kolkata',        'India'],
  ['COK', 10.1520,  76.4019, 'Kochi',          'India'],
  ['TRV',  8.4821,  76.9201, 'Thiruvananthapuram', 'India'],
  ['AMD', 23.0772,  72.6347, 'Ahmedabad',      'India'],
  ['PNQ', 18.5821,  73.9197, 'Pune',           'India'],
  ['GOI', 15.3808,  73.8314, 'Goa',            'India'],
  ['GOX', 15.7160,  73.8680, 'Goa',            'India'],
  ['JAI', 26.8242,  75.8122, 'Jaipur',         'India'],
  ['LKO', 26.7606,  80.8893, 'Lucknow',        'India'],
  ['IXC', 30.6735,  76.7885, 'Chandigarh',     'India'],
  ['TRZ', 10.7654,  78.7097, 'Tiruchirappalli','India'],
  ['MDU',  9.8345,  78.0934, 'Madurai',        'India'],
  ['CJB', 11.0300,  77.0434, 'Coimbatore',     'India'],
  ['VTZ', 17.7211,  83.2245, 'Visakhapatnam',  'India'],
  ['MLE',  4.1918,  73.5291, 'Male',           'Maldives'],
  ['KTM', 27.6966,  85.3591, 'Kathmandu',      'Nepal'],
  ['DAC', 23.8433,  90.3978, 'Dhaka',          'Bangladesh'],
  ['KHI', 24.9065,  67.1608, 'Karachi',        'Pakistan'],
  ['LHE', 31.5216,  74.4036, 'Lahore',         'Pakistan'],
  ['ISB', 33.5491,  72.8256, 'Islamabad',      'Pakistan'],
  // Gulf / Middle East
  ['DXB', 25.2532,  55.3657, 'Dubai',          'UAE'],
  ['DWC', 24.8964,  55.1614, 'Dubai',          'UAE'],
  ['AUH', 24.4330,  54.6511, 'Abu Dhabi',      'UAE'],
  ['SHJ', 25.3286,  55.5172, 'Sharjah',        'UAE'],
  ['DOH', 25.2731,  51.6080, 'Doha',           'Qatar'],
  ['MCT', 23.5933,  58.2844, 'Muscat',         'Oman'],
  ['KWI', 29.2266,  47.9689, 'Kuwait City',    'Kuwait'],
  ['BAH', 26.2708,  50.6336, 'Manama',         'Bahrain'],
  ['RUH', 24.9576,  46.6988, 'Riyadh',         'Saudi Arabia'],
  ['JED', 21.6796,  39.1565, 'Jeddah',         'Saudi Arabia'],
  ['TLV', 32.0114,  34.8867, 'Tel Aviv',       'Israel'],
  // East Asia
  ['HKG', 22.3080, 113.9185, 'Hong Kong',      'Hong Kong'],
  ['MFM', 22.1496, 113.5915, 'Macau',          'Macau'],
  ['TPE', 25.0777, 121.2328, 'Taipei',         'Taiwan'],
  ['PVG', 31.1443, 121.8083, 'Shanghai',       'China'],
  ['SHA', 31.1979, 121.3363, 'Shanghai',       'China'],
  ['PEK', 40.0799, 116.5845, 'Beijing',        'China'],
  ['PKX', 39.5098, 116.4109, 'Beijing',        'China'],
  ['CAN', 23.3924, 113.2988, 'Guangzhou',      'China'],
  ['SZX', 22.6393, 113.8107, 'Shenzhen',       'China'],
  ['CTU', 30.5785, 103.9471, 'Chengdu',        'China'],
  ['KMG', 25.1019, 102.9292, 'Kunming',        'China'],
  ['NRT', 35.7720, 140.3929, 'Tokyo',          'Japan'],
  ['HND', 35.5494, 139.7798, 'Tokyo',          'Japan'],
  ['KIX', 34.4273, 135.2444, 'Osaka',          'Japan'],
  ['NGO', 34.8584, 136.8054, 'Nagoya',         'Japan'],
  ['ICN', 37.4602, 126.4407, 'Seoul',          'South Korea'],
  ['GMP', 37.5583, 126.7906, 'Seoul',          'South Korea'],
  ['PUS', 35.1795, 128.9382, 'Busan',          'South Korea'],
  // Europe
  ['LHR', 51.4700,  -0.4543, 'London',         'United Kingdom'],
  ['LGW', 51.1537,  -0.1821, 'London',         'United Kingdom'],
  ['LTN', 51.8747,  -0.3683, 'London',         'United Kingdom'],
  ['MAN', 53.3537,  -2.2750, 'Manchester',     'United Kingdom'],
  ['DUB', 53.4213,  -6.2701, 'Dublin',         'Ireland'],
  ['CDG', 49.0097,   2.5479, 'Paris',          'France'],
  ['ORY', 48.7233,   2.3794, 'Paris',          'France'],
  ['FRA', 50.0379,   8.5622, 'Frankfurt',      'Germany'],
  ['MUC', 48.3538,  11.7861, 'Munich',         'Germany'],
  ['AMS', 52.3105,   4.7683, 'Amsterdam',      'Netherlands'],
  ['BRU', 50.9014,   4.4844, 'Brussels',       'Belgium'],
  ['ZRH', 47.4582,   8.5555, 'Zurich',         'Switzerland'],
  ['GVA', 46.2381,   6.1090, 'Geneva',         'Switzerland'],
  ['VIE', 48.1103,  16.5697, 'Vienna',         'Austria'],
  ['FCO', 41.8003,  12.2389, 'Rome',           'Italy'],
  ['MXP', 45.6306,   8.7281, 'Milan',          'Italy'],
  ['MAD', 40.4719,  -3.5626, 'Madrid',         'Spain'],
  ['BCN', 41.2974,   2.0833, 'Barcelona',      'Spain'],
  ['LIS', 38.7742,  -9.1342, 'Lisbon',         'Portugal'],
  ['CPH', 55.6181,  12.6561, 'Copenhagen',     'Denmark'],
  ['ARN', 59.6519,  17.9186, 'Stockholm',      'Sweden'],
  ['OSL', 60.1939,  11.1004, 'Oslo',           'Norway'],
  ['HEL', 60.3172,  24.9633, 'Helsinki',       'Finland'],
  ['WAW', 52.1657,  20.9671, 'Warsaw',         'Poland'],
  ['PRG', 50.1008,  14.2600, 'Prague',         'Czechia'],
  ['BUD', 47.4369,  19.2556, 'Budapest',       'Hungary'],
  ['ATH', 37.9364,  23.9445, 'Athens',         'Greece'],
  ['IST', 41.2619,  28.7419, 'Istanbul',       'Turkey'],
  ['SAW', 40.8986,  29.3092, 'Istanbul',       'Turkey'],
  ['SVO', 55.9726,  37.4146, 'Moscow',         'Russia'],
  ['DME', 55.4088,  37.9063, 'Moscow',         'Russia'],
  ['LED', 59.8003,  30.2625, 'St Petersburg',  'Russia'],
  // Americas
  ['JFK', 40.6413, -73.7781, 'New York',       'United States'],
  ['EWR', 40.6895, -74.1745, 'Newark',         'United States'],
  ['ORD', 41.9742, -87.9073, 'Chicago',        'United States'],
  ['LAX', 33.9416,-118.4085, 'Los Angeles',    'United States'],
  ['SFO', 37.6188,-122.3750, 'San Francisco',  'United States'],
  ['IAD', 38.9531, -77.4565, 'Washington',     'United States'],
  ['SEA', 47.4502,-122.3088, 'Seattle',        'United States'],
  ['YYZ', 43.6777, -79.6248, 'Toronto',        'Canada'],
  ['YVR', 49.1967,-123.1815, 'Vancouver',      'Canada'],
  ['GRU',-23.4356, -46.4731, 'Sao Paulo',      'Brazil'],
  // Oceania
  ['SYD',-33.9399, 151.1753, 'Sydney',         'Australia'],
  ['MEL',-37.6690, 144.8410, 'Melbourne',      'Australia'],
  ['BNE',-27.3842, 153.1175, 'Brisbane',       'Australia'],
  ['PER',-31.9403, 115.9669, 'Perth',          'Australia'],
  ['ADL',-34.9450, 138.5306, 'Adelaide',       'Australia'],
  ['AKL',-37.0082, 174.7850, 'Auckland',       'New Zealand'],
  // Africa
  ['JNB',-26.1392,  28.2460, 'Johannesburg',   'South Africa'],
  ['CPT',-33.9689,  18.6017, 'Cape Town',      'South Africa'],
  ['NBO', -1.3192,  36.9278, 'Nairobi',        'Kenya'],
  ['ADD',  8.9779,  38.7993, 'Addis Ababa',    'Ethiopia'],
  ['CAI', 30.1219,  31.4056, 'Cairo',          'Egypt'],
  ['MRU',-20.4302,  57.6836, 'Mauritius',      'Mauritius'],
  ['SEZ', -4.6743,  55.5218, 'Mahe',           'Seychelles'],
]

const AIRPORTS: Record<string, AirportRef> = Object.fromEntries(
  AIRPORT_ROWS.map(([iata, lat, lng, city, country]) => [iata, { iata, lat, lng, city, country }]),
)

/** Resolve an IATA code to a field. Case and padding tolerant; null when unknown. */
export function airport(code: string | null | undefined): AirportRef | null {
  if (!code) return null
  return AIRPORTS[code.trim().toUpperCase()] ?? null
}

// ─── Airports by the names people actually type ────────────────────────────
//
// Movement charts and itineraries do not write IATA codes; they write
// "Bandaranaike International Airport" or "Colombo Airport". Geocoding those as
// prose is where airports end up in the wrong place — "Colombo Airport,
// Colombo" resolves to *Ratmalana*, the city's other airfield 40 km south of
// the runway a guest actually lands on, and "Bandaranaike International
// Airport, Colombo" resolves to nothing at all because the field is in
// Katunayake. An airport is a fixed, known point; it should never be a search.

/**
 * Proper names, as they appear on tickets and charts. Only airports whose real
 * name is commonly typed instead of the city — the city fallback below covers
 * the rest.
 */
const AIRPORT_NAME_ROWS: [alias: string, iata: string][] = [
  // Sri Lanka
  ['bandaranaike', 'CMB'], ['katunayake airport', 'CMB'], ['bia', 'CMB'],
  ['mattala', 'HRI'], ['mattala rajapaksa', 'HRI'], ['ratmalana', 'RML'],
  ['palaly', 'JAF'], ['china bay', 'TRR'],
  // Vietnam
  ['noi bai', 'HAN'], ['tan son nhat', 'SGN'], ['tan son nhut', 'SGN'],
  ['cam ranh', 'CXR'], ['cat bi', 'HPH'], ['phu bai', 'HUI'],
  ['duong dong', 'PQC'], ['lien khuong', 'DLI'], ['van don', 'VDO'],
  ['phu cat', 'UIH'], ['tra noc', 'VCA'], ['vinh city', 'VII'],
  // Singapore / Malaysia
  ['changi', 'SIN'], ['seletar', 'XSP'],
  ['klia', 'KUL'], ['kuala lumpur international', 'KUL'], ['sepang airport', 'KUL'],
  ['subang', 'SZB'], ['sultan abdul aziz shah', 'SZB'],
  ['bayan lepas', 'PEN'], ['sultan abdul halim', 'LGK'],
  ['senai', 'JHB'], ['sultan ismail airport', 'JHB'],
  // Thailand / Indochina
  ['suvarnabhumi', 'BKK'], ['don mueang', 'DMK'], ['don muang', 'DMK'],
  ['mai khao', 'HKT'], ['siem reap angkor', 'SAI'], ['angkor international', 'REP'],
  ['wattay', 'VTE'], ['pochentong', 'PNH'],
  // South Asia
  ['indira gandhi', 'DEL'], ['chhatrapati shivaji', 'BOM'],
  ['kempegowda', 'BLR'], ['meenambakkam', 'MAA'],
  ['netaji subhas', 'CCU'], ['rajiv gandhi', 'HYD'],
  ['cochin international', 'COK'], ['kochi international', 'COK'],
  ['trivandrum international', 'TRV'], ['sardar vallabhbhai patel', 'AMD'],
  ['dabolim', 'GOI'], ['manohar international', 'GOX'], ['mopa', 'GOX'],
  ['velana', 'MLE'], ['ibrahim nasir', 'MLE'], ['male international', 'MLE'],
  ['tribhuvan', 'KTM'], ['hazrat shahjalal', 'DAC'], ['jinnah international', 'KHI'],
  ['allama iqbal', 'LHE'], ['islamabad international', 'ISB'],
  // Gulf
  ['al maktoum', 'DWC'], ['zayed international', 'AUH'], ['hamad international', 'DOH'],
  ['king abdulaziz', 'JED'], ['king khalid', 'RUH'], ['ben gurion', 'TLV'],
  // East Asia / Oceania
  ['chek lap kok', 'HKG'], ['taoyuan', 'TPE'], ['pudong', 'PVG'], ['hongqiao', 'SHA'],
  ['daxing', 'PKX'], ['baiyun', 'CAN'], ['bao an', 'SZX'], ['tianfu', 'CTU'],
  ['narita', 'NRT'], ['haneda', 'HND'], ['kansai', 'KIX'], ['chubu centrair', 'NGO'],
  ['incheon', 'ICN'], ['gimpo', 'GMP'], ['gimhae', 'PUS'],
  ['kingsford smith', 'SYD'], ['tullamarine', 'MEL'], ['soekarno hatta', 'CGK'],
  ['ngurah rai', 'DPS'], ['denpasar', 'DPS'], ['ninoy aquino', 'MNL'],
  // Europe / Africa
  ['heathrow', 'LHR'], ['gatwick', 'LGW'], ['stansted', 'LTN'],
  ['charles de gaulle', 'CDG'], ['roissy', 'CDG'], ['schiphol', 'AMS'],
  ['fiumicino', 'FCO'], ['malpensa', 'MXP'], ['barajas', 'MAD'], ['el prat', 'BCN'],
  ['zaventem', 'BRU'], ['kastrup', 'CPH'], ['arlanda', 'ARN'], ['gardermoen', 'OSL'],
  ['vantaa', 'HEL'], ['chopin airport', 'WAW'], ['vaclav havel', 'PRG'],
  ['jomo kenyatta', 'NBO'], ['or tambo', 'JNB'], ['bole international', 'ADD'],
  ['sir seewoosagur', 'MRU'],
]

/**
 * Words that make a string an airport rather than the town it is named after.
 *
 * Two strengths, and the difference matters. The strict one is the only thing
 * allowed to turn a *city* into its airport, because "international" is in the
 * name of every third hotel in Asia — "Hotel International Colombo" is a bed,
 * not a runway. The loose one only ever unlocks a code that was already typed
 * as a code.
 */
const AIRPORT_WORD_STRICT = /\b(airport|airfield|aerodrome)\b/i
const AIRPORT_WORD = /\b(airport|airfield|aerodrome|intl|international|terminal)\b/i

/** One normaliser for every fuzzy match in this file — airports and towns alike. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const AIRPORT_NAMES: [alias: string, iata: string][] = AIRPORT_NAME_ROWS.map(([alias, iata]) => [norm(alias), iata])

/**
 * The field a city means when someone writes "<city> airport".
 *
 * First row wins, and the table is ordered with the primary field first — so
 * "Colombo Airport" is Bandaranaike and not Ratmalana, "Bangkok Airport" is
 * Suvarnabhumi and not Don Mueang.
 */
const PRIMARY_BY_CITY: [city: string, iata: string][] = []
AIRPORT_ROWS.forEach(([iata, , , city]) => {
  const k = norm(city)
  if (!PRIMARY_BY_CITY.some(([c]) => c === k)) PRIMARY_BY_CITY.push([k, iata])
})

/**
 * Resolve free-typed text to a real airport, offline.
 *
 * Three passes, most specific first: a proper name we know, an IATA code
 * written as a code, then "<city> + an airport word". Returns null for anything
 * that is not clearly an airport — a hotel in Katunayake and the town of Can
 * Tho both have to come back empty, or this does more damage than the geocoder
 * it replaces.
 */
export function airportByName(text: string | null | undefined): AirportRef | null {
  if (!text) return null
  const raw = String(text)
  const hay = ` ${norm(raw)} `
  if (hay.trim().length === 0) return null

  for (const [alias, iata] of AIRPORT_NAMES) {
    if (hay.includes(` ${alias} `)) return AIRPORTS[iata] ?? null
  }

  // An IATA code, but only where it is written as one: upper-case in the
  // original, and either standing alone or next to an airport word. Without
  // that guard "Can Tho" is Guangzhou and "Hotel Rex, HAN" is a coin toss.
  const airporty = AIRPORT_WORD.test(raw)
  const tokens = raw.toUpperCase().match(/(?:^|[^A-Z])([A-Z]{3})(?![A-Z])/g) ?? []
  if (airporty || norm(raw).length <= 3) {
    for (const t of tokens) {
      const code = t.replace(/[^A-Z]/g, '')
      // Case matters: the code has to be upper-case where it was typed.
      if (!new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(raw)) continue
      if (AIRPORTS[code]) return AIRPORTS[code]
    }
  }

  if (!AIRPORT_WORD_STRICT.test(raw)) return null
  for (const [city, iata] of PRIMARY_BY_CITY) {
    if (hay.includes(` ${city} `)) return AIRPORTS[iata] ?? null
  }
  return null
}

// ─── Places we operate in ──────────────────────────────────────────────────
//
// Matched against free-typed movement-chart text, so the list carries the names
// as operations write them — "Habarana", "Ba Na Hills" — not administrative
// units nobody types.

const CITY_ROWS: [name: string, lat: number, lng: number, country: OpCountry][] = [
  // ── Sri Lanka ──
  ['Colombo',        6.9271,  79.8612, 'SRILANKA'],
  ['Negombo',        7.2083,  79.8358, 'SRILANKA'],
  ['Katunayake',     7.1627,  79.8846, 'SRILANKA'],
  ['Mount Lavinia',  6.8383,  79.8636, 'SRILANKA'],
  ['Wattala',        6.9897,  79.8917, 'SRILANKA'],
  ['Kandy',          7.2906,  80.6337, 'SRILANKA'],
  ['Peradeniya',     7.2599,  80.5977, 'SRILANKA'],
  ['Matale',         7.4675,  80.6234, 'SRILANKA'],
  ['Dambulla',       7.8562,  80.6511, 'SRILANKA'],
  ['Sigiriya',       7.9570,  80.7603, 'SRILANKA'],
  ['Habarana',       8.0370,  80.7522, 'SRILANKA'],
  ['Anuradhapura',   8.3114,  80.4037, 'SRILANKA'],
  ['Polonnaruwa',    7.9403,  81.0188, 'SRILANKA'],
  ['Trincomalee',    8.5874,  81.2152, 'SRILANKA'],
  ['Nilaveli',       8.6989,  81.1900, 'SRILANKA'],
  ['Pasikuda',       7.9257,  81.5620, 'SRILANKA'],
  ['Passikudah',     7.9257,  81.5620, 'SRILANKA'],
  ['Batticaloa',     7.7102,  81.6924, 'SRILANKA'],
  ['Arugam Bay',     6.8403,  81.8360, 'SRILANKA'],
  ['Nuwara Eliya',   6.9497,  80.7891, 'SRILANKA'],
  ['Ella',           6.8667,  81.0461, 'SRILANKA'],
  ['Haputale',       6.7676,  80.9512, 'SRILANKA'],
  ['Bandarawela',    6.8330,  80.9870, 'SRILANKA'],
  ['Horton Plains',  6.8094,  80.8072, 'SRILANKA'],
  ['Kitulgala',      6.9890,  80.4120, 'SRILANKA'],
  ['Ratnapura',      6.7056,  80.3847, 'SRILANKA'],
  ['Kegalle',        7.2528,  80.3464, 'SRILANKA'],
  ['Pinnawala',      7.3000,  80.3880, 'SRILANKA'],
  ['Udawalawe',      6.4425,  80.8884, 'SRILANKA'],
  ['Yala',           6.3724,  81.5210, 'SRILANKA'],
  ['Tissamaharama',  6.2839,  81.2881, 'SRILANKA'],
  ['Hambantota',     6.1241,  81.1185, 'SRILANKA'],
  ['Galle',          6.0329,  80.2168, 'SRILANKA'],
  ['Unawatuna',      6.0097,  80.2489, 'SRILANKA'],
  ['Koggala',        5.9880,  80.3250, 'SRILANKA'],
  ['Weligama',       5.9730,  80.4290, 'SRILANKA'],
  ['Mirissa',        5.9449,  80.4590, 'SRILANKA'],
  ['Matara',         5.9485,  80.5353, 'SRILANKA'],
  ['Hikkaduwa',      6.1408,  80.1002, 'SRILANKA'],
  ['Bentota',        6.4180,  79.9959, 'SRILANKA'],
  ['Ahungalla',      6.3180,  80.0360, 'SRILANKA'],
  ['Beruwala',       6.4788,  79.9828, 'SRILANKA'],
  ['Kalutara',       6.5831,  79.9596, 'SRILANKA'],
  ['Wadduwa',        6.6630,  79.9280, 'SRILANKA'],
  ['Kalpitiya',      8.2320,  79.7660, 'SRILANKA'],
  ['Chilaw',         7.5758,  79.7953, 'SRILANKA'],
  ['Wilpattu',       8.4462,  80.0450, 'SRILANKA'],
  ['Jaffna',         9.6615,  80.0255, 'SRILANKA'],
  ['Adams Peak',     6.8094,  80.4992, 'SRILANKA'],
  // ── Vietnam ──
  ['Ho Chi Minh',   10.7769, 106.7009, 'VIETNAM'],
  ['Saigon',        10.7769, 106.7009, 'VIETNAM'],
  ['Hanoi',         21.0278, 105.8342, 'VIETNAM'],
  ['Halong',        20.9101, 107.1839, 'VIETNAM'],
  ['Ha Long',       20.9101, 107.1839, 'VIETNAM'],
  ['Cat Ba',        20.7280, 107.0480, 'VIETNAM'],
  ['Hai Phong',     20.8449, 106.6881, 'VIETNAM'],
  ['Ninh Binh',     20.2540, 105.9750, 'VIETNAM'],
  ['Tam Coc',       20.2230, 105.9190, 'VIETNAM'],
  ['Trang An',      20.2510, 105.8980, 'VIETNAM'],
  ['Sapa',          22.3364, 103.8438, 'VIETNAM'],
  ['Sa Pa',         22.3364, 103.8438, 'VIETNAM'],
  ['Ha Giang',      22.8233, 104.9840, 'VIETNAM'],
  ['Hue',           16.4637, 107.5909, 'VIETNAM'],
  ['Da Nang',       16.0544, 108.2022, 'VIETNAM'],
  ['Danang',        16.0544, 108.2022, 'VIETNAM'],
  ['Ba Na Hills',   15.9954, 107.9960, 'VIETNAM'],
  ['Hoi An',        15.8801, 108.3380, 'VIETNAM'],
  ['Quy Nhon',      13.7820, 109.2190, 'VIETNAM'],
  ['Nha Trang',     12.2388, 109.1967, 'VIETNAM'],
  ['Da Lat',        11.9404, 108.4583, 'VIETNAM'],
  ['Dalat',         11.9404, 108.4583, 'VIETNAM'],
  ['Mui Ne',        10.9330, 108.2870, 'VIETNAM'],
  ['Phan Thiet',    10.9280, 108.1020, 'VIETNAM'],
  ['Vung Tau',      10.3460, 107.0840, 'VIETNAM'],
  ['Ho Tram',       10.4700, 107.3200, 'VIETNAM'],
  ['Cu Chi',        11.0050, 106.4940, 'VIETNAM'],
  ['My Tho',        10.3600, 106.3600, 'VIETNAM'],
  ['Ben Tre',       10.2415, 106.3759, 'VIETNAM'],
  ['Mekong',        10.0300, 105.7800, 'VIETNAM'],
  ['Can Tho',       10.0452, 105.7469, 'VIETNAM'],
  ['Phu Quoc',      10.2270, 103.9600, 'VIETNAM'],
  ['Con Dao',        8.6830, 106.6070, 'VIETNAM'],
  ['Bien Hoa',      10.9574, 106.8426, 'VIETNAM'],
  // ── Malaysia ──
  ['Kuala Lumpur',   3.1390, 101.6869, 'MALAYSIA'],
  ['Putrajaya',      2.9264, 101.6964, 'MALAYSIA'],
  ['Sepang',         2.7600, 101.7320, 'MALAYSIA'],
  ['Batu Caves',     3.2379, 101.6840, 'MALAYSIA'],
  ['Petaling Jaya',  3.1073, 101.6067, 'MALAYSIA'],
  ['Shah Alam',      3.0733, 101.5185, 'MALAYSIA'],
  ['Sunway',         3.0730, 101.6070, 'MALAYSIA'],
  ['Genting',        3.4227, 101.7930, 'MALAYSIA'],
  ['Cameron Highlands', 4.4712, 101.3774, 'MALAYSIA'],
  ['Ipoh',           4.5975, 101.0901, 'MALAYSIA'],
  ['Taiping',        4.8500, 100.7333, 'MALAYSIA'],
  ['Penang',         5.4141, 100.3288, 'MALAYSIA'],
  ['George Town',    5.4141, 100.3288, 'MALAYSIA'],
  ['Langkawi',       6.3520,  99.7990, 'MALAYSIA'],
  ['Malacca',        2.1960, 102.2490, 'MALAYSIA'],
  ['Melaka',         2.1960, 102.2490, 'MALAYSIA'],
  ['Port Dickson',   2.5230, 101.7960, 'MALAYSIA'],
  ['Johor Bahru',    1.4927, 103.7414, 'MALAYSIA'],
  ['Legoland',       1.4270, 103.6320, 'MALAYSIA'],
  ['Kota Kinabalu',  5.9804, 116.0735, 'MALAYSIA'],
  ['Kundasang',      5.9800, 116.5800, 'MALAYSIA'],
  ['Sandakan',       5.8390, 118.1170, 'MALAYSIA'],
  ['Kuching',        1.5533, 110.3592, 'MALAYSIA'],
  ['Miri',           4.3990, 113.9910, 'MALAYSIA'],
  ['Kuantan',        3.8077, 103.3260, 'MALAYSIA'],
  ['Kota Bharu',     6.1248, 102.2381, 'MALAYSIA'],
  ['Tioman',         2.7900, 104.1700, 'MALAYSIA'],
  ['Redang',         5.7830, 103.0070, 'MALAYSIA'],
  ['Perhentian',     5.9130, 102.7270, 'MALAYSIA'],
  ['Kuala Selangor', 3.3430, 101.2490, 'MALAYSIA'],
  // ── Singapore ──
  ['Singapore',      1.3521, 103.8198, 'SINGAPORE'],
  ['Sentosa',        1.2494, 103.8303, 'SINGAPORE'],
  ['Marina Bay',     1.2834, 103.8607, 'SINGAPORE'],
  ['Gardens by the Bay', 1.2816, 103.8636, 'SINGAPORE'],
  ['Orchard',        1.3048, 103.8318, 'SINGAPORE'],
  ['Chinatown',      1.2833, 103.8443, 'SINGAPORE'],
  ['Little India',   1.3066, 103.8493, 'SINGAPORE'],
  ['Universal Studios', 1.2540, 103.8238, 'SINGAPORE'],
  ['Night Safari',   1.4025, 103.7880, 'SINGAPORE'],
  ['Jurong',         1.3340, 103.7060, 'SINGAPORE'],
  ['Changi',         1.3570, 103.9880, 'SINGAPORE'],
]

/**
 * Longest name first, so "Kuala Selangor" is never swallowed by "Kuala Lumpur"
 * and "Ho Chi Minh" wins over a bare "Minh" fragment.
 */
const CITIES: CityRef[] = CITY_ROWS
  .map(([name, lat, lng, country]) => ({ name, lat, lng, country }))
  .sort((a, b) => b.name.length - a.name.length)

/**
 * Best-effort place resolve for free-typed movement-chart text.
 *
 * Substring match against the gazetteer, longest name first. `country` narrows
 * the search to one operating country — a booking in Vietnam should never pin
 * on a Malaysian town that happens to share a word.
 */
export function place(text: string | null | undefined, country?: OpCountry | null): CityRef | null {
  if (!text) return null
  const hay = ` ${norm(text)} `
  if (hay.trim().length === 0) return null
  for (const c of CITIES) {
    if (country && c.country !== country) continue
    if (hay.includes(` ${norm(c.name)} `) || hay.includes(norm(c.name))) return c
  }
  return null
}

// ─── Country framing ───────────────────────────────────────────────────────

export interface CountryFocus {
  label: string
  center: GeoPoint
  zoom: number
  /** [[southWestLat, southWestLng], [northEastLat, northEastLng]] */
  bounds: [[number, number], [number, number]]
  /** Accent colour used for this country's pins and arcs. */
  hex: string
}

export const COUNTRY_FOCUS: Record<string, CountryFocus> = {
  SRILANKA: {
    label: 'Sri Lanka',
    center: { lat: 7.8731, lng: 80.7718 },
    zoom: 7,
    bounds: [[5.85, 79.5], [9.9, 82.0]],
    hex: '#f59e0b',
  },
  VIETNAM: {
    label: 'Vietnam',
    center: { lat: 16.0, lng: 107.5 },
    zoom: 5,
    bounds: [[8.2, 102.1], [23.4, 109.6]],
    hex: '#ef4444',
  },
  SINGAPORE: {
    label: 'Singapore',
    center: { lat: 1.3521, lng: 103.8198 },
    zoom: 11,
    bounds: [[1.20, 103.60], [1.48, 104.05]],
    hex: '#3b82f6',
  },
  MALAYSIA: {
    label: 'Malaysia',
    center: { lat: 4.2, lng: 108.5 },
    zoom: 5,
    bounds: [[0.85, 99.6], [7.4, 119.3]],
    hex: '#10b981',
  },
  SINGAPORE_MALAYSIA: {
    label: 'Singapore & Malaysia',
    center: { lat: 3.2, lng: 105.0 },
    zoom: 5,
    bounds: [[0.85, 99.6], [7.4, 119.3]],
    hex: '#3b82f6',
  },
  ALL: {
    label: 'All Countries',
    center: { lat: 8.5, lng: 96.0 },
    zoom: 4,
    bounds: [[-1.0, 79.0], [23.5, 119.5]],
    hex: '#6366f1',
  },
}

export function countryFocus(country: string | null | undefined): CountryFocus {
  return COUNTRY_FOCUS[country ?? 'ALL'] ?? COUNTRY_FOCUS.ALL
}

// ─── Vehicles ──────────────────────────────────────────────────────────────

export type VehicleKind =
  | 'car' | 'suv' | 'flat_roof' | 'high_roof' | 'van' | 'minibus' | 'bus' | 'coach'
  | 'none' | 'other'

/**
 * `Assignment.vehicleType` carries two vocabularies at once.
 *
 * The Sri Lanka driver-allocation board writes a fixed set of slugs — `car`,
 * `flat_roof`, `high_roof`, `bus`, `hotel_only` — and those are checked first
 * and kept as their own classes, because the ground desk genuinely allocates a
 * flat roof differently from a high roof and collapsing the two would hide the
 * distinction the board exists to make.
 *
 * Everywhere else the field is free text typed straight into the movement chart
 * ("Toyota Hiace", "29 Seater Bus", "sedan"), so the rest is pattern matching.
 *
 * `hotel_only` is not a vehicle at all — it is the board's way of saying this
 * file carries no transport — so it classes as `none` and is counted by nobody.
 */
export function vehicleKind(raw: string | null | undefined): VehicleKind {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t) return 'other'

  // Fixed slugs from the Sri Lanka allocation board.
  if (t === 'hotel_only') return 'none'
  if (t === 'flat_roof') return 'flat_roof'
  if (t === 'high_roof') return 'high_roof'
  if (t === 'car') return 'car'
  if (t === 'bus') return 'bus'

  if (/flat[\s_-]?roof/.test(t)) return 'flat_roof'
  if (/high[\s_-]?roof/.test(t)) return 'high_roof'
  if (/coach|45|49|50\s*seat/.test(t)) return 'coach'
  if (/\bbus\b|33|29\s*seat|large/.test(t)) return 'bus'
  if (/mini\s*bus|minibus|coaster|rosa|hiace|commuter|20\s*seat|16\s*seat|14\s*seat/.test(t)) return 'minibus'
  if (/\bvan\b|kdh|noah|alphard|vellfire|starex|serena|caravelle|transit/.test(t)) return 'van'
  if (/suv|jeep|prado|fortuner|pajero|x-?trail|crv|cr-v|4wd|defender/.test(t)) return 'suv'
  if (/car|sedan|axio|prius|corolla|camry|vios|premio|allion|saloon/.test(t)) return 'car'
  return 'other'
}

/** Human label for a class — the slugs are not readable as they are stored. */
export const VEHICLE_LABEL: Record<VehicleKind, string> = {
  car:       'Car',
  suv:       'SUV',
  flat_roof: 'Flat Roof',
  high_roof: 'High Roof',
  van:       'Van',
  minibus:   'Mini Bus',
  bus:       'Bus',
  coach:     'Coach',
  none:      'No Transport',
  other:     'Other',
}

/** Seats a class typically carries — used only to sanity-label the fleet strip. */
export const VEHICLE_SEATS: Record<VehicleKind, string> = {
  car:       '1–3 pax',
  suv:       '1–4 pax',
  flat_roof: '4–6 pax',
  high_roof: '6–9 pax',
  van:       '4–7 pax',
  minibus:   '8–18 pax',
  bus:       '19–33 pax',
  coach:     '34+ pax',
  none:      'Hotel only',
  other:     'Unclassed',
}
