import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import openai from '@/lib/openai'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json() as {
    date?: string
    location?: string
    fromPoint?: string
    toPoint?: string
    meetingTime?: string
    serviceType?: string
  }

  const { date, location, fromPoint, toPoint, meetingTime, serviceType } = body

  const prompt = `You are a travel operations assistant. Generate a concise, professional one-paragraph description of the pickup and drop-off schedule for the following tour movement item. Include specific times, locations, and any relevant transfer notes. Keep it under 60 words.

Movement details:
- Date: ${date ?? 'Not specified'}
- Location / City: ${location ?? 'Not specified'}
- Pickup from: ${fromPoint ?? 'Not specified'}
- Drop-off at / Activity: ${toPoint ?? 'Not specified'}
- Meeting time: ${meetingTime ?? 'Not specified'}
- Service type: ${serviceType ?? 'OWN_ARRANGEMENT'}

Write only the description text, no labels or headings.`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 120,
    temperature: 0.4,
  })

  const description = completion.choices[0]?.message?.content?.trim() ?? ''
  return buildApiSuccess({ description })
}
