/**
 * Server-side helpers for the printed-ticket routes: clean what the print
 * dialog sends back, and find the artwork.
 *
 * The dialog lets the desk correct anything before printing, so the ticket
 * data arrives from the browser — it is re-typed field by field here, capped
 * in length and count, and only then drawn (render.ts escapes every value).
 * Nothing is stored: a printed ticket is a document, not a record.
 */
import { readFile } from 'fs/promises'
import path from 'path'
import type { TicketAssets } from './render'
import { cityForAirport } from './airports'
import { DEFAULT_PRINT_OPTIONS, type FlightTicketData, type TicketPoint, type TicketPrintOptions } from './types'

const s = (v: unknown, max = 120): string | null => {
  const t = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : ''
  return t ? t.slice(0, max) : null
}
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)
const time = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : null)
const code = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) : '')

function cleanPoint(v: unknown): TicketPoint {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const c = code(o.code)
  return { code: c, airport: s(o.airport, 90), city: s(o.city, 40) ?? cityForAirport(c), time: time(o.time), date: date(o.date) }
}

export function sanitizeTicketData(input: unknown): FlightTicketData {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const contact = (o.contact && typeof o.contact === 'object' ? o.contact : {}) as Record<string, unknown>

  return {
    orderId: s(o.orderId, 20),
    bookingRef: s(o.bookingRef, 12)?.toUpperCase() ?? null,
    airlinePnr: s(o.airlinePnr, 12)?.toUpperCase() ?? null,
    status: s(o.status, 20)?.toUpperCase() ?? null,
    issuedOn: date(o.issuedOn),
    passengers: arr(o.passengers).slice(0, 30).map((p) => {
      const q = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      const et = s(q.eticket, 20)?.replace(/[\s-]/g, '') ?? null
      return { name: s(q.name, 60) ?? '', type: s(q.type, 12), eticket: et && /^\d{10,14}$/.test(et) ? et : null }
    }).filter((p) => p.name),
    segments: arr(o.segments).slice(0, 8).map((g) => {
      const q = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>
      return {
        airline: s(q.airline, 40), flightNo: s(q.flightNo, 12)?.toUpperCase() ?? null, cabin: s(q.cabin, 20), status: s(q.status, 20),
        from: cleanPoint(q.from), to: cleanPoint(q.to), duration: s(q.duration, 12),
        checkedBaggage: s(q.checkedBaggage, 30), cabinBaggage: s(q.cabinBaggage, 30), meal: s(q.meal, 30),
      }
    }).filter((g) => g.from.code && g.to.code),
    contact: { phone: s(contact.phone, 30), email: s(contact.email, 80) },
    refundable: s(o.refundable, 20),
    dateChange: s(o.dateChange, 20),
    source: o.source === 'aahaas-eticket' || o.source === 'eticket-pdf' || o.source === 'store' ? o.source : 'manual',
    warnings: [],
  }
}

export function sanitizePrintOptions(input: unknown): TicketPrintOptions {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const mm = (v: unknown) => Math.max(-8, Math.min(8, Math.round((Number(v) || 0) * 10) / 10))
  return {
    flip: o.flip === 'short' ? 'short' : 'long',
    backOffsetX: mm(o.backOffsetX),
    backOffsetY: mm(o.backOffsetY),
    cropMarks: o.cropMarks === undefined ? DEFAULT_PRINT_OPTIONS.cropMarks : o.cropMarks === true,
    perSegment: o.perSegment === undefined ? DEFAULT_PRINT_OPTIONS.perSegment : o.perSegment === true,
  }
}

const ASSET_FILES = {
  front: ['ticket-art/front.jpg', 'image/jpeg'],
  back: ['ticket-art/back.jpg', 'image/jpeg'],
  logo: ['png/aahaas.png', 'image/png'],
  mark: ['png/aahaslogo.png', 'image/png'],
} as const

let cached: Omit<TicketAssets, never> | null = null

/**
 * Artwork as data URIs, so headless Chromium needs no network to draw it.
 * Where the bundle has no `public/` on disk (serverless), the site's own URL
 * for the same file is used instead.
 */
export async function ticketAssets(origin: string): Promise<TicketAssets> {
  if (cached) return cached
  const entries = await Promise.all(Object.entries(ASSET_FILES).map(async ([key, [file, type]]) => {
    try {
      const buf = await readFile(path.join(process.cwd(), 'public', file))
      return [key, `data:${type};base64,${buf.toString('base64')}`, true] as const
    } catch {
      return [key, `${origin.replace(/\/+$/, '')}/${file}`, false] as const
    }
  }))
  const assets = Object.fromEntries(entries.map(([k, v]) => [k, v])) as unknown as TicketAssets
  // Only a full set read from disk is worth keeping for the next request.
  if (entries.every(([, , fromDisk]) => fromDisk)) cached = assets
  return assets
}
