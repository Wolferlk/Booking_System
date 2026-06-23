import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveDriveByKey, DRIVE_CONFIGS } from '@/lib/onedrive-monitor'
import { listFolderChildren } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onedrive/browse?driveKey=MY&path=Reservation/Malaysia Drive/2026/06 june
 *
 * Lists the children (folders + files) at the given path within the drive.
 * If path is omitted, lists the drive root.
 * Returns only relevant data needed for the folder picker UI.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const driveKey = searchParams.get('driveKey')?.toUpperCase()
  const folderPath = searchParams.get('path') ?? undefined

  if (!driveKey) return buildApiError('driveKey is required', 400)

  const resolved = await resolveDriveByKey(driveKey)
  if (!resolved) return buildApiError(`Unknown driveKey "${driveKey}"`, 400)

  try {
    const items = await listFolderChildren(resolved.driveId, folderPath)
    const mapped = items.map(item => ({
      id:         item.id,
      name:       item.name,
      webUrl:     item.webUrl,
      isFolder:   !!item.folder,
      childCount: item.folder?.childCount ?? 0,
      size:       item.size,
      modified:   item.lastModifiedDateTime,
    }))
    // Return folders first, then files, both sorted by name
    const folders = mapped.filter(i => i.isFolder).sort((a, b) => a.name.localeCompare(b.name))
    const files   = mapped.filter(i => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name))
    return buildApiSuccess({ items: [...folders, ...files], driveKey, path: folderPath ?? '' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Drive access failed'
    return buildApiError(msg, 502)
  }
}

/** GET /api/onedrive/browse?list=drives — list all configured drives */
export async function POST() {
  return buildApiSuccess(DRIVE_CONFIGS.map(c => ({ key: c.key, label: c.label, country: c.country })))
}
