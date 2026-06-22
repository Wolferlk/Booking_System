import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendWhatsAppText, normalisePhone } from '@/lib/whatsapp'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const driver = await prisma.driver.findUnique({ where: { id: params.id }, select: { phone: true, name: true } })
  if (!driver) return buildApiError('Driver not found', 404)

  const phone = normalisePhone(driver.phone)

  const messages = await prisma.whatsAppMessage.findMany({
    where: {
      phone,
      senderName: { startsWith: '[DRIVER]' },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return buildApiSuccess(messages)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const driver = await prisma.driver.findUnique({ where: { id: params.id }, select: { phone: true, name: true } })
  if (!driver) return buildApiError('Driver not found', 404)

  const { message, bookingRef } = await req.json() as { message: string; bookingRef?: string }
  if (!message?.trim()) return buildApiError('Message is required')

  const sent = await sendWhatsAppText(driver.phone, message, driver.name)
  if (!sent) return buildApiError('Failed to send WhatsApp message', 500)

  const log = await prisma.whatsAppMessage.create({
    data: {
      bookingRef:  bookingRef ?? 'MANUAL',
      phone:       normalisePhone(driver.phone),
      direction:   'outbound',
      body:        message,
      status:      'sent',
      senderName:  `[DRIVER] ${driver.name}`,
    },
  })

  return buildApiSuccess(log, 'Message sent')
}
