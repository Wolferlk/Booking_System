/**
 * Fill a freshly generated movement chart with the confirmation's official
 * descriptions — the same result as opening "Confirmation Descriptions" on the
 * agenda screen and pressing Replace with the default ticks.
 *
 *   - Source: the AppleSystem quote (same read as
 *     `api/bookings/[ref]/agenda/source-description`). When AppleSystem has no
 *     quote for the ref or cannot be reached, the booking's own itinerary rows
 *     (extracted from the same confirmation) are used instead.
 *   - Matching: `matchSourceDescriptions` — identical to the modal.
 *   - Only "exact" / "good" matches are written; "Please check" pairs and
 *     movements with no entry keep the generated text, exactly as the modal
 *     leaves them unticked.
 *
 * Read-only against AppleSystem. Never throws — a failure leaves the items as
 * they were, so agenda generation is never blocked by it.
 */
import { fetchQuoteForRef } from '@/lib/as-quote-lookup'
import { mapQuoteToBooking } from '@/lib/as-booking-map'
import { matchSourceDescriptions, sameDescription, type SourceEntry } from '@/lib/agenda-source-match'

const AS_TIMEOUT_MS = 20_000

type FillableItem = {
  date?: unknown
  fromPoint?: string | null
  toPoint?: string | null
  location?: string | null
  details?: string | null
}

const isoDate = (v: unknown): string => {
  if (!v) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

async function loadAppleSystemEntries(bookingRef: string): Promise<SourceEntry[]> {
  const read = (async () => {
    const { quote } = await fetchQuoteForRef(bookingRef)
    const mapped = mapQuoteToBooking(quote as unknown as Record<string, unknown>, { fallbackIsNumber: bookingRef })
    return mapped.itineraryItems.map(i => ({ dayNo: i.dayNo, date: String(i.date ?? '').slice(0, 10), title: i.title, description: i.description ?? undefined }))
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`AppleSystem did not answer within ${AS_TIMEOUT_MS / 1000}s`)), AS_TIMEOUT_MS)
  })
  try {
    return await Promise.race([read, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function fillConfirmationDescriptions<T extends FillableItem>(
  bookingRef: string,
  items: T[],
  opts: {
    arrivalDate?: unknown
    /** The booking's stored itinerary — used when AppleSystem has nothing. */
    fallback?: { dayNo?: number | null; date?: unknown; title?: string | null; description?: string | null }[]
  } = {},
): Promise<{ items: T[]; replaced: number; source: 'applesystem' | 'booking' | 'none' }> {
  if (!items.length) return { items, replaced: 0, source: 'none' }

  let entries: SourceEntry[] = []
  let source: 'applesystem' | 'booking' | 'none' = 'none'
  try {
    entries = await loadAppleSystemEntries(bookingRef)
    if (entries.some(e => e.description?.trim())) source = 'applesystem'
  } catch (err) {
    console.warn(`[agenda/confirmation-fill] ${bookingRef}: AppleSystem read failed — ${err instanceof Error ? err.message : err}`)
  }
  if (source === 'none' && opts.fallback?.length) {
    entries = opts.fallback.map(f => ({
      dayNo: f.dayNo ?? undefined,
      date: isoDate(f.date),
      title: f.title ?? undefined,
      description: f.description ?? undefined,
    }))
    if (entries.some(e => e.description?.trim())) source = 'booking'
  }
  if (source === 'none') return { items, replaced: 0, source }

  try {
    const matchable = items.map(it => ({
      date: isoDate(it.date),
      fromPoint: String(it.fromPoint ?? ''),
      toPoint: String(it.toPoint ?? ''),
      location: String(it.location ?? ''),
    }))
    const { byItem } = matchSourceDescriptions(matchable, entries, isoDate(opts.arrivalDate) || null)
    let replaced = 0
    const out = items.map((it, idx) => {
      const m = byItem.get(idx)
      if (!m || m.confidence === 'check' || sameDescription(m.description, it.details)) return it
      replaced++
      return { ...it, details: m.description }
    })
    return { items: out, replaced, source }
  } catch (err) {
    console.warn(`[agenda/confirmation-fill] ${bookingRef}: matching failed — ${err instanceof Error ? err.message : err}`)
    return { items, replaced: 0, source }
  }
}
