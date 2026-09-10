'use client'

import Header from '@/components/layout/header'
import ActivityCheckBoard from '@/components/activity-check/activity-check-board'

export default function ActivityCheckPage() {
  return (
    <>
      <Header
        title="Activity Check"
        subtitle="Search every agenda and itinerary by activity — find which files are doing what, and when"
      />
      <div className="px-4 py-5 sm:px-8 sm:py-6">
        <ActivityCheckBoard />
      </div>
    </>
  )
}
