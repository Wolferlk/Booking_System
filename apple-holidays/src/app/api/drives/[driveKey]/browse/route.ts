/**
 * GET /api/drives/[driveKey]/browse?folderId=<item-id>
 *
 * Lists files and folders in a drive's root (or a specific sub-folder).
 * Used by the new-booking flow where no booking folder is linked yet —
 * the user picks the destination country and browses the matching drive.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveDriveByKey, DRIVE_CONFIGS } from '@/lib/onedrive-monitor'
import { listItemChildren, listFolderChildren, type DriveItem } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ driveKey: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const allowed = ['GT_USER', 'TE_USER', 'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowed.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { driveKey } = await params
  const { searchParams } = req.nextUrl
  const folderId = searchParams.get('folderId')

  // Validate key
  if (!DRIVE_CONFIGS.find(c => c.key === driveKey)) {
    return buildApiError(`Unknown drive key: ${driveKey}`, 400)
  }

  const resolved = await resolveDriveByKey(driveKey)
  if (!resolved) return buildApiError('Could not resolve drive', 500)
  const { driveId, cfg } = resolved

  try {
    let items: DriveItem[]
    if (folderId) {
      // Sub-folder navigation by item ID
      items = await listItemChildren(driveId, folderId)
    } else {
      // Drive root — use rootFolder path if configured
      const rootPath = cfg.type === 'personal' ? cfg.rootFolder : cfg.rootFolder_sp
      items = rootPath ? await listFolderChildren(driveId, rootPath) : await listFolderChildren(driveId)
    }

    const files = items.map(item => ({
      id:           item.id,
      name:         item.name,
      isFolder:     !!item.folder,
      size:         item.size ?? null,
      mimeType:     item.file?.mimeType ?? null,
      webUrl:       item.webUrl ?? null,
      lastModified: item.lastModifiedDateTime ?? null,
    }))

    // Folders first, then alphabetical
    files.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return  1
      return a.name.localeCompare(b.name)
    })

    return buildApiSuccess({
      driveKey,
      driveLabel: cfg.label,
      files,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to list drive: ${msg}`, 500)
  }
}
