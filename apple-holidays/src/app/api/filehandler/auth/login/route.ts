import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setFileHandlerCookie } from '@/lib/filehandler-auth'
import { looksLikePhone, normalizeEmail, phoneMatches } from '@/lib/credential-match'

export const dynamic = 'force-dynamic'

// Same number can sit on more than one row; test the password against each match, but cap the work.
const MAX_CANDIDATES = 5

export async function POST(req: NextRequest) {
  try {
    const { credential, password } = await req.json()
    if (!password) return buildApiError('Password is required')
    if (!credential) return buildApiError('Email or phone is required')

    const raw = String(credential).trim()

    // Phone numbers are stored in too many shapes for a SQL `contains` to find them —
    // narrow the rows here, then match on normalised digits. See credential-match.ts.
    const rows = await prisma.fileHandler.findMany({
      select: { id: true, email: true, phone: true, whatsappPhone: true },
    })
    const ids = rows
      .filter(h => looksLikePhone(raw)
        ? phoneMatches(h.phone, raw) || phoneMatches(h.whatsappPhone, raw)
        : normalizeEmail(h.email) === normalizeEmail(raw))
      .map(h => h.id)
      .slice(0, MAX_CANDIDATES)

    const candidates = ids.length
      ? await prisma.fileHandler.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true, country: true, isActive: true, password: true },
        })
      : []

    if (!candidates.length) {
      return buildApiError('No account found for that email or phone number. Please check it, or register first.', 401)
    }

    let handler: (typeof candidates)[number] | null = null
    for (const c of candidates) {
      if (c.password && await bcrypt.compare(password, c.password)) { handler = c; break }
    }
    if (!handler) return buildApiError('Incorrect password. Please try again.', 401)
    if (!handler.isActive) return buildApiError('Your account is pending admin approval. Please contact the team.', 403)

    setFileHandlerCookie(handler.id)

    await Promise.all([
      prisma.fileHandler.update({ where: { id: handler.id }, data: { lastLoginAt: new Date() } }),
      prisma.fileHandlerLog.create({
        data: { fileHandlerId: handler.id, fileHandlerName: handler.name, action: 'LOGIN', details: 'Signed in to the File Handler Portal' },
      }),
    ])

    return buildApiSuccess({ id: handler.id, name: handler.name, email: handler.email, country: handler.country }, 'Logged in')
  } catch (err) {
    console.error('[filehandler-login]', err)
    return buildApiError('Login failed. Please try again.', 500)
  }
}
