/** GET /api/driver-app/live — Driver App live board for the web (/dashboard/driver-app). */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { mobileRoute } from '@/lib/mobile/http'
import { liveBoard } from '@/lib/mobile/ops'
import { webViewer } from '../_viewer'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('web-live', async (_req: NextRequest) => buildApiSuccess(await liveBoard(await webViewer())))
