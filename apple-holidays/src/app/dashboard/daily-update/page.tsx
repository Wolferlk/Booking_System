'use client'

import Header from '@/components/layout/header'
import DailyUpdateSheet from '@/components/daily-update/daily-update-sheet'

export default function DailyUpdatePage() {
  return (
    <>
      <Header
        title="Daily Update Sheet"
        subtitle="Upcoming arrivals with today's new bookings on top — editable, filterable, and downloadable"
      />
      <div className="px-4 py-5 sm:px-8 sm:py-6">
        <DailyUpdateSheet />
      </div>
    </>
  )
}
