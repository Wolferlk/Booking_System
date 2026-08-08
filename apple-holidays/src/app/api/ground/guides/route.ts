import { createPartnerCollectionHandlers } from '@/lib/partner-routes'

export const dynamic = 'force-dynamic'

export const { GET, POST } = createPartnerCollectionHandlers('guide')
