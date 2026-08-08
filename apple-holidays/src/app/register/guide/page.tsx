import { Suspense } from 'react'
import BrandLoader from '@/components/shared/brand-loader'
import PartnerRegisterForm from '@/components/partners/partner-register-form'

export const metadata = {
  title: 'Guide Registration · Apple Holidays',
  description: 'Register as a tour guide with Apple Holidays.',
}

export default function GuideRegisterPage() {
  // The form reads `?country=` via useSearchParams, which needs a Suspense
  // boundary for the static shell to render.
  return (
    <Suspense fallback={<BrandLoader label="Loading…" />}>
      <PartnerRegisterForm kind="guide" />
    </Suspense>
  )
}
