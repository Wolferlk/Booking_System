import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { openAiToolSpecs } from '@/lib/ops-ai/registry'
import { buildSystemPrompt } from '@/lib/ops-ai/brain'
import { bookingRefFromPath, loadBookingSnapshot, type OpsActor } from '@/lib/ops-ai/context'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview'
const VOICE = process.env.OPENAI_REALTIME_VOICE || 'alloy'

// How the spoken agent should differ from the typed one. The security posture is
// identical — it still cannot execute a write — but it is talking out loud, so it
// must be brief, and it must never *claim* a change was made: every write becomes
// a confirmation card the operator taps in the panel.
const VOICE_ADDENDUM = `
# You are now speaking out loud

You are OPS_AI in voice mode. Everything above still holds, with these additions:

- Keep spoken replies to one or two short sentences. No lists, no markdown, no reference numbers read digit-by-digit unless asked.
- You may call read capabilities freely to look things up and answer aloud.
- When the operator asks for a change, still call the matching write/navigate capability. It will NOT run — it is turned into a confirmation card in the panel that the operator taps to approve. Say briefly what you've queued, e.g. "I've put that change up for you to confirm."
- Never say a change has been made or saved. You propose; the operator confirms.
- If you cannot find a booking or the request is genuinely ambiguous, ask one short clarifying question.
`.trim()

/** Realtime wants a flat tool shape, not the chat-completions nested one. */
function realtimeTools() {
  return openAiToolSpecs().map(t => ({
    type: 'function' as const,
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))
}

/**
 * Mints a short-lived ephemeral credential for a browser WebRTC session with the
 * OpenAI Realtime API.
 *
 * The instructions, tool list and voice are all fixed here on the server — the
 * browser receives only a throwaway token scoped to this one session, never the
 * real API key, and cannot widen the agent's toolset. Writes proposed over the
 * voice channel are resolved through /api/ops-ai/realtime/tool, which signs them
 * into the same confirmation cards the typed copilot uses.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return buildApiError('OPS_AI is not configured — OPENAI_API_KEY is missing.', 503)

  const body = await req.json().catch(() => null)
  const pathname   = typeof body?.pathname === 'string' ? body.pathname : undefined
  const bookingRef = (typeof body?.bookingRef === 'string' && body.bookingRef) || bookingRefFromPath(pathname)

  const actor: OpsActor = {
    userId:    session.user.id,
    name:      session.user.name ?? 'Operator',
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const snapshot = bookingRef ? await loadBookingSnapshot(bookingRef.toUpperCase(), actor) : null
  const instructions = `${buildSystemPrompt(actor, snapshot, pathname)}\n\n---\n\n${VOICE_ADDENDUM}`

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: VOICE,
        instructions,
        tools: realtimeTools(),
        tool_choice: 'auto',
        input_audio_transcription: { model: 'whisper-1' },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      let apiMsg = ''
      try { apiMsg = JSON.parse(detail)?.error?.message ?? '' } catch { /* non-JSON body */ }
      console.error('[OPS_AI] realtime session mint failed:', res.status, detail.slice(0, 500))

      // Surface OpenAI's real reason — it distinguishes "no Realtime access on this
      // project" from "that model name isn't available" from "bad key", which the
      // old catch-all message hid.
      const base =
        res.status === 401 ? 'OpenAI rejected the API key'
        : res.status === 403 ? 'This OpenAI project does not have Realtime API access'
        : res.status === 404 ? `The Realtime model "${REALTIME_MODEL}" is not available to this project`
        : 'Could not start a voice session'
      return buildApiError(apiMsg ? `${base}: ${apiMsg}` : `${base}.`, 502)
    }

    const data = await res.json()
    // Return only what the browser needs: the ephemeral secret and the model.
    return buildApiSuccess({
      clientSecret: data?.client_secret?.value ?? null,
      expiresAt:    data?.client_secret?.expires_at ?? null,
      model:        REALTIME_MODEL,
      bookingRef:   snapshot?.bookingRef ?? bookingRef ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OPS_AI] realtime session error:', msg)
    return buildApiError('Could not start a voice session.', 502)
  }
}
