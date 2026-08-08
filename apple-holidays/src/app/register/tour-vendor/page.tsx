import { Suspense } from 'react'
import BrandLoader from '@/components/shared/brand-loader'
import PartnerRegisterForm from '@/components/partners/partner-register-form'

export const metadata = {
  title: 'Tour Vendor Registration · Apple Holidays',
  description: 'Register as a tour vendor with Apple Holidays.',
}

export default function TourVendorRegisterPage() {
  return (
    <Suspense fallback={<BrandLoader label="Loading…" />}>
      <PartnerRegisterForm kind="tourVendor" />
    </Suspense>
  )
}
