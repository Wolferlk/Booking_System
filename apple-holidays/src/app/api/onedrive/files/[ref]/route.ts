import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getBookingOneDriveFiles, getBookingFolderUrl } from '@/lib/onedrive-monitor'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const bookingRef = normalizeBookingRef(params.ref)
  const [files, folderUrl] = await Promise.all([
    getBookingOneDriveFiles(bookingRef),
    getBookingFolderUrl(bookingRef),
  ])

  return buildApiSuccess({ files, folderUrl })
}

function normalizeBookingRef(ref: string) {
  return decodeURIComponent(ref).trim().toUpperCase()
}
