'use client'

/**
 * Hotel Partners — the directory, seen from the supplier-relationship side.
 *
 * The hotel profiles and their contact channels already exist for pre-checking;
 * this page adds what the Reservation Team accumulates against them: how much
 * we spend, how reliably they honour a confirmation, how fast they answer, and
 * what they currently owe us.
 *
 * The partner score is deliberately withheld below five stays. A score built on
 * two bookings is noise dressed as a number.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Loader2, RefreshCw, Search, Star } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { formatMoney } from '@/lib/reservation-shared'

export default function HotelPartnersPage() {
  const [hotels, setHotels] = useState<any[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Reuses the existing pre-checking hotel directory endpoint — there is
      // only one hotel list in this system and this page must not fork it.
      // It answers `{ profiles, master, masterError }`; only the local profiles
      // are relevant here, since a partner must exist locally to be traded with.
      const res = await fetch('/api/precheck/hotels')
      const json = await res.json()
      if (json.success) setHotels(json.data.profiles ?? [])
      else setError(json.error ?? 'Failed to load hotels')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    setDetailLoading(true)
    fetch(`/api/reservations/partners/${selected}`)
      .then(r => r.json())
      .then(j => setDetail(j.success ? j.data : null))
      .finally(() => setDetailLoading(false))
  }, [selected])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return hotels
    return hotels.filter((h: any) =>
      (h.name ?? '').toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q))
  }, [hotels, search])

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Building2 className="h-5 w-5 text-brand-500" />
            Hotel Partners
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${filtered.length} propert${filtered.length === 1 ? 'y' : 'ies'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hotel or city…"
              className="w-56 rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="max-h-[70vh] space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No hotels match" />
          ) : (
            filtered.map((h: any) => (
              <button
                key={h.id}
                onClick={() => setSelected(h.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition',
                  selected === h.id
                    ? 'border-brand-400 bg-brand-50/50 ring-1 ring-brand-200'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <div className="truncate text-xs font-medium text-slate-800">{h.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                  {h.city && <span>{h.city}</span>}
                  {h.whatsappVerified && (
                    <span className="rounded bg-emerald-100 px-1 text-emerald-700">WA verified</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {!selected ? (
            <EmptyState title="Select a property" hint="Its trading history, contracts and open money appear here." />
          ) : detailLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !detail ? (
            <EmptyState title="Could not load this property" />
          ) : (
            <PartnerDetail detail={detail} />
          )}
        </div>
      </div>
    </div>
  )
}

function PartnerDetail({ detail }: { detail: any }) {
  const { profile, stats, contracts, recent } = detail

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{profile.name}</h2>
        <p className="text-xs text-slate-500">
          {[profile.city, profile.countryCode].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Stays" value={stats.reservations} />
        <Metric label="Confirmed" value={stats.confirmed} />
        <Metric label="Cancelled" value={stats.cancelled} tone={stats.cancelled > 0 ? 'amber' : undefined} />
        <Metric
          label="Partner score"
          value={stats.score === null ? '—' : (
            <span className="inline-flex items-center gap-1">
              {stats.score}<Star className="h-3.5 w-3.5 fill-current text-amber-400" />
            </span>
          )}
          hint={stats.score === null ? 'needs 5+ stays' : undefined}
        />
        <Metric label="Total spend" value={formatMoney(stats.totalSpend, 'USD')} />
        <Metric
          label="Median reply"
          value={stats.medianResponseHours === null ? '—' : `${stats.medianResponseHours}h`}
        />
        <Metric label="Open invoices" value={stats.openInvoices} />
        <Metric
          label="Owed to us"
          value={formatMoney(stats.pendingCreditValue, 'USD')}
          tone={stats.pendingCreditValue > 0 ? 'red' : undefined}
          hint={`${stats.pendingCreditNotes} note(s)`}
        />
      </div>

      <div>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Contracts</h3>
        {contracts.length === 0 ? (
          <p className="text-xs text-slate-400">No contract on file — rates with this property are ad-hoc.</p>
        ) : (
          <div className="space-y-1">
            {contracts.map((c: any) => {
              const live = c.status === 'ACTIVE' && new Date(c.validTo) >= new Date()
              return (
                <div key={c.id} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-700">{c.contractCode ?? 'Unnamed contract'}</span>
                  <span className="text-slate-500">{fmtDay(c.validFrom)} → {fmtDay(c.validTo)}</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                  )}>
                    {live ? 'live' : c.status.toLowerCase()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Recent stays</h3>
        {recent.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing booked with this property yet.</p>
        ) : (
          <div className="space-y-1">
            {recent.slice(0, 10).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between rounded border border-slate-100 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-[11px] text-slate-500">{r.bookingRef}</span>
                <span className="text-slate-600">{fmtDay(r.checkIn)}</span>
                <span className="font-mono text-[11px] text-slate-700">{formatMoney(r.totalCost, r.currency)}</span>
                <span className="text-[10px] text-slate-400">{r.status.toLowerCase().replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({
  label, value, tone, hint,
}: { label: string; value: React.ReactNode; tone?: 'amber' | 'red'; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn(
        'mt-0.5 text-base font-semibold tabular-nums',
        tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800',
      )}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}
