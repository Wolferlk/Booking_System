/** GET /api/driver-app/accounts — which drivers use the app, and when they were last seen. */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { mobileRoute } from '@/lib/mobile/http'
import { appAccounts } from '@/lib/mobile/ops'
import { webViewer } from '../_viewer'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('web-accounts', async (_req: NextRequest) => buildApiSuccess({ accounts: await appAccounts(await webViewer()) }))
