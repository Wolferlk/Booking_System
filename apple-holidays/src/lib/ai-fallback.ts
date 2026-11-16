/**
 * Gemini backup for the shared OpenAI client.
 *
 * OpenAI stays the primary provider for every call. Only when an OpenAI call
 * fails for a reason that is NOT the request's own fault — outage (5xx),
 * rate limit / quota (429), auth/billing (401/403), timeout or network error —
 * the same request is replayed against Google Gemini, and the caller receives
 * a normal OpenAI-shaped response. Callers do not change at all.
 *
 * Safety properties:
 *   - No GEMINI_API_KEY → this module does nothing; behaviour is exactly as before.
 *   - If Gemini also fails, the ORIGINAL OpenAI error is re-thrown, so existing
 *     error handling / retries in callers keep seeing what they saw before.
 *   - Bad requests (400/404/422) and caller aborts are never re-routed.
 *
 * Covered:
 *   - chat.completions.create  → Gemini OpenAI-compatible endpoint
 *   - responses.create (string input + web_search tool) → Gemini + Google Search
 * Not covered (stay OpenAI-only): audio.transcriptions, images.generate, Realtime.
 *
 * Env:
 *   GEMINI_API_KEY        required to enable the backup
 *   GEMINI_MODEL          backup for gpt-4o class models   (default gemini-3.5-flash)
 *   GEMINI_MODEL_LITE     backup for *-mini / *-nano models (default gemini-3.5-flash-lite)
 *   AI_FALLBACK_DISABLED  "true" to switch the backup off without removing the key
 */
import OpenAI from 'openai'

const GEMINI_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const DEFAULT_MODEL = 'gemini-3.5-flash'
const DEFAULT_MODEL_LITE = 'gemini-3.5-flash-lite'

// Chat-completion params Gemini's compatibility layer rejects or ignores.
const UNSUPPORTED_CHAT_PARAMS = [
  'store', 'metadata', 'logit_bias', 'user', 'service_tier', 'prediction',
  'modalities', 'audio', 'parallel_tool_calls', 'web_search_options', 'safety_identifier',
  'prompt_cache_key', 'verbosity',
] as const

function geminiKey(): string | undefined {
  if (process.env.AI_FALLBACK_DISABLED === 'true') return undefined
  const k = process.env.GEMINI_API_KEY?.trim().replace(/^"|"$/g, '')
  return k || undefined
}

let geminiClient: OpenAI | null | undefined
function getGemini(): OpenAI | null {
  if (geminiClient !== undefined) return geminiClient
  const apiKey = geminiKey()
  geminiClient = apiKey
    ? new OpenAI({ apiKey, baseURL: GEMINI_OPENAI_BASE, timeout: 120_000, maxRetries: 1 })
    : null
  return geminiClient
}

/** Models to try on Gemini, best match first, then the light model as last resort. */
function geminiModelsFor(openaiModel: unknown): string[] {
  const m = String(openaiModel ?? '').toLowerCase()
  const full = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  const lite = process.env.GEMINI_MODEL_LITE?.trim() || DEFAULT_MODEL_LITE
  const primary = /mini|nano|lite/.test(m) ? lite : full
  return Array.from(new Set([primary, lite]))
}

/** True when the failure is OpenAI's side (outage, quota, auth, network), not a bad request. */
export function isProviderFailure(err: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any
  if (!e) return false
  const name: string = e.name ?? e.constructor?.name ?? ''
  if (name === 'APIUserAbortError' || name === 'AbortError') return false
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true

  const status: number | undefined = typeof e.status === 'number' ? e.status : undefined
  if (status !== undefined) {
    return status === 401 || status === 403 || status === 408 || status === 409 ||
           status === 429 || status >= 500
  }
  // Raw network failures (fetch failed, ECONNRESET, ETIMEDOUT, DNS…)
  const msg = String(e.message ?? '')
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(msg)
}

function describe(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any
  return `${e?.status ?? e?.name ?? 'error'}: ${String(e?.message ?? err).slice(0, 160)}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toGeminiChatBody(body: any, model: string): any {
  const out = { ...body, model }
  for (const k of UNSUPPORTED_CHAT_PARAMS) delete out[k]

  // Gemini counts its thinking tokens against the output cap; give headroom so
  // JSON answers are not cut off, and keep thinking light for speed.
  const cap = out.max_completion_tokens ?? out.max_tokens
  delete out.max_completion_tokens
  if (typeof cap === 'number') out.max_tokens = cap + 1024
  if (!out.reasoning_effort) out.reasoning_effort = 'low'
  return out
}

/**
 * Wraps `client.chat.completions.create` and `client.responses.create` in place
 * so every existing import of the shared client gets the backup automatically.
 */
export function attachGeminiFallback(client: OpenAI): OpenAI {
  // ── Chat Completions ────────────────────────────────────────────────────
  const chat = client.chat.completions
  const originalChat = chat.create.bind(chat)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(chat as any).create = async (body: any, options?: any) => {
    try {
      return await originalChat(body, options)
    } catch (openaiErr) {
      const gemini = getGemini()
      if (!gemini || !isProviderFailure(openaiErr)) throw openaiErr

      for (const model of geminiModelsFor(body?.model)) {
        try {
          console.warn(
            `\x1b[33m[AI fallback]\x1b[0m OpenAI ${body?.model} failed (${describe(openaiErr)}) → retrying on Gemini ${model}`
          )
          const res = await gemini.chat.completions.create(
            toGeminiChatBody(body, model),
            options?.signal ? { signal: options.signal } : undefined
          )
          console.warn(`\x1b[32m[AI fallback]\x1b[0m Gemini ${model} succeeded`)
          return res
        } catch (geminiErr) {
          console.error(`\x1b[31m[AI fallback]\x1b[0m Gemini ${model} failed (${describe(geminiErr)})`)
        }
      }
      throw openaiErr // both providers failed — behave exactly as before
    }
  }

  // ── Responses API (used only for web-search lookups) ───────────────────
  const responses = client.responses
  const originalResponses = responses.create.bind(responses)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(responses as any).create = async (body: any, options?: any) => {
    try {
      return await originalResponses(body, options)
    } catch (openaiErr) {
      const key = geminiKey()
      if (!key || !isProviderFailure(openaiErr) || typeof body?.input !== 'string') throw openaiErr

      const wantsSearch = Array.isArray(body.tools) &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body.tools.some((t: any) => String(t?.type ?? '').startsWith('web_search'))

      for (const model of geminiModelsFor(body?.model)) {
        try {
          console.warn(
            `\x1b[33m[AI fallback]\x1b[0m OpenAI responses ${body?.model} failed (${describe(openaiErr)}) → retrying on Gemini ${model}`
          )
          const res = await geminiGenerate(key, model, body.input, wantsSearch, options?.signal)
          console.warn(`\x1b[32m[AI fallback]\x1b[0m Gemini ${model} succeeded`)
          return res
        } catch (geminiErr) {
          console.error(`\x1b[31m[AI fallback]\x1b[0m Gemini ${model} failed (${describe(geminiErr)})`)
        }
      }
      throw openaiErr
    }
  }

  return client
}

/** Native Gemini call (needed for Google Search grounding), shaped like a Responses API result. */
async function geminiGenerate(
  key: string,
  model: string,
  input: string,
  withSearch: boolean,
  signal?: AbortSignal
) {
  const res = await fetch(`${GEMINI_NATIVE_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: input }] }],
      ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
    }),
    signal: signal ?? AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json()
  const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => (typeof p?.text === 'string' && !p.thought ? p.text : ''))
    .join('')
  const u = json?.usageMetadata ?? {}
  return {
    id: json?.responseId ?? `gemini-${Date.now()}`,
    object: 'response',
    model,
    output_text: text,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: {
      input_tokens: u.promptTokenCount ?? 0,
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      total_tokens: u.totalTokenCount ?? 0,
    },
  }
}
