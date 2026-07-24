import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setFileHandlerCookie } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { credential, password } = await req.json()
    if (!password) return buildApiError('Password is required')
    if (!credential) return buildApiError('Email or phone is required')

    const raw = String(credential).trim()
    const isPhone = /^[+\d][\d\s\-().]{4,}$/.test(raw)

    const handler = await prisma.fileHandler.findFirst({
      where: isPhone
        ? { OR: [{ phone: { contains: raw } }, { whatsappPhone: { contains: raw } }] }
        : { email: raw.toLowerCase() },
      select: { id: true, name: true, email: true, country: true, isActive: true, password: true },
    })

    if (!handler || !handler.password) return buildApiError('Invalid credentials', 401)
    const valid = await bcrypt.compare(password, handler.password)
    if (!valid) return buildApiError('Invalid credentials', 401)
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
