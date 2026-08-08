import { createPartnerItemHandlers } from '@/lib/partner-routes'

export const dynamic = 'force-dynamic'

export const { GET, PUT, DELETE } = createPartnerItemHandlers('tourVendor')
