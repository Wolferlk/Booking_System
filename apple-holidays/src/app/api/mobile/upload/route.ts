/**
 * POST /api/mobile/upload  (multipart: file, kind)
 *
 * Photos from the app — vehicle renewal shots, profile photo. Stored through
 * the same storage layer as every other upload (S3, local fallback) under
 * `driver-app/<driverId>/`, and returned as the usual `/api/uploads/...` URL.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { putUpload } from '@/lib/storage'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute } from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'

const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
const MAX_SIZE = 8 * 1024 * 1024
const KINDS = ['vehicle', 'profile', 'odometer']

export const POST = mobileRoute('upload', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  // The DOM lib FormData typing on this project lacks .get(); the runtime object has it.
  const form = (await req.formData()) as unknown as { get(name: string): FormDataEntryValue | null }
  const file = form.get('file') as File | null
  const kind = KINDS.includes(String(form.get('kind'))) ? String(form.get('kind')) : 'vehicle'
  if (!file) throw new MobileError('No photo received.')
  if (!ALLOWED.includes(file.type)) throw new MobileError('Only photos (JPEG / PNG / WebP) can be uploaded.')
  if (file.size > MAX_SIZE) throw new MobileError('Photo is too large (max 8 MB).')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const name = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const url = await putUpload(`driver-app/${actor.driverId}/${name}`, Buffer.from(await file.arrayBuffer()), file.type)
  return buildApiSuccess({ url })
})
