import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const settings = await prisma.systemSetting.findMany()
  const map: Record<string, string> = {}
  settings.forEach(s => { map[s.key] = s.value })
  return buildApiSuccess(map)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const { key, value } = await req.json() as { key: string; value: string }
  if (!key) return buildApiError('Key is required')

  await prisma.systemSetting.upsert({
    where:  { key },
    create: { key, value },
    update: { value },
  })
  return buildApiSuccess(null, 'Setting saved')
}
