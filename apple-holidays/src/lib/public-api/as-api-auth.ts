/**
 * Authentication for the public AppleSystem (AS) quotation API.
 *
 * The AS side is a separate PHP application, so it cannot carry a NextAuth
 * session cookie. Instead it logs in once against
 * `POST /api/public/as/v1/auth/login` with a machine username + password and
 * receives a short-lived signed JWT which it sends as
 * `Authorization: Bearer <token>` on every subsequent call.
 *
 * Nothing here touches the `users` table — these are integration clients, not
 * humans, so they live in configuration. That keeps the live database schema
 * untouched while still giving each caller its own credentials and scopes.
 */

import { SignJWT, jwtVerify } from 'jose'
import { timingSafeEqual } from 'crypto'

export const AS_API_ISSUER = 'ops.aahaas/as-public-api'
export const AS_API_AUDIENCE = 'applesystem'

/** Everything a client is allowed to do. `*` means all of them. */
export type AsApiScope = 'quotation:create' | 'quotation:update' | 'quotation:cancel' | 'quotation:read'

export interface AsApiClient {
  username: string
  password: string
  /** Human label shown in audit trails and status events. */
  name: string
  scopes: AsApiScope[] | ['*']
}

/**
 * Sample credentials, used only when no client is configured in the
 * environment. They exist so the Postman collection works out of the box on a
 * dev machine. In production they are refused unless the operator explicitly
 * opts in with `AS_PUBLIC_API_ALLOW_SAMPLE=true`.
 */
export const SAMPLE_CLIENT: AsApiClient = {
  username: 'as_integration',
  password: 'AppleSystem@2026#Quote',
  name: 'AppleSystem Integration (sample)',
  scopes: ['*'],
}

const TOKEN_TTL_MINUTES = Number(process.env.AS_PUBLIC_API_TOKEN_TTL_MIN || 720) // 12 h

function secretKey(): Uint8Array {
  const raw = process.env.AS_PUBLIC_API_JWT_SECRET || process.env.NEXTAUTH_SECRET
  if (!raw) throw new Error('AS_PUBLIC_API_JWT_SECRET (or NEXTAUTH_SECRET) is not configured')
  return new TextEncoder().encode(raw)
}

/**
 * Configured clients, in precedence order:
 *   1. `AS_PUBLIC_API_CLIENTS` — JSON array of {username,password,name,scopes}
 *   2. `AS_PUBLIC_API_USERNAME` / `AS_PUBLIC_API_PASSWORD` — single client
 *   3. the sample client (dev only)
 */
export function getConfiguredClients(): AsApiClient[] {
  const json = process.env.AS_PUBLIC_API_CLIENTS?.trim()
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<AsApiClient>[]
      const clients = parsed
        .filter((c) => c && c.username && c.password)
        .map((c) => ({
          username: String(c.username),
          password: String(c.password),
          name: String(c.name || c.username),
          scopes: (Array.isArray(c.scopes) && c.scopes.length ? c.scopes : ['*']) as AsApiClient['scopes'],
        }))
      if (clients.length) return clients
    } catch {
      console.error('[as-public-api] AS_PUBLIC_API_CLIENTS is not valid JSON — ignoring it')
    }
  }

  const username = process.env.AS_PUBLIC_API_USERNAME?.trim()
  const password = process.env.AS_PUBLIC_API_PASSWORD
  if (username && password) {
    return [{ username, password, name: process.env.AS_PUBLIC_API_CLIENT_NAME || 'AppleSystem Integration', scopes: ['*'] }]
  }

  const sampleAllowed =
    process.env.NODE_ENV !== 'production' || process.env.AS_PUBLIC_API_ALLOW_SAMPLE === 'true'
  return sampleAllowed ? [SAMPLE_CLIENT] : []
}

/** Constant-time string compare, safe on differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// ── Brute-force damping ──────────────────────────────────────────────────────
// In-process only: enough to blunt a credential-guessing loop without adding a
// table. On serverless each container keeps its own counter, which is fine —
// the goal is to slow a burst, not to be an authority.
const failures = new Map<string, { count: number; until: number }>()
const LOCK_AFTER = 8
const LOCK_MS = 5 * 60_000

export function loginLockRemainingMs(key: string): number {
  const hit = failures.get(key)
  if (!hit || hit.count < LOCK_AFTER) return 0
  const left = hit.until - Date.now()
  if (left <= 0) {
    failures.delete(key)
    return 0
  }
  return left
}

function noteFailure(key: string) {
  const hit = failures.get(key) ?? { count: 0, until: 0 }
  hit.count += 1
  hit.until = Date.now() + LOCK_MS
  failures.set(key, hit)
}

// ── Login / token issue ──────────────────────────────────────────────────────

export interface IssuedToken {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  expires_at: string
  scopes: string[]
  client_name: string
}

/** Verify username + password against the configured clients. */
export function authenticateClient(username: string, password: string): AsApiClient | null {
  const clients = getConfiguredClients()
  const match = clients.find((c) => safeEqual(c.username, username))
  if (!match || !safeEqual(match.password, password)) {
    noteFailure(username || 'unknown')
    return null
  }
  failures.delete(username)
  return match
}

/** Sign a bearer token for an authenticated client. */
export async function issueToken(client: AsApiClient): Promise<IssuedToken> {
  const ttlSeconds = TOKEN_TTL_MINUTES * 60
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const access_token = await new SignJWT({ name: client.name, scopes: client.scopes })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(client.username)
    .setIssuer(AS_API_ISSUER)
    .setAudience(AS_API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey())

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: ttlSeconds,
    expires_at: expiresAt.toISOString(),
    scopes: client.scopes as string[],
    client_name: client.name,
  }
}

// ── Request authorisation ────────────────────────────────────────────────────

export interface AuthedCaller {
  username: string
  name: string
  scopes: string[]
  /** How the caller proved itself — shown in the audit trail. */
  via: 'bearer' | 'api-key'
}

export type AuthResult =
  | { ok: true; caller: AuthedCaller }
  | { ok: false; status: number; error: string }

function hasScope(scopes: string[], needed: AsApiScope): boolean {
  return scopes.includes('*') || scopes.includes(needed)
}

/**
 * Authorise an incoming request. Accepts either a bearer token from
 * `/auth/login` or, when `AS_PUBLIC_API_KEY` is configured, a static
 * `x-api-key` header for callers that cannot hold a token.
 */
export async function authorizeRequest(req: Request, needed: AsApiScope): Promise<AuthResult> {
  const apiKey = req.headers.get('x-api-key')?.trim()
  const configuredKey = process.env.AS_PUBLIC_API_KEY?.trim()
  if (apiKey && configuredKey && safeEqual(apiKey, configuredKey)) {
    return {
      ok: true,
      caller: {
        username: process.env.AS_PUBLIC_API_USERNAME || 'api-key-client',
        name: process.env.AS_PUBLIC_API_CLIENT_NAME || 'AppleSystem Integration (API key)',
        scopes: ['*'],
        via: 'api-key',
      },
    }
  }

  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token — call /api/public/as/v1/auth/login first' }
  }

  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(token, secretKey(), {
      issuer: AS_API_ISSUER,
      audience: AS_API_AUDIENCE,
    })
    payload = verified.payload as Record<string, unknown>
  } catch (err) {
    const expired = err instanceof Error && /exp/i.test(err.message)
    return { ok: false, status: 401, error: expired ? 'Token has expired — log in again' : 'Invalid token' }
  }

  const scopes = Array.isArray(payload.scopes) ? (payload.scopes as string[]) : []
  const caller: AuthedCaller = {
    username: String(payload.sub || 'unknown'),
    name: String(payload.name || payload.sub || 'AppleSystem'),
    scopes,
    via: 'bearer',
  }

  if (!hasScope(scopes, needed)) {
    return { ok: false, status: 403, error: `This client is not allowed to ${needed.replace(':', ' a ')}` }
  }
  return { ok: true, caller }
}
