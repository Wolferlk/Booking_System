/**
 * The GlobalTix and Cebu catalogues, read through Main Backend.
 *
 * Amplify gives each request a short-lived Lambda, so a memory cache alone would
 * re-walk GlobalTix's pages on most page opens; the trimmed lists are also kept
 * in `ticket_portal_cache`. Failed or empty reads are never cached.
 */
import { prisma } from '@/lib/prisma'
import openai, { logAiUsage } from '@/lib/openai'
import { backendGet } from './backend'
import {
  shapeCebuOptions, shapeGlobaltixOptions, str, num, r2, type PortalOption, type Provider,
} from './shapes'

export interface CatalogProduct {
  provider: Provider
  id: string
  name: string
  city: string | null
  image: string | null
}

const CATALOG_TTL = 6 * 3_600_000
const OPTIONS_TTL = 3_600_000
const memory = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, ttl: number, fresh: boolean, work: () => Promise<T>, keep: (v: T) => boolean): Promise<T> {
  if (!fresh) {
    const hit = memory.get(key)
    if (hit && Date.now() - hit.at < ttl) return hit.value as T
    try {
      const row = await prisma.ticketPortalCache.findUnique({ where: { cacheKey: key } })
      if (row && Date.now() - row.fetchedAt.getTime() < ttl) {
        const value = JSON.parse(row.value) as T
        memory.set(key, { at: row.fetchedAt.getTime(), value })
        return value
      }
    } catch { /* the cache is an optimisation; read the portal instead */ }
  }
  const value = await work()
  if (keep(value)) {
    memory.set(key, { at: Date.now(), value })
    if (memory.size > 300) memory.delete(memory.keys().next().value as string)
    const text = JSON.stringify(value)
    await prisma.ticketPortalCache.upsert({
      where: { cacheKey: key }, create: { cacheKey: key, value: text, fetchedAt: new Date() }, update: { value: text, fetchedAt: new Date() },
    }).catch(() => { /* optimisation only */ })
  }
  return value
}

const dataSet = (country: string, city: string | null) => JSON.stringify({
  dataSet: JSON.stringify({
    address_components: [
      ...(city ? [{ types: ['locality'], long_name: city, short_name: city }] : []),
      { types: ['country'], long_name: country, short_name: country },
    ],
  }),
})

function shapeGt(p: any): CatalogProduct {
  const c = p.city
  return {
    provider: 'globaltix',
    id: String(p.id ?? p.productId ?? p.lifestyle_id),
    name: str(p.name ?? p.title ?? p.lifestyle_name) ?? '',
    city: str(typeof c === 'object' && c ? c.name : c) ?? str(p.lifestyle_city),
    image: str(p.image_url) ?? (/^https?:\/\//i.test(str(p.image) ?? '') ? str(p.image) : null),
  }
}

/** GlobalTix's own list, then the older search route. Throws if neither gives anything. */
async function readGlobaltix(cc: string): Promise<CatalogProduct[]> {
  const out: CatalogProduct[] = []
  let failure: string | null = null
  const page = async (n: number) => {
    const res = await backendGet(`/api/globaltix/products?countryCode=${encodeURIComponent(cc)}&page=${n}`)
    return (Array.isArray(res?.data) ? res.data : []) as any[]
  }
  try {
    const first = await page(1)
    first.forEach(p => out.push(shapeGt(p)))
    // A few pages at a time: a serial walk of 25 would outlast the request.
    for (let n = 2, more = first.length >= 10; more && n <= 25; n += 6) {
      const batch = await Promise.all(Array.from({ length: 6 }, (_, i) => n + i).filter(x => x <= 25).map(page))
      batch.flat().forEach(p => out.push(shapeGt(p)))
      more = batch.every(b => b.length >= 10)
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }
  if (!out.length) {
    try {
      const res = await backendGet(`/api/lifestyles/globaltix?page=1&dataSet=${encodeURIComponent(dataSet(cc, null))}`)
      for (const p of res?.data ?? []) out.push(shapeGt(p))
    } catch (err) {
      failure = failure ?? (err instanceof Error ? err.message : String(err))
    }
  }
  if (!out.length && failure) throw new Error(failure)
  return out.filter(p => p.id && p.name)
}

async function readCebu(cc: string): Promise<CatalogProduct[]> {
  const res = await backendGet(`/api/lifestyles/cebu?dataSet=${encodeURIComponent(dataSet(cc, null))}`)
  return (res?.data ?? []).map((p: any): CatalogProduct => ({
    provider: 'cebu', id: String(p.lifestyle_id), name: str(p.lifestyle_name) ?? '', city: str(p.lifestyle_city), image: str(p.image),
  })).filter((p: CatalogProduct) => p.id && p.name)
}

export function catalog(provider: Provider, cc: string, fresh = false): Promise<CatalogProduct[]> {
  return cached(`cat|${provider}|${cc}`, CATALOG_TTL, fresh, () => (provider === 'cebu' ? readCebu(cc) : readGlobaltix(cc)), v => v.length > 0)
}

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export async function productOptions(provider: Provider, id: string, fresh = false): Promise<PortalOption[]> {
  if (!validId(id)) throw new Error('That is not a portal product id.')
  return cached(`opt|${provider}|${id}`, OPTIONS_TTL, fresh, async () => {
    const res = await backendGet(provider === 'cebu' ? `/api/cebu/product/${encodeURIComponent(id)}` : `/api/globaltix/product/${encodeURIComponent(id)}/tickets`)
    if (res?.success === false) throw new Error(`${provider === 'cebu' ? 'Cebu' : 'GlobalTix'} did not give the tickets — ${str(res?.message) ?? str(res?.error) ?? 'no reason given'}.`)
    return provider === 'cebu' ? shapeCebuOptions(res, id) : shapeGlobaltixOptions(res)
  }, v => v.length > 0)
}

/** Open time slots for one GlobalTix ticket type on one date. */
export async function globaltixSlots(ticketTypeId: string, date: string) {
  if (!/^\d{1,12}$/.test(ticketTypeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Give a ticket type and a date.')
  const res = await backendGet(`/api/globaltix/product/tickets/${ticketTypeId}/availability?date=${encodeURIComponent(date)}`)
  if (res?.success === false) throw new Error('GlobalTix did not give availability for that date.')
  const dates: any[] = Array.isArray(res?.dates) ? res.dates : []
  return (dates.find(d => d.date === date)?.timeslots ?? []) as unknown[]
}

export interface AiMatch { key: string; confidence: 'high' | 'medium' | 'low'; why: string | null; covers: number[] }

/**
 * Which shortlisted products really are this ticket, and which of the booking's
 * other tickets each also includes. Only shortlisted ids survive, and a failed
 * call returns null: the word match still stands, and the screen says so.
 */
export async function aiMatch(input: {
  ticket: string
  others: string[]
  shortlist: { key: string; name: string; city: string | null }[]
  bookingRef: string
}): Promise<AiMatch[] | null> {
  if (!input.shortlist.length) return []
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You match a travel ticket to supplier products.
Return JSON: {"matches":[{"key": a key from "shortlist" exactly as given, "confidence":"high"|"medium"|"low", "why": one short sentence, "covers":[numbers of "others" this one product also gets the traveller into]}]}
Rules: use only keys from the shortlist. Leave out any product that is a different attraction merely sharing a word. A combo covers another ticket only if its name says it includes it.`,
        },
        { role: 'user', content: JSON.stringify({ ticket: input.ticket, others: input.others.map((name, i) => ({ n: i + 1, name })), shortlist: input.shortlist }) },
      ],
    }, { timeout: 12_000, maxRetries: 0 })
    await logAiUsage({ callType: 'ticket_portal_match', model: 'gpt-4o-mini', usage: response.usage, bookingRef: input.bookingRef, source: 'ticket-portal' })
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    const allowed = new Set(input.shortlist.map(s => s.key))
    return (Array.isArray(parsed?.matches) ? parsed.matches : [])
      .filter((m: any) => allowed.has(String(m?.key)))
      .map((m: any): AiMatch => ({
        key: String(m.key),
        confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'low',
        why: str(m.why)?.slice(0, 200) ?? null,
        covers: (Array.isArray(m.covers) ? m.covers : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= input.others.length),
      }))
  } catch (err) {
    console.warn('[ticket-portal] AI match skipped:', err instanceof Error ? err.message : err)
    return null
  }
}

export { num, r2 }
