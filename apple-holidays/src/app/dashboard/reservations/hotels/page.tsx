'use client'

/**
 * Hotel Contracts & Rates — the Reservation Team's window onto the contracted
 * hotel portfolio held in the live Aahaas store (`production_live1`).
 *
 * Everything on this screen is read out of that database and nothing is ever
 * written back to it: the API routes behind this page are GET-only and the
 * underlying client refuses any statement that is not a SELECT.
 *
 * Four things the desk needs, in the order it needs them:
 *   Overview     — who the property and its supplier are, and how to reach them
 *   Rate cards   — the contracted seasons, prices, allotment and blackouts
 *   Availability — can this stay actually be sold, night by night, and for how much
 *   Ops history  — what we know about trading with this property (local records)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, Building2, CalendarSearch, CheckCircle2, ExternalLink,
  Loader2, MapPin, RefreshCw, Search, Star,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { formatMoney } from '@/lib/reservation-shared'

const PAGE_SIZE = 50

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type TabKey = 'overview' | 'rates' | 'availability' | 'ops'

export default function HotelContractsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [status, setStatus] = useState('active')
  const [rateFilter, setRateFilter] = useState<'' | 'live' | 'none'>('live')
  const [page, setPage] = useState(0)

  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async (opts: { keepPage?: boolean } = {}) => {
    setLoading(true)
    setError(null)
    const offset = (opts.keepPage ? page : 0) * PAGE_SIZE
    const params = new URLSearchParams({
      status,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      facets: '1',
    })
    if (search.trim()) params.set('search', search.trim())
    if (country) params.set('country', country)
    if (rateFilter === 'live') params.set('liveRates', '1')
    if (rateFilter === 'none') params.set('noLiveRates', '1')

    try {
      const res = await fetch(`/api/reservations/hotels?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load the hotel directory')
      setRows(json.data.rows ?? [])
      setTotal(json.data.total ?? 0)
      if (json.data.facets) setFacets(json.data.facets)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [search, country, status, rateFilter, page])

  // Filters reset paging; page changes keep it. Both go through one loader.
  useEffect(() => { setPage(0) }, [search, country, status, rateFilter])
  useEffect(() => { void load({ keepPage: true }) }, [load])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Building2 className="h-5 w-5 text-brand-500" />
            Hotel Contracts &amp; Rates
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${total.toLocaleString()} propert${total === 1 ? 'y' : 'ies'}`}
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              live Aahaas data · read-only
            </span>
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => load({ keepPage: true })}
          icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Hotel, city, address or supplier…"
            className="w-72 rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>

        <select value={country} onChange={e => setCountry(e.target.value)} className={selectCls}>
          <option value="">All countries</option>
          {(facets?.countries ?? []).filter((c: any) => c.code).map((c: any) => (
            <option key={c.code} value={c.code}>{c.code} ({c.count})</option>
          ))}
        </select>

        <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">Any status</option>
        </select>

        <select value={rateFilter} onChange={e => setRateFilter(e.target.value as any)} className={selectCls}>
          <option value="live">Has current rates</option>
          <option value="none">No current rates</option>
          <option value="">Any rate state</option>
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
        <div className="space-y-2">
          <div className="max-h-[72vh] space-y-1.5 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState title="No properties match" hint="Widen the filters or clear the search." />
            ) : (
              rows.map(h => (
                <HotelRow key={h.id} hotel={h} selected={selected === h.id} onSelect={() => setSelected(h.id)} />
              ))
            )}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <Button size="sm" variant="ghost" disabled={page === 0 || loading}
                onClick={() => setPage(p => Math.max(0, p - 1))}>
                ← Previous
              </Button>
              <span>Page {page + 1} of {pages}</span>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages || loading}
                onClick={() => setPage(p => p + 1)}>
                Next →
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-[400px] rounded-lg border border-slate-200 bg-white">
          {selected === null
            ? <div className="p-4"><EmptyState title="Select a property"
                hint="Its contract, supplier, rate cards and live availability appear here." /></div>
            : <HotelDetail hotelId={selected} />}
        </div>
      </div>
    </div>
  )
}

const selectCls = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400'

// ─── List row ─────────────────────────────────────────────────────────────────

function HotelRow({ hotel, selected, onSelect }: { hotel: any; selected: boolean; onSelect: () => void }) {
  const live = Number(hotel.liveRates ?? 0)
  const currencies = (hotel.currencies ?? '').split(',').filter(Boolean)
  const active = String(hotel.hotel_status) === '1'

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left transition',
        selected ? 'border-brand-400 bg-brand-50/50 ring-1 ring-brand-200'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-800">{hotel.hotel_name ?? `Hotel #${hotel.id}`}</span>
        {!active && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">inactive</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
        {hotel.country && <span className="font-medium text-slate-500">{hotel.country}</span>}
        {hotel.city && <span className="truncate">{hotel.city}</span>}
        {hotel.star_classification && <span>· {hotel.star_classification}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={cn(
          'rounded px-1.5 py-0.5 font-medium',
          live > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
        )}>
          {live > 0 ? `${live} current rate${live === 1 ? '' : 's'}` : 'no current rates'}
        </span>
        {currencies.slice(0, 3).map((c: string) => (
          <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">{c}</span>
        ))}
        {hotel.minAdultRate && currencies.length > 0 && (
          <span className="text-slate-500">from {formatMoney(hotel.minAdultRate, currencies[0])}</span>
        )}
        {hotel.contractUntil && (
          <span className="text-slate-400">until {fmtDay(hotel.contractUntil)}</span>
        )}
      </div>
    </button>
  )
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function HotelDetail({ hotelId }: { hotelId: number }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [includeExpired, setIncludeExpired] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/reservations/hotels/${hotelId}${includeExpired ? '?expired=1' : ''}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.success) setData(j.data)
        else { setData(null); setError(j.error ?? 'Failed to load this property') }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [hotelId, includeExpired])

  // A different property invalidates the tab only when that tab cannot exist.
  useEffect(() => { setTab(t => (t === 'ops' ? 'overview' : t)) }, [hotelId])

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  if (error) {
    return <div className="p-4"><div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div></div>
  }
  if (!data) return <div className="p-4"><EmptyState title="Could not load this property" /></div>

  const { hotel, vendor, cards, roomSetup, ops } = data
  const tabs: { key: TabKey; label: string; hidden?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'rates', label: `Rate cards (${cards.length})` },
    { key: 'availability', label: 'Availability' },
    { key: 'ops', label: 'Ops history', hidden: !ops },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{hotel.hotel_name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              {hotel.star_classification && <span>{hotel.star_classification}</span>}
              {hotel.city && <span>· {hotel.city}</span>}
              {hotel.country && <span>· {hotel.country}</span>}
              <span className="font-mono text-[10px] text-slate-400">#{hotel.id}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {String(hotel.hotel_status) === '1'
              ? <Chip tone="emerald">active</Chip>
              : <Chip tone="slate">inactive</Chip>}
            {Number(hotel.auto_confirmation) === 1 && <Chip tone="brand">auto-confirm</Chip>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {tabs.filter(t => !t.hidden).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition',
                tab === t.key ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[62vh] overflow-y-auto p-4">
        {tab === 'overview' && <Overview hotel={hotel} vendor={vendor} roomSetup={roomSetup} cards={cards} />}
        {tab === 'rates' && (
          <RateCards cards={cards} includeExpired={includeExpired} onToggleExpired={setIncludeExpired} />
        )}
        {tab === 'availability' && <Availability hotelId={hotel.id} />}
        {tab === 'ops' && ops && <OpsHistory ops={ops} />}
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({ hotel, vendor, roomSetup, cards }: any) {
  const liveCards = cards.filter((c: any) => c.live).length
  const mapUrl = hotel.latitude && hotel.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${hotel.latitude},${hotel.longitude}`
    : null

  return (
    <div className="space-y-4">
      {hotel.hotel_image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hotel.hotel_image} alt={hotel.hotel_name ?? 'Hotel'}
          className="h-40 w-full rounded-lg object-cover" />
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Rate cards" value={cards.length} hint={`${liveCards} live today`} />
        <Metric label="Room categories" value={roomSetup.categories.length} />
        <Metric label="Contracting ccy" value={hotel.additional_data_1 || '—'} />
        <Metric label="Markup" value={hotel.markup ? `${Number(hotel.markup)}%` : '—'} />
      </div>

      <Section title="Property">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <Row label="Address" value={hotel.hotel_address} />
          <Row label="Micro location" value={hotel.micro_location} />
          <Row label="Contract window" value={
            hotel.start_date || hotel.end_date
              ? `${fmtDay(hotel.start_date)} → ${fmtDay(hotel.end_date)}`
              : null
          } />
          <Row label="Loaded" value={hotel.input_type} />
          <Row label="Last updated" value={hotel.updated_at ? fmtDay(hotel.updated_at) : null} />
          <Row label="Classification" value={hotel.hotel_classification} />
        </dl>
        <div className="mt-2 flex flex-wrap gap-2">
          {mapUrl && <LinkChip href={mapUrl} label="Map" icon={<MapPin className="h-3 w-3" />} />}
          {hotel.trip_advisor_link && <LinkChip href={hotel.trip_advisor_link} label="TripAdvisor" />}
        </div>
      </Section>

      <Section title="Supplier">
        {!vendor ? (
          <p className="text-xs text-slate-400">No supplier record linked to this property.</p>
        ) : (
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label="Company" value={vendor.company_name} />
            <Row label="Contact" value={[vendor.first_name, vendor.last_name].filter(Boolean).join(' ')} />
            <Row label="Email" value={vendor.email} />
            <Row label="Phone" value={[vendor.phone, vendor.additional_number_1, vendor.additional_number_2]
              .filter(Boolean).join(' · ')} />
            <Row label="Address" value={vendor.address} />
            <Row label="Business" value={vendor.business_type || vendor.nature_of_business} />
            <Row label="Cancellation policy" value={vendor.cancellation_policy} />
            <Row label="Payment policy" value={vendor.payment_policy} />
          </dl>
        )}
      </Section>

      {(roomSetup.categories.length > 0 || roomSetup.types.length > 0) && (
        <Section title="Rooms on file">
          <div className="flex flex-wrap gap-1">
            {roomSetup.categories.map((c: string) => (
              <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{c}</span>
            ))}
            {roomSetup.types.map((t: string) => (
              <span key={t} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">{t}</span>
            ))}
          </div>
        </Section>
      )}

      {hotel.sub_description && (
        <Section title="Description">
          <p className="text-xs leading-relaxed text-slate-600">{hotel.sub_description}</p>
        </Section>
      )}
    </div>
  )
}

// ─── Rate cards ───────────────────────────────────────────────────────────────

function RateCards({ cards, includeExpired, onToggleExpired }: {
  cards: any[]; includeExpired: boolean; onToggleExpired: (v: boolean) => void
}) {
  const [open, setOpen] = useState<string | null>(cards[0]?.key ?? null)

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[11px] text-slate-500">
        <input type="checkbox" checked={includeExpired} onChange={e => onToggleExpired(e.target.checked)} />
        Include closed seasons
      </label>

      {cards.length === 0 ? (
        <EmptyState title="No contracted rates"
          hint="Nothing valid today or later is loaded for this property." />
      ) : cards.map((card: any) => (
        <div key={card.key} className={cn(
          'rounded-lg border',
          card.live ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white',
        )}>
          <button onClick={() => setOpen(o => (o === card.key ? null : card.key))}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-800">
                <span>{fmtDay(card.validFrom)} → {fmtDay(card.validTo)}</span>
                {card.live && <Chip tone="emerald">live</Chip>}
                {card.expired && <Chip tone="slate">closed</Chip>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                <span>{card.market || 'All markets'}</span>
                {card.currency && <span className="font-mono">{card.currency}</span>}
                {card.mealPlans.length > 0 && <span>{card.mealPlans.join(' / ')}</span>}
                <span>{card.lines.length} room line{card.lines.length === 1 ? '' : 's'}</span>
                {card.bookByDays !== null && <span>book {card.bookByDays}d ahead</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {card.lowestAdultRate !== null && (
                <div className="text-xs font-semibold tabular-nums text-slate-800">
                  {formatMoney(card.lowestAdultRate, card.currency ?? 'USD')}
                </div>
              )}
              {card.blackoutDates.length > 0 && (
                <div className="text-[10px] font-medium text-red-600">
                  {card.blackoutDates.length} blackout day{card.blackoutDates.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </button>

          {open === card.key && (
            <div className="space-y-3 border-t border-slate-200 px-3 py-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="pb-1 pr-2 font-semibold">Room</th>
                      <th className="pb-1 pr-2 font-semibold">Type</th>
                      <th className="pb-1 pr-2 font-semibold">Plan</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Adult</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Child +bed</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Child −bed</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Nett</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Occ.</th>
                      <th className="pb-1 text-right font-semibold">Allot.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {card.lines.map((l: any) => (
                      <tr key={l.id}>
                        <td className="py-1 pr-2 text-slate-700">{l.roomCategory ?? '—'}</td>
                        <td className="py-1 pr-2 text-slate-500">{l.roomType ?? '—'}</td>
                        <td className="py-1 pr-2 text-slate-500">{l.mealPlan ?? '—'}</td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-800">
                          {l.adultRate === null ? '—' : l.adultRate.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-500">
                          {l.childWithBedRate === null ? '—' : l.childWithBedRate.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-500">
                          {l.childNoBedRate === null ? '—' : l.childNoBedRate.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">
                          {l.nettAdultRate === null ? '—' : l.nettAdultRate.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right text-slate-500">
                          {[l.maxAdults, l.maxChildren].some(v => v !== null)
                            ? `${l.maxAdults ?? '–'}A/${l.maxChildren ?? '–'}C`
                            : '—'}
                        </td>
                        <td className="py-1 text-right text-slate-500">{l.allotment ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <SubHead>Child age bands</SubHead>
                  <dl className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                    <AgeRow label="FOC" value={card.childAges.foc} />
                    <AgeRow label="Child without bed" value={card.childAges.withoutBed} />
                    <AgeRow label="Child with bed" value={card.childAges.withBed} />
                    <AgeRow label="Adult" value={card.childAges.adult} />
                  </dl>
                  {card.paymentType && (
                    <p className="mt-1.5 text-[11px] text-slate-500">Terms: {card.paymentType}</p>
                  )}
                </div>
                <div>
                  <SubHead>Blackouts</SubHead>
                  {card.blackoutDates.length === 0 && card.blackoutWeekdays.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-400">None on this card.</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {card.blackoutWeekdays.map((w: number) => (
                        <span key={`w${w}`} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          every {WEEKDAY_LABELS[w]}
                        </span>
                      ))}
                      {card.blackoutDates.map((d: string) => (
                        <span key={d} className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-600">
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                  <UnreadableNote lines={card.lines} />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Contract blackout text that could not be parsed. Shown rather than swallowed:
 * a note we cannot read may hide a closed date, and the operator must know that
 * before they promise the room.
 */
function UnreadableNote({ lines }: { lines: any[] }) {
  const notes = Array.from(new Set(lines.flatMap((l: any) => l.unreadableBlackout as string[]))).slice(0, 6)
  if (notes.length === 0) return null
  return (
    <p className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-700">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>Unparsed blackout note — verify with the hotel: {notes.join(' · ')}</span>
    </p>
  )
}

// ─── Availability ─────────────────────────────────────────────────────────────

function Availability({ hotelId }: { hotelId: number }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [checkIn, setCheckIn] = useState(today)
  const [checkOut, setCheckOut] = useState(() => {
    const d = new Date(Date.now() + 86_400_000)
    return d.toISOString().slice(0, 10)
  })
  const [adults, setAdults] = useState(2)
  const [childrenWithBed, setChildrenWithBed] = useState(0)
  const [childrenNoBed, setChildrenNoBed] = useState(0)
  const [rooms, setRooms] = useState(1)
  const [nationality, setNationality] = useState('')

  const [result, setResult] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    const params = new URLSearchParams({
      checkIn, checkOut,
      adults: String(adults),
      childrenWithBed: String(childrenWithBed),
      childrenNoBed: String(childrenNoBed),
      rooms: String(rooms),
    })
    if (nationality.trim()) params.set('nationality', nationality.trim())
    try {
      const res = await fetch(`/api/reservations/hotels/${hotelId}/availability?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Availability check failed')
      setResult(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Availability check failed')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }, [hotelId, checkIn, checkOut, adults, childrenWithBed, childrenNoBed, rooms, nationality])

  // A new property invalidates the previous property's answer.
  useEffect(() => { setResult(null) }, [hotelId])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <NumField label="Check-in" type="date" value={checkIn} onChange={setCheckIn} className="w-36" />
        <NumField label="Check-out" type="date" value={checkOut} onChange={setCheckOut} className="w-36" />
        <NumField label="Adults" type="number" value={String(adults)} onChange={v => setAdults(Number(v) || 0)} className="w-16" />
        <NumField label="Ch +bed" type="number" value={String(childrenWithBed)} onChange={v => setChildrenWithBed(Number(v) || 0)} className="w-16" />
        <NumField label="Ch −bed" type="number" value={String(childrenNoBed)} onChange={v => setChildrenNoBed(Number(v) || 0)} className="w-16" />
        <NumField label="Rooms" type="number" value={String(rooms)} onChange={v => setRooms(Number(v) || 1)} className="w-16" />
        <NumField label="Market" type="text" value={nationality} onChange={setNationality} className="w-24" placeholder="e.g. LK" />
        <Button size="sm" onClick={run} loading={running}
          icon={<CalendarSearch className="h-3.5 w-3.5" />}>
          Check
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {!result ? (
        <EmptyState title="Check a stay"
          hint="Every contracted rate is tested night by night against blackouts, stop-sale and allotment." />
      ) : (
        <>
          <div className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            result.verdict === 'available' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : result.verdict === 'blocked' ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-600',
          )}>
            {result.verdict === 'available'
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <Ban className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <p className="font-medium">
                {result.verdict === 'available'
                  ? `${result.sellableCount} rate${result.sellableCount === 1 ? '' : 's'} sellable for ${result.nights} night${result.nights === 1 ? '' : 's'}`
                  : result.verdict === 'blocked'
                    ? 'No rate clears every night of this stay'
                    : 'No contracted rate covers these dates'}
              </p>
              {result.onRequestOnly && (
                <p className="mt-0.5 text-[11px] opacity-80">
                  This property keeps no per-date allotment — confirm on request with the hotel.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {result.results.slice(0, 40).map((r: any) => (
              <RateResult key={r.rateId} r={r} />
            ))}
            {result.results.length > 40 && (
              <p className="text-[11px] text-slate-400">
                Showing the 40 closest matches of {result.results.length}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RateResult({ r }: { r: any }) {
  const reasons = [
    !r.occupancy.fits && 'occupancy exceeded',
    !r.leadTimeOk && `needs ${r.leadTimeDays} days' notice`,
    ...Array.from(new Set(r.nights.filter((n: any) => !n.ok).map((n: any) => REASON_LABELS[n.reason as string] ?? n.reason))),
  ].filter(Boolean) as string[]

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2',
      r.available ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-800">
            <span>{r.roomCategory ?? 'Room'}</span>
            {r.roomType && <span className="text-slate-500">· {r.roomType}</span>}
            {r.mealPlan && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">{r.mealPlan}</span>}
            {r.available
              ? <Chip tone="emerald">sellable</Chip>
              : <Chip tone="amber">{r.blockedNights} night{r.blockedNights === 1 ? '' : 's'} blocked</Chip>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
            <span>{r.market || 'All markets'}</span>
            {r.paymentType && <span>· {r.paymentType}</span>}
            {r.allotment !== null && <span>· allot {r.allotment}</span>}
            <span className="font-mono text-slate-400">#{r.rateId}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-slate-900">
            {r.pricing.total === null ? '—' : formatMoney(r.pricing.total, r.currency ?? 'USD')}
          </div>
          {r.pricing.nettTotal !== null && (
            <div className="text-[10px] text-slate-400">nett {formatMoney(r.pricing.nettTotal, r.currency ?? 'USD')}</div>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-0.5">
        {r.nights.map((n: any) => (
          <span
            key={n.date}
            title={`${n.date}${n.ok ? (n.balance === null ? ' — open' : ` — ${n.balance} left`) : ` — ${REASON_LABELS[n.reason] ?? n.reason}`}`}
            className={cn(
              'rounded px-1 py-0.5 font-mono text-[9px]',
              n.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
            )}
          >
            {n.date.slice(5)}
          </span>
        ))}
      </div>

      {reasons.length > 0 && (
        <p className="mt-1 text-[10px] text-slate-500">Blocked by: {reasons.join(' · ')}</p>
      )}
      {r.unreadableBlackout.length > 0 && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700">
          <AlertTriangle className="h-3 w-3" /> unparsed blackout note on this rate — verify with the hotel
        </p>
      )}
    </div>
  )
}

const REASON_LABELS: Record<string, string> = {
  'blackout-date': 'blackout date',
  'blackout-weekday': 'blackout weekday',
  'stop-sale': 'stop sale',
  'no-allotment': 'no allotment left',
  'outside-window': 'outside contract window',
}

// ─── Ops history ──────────────────────────────────────────────────────────────

function OpsHistory({ ops }: { ops: any }) {
  const { profile, stats } = ops
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Matched to our own hotel record <span className="font-medium text-slate-700">{profile.name}</span> — the
        figures below are what this desk has traded, not Aahaas data.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Stays" value={stats.reservations} />
        <Metric label="Confirmed" value={stats.confirmed} />
        <Metric label="Cancelled" value={stats.cancelled} tone={stats.cancelled > 0 ? 'amber' : undefined} />
        <Metric label="Partner score" hint={stats.score === null ? 'needs 5+ stays' : undefined}
          value={stats.score === null ? '—' : (
            <span className="inline-flex items-center gap-1">{stats.score}<Star className="h-3.5 w-3.5 fill-current text-amber-400" /></span>
          )} />
        <Metric label="Total spend" value={formatMoney(stats.totalSpend, 'USD')} />
        <Metric label="Median reply" value={stats.medianResponseHours === null ? '—' : `${stats.medianResponseHours}h`} />
        <Metric label="Open invoices" value={stats.openInvoices} />
        <Metric label="Owed to us" value={formatMoney(stats.pendingCreditValue, 'USD')}
          tone={stats.pendingCreditValue > 0 ? 'red' : undefined}
          hint={`${stats.pendingCreditNotes} note(s)`} />
      </div>

      <Section title="Contact on file">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <Row label="Email" value={profile.email} />
          <Row label="Phone" value={profile.phone} />
          <Row label="WhatsApp" value={profile.whatsapp
            ? `${profile.whatsapp}${profile.whatsappVerified ? ' (verified)' : ''}`
            : null} />
          <Row label="City" value={[profile.city, profile.countryCode].filter(Boolean).join(' · ')} />
        </dl>
      </Section>
    </div>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="break-words text-xs text-slate-700">{value}</dd>
    </div>
  )
}

function AgeRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return <div className="flex justify-between gap-2"><span className="text-slate-400">{label}</span><span>{value}</span></div>
}

function Metric({ label, value, tone, hint }: {
  label: string; value: React.ReactNode; tone?: 'amber' | 'red'; hint?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn(
        'mt-0.5 text-base font-semibold tabular-nums',
        tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800',
      )}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'emerald' | 'amber' | 'slate' | 'brand'; children: React.ReactNode }) {
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-slate-100 text-slate-500',
    brand: 'bg-brand-100 text-brand-700',
  }
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', tones[tone])}>{children}</span>
}

function LinkChip({ href, label, icon }: { href: string; label: string; icon?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
      {icon ?? <ExternalLink className="h-3 w-3" />}
      {label}
    </a>
  )
}

function NumField({ label, value, onChange, type, className, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type: string; className?: string; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        min={type === 'number' ? 0 : undefined}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400',
          className,
        )}
      />
    </label>
  )
}
