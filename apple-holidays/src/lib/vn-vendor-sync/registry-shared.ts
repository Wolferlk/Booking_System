/**
 * VN Vendor Register — types and small helpers. Safe to import from the browser.
 *
 * The desk's Excel only carries a vendor NAME. The register is where the
 * Vietnam team keeps each vendor's number, so the guest Day Plan can give the
 * guest a number to call instead of a bare name. Server side: ./registry.ts.
 */

/** `system_settings` key holding Excel-name → vendor links (no new table needed). */
export const VENDOR_ALIAS_SETTING = 'vn_vendor_aliases'

export interface VendorAlias {
  alias: string
  vendorId: string
  by: string | null
  at: string
}

/** How an Excel vendor name stands against the register. */
export type ExcelVendorState =
  | 'READY'        // resolves to a registered vendor that has a number
  | 'NO_NUMBER'    // registered, but no number yet
  | 'TRANSPORT'    // only a transport vendor matches; its number is used
  | 'AMBIGUOUS'    // fits more than one registered vendor equally
  | 'NEW'          // not in the register at all

export const EXCEL_STATE: Record<ExcelVendorState, { label: string; hint: string; pill: string }> = {
  READY:     { label: 'Has number',   hint: 'Guests get this number in the Day Plan',                 pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  TRANSPORT: { label: 'Via transport', hint: 'Matched a transport vendor — its number is used',        pill: 'bg-sky-50 text-sky-700 ring-sky-200' },
  NO_NUMBER: { label: 'No number',    hint: 'Registered, but guests only see the name',                pill: 'bg-amber-50 text-amber-700 ring-amber-200' },
  AMBIGUOUS: { label: 'Unclear',      hint: 'Fits more than one registered vendor — link it to one',  pill: 'bg-orange-50 text-orange-700 ring-orange-200' },
  NEW:       { label: 'Not registered', hint: 'Guests only see the name until it is registered',      pill: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export interface VendorSuggestion {
  id: string
  name: string
  phone: string | null
  source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR'
  score: number
}

export interface ExcelVendorRow {
  /** Exactly as typed in the Excel VENDORS column (the most common spelling). */
  excelName: string
  /** Other spellings of the same cell value seen in the sheet. */
  spellings: string[]
  /** The cell with any phone number taken out — what to register it as. */
  cleanName: string
  /** A number typed into the Excel cell itself, if any (pre-fills the form). */
  phoneInCell: string | null
  lines: number
  tours: number
  /** Upcoming movements whose tour vendor is this name. */
  movements: number
  nextDate: string | null
  sampleLine: string | null
  state: ExcelVendorState
  vendor: { id: string; name: string; phone: string | null; source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR'; viaAlias: boolean } | null
  suggestions: VendorSuggestion[]
}

export interface RegisteredVendorRow {
  id: string
  name: string
  phone: string | null
  whatsappPhone: string | null
  phoneSource: 'REGISTERED' | 'MESSAGE_HISTORY' | 'NONE'
  aliases: string[]
  /** Upcoming movements that resolve to this vendor. */
  movements: number
  /** …of which already carry a number on the movement. */
  movementsWithPhone: number
  services: string | null
  updatedAt: string
}

export interface VendorRegisterPayload {
  excel: ExcelVendorRow[]
  vendors: RegisteredVendorRow[]
  coverage: {
    excelNames: number
    excelReady: number
    /** Upcoming VN movements that name a tour vendor. */
    movements: number
    /** …that will show a number to the guest (stored, or found in the register). */
    movementsWithNumber: number
  }
  canEdit: boolean
}

/** Pull a phone-looking run of digits out of free text. */
export function findPhoneInText(s: string | null | undefined): string | null {
  const m = String(s ?? '').match(/(?:\+|00)?\d[\d\s.\-()]{7,}\d/)
  if (!m) return null
  const digits = m[0].replace(/[^\d]/g, '')
  return digits.length >= 8 && digits.length <= 15 ? m[0].trim() : null
}

/** The cell without its phone number and the punctuation around it. */
export function stripPhone(s: string): string {
  const p = findPhoneInText(s)
  const out = p ? s.replace(p, ' ') : s
  return out.replace(/\b(sdt|sđt|tel|phone|mob|mobile|hp|zalo|whatsapp|wa)\b\s*[:.]?/gi, ' ')
    .replace(/[\s,;:/\-–()]+$/g, '').replace(/^[\s,;:/\-–()]+/g, '').replace(/\s+/g, ' ').trim()
}

/** Light client-side check; the server normalises properly. */
export function looksLikePhone(s: string): boolean {
  const d = s.replace(/[^\d]/g, '')
  return d.length >= 8 && d.length <= 15
}

/** "Line 1 \n Line 2" pasted from Excel/WhatsApp → [{ name, phone }]. */
export function parsePastedVendors(text: string): { name: string; phone: string | null }[] {
  const out: { name: string; phone: string | null }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(/\t|;|\|/).map(p => p.trim()).filter(Boolean)
    let name: string, phone: string | null
    if (parts.length >= 2) {
      const pi = parts.findIndex(p => looksLikePhone(p) && !/[a-z]{3,}/i.test(p))
      phone = pi >= 0 ? parts[pi] : findPhoneInText(line)
      name = parts.filter((_, i) => i !== pi).join(' ').trim()
      if (pi < 0 && phone) name = stripPhone(name)
    } else {
      phone = findPhoneInText(line)
      name = stripPhone(line.replace(/,\s*$/, ''))
    }
    name = name.replace(/,+$/, '').trim()
    if (name) out.push({ name, phone })
  }
  return out
}
