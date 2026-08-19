/**
 * POST /api/bookings/:ref/journey-map/activity
 *
 * The detail card behind a pin on the Journey Map: a short live-researched
 * brief on the place plus real photographs of it. Read only — nothing here
 * touches booking data; the response is cached in process memory by place name
 * so re-opening the same pin (or the same place on another file) is instant.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import openai, { logAiUsage, findPlacePhotos } from '@/lib/openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ActivityBrief {
  place: string
  headline: string
  summary: string
  highlights: string[]
  bestTime: string | null
  tips: string[]
  images: string[]
}

const cache = new Map<string, { at: number; data: ActivityBrief }>()
const TTL_MS = 12 * 60 * 60_000

const PROMPT = `You are a destination expert briefing a tour operator's staff.

Given a place and the itinerary line it appears on, write a short, factual,
vivid brief on that place. Be concrete and specific to the place — no filler,
no marketing superlatives that could apply anywhere.

Reply with JSON only:
{
  "headline": "six words or fewer, evocative",
  "summary": "2-3 sentences on what the place is and why guests go there",
  "highlights": ["3-5 specific things to see or do there"],
  "bestTime": "best time of day or season to visit, one short phrase, or null",
  "tips": ["2-3 practical operator tips: timing, dress code, queues, weather, what guests complain about"]
}`

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({})) as {
    place?: string; title?: string; city?: string; country?: string
  }
  const place = (body.place ?? '').trim()
  if (!place) return buildApiError('A place is required', 400)

  const where = [body.city, body.country].filter(Boolean).join(', ')
  const subject = where ? `${place}, ${where}` : place
  const key = subject.toLowerCase()

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return buildApiSuccess({ ...hit.data, cached: true })
  }

  // The brief and the photo hunt are independent — run them together so the
  // popup fills in one round trip rather than two sequential model calls.
  const [brief, images] = await Promise.all([
    (async () => {
      try {
        const res = await openai.chat.completions.create({
          model: process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini',
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: PROMPT },
            {
              role: 'user',
              content: `Place: ${subject}\nItinerary line: ${(body.title ?? '').slice(0, 400)}`,
            },
          ],
        })
        await logAiUsage({
          callType: 'journey_map_activity',
          model: process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini',
          usage: res.usage,
          bookingRef: params.ref,
          source: 'booking',
        })
        return JSON.parse(res.choices[0]?.message?.content ?? '{}')
      } catch (e) {
        console.warn('[journey-activity] brief failed:', (e as Error).message)
        return {}
      }
    })(),
    findPlacePhotos(subject, 5).catch(() => [] as string[]),
  ])

  const data: ActivityBrief = {
    place: subject,
    headline: typeof brief.headline === 'string' ? brief.headline : place,
    summary: typeof brief.summary === 'string' ? brief.summary : '',
    highlights: Array.isArray(brief.highlights) ? brief.highlights.filter((h: unknown) => typeof h === 'string').slice(0, 5) : [],
    bestTime: typeof brief.bestTime === 'string' ? brief.bestTime : null,
    tips: Array.isArray(brief.tips) ? brief.tips.filter((t: unknown) => typeof t === 'string').slice(0, 3) : [],
    images,
  }

  // Only cache a result worth reusing — an empty brief usually means a
  // transient model failure, and we want the next open to retry it.
  if (data.summary || data.images.length) cache.set(key, { at: Date.now(), data })

  return buildApiSuccess(data)
}
