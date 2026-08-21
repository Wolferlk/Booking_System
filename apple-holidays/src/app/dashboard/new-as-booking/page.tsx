'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PlusCircle, Search, CalendarRange, Zap, PlaneLanding, Radar, CalendarClock } from 'lucide-react'
import Header from '@/components/layout/header'
import SearchImportTab from '@/components/as-bookings/search-import-tab'
import RangeImportTab from '@/components/as-bookings/range-import-tab'
import AutoImportTab from '@/components/as-bookings/auto-import-tab'
import WatchTab from '@/components/as-bookings/watch-tab'
import PreArrivalTab from '@/components/as-bookings/prearrival-tab'

type TabKey = 'search' | 'range' | 'arrival' | 'auto' | 'watch' | 'presync'

const TABS: { key: TabKey; label: string; icon: typeof Search; hint: string }[] = [
  { key: 'search',  label: 'Search & Import',   icon: Search,        hint: 'Find one confirmation by IS / quotation number' },
  { key: 'range',   label: 'Range Import',      icon: CalendarRange, hint: 'Bulk import confirmations by create date' },
  { key: 'arrival', label: 'Arrival Import',    icon: PlaneLanding,  hint: 'Bulk import confirmations by arrival date' },
  { key: 'auto',    label: 'Daily Auto-Import', icon: Zap,           hint: 'Automatic 6 AM import + run history' },
  { key: 'watch',   label: 'Live Watch',        icon: Radar,         hint: 'Check for new confirmations every few minutes' },
  { key: 'presync', label: 'Pre-Arrival Sync',  icon: CalendarClock, hint: 'Refresh bookings from the API a few days before arrival' },
]

function isTabKey(v: string | null): v is TabKey {
  return !!v && TABS.some((t) => t.key === v)
}

function NewASBookingInner() {
  // `?tab=` lets other pages deep-link straight to a tab — the All Bookings
  // fetch pill points its settings link at `?tab=watch`.
  const params = useSearchParams()
  const initial = params.get('tab')
  const [tab, setTab] = useState<TabKey>(isTabKey(initial) ? initial : 'search')

  return (
    <div>
      <Header
        title={
          <span className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-brand-500" />
            New Booking · AppleSystem
          </span>
        }
        subtitle="Import confirmed AppleSystem quotations into the system — one at a time, in bulk, or automatically"
      />

      <div className="p-4 sm:p-8 space-y-5">
        {/* ── Tab bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1.5 w-full sm:w-auto sm:inline-flex">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {tab === 'search' && <SearchImportTab />}
        {tab === 'range' && <RangeImportTab key="range" dateField="create" />}
        {tab === 'arrival' && <RangeImportTab key="arrival" dateField="arrival" />}
        {tab === 'auto' && <AutoImportTab />}
        {tab === 'watch' && <WatchTab />}
        {tab === 'presync' && <PreArrivalTab />}
      </div>
    </div>
  )
}

export default function NewASBookingPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <NewASBookingInner />
    </Suspense>
  )
}
