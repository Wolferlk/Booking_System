import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import openai from '@/lib/openai'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Whisper is universally available on any OpenAI key; gpt-4o-transcribe gives
// better accuracy where the account has access. Override with OPENAI_TRANSCRIBE_MODEL.
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'

// A dictated composer line is short. Cap the upload so a stuck recorder can't
// stream minutes of audio at us.
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Voice-to-text for the OPS_AI composer.
 *
 * Takes a short audio clip recorded in the browser and returns its transcript.
 * This never plans or executes anything — the text lands in the composer exactly
 * as if the operator had typed it, so the plan → approve → execute flow is
 * completely untouched.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  if (!process.env.OPENAI_API_KEY) {
    return buildApiError('OPS_AI is not configured — OPENAI_API_KEY is missing.', 503)
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('audio')
  if (!(file instanceof File)) return buildApiError('No audio was received.')
  if (file.size === 0) return buildApiError('The recording was empty.')
  if (file.size > MAX_BYTES) return buildApiError('That recording is too long.')

  try {
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: MODEL,
      // English-first operation; drop this to let the model auto-detect.
      language: process.env.OPENAI_TRANSCRIBE_LANG || 'en',
    })

    const text = (transcription.text ?? '').trim()
    return buildApiSuccess({ text })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OPS_AI] transcribe failed:', msg)
    return buildApiError(`Could not transcribe that: ${msg}`, 502)
  }
}
