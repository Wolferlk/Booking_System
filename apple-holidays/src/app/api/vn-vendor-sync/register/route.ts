import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import { fillVendorPhones, linkExcelName, registerMany, registerVendor, unlinkExcelName, updateVendor, vendorRegister } from '@/lib/vn-vendor-sync/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try { return buildApiSuccess(await vendorRegister(auth.canEdit)) }
  catch (err) { return buildApiError(err instanceof Error ? err.message : 'Could not load vendor register', 500) }
}

export async function POST(req: NextRequest) {
  const auth = await vendorSyncSession('edit')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; name?: string; phone?: string | null; whatsappPhone?: string | null; excelName?: string | null; services?: string | null; rows?: { name: string; phone: string | null }[] }
  try {
    let result
    switch (body.action) {
      case 'register': result = await registerVendor({ name: body.name ?? '', phone: body.phone, whatsappPhone: body.whatsappPhone, excelName: body.excelName, services: body.services }, auth.actor); break
      case 'update':
        if (!body.id) return buildApiError('Vendor id is required')
        result = await updateVendor(body.id, { name: body.name, phone: body.phone, whatsappPhone: body.whatsappPhone, services: body.services }, auth.actor); break
      case 'link':
        if (!body.excelName || !body.id) return buildApiError('Excel name and vendor id are required')
        result = await linkExcelName(body.excelName, body.id, auth.actor); break
      case 'unlink':
        if (!body.excelName) return buildApiError('Excel name is required')
        result = await unlinkExcelName(body.excelName); break
      case 'registerMany': result = await registerMany(Array.isArray(body.rows) ? body.rows.filter(r => r && typeof r.name === 'string').slice(0, 300) : [], auth.actor); break
      case 'fill': result = await fillVendorPhones('ALL'); break
      default: return buildApiError('Unknown register action')
    }
    return 'ok' in result && result.ok === false ? buildApiError(result.message, 400) : buildApiSuccess(result)
  } catch (err) { return buildApiError(err instanceof Error ? err.message : 'Could not save vendor', 400) }
}
