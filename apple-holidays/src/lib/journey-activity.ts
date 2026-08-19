/**
 * The brief behind a Journey Map pin: a short researched write-up of a place
 * plus real photographs of it.
 *
 * Shared by the operations route and the traveller-portal route so the two can
 * never drift. The only thing that differs between them is `audience`, which
 * decides who the practical notes are written for — a file handler wants to
 * know what guests complain about, a guest wants to know what to bring.
 *
 * Read only: nothing here touches booking data.
 */
import openai, { logAiUsage, findPlacePhotos } from '@/lib/openai'

export type BriefAudience = 'staff' | 'guest'

export interface ActivityBrief {
  place: string
  headline: string
  summary: string
  highlights: string[]
  bestTime: string | null
  tips: string[]
  images: string[]
}

const MODEL = () => process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini'

const TIPS_LINE: Record<BriefAudience, string> = {
  staff: '"tips": ["2-3 practical operator notes: timing, dress code, queues, weather, what guests complain about"]',
  guest: '"tips": ["2-3 friendly traveller tips: what to wear or bring, when to go, what not to miss"]',
}

function prompt(audience: BriefAudience) {
  const voice = audience === 'guest'
    ? `You are writing for the traveller themselves, in warm second person ("you"). Be inviting but never breathless.`
    : `You are briefing a tour operator's staff. Be factual and operational.`

  return `You are a destination expert. ${voice}

Given a place and the itinerary line it appears on, write a short, vivid brief on
that place. Be concrete and specific — no filler, no marketing superlatives that
could apply to anywhere.

Reply with JSON only:
{
  "headline": "six words or fewer, evocative",
  "summary": "2-3 sentences on what the place is and why people go there",
  "highlights": ["3-5 specific things to see or do there"],
  "bestTime": "best time of day or season to visit, one short phrase, or null",
  ${TIPS_LINE[audience]}
}`
}

/** Cached by place *and* audience — the two read very differently. */
const cache = new Map<string, { at: number; data: ActivityBrief }>()
const TTL_MS = 12 * 60 * 60_000

export async function buildActivityBrief(opts: {
  place: string
  title?: string | null
  city?: string | null
  country?: string | null
  audience: BriefAudience
  bookingRef?: string | null
}): Promise<ActivityBrief> {
  const where = [opts.city, opts.country].filter(Boolean).join(', ')
  const subject = where ? `${opts.place}, ${where}` : opts.place
  const key = `${opts.audience}|${subject}`.toLowerCase()

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  // The write-up and the photo hunt are independent — running them together
  // is the difference between a card that fills in once and one that stutters.
  const [brief, images] = await Promise.all([
    (async (): Promise<Record<string, unknown>> => {
      try {
        const res = await openai.chat.completions.create({
          model: MODEL(),
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt(opts.audience) },
            {
              role: 'user',
              content: `Place: ${subject}\nItinerary line: ${(opts.title ?? '').slice(0, 400)}`,
            },
          ],
        })
        await logAiUsage({
          callType: `journey_map_activity_${opts.audience}`,
          model: MODEL(),
          usage: res.usage,
          bookingRef: opts.bookingRef ?? null,
          source: opts.audience === 'guest' ? 'portal' : 'booking',
        })
        return JSON.parse(res.choices[0]?.message?.content ?? '{}')
      } catch (e) {
        console.warn('[journey-activity] brief failed:', (e as Error).message)
        return {}
      }
    })(),
    findPlacePhotos(subject, 5).catch(() => [] as string[]),
  ])

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const list = (v: unknown, n: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, n) : []

  const data: ActivityBrief = {
    place: subject,
    headline: str(brief.headline) ?? opts.place,
    summary: str(brief.summary) ?? '',
    highlights: list(brief.highlights, 5),
    bestTime: str(brief.bestTime),
    tips: list(brief.tips, 3),
    images,
  }

  // Only cache something worth reusing. An empty brief is usually a transient
  // model failure, and the next open should get a real retry rather than the
  // failure frozen in for twelve hours.
  if (data.summary || data.images.length) cache.set(key, { at: Date.now(), data })

  return data
}
