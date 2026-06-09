import * as XLSX from 'xlsx'

export function extractTextFromXlsx(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const lines: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    lines.push(`=== Sheet: ${sheetName} ===\n${csv}`)
  }

  return lines.join('\n\n')
}

export function parseXlsxToJson(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][]
}

function detectCategory(activity: string): string {
  const a = activity.toLowerCase()
  if (a.includes('hotel') || a.includes('accommodation') || a.includes('resort') || a.includes('villa')) return 'HOTEL'
  if (a.includes('flight') || a.includes('airline') || a.includes('air ticket')) return 'FLIGHT_TICKETS'
  if (a.includes('transfer') || a.includes('cab') || a.includes('taxi') || a.includes('airport') || a.includes('bus') || a.includes('transport')) return 'TRANSPORT'
  if (a.includes('cruise') || a.includes('halong') || a.includes('ha long') || a.includes('boat')) return 'CRUISE'
  if (a.includes('meal') || a.includes('lunch') || a.includes('dinner') || a.includes('breakfast') || a.includes('food') || a.includes('restaurant')) return 'MEALS'
  if (a.includes('water') || a.includes('kayak') || a.includes('snorkel') || a.includes('dive') || a.includes('swim')) return 'WATER'
  if (a.includes('guide') || a.includes('tour') || a.includes('walk') || a.includes('trekking') || a.includes('trip')) return 'GUIDES'
  if (a.includes('ticket') || a.includes('entrance') || a.includes('admission') || a.includes('pass') || a.includes('cable car')) return 'TICKETS'
  if (a.includes('tax') || a.includes('fee') || a.includes('visa') || a.includes('insurance')) return 'TAX_FEES'
  return 'OTHER'
}

export interface PNLImportResult {
  paxAdults: number
  paxChildren: number
  lineItems: {
    activity: string
    category: string
    mmtRate: number
    sicRate: number
    pvtRatePP: number
    adEntrance: number
    chEntrance: number
    otherRate: number
  }[]
}

export function parsePNLXlsx(buffer: Buffer): PNLImportResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as (string | number)[][]

  let paxAdults = 2
  let paxChildren = 0

  // Row 1 (index 1) has pax counts in columns 9 and 10
  if (rows[1]) {
    const adults = Number(rows[1][9] ?? 0)
    const children = Number(rows[1][10] ?? 0)
    if (adults > 0) paxAdults = adults
    if (children > 0) paxChildren = children
  }

  const lineItems: PNLImportResult['lineItems'] = []

  // Rows from index 2 onwards are line items
  // Col: 0=NO, 1=Activity, 2=MMT Rate, 3=SIC Rate, 4=PVT PP, 5=AD Entrance, 6=Other, 7=CH Entrance
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    const activity = String(row[1] ?? '').trim()
    if (!activity) continue // skip empty rows

    const mmtRate = Number(row[2] ?? 0) || 0
    const sicRate = Number(row[3] ?? 0) || 0
    const pvtRatePP = Number(row[4] ?? 0) || 0
    const adEntrance = Number(row[5] ?? 0) || 0
    const otherRate = Number(row[6] ?? 0) || 0
    const chEntrance = Number(row[7] ?? 0) || 0

    // Skip fully empty cost rows
    if (mmtRate === 0 && sicRate === 0 && pvtRatePP === 0 && adEntrance === 0 && chEntrance === 0 && otherRate === 0) continue

    lineItems.push({
      activity,
      category: detectCategory(activity),
      mmtRate,
      sicRate,
      pvtRatePP,
      adEntrance,
      chEntrance,
      otherRate,
    })
  }

  return { paxAdults, paxChildren, lineItems }
}
