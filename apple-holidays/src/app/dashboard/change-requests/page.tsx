'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'

interface CR {
  id: string; notes: string; targetField: string | null; status: string
  createdAt: string; resolvedAt: string | null; resolvedNote: string | null
  bookingId: string; raisedBy: { name: string; role: string }
}

// Simplified — real impl would use a dedicated API endpoint
export default function ChangeRequestsPage() {
  const { countryFilter } = useCountryFilter()
  const [crs, setCrs] = useState<CR[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams({ status: 'CHANGE_REQUESTED', limit: '50' })
    if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
    fetch(`/api/bookings?${params}`)
      .then(r => r.json())
      .then(j => { if (j.success) setCrs([]) }) // placeholder
      .finally(() => setLoading(false))
  }, [countryFilter])

  return (
    <div>
      <Header title="Change Requests" subtitle="Open correction requests from Ground Team" />
      <div className="p-8">
        {loading ? (
          <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <p className="text-sm text-blue-800">
                Change requests are shown on each booking page. Navigate to a booking in <strong>CHANGE_REQUESTED</strong> status to review and resubmit.
              </p>
            </div>
            <Link href="/dashboard/bookings?status=CHANGE_REQUESTED" className="btn btn-primary btn-sm w-fit">
              View Bookings Needing Changes <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
