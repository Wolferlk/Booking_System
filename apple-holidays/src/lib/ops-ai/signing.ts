import { createHmac, timingSafeEqual, randomUUID } from 'crypto'

/**
 * Proposed actions travel to the browser and come back when the user clicks
 * "Run". The signature binds an action to the user who was shown it and to a
 * short expiry window, so a tampered or replayed payload is rejected before the
 * executor ever looks at it.
 *
 * This is defence in depth, not the primary control: the executor independently
 * re-checks RBAC and country scope on every execute call.
 */

const TTL_MS = 30 * 60 * 1000

export interface SignedEnvelope {
  tool:   string
  args:   Record<string, unknown>
  userId: string
  exp:    number
  nonce:  string
  sig:    string
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET is required to sign OPS_AI actions')
  return s
}

function digest(payload: Omit<SignedEnvelope, 'sig'>): string {
  // Sorted keys so the signed string is stable regardless of property order.
  const canonical = JSON.stringify({
    tool:   payload.tool,
    args:   sortKeys(payload.args),
    userId: payload.userId,
    exp:    payload.exp,
    nonce:  payload.nonce,
  })
  return createHmac('sha256', secret()).update(canonical).digest('hex')
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k])
        return acc
      }, {})
  }
  return value
}

export function signAction(tool: string, args: Record<string, unknown>, userId: string): SignedEnvelope {
  const base = { tool, args, userId, exp: Date.now() + TTL_MS, nonce: randomUUID() }
  return { ...base, sig: digest(base) }
}

export function verifyAction(
  envelope: SignedEnvelope | null | undefined,
  userId: string,
): { ok: true; tool: string; args: Record<string, unknown> } | { ok: false; reason: string } {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'Missing action envelope' }
  const { sig, ...rest } = envelope
  if (typeof sig !== 'string' || sig.length !== 64) return { ok: false, reason: 'Malformed signature' }
  if (rest.userId !== userId) return { ok: false, reason: 'This action was issued to a different user' }
  if (typeof rest.exp !== 'number' || rest.exp < Date.now()) {
    return { ok: false, reason: 'This action expired — ask again to get a fresh one' }
  }

  const expected = digest(rest as Omit<SignedEnvelope, 'sig'>)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Action signature does not match — refusing to run' }
  }

  return { ok: true, tool: rest.tool, args: (rest.args ?? {}) as Record<string, unknown> }
}
