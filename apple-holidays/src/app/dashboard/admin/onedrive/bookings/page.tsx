'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Loader2 } from 'lucide-react'
import Header from '@/components/layout/header'
import OneDriveBookingsExplorer from '@/components/bookings/onedrive-bookings-explorer'

export default function OneDriveBookingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.replace('/dashboard')
  }, [session, status, router])

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Drive Bookings"
        subtitle="Browse booking folders across all OneDrive country drives — create or open existing bookings"
      />
      <div className="p-6">
        <OneDriveBookingsExplorer />
      </div>
    </div>
  )
}
