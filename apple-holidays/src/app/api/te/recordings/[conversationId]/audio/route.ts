import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Streams the call RECORDING (mp3) behind an AI-call conversation, proxied from
 * the voice service (/v1/call-recordings/:conversationId/audio). The voice
 * service serves it from its local store, or fetches it from ElevenLabs on
 * demand when the sync hasn't filed it yet — so a recording is playable on the
 * booking page minutes after the call ends.
 */

const TE_BASE = (
  process.env.TE_BASE_URL ??
  'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')

const RECORDINGS_BASE =
  process.env.TE_RECORDINGS_BASE_URL ?? TE_BASE.replace(/\/traveller-experience$/, '/call-recordings')

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { conversationId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conv = String(params.conversationId ?? '').trim()
  if (!conv) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  try {
    const res = await fetch(`${RECORDINGS_BASE}/${encodeURIComponent(conv)}/audio`, { cache: 'no-store' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: text || `Recording not available (${res.status})` },
        { status: res.status === 404 ? 404 : 502 },
      )
    }
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'audio/mpeg',
        'Content-Disposition': `inline; filename="${conv}.mp3"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
