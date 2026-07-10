'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { ArrowLeft, FileText } from 'lucide-react'
import Header from '@/components/layout/header'
import DriverLogPanel from '@/components/bookings/driver-log-panel'
import type { UserRole } from '@prisma/client'

export default function DriverLogDetailPage({ params }: { params: { ref: string } }) {
  const { ref } = params
  const { data: session } = useSession()
  const role = (session?.user?.role ?? '') as UserRole

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Driver Advance Sheet"
        subtitle={`Booking ${ref}`}
        actions={
          <Link
            href={`/dashboard/bookings/${ref}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <FileText className="w-4 h-4" /> Open booking
          </Link>
        }
      />

      <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-4">
        <Link
          href="/dashboard/driver-log"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-4 h-4" /> All Driver Logs
        </Link>

        {role
          ? <DriverLogPanel bookingRef={ref} role={role} defaultOpen />
          : <div className="text-sm text-slate-500">Loading…</div>}
      </div>
    </div>
  )
}
