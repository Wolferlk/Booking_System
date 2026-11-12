/**
 * VN Vendor Sync (Excel checklist → movement Tour Vendor) was retired on
 * 2026-11-12. The old address now opens VN Driver Sync, which fills each
 * movement's DRIVER from the VN team's Movement Chart. The previous page is
 * in git history (before this change) if it is ever needed again.
 */
import { redirect } from 'next/navigation'

export default function RetiredVendorSyncPage() {
  redirect('/dashboard/checklist-vn/driver-sync')
}
