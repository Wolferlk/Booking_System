import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

const PROTECTED_KEYS = new Set([
  'use_test_data',
  'less_credit_mode',
  'auto_mail_enabled',
  'auto_onedrive_enabled',
])

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const settings = await prisma.systemSetting.findMany()
  const map: Record<string, string> = {}
  settings.forEach(s => { map[s.key] = s.value })
  return buildApiSuccess(map)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { key, value, password } = await req.json() as { key: string; value: string; password?: string }
  if (!key) return buildApiError('Key is required')

  if (PROTECTED_KEYS.has(key)) {
    const criticalPassword =
      process.env.CRITICAL_SERVICES_PASSWORD ??
      process.env.CRITICAL_OPS_PASSWORD
    if (!criticalPassword) {
      return buildApiError('Critical services password is not configured on the server', 500)
    }
    if (!password || password !== criticalPassword) {
      return buildApiError('Incorrect critical services password', 403)
    }
  }

  await prisma.systemSetting.upsert({
    where:  { key },
    create: { key, value },
    update: { value },
  })
  return buildApiSuccess(null, 'Setting saved')
}
