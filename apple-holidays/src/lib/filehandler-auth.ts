import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'

/**
 * Standalone cookie auth for the File Handler Portal (/filehandler). Mirrors
 * lib/vendor-auth.ts: a signed, self-contained HMAC token in an httpOnly cookie —
 * no NextAuth, no DB session table. File handlers are external partners kept
 * completely separate from staff `User` rows.
 */
const SECRET  = process.env.NEXTAUTH_SECRET ?? 'filehandler-fallback-secret'
const COOKIE  = 'fh_session'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

export function createFileHandlerToken(id: string): string {
  const ts   = Date.now().toString()
  const data = `${id}:${ts}`
  const sig  = createHmac('sha256', SECRET).update(data).digest('hex')
  return Buffer.from(`${data}:${sig}`).toString('base64url')
}

export function parseFileHandlerToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString()
    const lastColon = decoded.lastIndexOf(':')
    const data = decoded.slice(0, lastColon)
    const sig  = decoded.slice(lastColon + 1)
    const expected = createHmac('sha256', SECRET).update(data).digest('hex')
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const [id, ts] = data.split(':')
    if (Date.now() - parseInt(ts) > MAX_AGE) return null
    return id
  } catch {
    return null
  }
}

export function setFileHandlerCookie(id: string) {
  const token = createFileHandlerToken(id)
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE / 1000,
    path: '/',
  })
}

export function clearFileHandlerCookie() {
  cookies().set(COOKIE, '', { maxAge: 0, path: '/' })
}

/**
 * Resolves the current File Handler from the request cookie, or null. Also the
 * server-side guard for every /api/filehandler route — returns null unless the
 * account is both registered and approved (isActive).
 */
export async function getFileHandlerSession() {
  const token = cookies().get(COOKIE)?.value
  if (!token) return null
  const id = parseFileHandlerToken(token)
  if (!id) return null
  const handler = await prisma.fileHandler.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, phone: true,
      whatsappPhone: true, country: true, isRegistered: true, isActive: true,
    },
  })
  if (!handler || !handler.isRegistered || !handler.isActive) return null
  const { isRegistered: _r, isActive: _a, ...rest } = handler
  return rest
}
