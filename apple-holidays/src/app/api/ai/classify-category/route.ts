import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { classifyPNLCategories } from '@/lib/openai'
import { detectCategory } from '@/lib/parsers/xlsx-parser'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json()
  const activity: string = body.activity ?? ''

  if (!activity.trim()) return buildApiSuccess({ category: 'OTHER' })

  // Try OpenAI first; fall back to keyword detection
  if (process.env.OPENAI_API_KEY) {
    try {
      const [category] = await classifyPNLCategories([activity])
      return buildApiSuccess({ category: category ?? 'OTHER' })
    } catch {
      // fall through to keyword detection
    }
  }

  return buildApiSuccess({ category: detectCategory(activity) })
}
