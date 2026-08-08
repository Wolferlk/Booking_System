import { buildApiSuccess } from '@/lib/utils'
import { getAllEnabledCountries } from '@/lib/partner-directory-server'

export const dynamic = 'force-dynamic'

/**
 * Which countries require a guide / tour vendor.
 *
 * Public because the registration pages need it before anyone has logged in —
 * it exposes nothing but the list of countries the feature is switched on for.
 * The movement chart reads the same endpoint so both agree on what is enabled.
 */
export async function GET() {
  try {
    return buildApiSuccess(await getAllEnabledCountries())
  } catch (err) {
    // A missing settings row must not break the registration page — an empty
    // list simply renders "registration is not open yet".
    console.error('[partner-settings GET] failed:', err)
    return buildApiSuccess({ guide: [], tourVendor: [] })
  }
}
