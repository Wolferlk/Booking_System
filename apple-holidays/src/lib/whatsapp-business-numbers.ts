/**
 * The Aahaas WhatsApp business numbers. They all share one WABA and therefore
 * one webhook (owned by n8n), so customer replies on ANY of them reach the
 * shared store this inbox imports from. The inbox uses this list to tell the
 * desk which number a chat is on, and to filter by it.
 *
 * OPS itself only ever SENDS from Aahaas Operations (WHATSAPP_PHONE_NUMBER_ID).
 *
 * Pure data — safe to import from client components.
 */

export type BusinessNumberKey = 'ops' | 'aahaas' | 'apple' | 'singapore' | 'supplier' | 'other'

export interface BusinessNumber {
  key: BusinessNumberKey
  /** Meta phone_number_id. Empty for the catch-all bucket. */
  id: string
  label: string
  short: string
  display: string
  /** Tailwind classes for the small chip on a chat row. */
  tone: string
}

export const BUSINESS_NUMBERS: BusinessNumber[] = [
  { key: 'ops',       id: '1270807392778665', label: 'Aahaas Operations',      short: 'Operations', display: '+94 70 722 4229', tone: 'bg-emerald-100 text-emerald-700' },
  { key: 'aahaas',    id: '1137601392765411', label: 'Aahaas (B2C)',           short: 'Aahaas',     display: '+94 70 360 7752', tone: 'bg-sky-100 text-sky-700' },
  { key: 'apple',     id: '1138491826025004', label: 'Apple Holidays (India)', short: 'Apple',      display: '+91 95852 22043', tone: 'bg-rose-100 text-rose-700' },
  { key: 'singapore', id: '1136706852865216', label: 'Aahaas Singapore',       short: 'Singapore',  display: '+65 8220 2603',   tone: 'bg-amber-100 text-amber-800' },
  { key: 'supplier',  id: '1257503577439373', label: 'Aahaas Supplier',        short: 'Supplier',   display: '+94 71 567 5347', tone: 'bg-violet-100 text-violet-700' },
  { key: 'other',     id: '',                 label: 'Number not known',       short: 'Unknown',    display: '',                tone: 'bg-slate-200 text-slate-600' },
]

export const DEFAULT_BUSINESS_NUMBER: BusinessNumberKey = 'ops'

const BY_ID = new Map(BUSINESS_NUMBERS.filter(n => n.id).map(n => [n.id, n.key]))
const BY_KEY = new Map(BUSINESS_NUMBERS.map(n => [n.key, n]))

/** Meta phone_number_id → bucket. Unlisted or empty ids land in 'other'. */
export function businessKeyForId(id: string | null | undefined): BusinessNumberKey {
  return (id && BY_ID.get(String(id).trim())) || 'other'
}

export function businessNumber(key: BusinessNumberKey): BusinessNumber {
  return BY_KEY.get(key) ?? BY_KEY.get('other')!
}
