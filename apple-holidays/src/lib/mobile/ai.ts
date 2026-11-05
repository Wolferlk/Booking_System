/**
 * Driver App — the two places OpenAI helps a driver:
 *
 *   reviewVehiclePhotos  a first look at the 2-monthly vehicle photos (is it
 *                        the right angle, is it clean, any visible damage,
 *                        does the plate match). Advisory only — a person in
 *                        ops still approves or rejects.
 *   dayBriefing          a short, friendly spoken-style summary of today's
 *                        plan, in the driver's language (English / Sinhala /
 *                        Tamil / Vietnamese).
 *
 * Both log to AiUsageLog via logAiUsage like every other AI call, and both
 * fail soft: no key / no credit just means no AI note.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { getUpload } from '@/lib/storage'
import type { TripDayPlan } from './trips'

const VISION_MODEL = process.env.MOBILE_AI_VISION_MODEL?.trim() || 'gpt-4o-mini'
const TEXT_MODEL = process.env.MOBILE_AI_TEXT_MODEL?.trim() || 'gpt-4o-mini'

export interface VehicleAiReview {
  verdict: 'LOOKS_GOOD' | 'CHECK' | 'RETAKE'
  summary: string
  issues: string[]
  plateSeen: string | null
  plateMatches: boolean | null
  cleanliness: 'CLEAN' | 'OK' | 'DIRTY' | null
  model: string
}

export async function reviewVehiclePhotos(
  photos: Record<string, string>,
  vehicle: { plateNo?: string | null; brand?: string | null; model?: string | null; type?: string | null } | null,
): Promise<VehicleAiReview | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const images: { label: string; dataUrl: string }[] = []
    for (const [label, url] of Object.entries(photos)) {
      const rel = url.replace(/^\/api\/uploads\//, '')
      const file = await getUpload(rel)
      if (!file) continue
      images.push({ label, dataUrl: `data:${file.contentType};base64,${file.buffer.toString('base64')}` })
    }
    if (!images.length) return null

    const expected = [vehicle?.brand, vehicle?.model, vehicle?.type].filter(Boolean).join(' ') || 'unknown'
    const res = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You check tour-vehicle photos a driver submits every two months for a travel company. ' +
            'Be practical and brief. Reply as JSON: {"verdict":"LOOKS_GOOD"|"CHECK"|"RETAKE","summary":string (max 2 sentences, simple English),' +
            '"issues":string[] (each max 12 words),"plateSeen":string|null,"cleanliness":"CLEAN"|"OK"|"DIRTY"|null}. ' +
            'RETAKE = a photo is blurry, too dark, the wrong angle, or not a vehicle. CHECK = visible damage, dirty interior, or plate mismatch. ' +
            'Never invent damage you cannot see.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Registered vehicle: ${expected}. Registered plate: ${vehicle?.plateNo ?? 'unknown'}. Photos (in order): ${images.map(i => i.label).join(', ')}.` },
            ...images.map(i => ({ type: 'image_url' as const, image_url: { url: i.dataUrl, detail: 'low' as const } })),
          ],
        },
      ],
    })
    await logAiUsage({ callType: 'mobileVehicleCheck', model: VISION_MODEL, usage: res.usage, source: 'driver-app' })
    const j = JSON.parse(res.choices[0]?.message?.content || '{}') as Partial<VehicleAiReview>
    const norm = (s: string | null | undefined) => (s ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
    const plateSeen = j.plateSeen?.trim() || null
    return {
      verdict: j.verdict === 'LOOKS_GOOD' || j.verdict === 'RETAKE' ? j.verdict : 'CHECK',
      summary: String(j.summary ?? '').slice(0, 400),
      issues: Array.isArray(j.issues) ? j.issues.map(String).slice(0, 8) : [],
      plateSeen,
      plateMatches: plateSeen && vehicle?.plateNo ? norm(vehicle.plateNo).endsWith(norm(plateSeen).slice(-4)) : null,
      cleanliness: j.cleanliness ?? null,
      model: VISION_MODEL,
    }
  } catch (err) {
    console.error('[mobile ai] vehicle review failed:', (err as Error).message)
    return null
  }
}

const LANG_NAME: Record<string, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil', vi: 'Vietnamese' }

export async function dayBriefing(params: {
  driverName: string
  language: string
  fileNo: string
  leadGuest: string | null
  pax: { adults: number; children: number }
  day: TripDayPlan
  dayCount: number
  specialNotes: string | null
}): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const { day } = params
  const facts = {
    driver: params.driverName.split(/\s+/)[0],
    file: params.fileNo,
    guest: params.leadGuest,
    pax: params.pax,
    day: `Day ${day.dayNo} of ${params.dayCount}`,
    movements: day.movements.filter(m => m.mine).map(m => ({
      time: m.time, from: m.from, to: m.to, place: m.location, details: m.details?.slice(0, 300), meal: m.mealPlan, freeDay: m.noDriverNeeded,
    })),
    hotelTonight: day.hotel,
    flights: day.flights,
    specialOccasions: params.specialNotes,
  }
  try {
    const res = await openai.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0.4,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content:
            `You brief a tour driver on their day. Write in ${LANG_NAME[params.language] ?? 'English'}, ` +
            'warm and simple, max 6 short lines. Start with the first pickup time and place. Mention flights, hotel tonight and any special occasion. ' +
            'End with one practical tip (traffic, timing, guest comfort). Use only the facts given; never invent times or places. No markdown headings.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    })
    await logAiUsage({ callType: 'mobileDayBriefing', model: TEXT_MODEL, usage: res.usage, bookingRef: params.fileNo, source: 'driver-app' })
    return res.choices[0]?.message?.content?.trim() || null
  } catch (err) {
    console.error('[mobile ai] briefing failed:', (err as Error).message)
    return null
  }
}
