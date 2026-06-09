'use client'

import { useEffect, useState } from 'react'
import { Loader2, Shield, Search } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/rbac'
import type { BookingStatus, UserRole } from '@prisma/client'

interface Event {
  id: string; fromState?: BookingStatus; toState: BookingStatus; note: string | null; createdAt: string
  actor: { name: string; role: UserRole }
  booking: { bookingRef: string }
}

export default function AuditLogPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    // In a real app, this would have a dedicated /api/audit endpoint
    // Using bookings to get status events via the booking detail endpoint
    fetch('/api/bookings?limit=5')
      .then(r => r.json())
      .then(async j => {
        if (!j.success) return
        const allEvents: Event[] = []
        for (const booking of j.data.bookings) {
          const res = await fetch(`/api/bookings/${booking.bookingRef}`)
          const json = await res.json()
          if (json.success && json.data.statusEvents) {
            json.data.statusEvents.forEach((e: Event) => {
              allEvents.push({ ...e, booking: { bookingRef: booking.bookingRef } })
            })
          }
        }
        allEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setEvents(allEvents)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = events.filter(e =>
    !search ||
    e.booking.bookingRef.includes(search.toUpperCase()) ||
    e.actor.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <Header title="Audit Log" subtitle="All system events and state transitions" />
      <div className="p-8 space-y-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="form-input pl-9 max-w-sm"
            placeholder="Search by booking ref or user..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No events found</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th><th>Booking</th><th>From</th><th>To</th><th>Actor</th><th>Role</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td className="text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(e.createdAt, 'dd MMM yyyy HH:mm')}
                    </td>
                    <td className="font-mono font-semibold text-sm">{e.booking.bookingRef}</td>
                    <td>{e.fromState ? <StatusBadge status={e.fromState} /> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td><StatusBadge status={e.toState} /></td>
                    <td className="text-sm font-medium">{e.actor.name}</td>
                    <td className="text-xs text-slate-500">{ROLE_LABELS[e.actor.role]}</td>
                    <td className="text-xs text-slate-500 max-w-[200px] truncate">{e.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
