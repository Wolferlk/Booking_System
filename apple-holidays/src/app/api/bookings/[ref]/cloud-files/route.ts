import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveBookingDriveFolder } from '@/lib/onedrive-monitor'
import { listItemChildren, type DriveItem } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const allowed = ['GT_USER', 'TE_USER', 'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowed.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { ref } = await params

  // Optional: browse a sub-folder by passing ?folderId=<item-id>
  const { searchParams } = req.nextUrl
  const subFolderId = searchParams.get('folderId')

  const folder = await resolveBookingDriveFolder(ref)
  if (!folder) {
    return buildApiSuccess({
      hasFolder: false,
      files: [],
      folderUrl: null,
      folderId: null,
    })
  }

  const targetFolderId = subFolderId ?? folder.folderId

  try {
    const items: DriveItem[] = await listItemChildren(folder.driveId, targetFolderId)

    const files = items.map(item => ({
      id:        item.id,
      name:      item.name,
      isFolder:  !!item.folder,
      size:      item.size ?? null,
      mimeType:  item.file?.mimeType ?? null,
      webUrl:    item.webUrl ?? null,
      lastModified: item.lastModifiedDateTime ?? null,
    }))

    // Sort: folders first, then by name
    files.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name)
    })

    return buildApiSuccess({
      hasFolder: true,
      files,
      folderUrl: folder.folderUrl,
      folderId:  folder.folderId,
      driveKey:  folder.driveKey,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to list folder: ${msg}`, 500)
  }
}
