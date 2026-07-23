'use client'

import { Suspense, useState } from 'react'
import { PlusCircle, Search, CalendarRange, Zap, PlaneLanding } from 'lucide-react'
import Header from '@/components/layout/header'
import SearchImportTab from '@/components/as-bookings/search-import-tab'
import RangeImportTab from '@/components/as-bookings/range-import-tab'
import AutoImportTab from '@/components/as-bookings/auto-import-tab'

type TabKey = 'search' | 'range' | 'arrival' | 'auto'

const TABS: { key: TabKey; label: string; icon: typeof Search; hint: string }[] = [
  { key: 'search',  label: 'Search & Import',   icon: Search,        hint: 'Find one confirmation by IS / quotation number' },
  { key: 'range',   label: 'Range Import',      icon: CalendarRange, hint: 'Bulk import confirmations by create date' },
  { key: 'arrival', label: 'Arrival Import',    icon: PlaneLanding,  hint: 'Bulk import confirmations by arrival date' },
  { key: 'auto',    label: 'Daily Auto-Import', icon: Zap,           hint: 'Automatic 6 AM import + run history' },
]

function NewASBookingInner() {
  const [tab, setTab] = useState<TabKey>('search')

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
