/**
 * Authentication for the public File Handler API (`/api/public/fh/v1`).
 *
 * The File Handler Portal itself runs on an httpOnly cookie (lib/filehandler-auth.ts),
 * which a third-party application cannot carry. This module gives the same
 * capabilities a signed bearer token instead, obtained from
 * `POST /api/public/fh/v1/auth/login`.
 *
 * Two kinds of caller are supported:
 *
 *  1. **Handler token** — the external app logs in with a real File Handler's
 *     email/phone + password (the very same credentials as the portal). Every
 *     action is attributed to that handler in `file_handler_logs`, exactly as if
 *     they had clicked it in the portal.
 *
 *  2. **Service client** — a machine account configured in the environment
 *     (`FH_PUBLIC_API_*`). It has no row in `file_handlers`, so it must say which
 *     handler it is acting for via the `X-File-Handler` header (email or id), or
 *     rely on the configured default. This is the mode to use when the other app
 *     has its own user accounts and should not be storing handler passwords.
 *
 * Nothing here writes to the schema — service clients live in configuration, so
 * the live database is untouched.
 */

import { SignJWT, jwtVerify } from 'jose'
import { timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { FhApiError } from './fh-http'

export const FH_API_ISSUER = 'ops.aahaas/fh-public-api'
export const FH_API_AUDIENCE = 'filehandler'

/** Everything a caller may be allowed to do. `*` means all of them. */
export type FhApiScope =
  | 'booking:read'
  | 'booking:write'
  | 'booking:import'
  | 'booking:cancel'
  | 'flight:write'
  | 'hotel:write'
  | 'document:read'
  | 'document:send'
  | 'ai:extract'
  | 'activity:read'

export const ALL_SCOPES: FhApiScope[] = [
  'booking:read',
  'booking:write',
  'booking:import',
  'booking:cancel',
  'flight:write',
  'hotel:write',
  'document:read',
  'document:send',
  'ai:extract',
  'activity:read',
]

export interface FhServiceClient {
  username: string
  password: string
  /** Human label shown in audit trails and the file-handler log. */
  name: string
  scopes: FhApiScope[] | ['*']
  /** Handler this client acts for when the request does not name one. */
  actAs?: string
  /** When true the client may only act for `actAs` — `X-File-Handler` is ignored. */
  lockActAs?: boolean
}

/**
 * Sample service credentials, used only when no client is configured in the
 * environment, so the Postman collection works out of the box on a dev machine.
 * In production they are refused unless the operator explicitly opts in with
 * `FH_PUBLIC_API_ALLOW_SAMPLE=true`.
 */
export const SAMPLE_CLIENT: FhServiceClient = {
  username: 'fh_integration',
  password: 'FileHandler@2026#Portal',
  name: 'File Handler Integration (sample)',
  scopes: ['*'],
}

const TOKEN_TTL_MINUTES = Number(process.env.FH_PUBLIC_API_TOKEN_TTL_MIN || 720) // 12 h

function secretKey(): Uint8Array {
  const raw =
    process.env.FH_PUBLIC_API_JWT_SECRET ||
    process.env.AS_PUBLIC_API_JWT_SECRET ||
    process.env.NEXTAUTH_SECRET
  if (!raw) throw new FhApiError('FH_PUBLIC_API_JWT_SECRET (or NEXTAUTH_SECRET) is not configured', 503, 'NOT_CONFIGURED')
  return new TextEncoder().encode(raw)
}

/**
 * Configured service clients, in precedence order:
 *   1. `FH_PUBLIC_API_CLIENTS` — JSON array of {username,password,name,scopes,actAs}
 *   2. `FH_PUBLIC_API_USERNAME` / `FH_PUBLIC_API_PASSWORD` — single client
 *   3. the sample client (dev only)
 */
export function getConfiguredClients(): FhServiceClient[] {
  const json = process.env.FH_PUBLIC_API_CLIENTS?.trim()
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<FhServiceClient>[]
      const clients = parsed
        .filter((c) => c && c.username && c.password)
        .map((c) => ({
          username: String(c.username),
          password: String(c.password),
          name: String(c.name || c.username),
          scopes: (Array.isArray(c.scopes) && c.scopes.length ? c.scopes : ['*']) as FhServiceClient['scopes'],
          actAs: c.actAs ? String(c.actAs) : undefined,
          lockActAs: c.lockActAs === true,
        }))
      if (clients.length) return clients
    } catch {
      console.error('[fh-public-api] FH_PUBLIC_API_CLIENTS is not valid JSON — ignoring it')
    }
  }

  const username = process.env.FH_PUBLIC_API_USERNAME?.trim()
  const password = process.env.FH_PUBLIC_API_PASSWORD
  if (username && password) {
    return [
      {
        username,
        password,
        name: process.env.FH_PUBLIC_API_CLIENT_NAME || 'File Handler Integration',
        scopes: ['*'],
        actAs: process.env.FH_PUBLIC_API_ACT_AS?.trim() || undefined,
      },
    ]
  }

  const sampleAllowed =
    process.env.NODE_ENV !== 'production' || process.env.FH_PUBLIC_API_ALLOW_SAMPLE === 'true'
  return sampleAllowed
    ? [{ ...SAMPLE_CLIENT, actAs: process.env.FH_PUBLIC_API_ACT_AS?.trim() || undefined }]
    : []
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
  const hit = failures.get(key.toLowerCase())
  if (!hit || hit.count < LOCK_AFTER) return 0
  const left = hit.until - Date.now()
  if (left <= 0) {
    failures.delete(key.toLowerCase())
    return 0
  }
  return left
}

function noteFailure(key: string) {
  const k = (key || 'unknown').toLowerCase()
  const hit = failures.get(k) ?? { count: 0, until: 0 }
  hit.count += 1
  hit.until = Date.now() + LOCK_MS
  failures.set(k, hit)
}

function clearFailures(key: string) {
  failures.delete((key || '').toLowerCase())
}

// ── The acting File Handler ──────────────────────────────────────────────────

export interface ActingHandler {
  id: string
  name: string
  email: string
  phone: string | null
  whatsappPhone: string | null
  country: string
  lastLoginAt: Date | null
}

const HANDLER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  whatsappPhone: true,
  country: true,
  isRegistered: true,
  isActive: true,
  lastLoginAt: true,
} as const

function toActing(h: {
  id: string
  name: string
  email: string
  phone: string | null
  whatsappPhone: string | null
  country: string
  lastLoginAt: Date | null
}): ActingHandler {
  return {
    id: h.id,
    name: h.name,
    email: h.email,
    phone: h.phone,
    whatsappPhone: h.whatsappPhone,
    country: h.country,
    lastLoginAt: h.lastLoginAt,
  }
}

/** Look a handler up by id or email — the two things `X-File-Handler` may hold. */
export async function findHandlerByRef(ref: string): Promise<ActingHandler> {
  const raw = ref.trim()
  const handler = await prisma.fileHandler.findFirst({
    where: raw.includes('@') ? { email: raw.toLowerCase() } : { id: raw },
    select: HANDLER_SELECT,
  })
  if (!handler) throw new FhApiError(`No file handler matches "${raw}"`, 404, 'HANDLER_NOT_FOUND')
  if (!handler.isRegistered || !handler.isActive) {
    throw new FhApiError(`File handler "${handler.name}" is not approved for portal access`, 403, 'HANDLER_INACTIVE')
  }
  return toActing(handler)
}

/**
 * Verify a File Handler's own credentials — email **or** phone, plus password.
 * Mirrors `/api/filehandler/auth/login` so one password works in both places.
 */
export async function authenticateHandler(credential: string, password: string): Promise<ActingHandler> {
  const raw = credential.trim()
  const isPhone = /^[+\d][\d\s\-().]{4,}$/.test(raw)

  const handler = await prisma.fileHandler.findFirst({
    where: isPhone
      ? { OR: [{ phone: { contains: raw } }, { whatsappPhone: { contains: raw } }] }
      : { email: raw.toLowerCase() },
    select: { ...HANDLER_SELECT, password: true },
  })

  if (!handler?.password || !(await bcrypt.compare(password, handler.password))) {
    noteFailure(raw)
    throw new FhApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS')
  }
  if (!handler.isRegistered || !handler.isActive) {
    throw new FhApiError('This account is pending admin approval', 403, 'ACCOUNT_PENDING')
  }
  clearFailures(raw)
  return toActing(handler)
}

/** Verify a configured service client's username + password. */
export function authenticateServiceClient(username: string, password: string): FhServiceClient | null {
  const match = getConfiguredClients().find((c) => safeEqual(c.username, username))
  if (!match || !safeEqual(match.password, password)) {
    noteFailure(username)
    return null
  }
  clearFailures(username)
  return match
}

// ── Token issue ──────────────────────────────────────────────────────────────

export interface IssuedToken {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  expires_at: string
  scopes: string[]
  subject_type: 'handler' | 'service'
  client_name: string
  file_handler?: { id: string; name: string; email: string; country: string }
}

async function sign(payload: Record<string, unknown>, subject: string, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(FH_API_ISSUER)
    .setAudience(FH_API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey())
  return { token, expiresAt }
}

/** Sign a bearer token for an authenticated File Handler. */
export async function issueHandlerToken(handler: ActingHandler): Promise<IssuedToken> {
  const ttlSeconds = TOKEN_TTL_MINUTES * 60
  const { token, expiresAt } = await sign(
    { kind: 'handler', name: handler.name, email: handler.email, scopes: ['*'] },
    handler.id,
    ttlSeconds,
  )
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: ttlSeconds,
    expires_at: expiresAt.toISOString(),
    scopes: ['*'],
    subject_type: 'handler',
    client_name: handler.name,
    file_handler: { id: handler.id, name: handler.name, email: handler.email, country: handler.country },
  }
}

/** Sign a bearer token for a configured service client. */
export async function issueServiceToken(client: FhServiceClient, actAs?: ActingHandler): Promise<IssuedToken> {
  const ttlSeconds = TOKEN_TTL_MINUTES * 60
  const { token, expiresAt } = await sign(
    {
      kind: 'service',
      name: client.name,
      scopes: client.scopes,
      act_as: actAs?.id,
      lock_act_as: client.lockActAs === true,
    },
    client.username,
    ttlSeconds,
  )
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: ttlSeconds,
    expires_at: expiresAt.toISOString(),
    scopes: client.scopes as string[],
    subject_type: 'service',
    client_name: client.name,
    ...(actAs
      ? { file_handler: { id: actAs.id, name: actAs.name, email: actAs.email, country: actAs.country } }
      : {}),
  }
}

// ── Request authorisation ────────────────────────────────────────────────────

export interface FhCaller {
  /** Who signed in: a real handler, or a machine client acting for one. */
  kind: 'handler' | 'service'
  /** Token subject — handler id, or the service client's username. */
  subject: string
  /** Display name of the caller (client name for service tokens). */
  name: string
  scopes: string[]
  via: 'bearer' | 'api-key'
  /** The File Handler every write is attributed to. */
  handler: ActingHandler
}

export type FhAuthResult =
  | { ok: true; caller: FhCaller }
  | { ok: false; status: number; error: string; code: string }

function hasScope(scopes: string[], needed: FhApiScope): boolean {
  return scopes.includes('*') || scopes.includes(needed)
}

/** The handler a service caller wants to act for: header, then configured default. */
function requestedActAs(req: Request): string | undefined {
  return (
    req.headers.get('x-file-handler')?.trim() ||
    req.headers.get('x-filehandler')?.trim() ||
    req.headers.get('x-on-behalf-of')?.trim() ||
    undefined
  )
}

/**
 * Authorise an incoming request. Accepts either a bearer token from
 * `/auth/login` or, when `FH_PUBLIC_API_KEY` is configured, a static
 * `x-api-key` header for callers that cannot hold a token.
 *
 * Resolves — and returns — the File Handler the request acts as, so every route
 * can attribute its writes without repeating the lookup.
 */
export async function authorizeRequest(req: Request, needed: FhApiScope): Promise<FhAuthResult> {
  try {
    // ── Static API key ───────────────────────────────────────────────────────
    const apiKey = req.headers.get('x-api-key')?.trim()
    const configuredKey = process.env.FH_PUBLIC_API_KEY?.trim()
    if (apiKey && configuredKey && safeEqual(apiKey, configuredKey)) {
      const ref = requestedActAs(req) || process.env.FH_PUBLIC_API_ACT_AS?.trim()
      if (!ref) {
        return {
          ok: false,
          status: 400,
          error: 'Send X-File-Handler (handler email or id) to say which file handler this API key acts for',
          code: 'ACT_AS_REQUIRED',
        }
      }
      const handler = await findHandlerByRef(ref)
      return {
        ok: true,
        caller: {
          kind: 'service',
          subject: process.env.FH_PUBLIC_API_USERNAME || 'api-key-client',
          name: process.env.FH_PUBLIC_API_CLIENT_NAME || 'File Handler Integration (API key)',
          scopes: ['*'],
          via: 'api-key',
          handler,
        },
      }
    }

    // ── Bearer token ─────────────────────────────────────────────────────────
    const header = req.headers.get('authorization') || ''
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    if (!token) {
      return {
        ok: false,
        status: 401,
        error: 'Missing bearer token — call /api/public/fh/v1/auth/login first',
        code: 'UNAUTHORIZED',
      }
    }

    let payload: Record<string, unknown>
    try {
      const verified = await jwtVerify(token, secretKey(), { issuer: FH_API_ISSUER, audience: FH_API_AUDIENCE })
      payload = verified.payload as Record<string, unknown>
    } catch (err) {
      const expired = err instanceof Error && /exp/i.test(err.message)
      return {
        ok: false,
        status: 401,
        error: expired ? 'Token has expired — log in again' : 'Invalid token',
        code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      }
    }

    const scopes = Array.isArray(payload.scopes) ? (payload.scopes as string[]) : []
    if (!hasScope(scopes, needed)) {
      return {
        ok: false,
        status: 403,
        error: `This client is missing the "${needed}" scope`,
        code: 'INSUFFICIENT_SCOPE',
      }
    }

    const subject = String(payload.sub || '')
    const kind = payload.kind === 'service' ? 'service' : 'handler'

    let handler: ActingHandler
    if (kind === 'handler') {
      // Re-read on every call: an admin can deactivate an account mid-token.
      handler = await findHandlerByRef(subject)
    } else {
      const locked = payload.lock_act_as === true
      const ref =
        (locked ? undefined : requestedActAs(req)) ||
        (payload.act_as ? String(payload.act_as) : undefined) ||
        process.env.FH_PUBLIC_API_ACT_AS?.trim()
      if (!ref) {
        return {
          ok: false,
          status: 400,
          error: 'Send X-File-Handler (handler email or id) to say which file handler this token acts for',
          code: 'ACT_AS_REQUIRED',
        }
      }
      handler = await findHandlerByRef(ref)
    }

    return {
      ok: true,
      caller: {
        kind,
        subject,
        name: String(payload.name || handler.name),
        scopes,
        via: 'bearer',
        handler,
      },
    }
  } catch (err) {
    if (err instanceof FhApiError) return { ok: false, status: err.status, error: err.message, code: err.code }
    throw err
  }
}

/** Authorise or throw — the shape most routes want. */
export async function requireCaller(req: Request, needed: FhApiScope): Promise<FhCaller> {
  const auth = await authorizeRequest(req, needed)
  if (!auth.ok) throw new FhApiError(auth.error, auth.status, auth.code)
  return auth.caller
}
