/** Read and update the Experience Report Centre configuration. */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireTeUser } from '@/lib/te/experience-report/auth'
import { getSettings, saveSettings, SettingsError } from '@/lib/te/experience-report/store'
import { runSweep } from '@/lib/te/experience-report/run'
import type { ExperienceReportSettings } from '@/lib/te/experience-report/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)
  return buildApiSuccess(await getSettings())
}

export async function PUT(req: NextRequest) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  let patch: Partial<ExperienceReportSettings> = {}
  try { patch = await req.json() } catch { return buildApiError('Invalid request body.', 422) }

  try {
    return buildApiSuccess(await saveSettings(patch, gate.actor.label), 'Settings saved.')
  } catch (err) {
    if (err instanceof SettingsError) return buildApiError(err.message, 422)
    return buildApiError(err instanceof Error ? err.message : 'Could not save settings')
  }
}

/** Run the post-departure sweep now, rather than waiting for the cron tick. */
export async function POST(req: NextRequest) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* empty body */ }

  try {
    const result = await runSweep({ actor: gate.actor.label, dryRun: body.dryRun })
    const message = body.dryRun
      ? `${result.built} of ${result.considered} finished trip(s) would be reported on.`
      : `Swept ${result.considered} finished trip(s): ${result.sent} sent, ${result.held} held, ${result.skipped} already handled.`
    return buildApiSuccess(result, message)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'The sweep failed')
  }
}
