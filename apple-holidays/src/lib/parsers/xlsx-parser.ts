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
