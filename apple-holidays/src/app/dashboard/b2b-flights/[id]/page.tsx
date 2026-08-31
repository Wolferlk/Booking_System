'use client'

/**
 * One Aahaas B2B booking, fully expanded.
 *
 * Everything on this page comes from `/api/b2b-flights/[id]`, which reads the
 * five B2B tables and nothing else. There is no action on this page that writes
 * anywhere — the only outbound calls are the two document endpoints, which
 * render PDFs from the same read model.
 *
 * Layout: a passport-style hero, then one section per component type. Flights
 * are drawn as boarding passes (segment ribbon + passenger manifest + tickets)
 * because that is how the desk reads them; the other components are fact grids
 * with their own sub-tables. Every raw JSON blob stays reachable through the
 * inspector at the bottom of its card, so nothing in the record is hidden.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BedDouble, Building2, CalendarDays, Check,
  ChevronDown, Clock, Copy, CreditCard, Download, ExternalLink, FileText, Loader2,
  Luggage, Plane, Receipt, Shield, Sparkles, Ticket, User, Users,
} from 'lucide-react'
import Header from '@/components/layout/header'

// ─── Types (mirror lib/b2b-flights.ts) ────────────────────────────────────────

interface Segment {
  airlineCode: string | null; airlineName: string | null; flightNumber: string | null
  fromAirportCode: string | null; toAirportCode: string | null
  departureDate: string | null; departureTime: string | null
  arrivalDate: string | null; arrivalTime: string | null
  departureTerminal: string | null; arrivalTerminal: string | null
  departureGate: string | null; arrivalGate: string | null
  cabinTypeName: string | null; bookingClass: string | null; aircraftTypeName: string | null
  durationInMinutes: number | null; distanceInMiles: number | null
  status: string | null; confirmationId: string | null
  baggage: { checkedKg: number | null; cabinKg: number | null; cabinPieces: number | null } | null
}

interface Traveler {
  type: string | null; givenName: string | null; surname: string | null; fullName: string | null
  email: string | null; phone: string | null
  documents: { type: string | null; number: string | null; nationality: string | null; expiry: string | null }[]
  ticketNumber: string | null
}

interface Flight {
  id: number; pnr: string | null; bookingType: string | null
  aahaasBookingId: number | null; aahaasOrderId: number | null
  airlineCode: string | null; airlineName: string | null
  departureCity: string | null; arrivalCity: string | null
  departureDate: string | null; returnDate: string | null; tripType: string | null
  adults: number | null; children: number | null; infants: number | null
  cabinClass: string | null
  baseFare: number | null; taxes: number | null; total: number | null; currency: string | null
  status: string | null; ticketStatus: string | null
  issuedAt: string | null; ticketedAt: string | null
  segments: Segment[]; travelers: Traveler[]
  fareTotals: { subtotal: number | null; taxes: number | null; total: number | null; currency: string | null } | null
  fareRules: { passengerCode: string | null; refundable: boolean | null; changeable: boolean | null }[]
  tickets: { number: string | null; date: string | null; statusName: string | null; total: number | null; currency: string | null }[]
  raw: { flightData: unknown; passengerData: unknown }
}

interface Hotel {
  id: number; hotelName: string | null; hotelCode: string | null; starRating: number | null
  city: string | null; country: string | null
  checkIn: string | null; checkOut: string | null; nights: number | null; rooms: number | null
  adults: number | null; children: number | null
  roomCategory: string | null; roomType: string | null; mealPlan: string | null
  roomRate: number | null; total: number | null; currency: string | null
  status: string | null; confirmationNumber: string | null; specialRequests: string | null
  confirmedAt: string | null
  guests: { name: string | null; type: string | null }[]
  roomBreakdown: unknown; cancellation: unknown
  raw: { hotelData: unknown; guestData: unknown }
}

interface Insurance {
  id: number; provider: string | null; policyType: string | null; planName: string | null
  policyNumber: string | null; coverageStart: string | null; coverageEnd: string | null
  coverageDays: number | null; destinationCountry: string | null; travelerCount: number | null
  premium: number | null; coverageAmount: number | null; total: number | null; currency: string | null
  status: string | null; issuedAt: string | null; expiresAt: string | null
  travelers: { name: string | null; passport: string | null; dob: string | null }[]
  coverageDetails: unknown
  raw: { insuranceData: unknown; travelerData: unknown }
}

interface Lifestyle {
  id: number; name: string | null; category: string | null; subCategory: string | null
  serviceDate: string | null; serviceTime: string | null
  adults: number | null; children: number | null; packages: number | null
  unitPrice: number | null; discount: number | null; total: number | null; paid: number | null
  currency: string | null; status: string | null; confirmationNumber: string | null
  specialRequests: string | null; confirmedAt: string | null
  participants: { name: string | null; type: string | null }[]
  cancellation: unknown
  raw: { lifestyleData: unknown; participantData: unknown }
}

interface Detail {
  id: number; uuid: string | null; reference: string; type: string | null
  orderId: number | null; categoryId: number | null; transactionId: number | null
  amount: number | null; currency: string | null
  status: string | null; orderStatus: string | null; paymentStatus: string | null
  paymentMethod: string | null; paymentReference: string | null
  createdAt: string | null; updatedAt: string | null
  agentName: string | null; agentEmail: string | null; leadTraveller: string | null
  components: { flights: number; hotels: number; insurances: number; lifestyles: number }
  routes: string[]; travelDate: string | null; pnrs: string[]; pax: number | null
  bookingData: unknown
  flights: Flight[]; hotels: Hotel[]; insurances: Insurance[]; lifestyles: Lifestyle[]
  warnings: string[]
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function money(v: number | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const n = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${n}` : n
}

function d(v: string | null | undefined): string {
  if (!v) return '—'
  const dt = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T') + 'Z')
  if (Number.isNaN(dt.getTime())) return String(v)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function dt(v: string | null | undefined): string {
  if (!v) return '—'
  const x = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T') + 'Z')
  if (Number.isNaN(x.getTime())) return String(v)
  return x.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

function dur(mins: number | null | undefined): string {
  if (!mins || !Number.isFinite(mins)) return '—'
  const h = Math.floor(mins / 60), m = mins % 60
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`
}

function tone(status: string | null | undefined): string {
  const v = (status ?? '').toLowerCase()
  if (['confirmed', 'ticketed', 'issued', 'paid', 'active', 'success'].includes(v)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (['pending', 'processing', 'hold'].includes(v)) return 'bg-amber-50 text-amber-700 border-amber-200'
  if (['failed', 'cancelled', 'canceled', 'void', 'refunded'].includes(v)) return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function B2bBookingDetailPage({ params }: { params: { id: string } }) {
  const [booking, setBooking] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/b2b-flights/${params.id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Request failed')
      setBooking(json.data as Detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the booking')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { void load() }, [load])

  /** Download a PDF; a rendering failure is reported instead of a blank tab. */
  const download = useCallback(async (doc: 'details' | 'invoice') => {
    setBusy(doc)
    setDocError(null)
    try {
      const res = await fetch(`/api/b2b-flights/${params.id}/document?doc=${doc}&format=pdf`, { cache: 'no-store' })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || `PDF request failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${booking?.reference ?? params.id}-${doc}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(null)
    }
  }, [params.id, booking?.reference])

  const totals = useMemo(() => {
    if (!booking) return null
    const sum = (n: (number | null)[]) => n.reduce<number>((s, v) => s + (v ?? 0), 0)
    return {
      flights: sum(booking.flights.map((f) => f.total)),
      hotels: sum(booking.hotels.map((h) => h.total)),
      insurances: sum(booking.insurances.map((i) => i.total ?? i.premium)),
      lifestyles: sum(booking.lifestyles.map((l) => l.total)),
    }
  }, [booking])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header title="Aahaas B2B booking" />
        <div className="py-24 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Reading the booking…</p>
        </div>
      </div>
    )
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header title="Aahaas B2B booking" />
        <div className="px-4 sm:px-8 py-10">
          <div className="max-w-xl mx-auto p-6 rounded-xl border border-rose-200 bg-rose-50 text-rose-800">
            <AlertTriangle className="w-6 h-6" />
            <p className="mt-2 font-semibold">{error ?? 'Booking not found'}</p>
            <p className="text-xs mt-1">Only confirmed B2B bookings are reachable from this page.</p>
            <Link href="/dashboard/b2b-flights" className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-rose-900 hover:underline">
              <ArrowLeft className="w-4 h-4" /> Back to the board
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title={<span className="font-mono">{booking.reference}</span>}
        subtitle={
          <span className="text-xs text-slate-500">
            Aahaas B2B · order #{booking.orderId ?? '—'} · booked {dt(booking.createdAt)}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href={`/api/b2b-flights/${booking.id}/document?doc=invoice&format=html`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Receipt className="w-4 h-4" /> View invoice <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <button
              onClick={() => void download('invoice')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'invoice' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Invoice PDF
            </button>
            <button
              onClick={() => void download('details')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === 'details' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Download details
            </button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-6 space-y-6 max-w-[1400px]">
        <Link href="/dashboard/b2b-flights" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-3.5 h-3.5" /> All B2B bookings
        </Link>

        {docError && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{docError}</span>
          </div>
        )}

        {booking.warnings.map((w) => (
          <div key={w} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
            <span>{w}</span>
          </div>
        ))}

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-900 via-blue-900 to-sky-700 text-white">
          <div className="p-6 flex flex-col lg:flex-row gap-6 lg:items-center justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-bold uppercase tracking-wider">
                  {booking.status ?? 'confirmed'}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-bold uppercase tracking-wider">
                  payment {booking.paymentStatus ?? '—'}
                </span>
                {booking.paymentMethod && (
                  <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-bold uppercase tracking-wider">
                    {booking.paymentMethod}
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight">
                {booking.routes.length ? booking.routes.join('  ·  ') : 'Aahaas B2B booking'}
              </h2>
              <p className="mt-1 text-sm text-white/70">
                {booking.leadTraveller ? `${booking.leadTraveller}` : 'Traveller not recorded'}
                {booking.pax ? ` · ${booking.pax} traveller${booking.pax === 1 ? '' : 's'}` : ''}
                {booking.travelDate ? ` · departs ${d(booking.travelDate)}` : ''}
              </p>
              {booking.agentName && (
                <p className="mt-1 text-xs text-white/60">
                  Booked by {booking.agentName}{booking.agentEmail ? ` · ${booking.agentEmail}` : ''}
                </p>
              )}
            </div>
            <div className="lg:text-right flex-shrink-0">
              <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">Total charged</p>
              <p className="text-3xl font-bold tabular-nums">{money(booking.amount, booking.currency)}</p>
              {booking.paymentReference && (
                <CopyLine label="Payment ref" value={booking.paymentReference} />
              )}
              {booking.uuid && <CopyLine label="UUID" value={booking.uuid} />}
            </div>
          </div>

          {/* Component ribbon */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-white/15">
            <Ribbon icon={<Plane className="w-4 h-4" />} label="Flights" count={booking.components.flights} amount={money(totals?.flights ?? null, booking.currency)} />
            <Ribbon icon={<BedDouble className="w-4 h-4" />} label="Hotels" count={booking.components.hotels} amount={money(totals?.hotels ?? null, booking.currency)} />
            <Ribbon icon={<Shield className="w-4 h-4" />} label="Insurance" count={booking.components.insurances} amount={money(totals?.insurances ?? null, booking.currency)} />
            <Ribbon icon={<Sparkles className="w-4 h-4" />} label="Experiences" count={booking.components.lifestyles} amount={money(totals?.lifestyles ?? null, booking.currency)} />
          </div>
        </div>

        {/* ── Order facts ─────────────────────────────────────────────────── */}
        <Card title="Order record" icon={<CreditCard className="w-4 h-4" />}>
          <Facts items={[
            ['Reference', booking.reference],
            ['Internal id', booking.id],
            ['UUID', booking.uuid],
            ['Type', booking.type],
            ['Aahaas order id', booking.orderId],
            ['Category id', booking.categoryId],
            ['Transaction id', booking.transactionId],
            ['Order status', booking.orderStatus],
            ['Payment status', booking.paymentStatus],
            ['Payment method', booking.paymentMethod],
            ['Payment reference', booking.paymentReference],
            ['Amount', money(booking.amount, booking.currency)],
            ['Created', dt(booking.createdAt)],
            ['Updated', dt(booking.updatedAt)],
          ]} />
          <Inspector label="booking_data" value={booking.bookingData} />
        </Card>

        {/* ── Flights ─────────────────────────────────────────────────────── */}
        {booking.flights.length > 0 && (
          <Section title="Flights" icon={<Plane className="w-4 h-4" />} count={booking.flights.length}>
            {booking.flights.map((f) => <FlightCard key={f.id} f={f} />)}
          </Section>
        )}

        {booking.hotels.length > 0 && (
          <Section title="Hotels" icon={<BedDouble className="w-4 h-4" />} count={booking.hotels.length}>
            {booking.hotels.map((h) => <HotelCard key={h.id} h={h} />)}
          </Section>
        )}

        {booking.insurances.length > 0 && (
          <Section title="Travel insurance" icon={<Shield className="w-4 h-4" />} count={booking.insurances.length}>
            {booking.insurances.map((i) => <InsuranceCard key={i.id} i={i} />)}
          </Section>
        )}

        {booking.lifestyles.length > 0 && (
          <Section title="Experiences" icon={<Sparkles className="w-4 h-4" />} count={booking.lifestyles.length}>
            {booking.lifestyles.map((l) => <LifestyleCard key={l.id} l={l} />)}
          </Section>
        )}

        {!booking.flights.length && !booking.hotels.length && !booking.insurances.length && !booking.lifestyles.length && (
          <div className="p-10 text-center rounded-xl border border-dashed border-slate-300 bg-white">
            <Ticket className="w-8 h-8 mx-auto text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">This confirmed order has no component rows.</p>
            <p className="text-xs text-slate-400 mt-1">Everything known about it is in the order record above.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Ribbon({ icon, label, count, amount }: { icon: React.ReactNode; label: string; count: number; amount: string }) {
  return (
    <div className={`px-5 py-3 border-r border-white/10 last:border-r-0 ${count ? '' : 'opacity-40'}`}>
      <div className="flex items-center gap-2 text-white/70">
        {icon}<span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold">
        {count ? `${count} × ` : '—'}<span className="tabular-nums font-normal text-white/80">{count ? amount : ''}</span>
      </p>
    </div>
  )
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400) }}
      className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span className="font-mono truncate max-w-[220px]">{value}</span>
    </button>
  )
}

function Section({ title, icon, count, children }: {
  title: string; icon: React.ReactNode; count: number; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600">{icon}</span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h3>
        <span className="px-1.5 py-0.5 rounded-md bg-slate-200/70 text-slate-600 text-[10px] font-bold">{count}</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Card({ title, icon, badge, right, children }: {
  title: React.ReactNode; icon?: React.ReactNode; badge?: string | null; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-slate-500">{icon}</span>}
          <h4 className="font-semibold text-slate-800 text-sm truncate">{title}</h4>
          {badge && (
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${tone(badge)}`}>{badge}</span>
          )}
        </div>
        {right}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function Facts({ items }: { items: [string, unknown][] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
      {items.filter(([, v]) => v !== undefined).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</p>
          <p className="text-sm text-slate-800 break-words">
            {v === null || v === '' ? <span className="text-slate-300">—</span> : String(v)}
          </p>
        </div>
      ))}
    </div>
  )
}

function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            {head.map((h) => (
              <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => <td key={j} className="px-3 py-2 text-slate-700 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Collapsed raw JSON, so no stored field is unreachable from the UI. */
function Inspector({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false)
  if (value === null || value === undefined) return null
  return (
    <div className="pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-700"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        Raw <code className="font-mono">{label}</code>
      </button>
      {open && (
        <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] leading-relaxed overflow-x-auto max-h-96">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── Component cards ──────────────────────────────────────────────────────────

function FlightCard({ f }: { f: Flight }) {
  return (
    <Card
      icon={<Plane className="w-4 h-4" />}
      title={
        <span className="flex items-center gap-2">
          {f.airlineName || f.airlineCode || 'Flight'}
          {f.pnr && <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">PNR {f.pnr}</span>}
        </span>
      }
      badge={f.ticketStatus ?? f.status}
      right={<span className="text-sm font-bold text-emerald-700 whitespace-nowrap">{money(f.total, f.currency)}</span>}
    >
      {/* Segment ribbon — the boarding-pass view */}
      <div className="space-y-3">
        {f.segments.length ? f.segments.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-gradient-to-r from-sky-50/50 to-white p-4">
            <div className="flex items-center gap-4">
              <div className="text-center min-w-[76px]">
                <p className="text-2xl font-black tracking-tight text-slate-900">{s.fromAirportCode ?? '???'}</p>
                <p className="text-xs font-medium text-slate-600">{s.departureTime ?? '—'}</p>
                <p className="text-[10px] text-slate-400">{d(s.departureDate)}</p>
              </div>
              <div className="flex-1 relative">
                <div className="h-px bg-gradient-to-r from-sky-200 via-sky-400 to-sky-200" />
                <Plane className="w-4 h-4 text-sky-500 absolute left-1/2 -translate-x-1/2 -top-2 bg-white rounded-full" />
                <p className="mt-2 text-center text-[10px] text-slate-500">
                  {[
                    [s.airlineCode, s.flightNumber].filter(Boolean).join(' '),
                    dur(s.durationInMinutes),
                    s.cabinTypeName,
                    s.bookingClass ? `class ${s.bookingClass}` : null,
                  ].filter(Boolean).join(' · ') || 'segment'}
                </p>
              </div>
              <div className="text-center min-w-[76px]">
                <p className="text-2xl font-black tracking-tight text-slate-900">{s.toAirportCode ?? '???'}</p>
                <p className="text-xs font-medium text-slate-600">{s.arrivalTime ?? '—'}</p>
                <p className="text-[10px] text-slate-400">{d(s.arrivalDate)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-dashed border-slate-200 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
              {s.aircraftTypeName && <span>Aircraft {s.aircraftTypeName}</span>}
              {(s.departureTerminal || s.departureGate) && <span>Dep {[s.departureTerminal, s.departureGate].filter(Boolean).join(' / ')}</span>}
              {(s.arrivalTerminal || s.arrivalGate) && <span>Arr {[s.arrivalTerminal, s.arrivalGate].filter(Boolean).join(' / ')}</span>}
              {s.baggage?.checkedKg != null && (
                <span className="inline-flex items-center gap-1"><Luggage className="w-3 h-3" />{s.baggage.checkedKg} kg checked</span>
              )}
              {s.baggage?.cabinKg != null && <span>{s.baggage.cabinKg} kg cabin</span>}
              {s.status && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{s.status}</span>}
            </div>
          </div>
        )) : (
          <p className="text-xs text-slate-400">No segment detail stored in <code>flight_data</code>.</p>
        )}
      </div>

      <Facts items={[
        ['Route', [f.departureCity, f.arrivalCity].filter(Boolean).join(' → ') || null],
        ['Trip type', f.tripType],
        ['Departure', d(f.departureDate)],
        ['Return', f.returnDate ? d(f.returnDate) : null],
        ['Cabin', f.cabinClass],
        ['Pax', [f.adults ? `${f.adults} adult` : null, f.children ? `${f.children} child` : null, f.infants ? `${f.infants} infant` : null].filter(Boolean).join(', ') || null],
        ['Booking type', f.bookingType],
        ['Base fare', money(f.baseFare, f.currency)],
        ['Taxes', money(f.taxes, f.currency)],
        ['Fare total', f.fareTotals ? money(f.fareTotals.total, f.fareTotals.currency) : null],
        ['Issued at', f.issuedAt ? dt(f.issuedAt) : null],
        ['Ticketed at', f.ticketedAt ? dt(f.ticketedAt) : null],
        ['Aahaas booking id', f.aahaasBookingId],
        ['Aahaas order id', f.aahaasOrderId],
      ]} />

      {f.travelers.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Passenger manifest
          </p>
          <MiniTable
            head={['Passenger', 'Type', 'Document', 'Nationality', 'Contact', 'Ticket']}
            rows={f.travelers.map((t) => [
              <span key="n" className="font-medium text-slate-900">{t.fullName ?? '—'}</span>,
              t.type ?? '—',
              <span key="doc" className="font-mono text-xs">{t.documents[0]?.number ?? '—'}</span>,
              t.documents[0]?.nationality ?? '—',
              [t.email, t.phone].filter(Boolean).join(' · ') || '—',
              <span key="tk" className="font-mono text-xs">{t.ticketNumber ?? '—'}</span>,
            ])}
          />
        </div>
      )}

      {f.tickets.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
            <Ticket className="w-3.5 h-3.5" /> Tickets
          </p>
          <MiniTable
            head={['Ticket no.', 'Issued', 'Status', 'Amount']}
            rows={f.tickets.map((t) => [
              <span key="n" className="font-mono">{t.number ?? '—'}</span>,
              d(t.date),
              <span key="s" className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${tone(t.statusName)}`}>{t.statusName ?? '—'}</span>,
              money(t.total, t.currency ?? f.currency),
            ])}
          />
        </div>
      )}

      {f.fareRules.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {f.fareRules.map((r, i) => (
            <span key={i} className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
              {r.passengerCode ?? 'FARE'} ·{' '}
              <span className={r.refundable ? 'text-emerald-600' : 'text-rose-600'}>
                {r.refundable === null ? 'refund n/a' : r.refundable ? 'refundable' : 'non-refundable'}
              </span>{' '}·{' '}
              <span className={r.changeable ? 'text-emerald-600' : 'text-rose-600'}>
                {r.changeable === null ? 'change n/a' : r.changeable ? 'changeable' : 'non-changeable'}
              </span>
            </span>
          ))}
        </div>
      )}

      <Inspector label="flight_data" value={f.raw.flightData} />
      <Inspector label="passenger_data" value={f.raw.passengerData} />
    </Card>
  )
}

function HotelCard({ h }: { h: Hotel }) {
  return (
    <Card
      icon={<Building2 className="w-4 h-4" />}
      title={
        <span className="flex items-center gap-2">
          {h.hotelName ?? 'Hotel'}
          {h.starRating ? <span className="text-amber-500 text-xs">{'★'.repeat(Math.min(h.starRating, 5))}</span> : null}
        </span>
      }
      badge={h.status}
      right={<span className="text-sm font-bold text-emerald-700 whitespace-nowrap">{money(h.total, h.currency)}</span>}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 font-medium">
          <CalendarDays className="w-3.5 h-3.5" /> {d(h.checkIn)}
        </span>
        <ArrowRight className="w-4 h-4 text-slate-300" />
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 font-medium">
          <CalendarDays className="w-3.5 h-3.5" /> {d(h.checkOut)}
        </span>
        {h.nights ? <span className="text-xs text-slate-500">{h.nights} night{h.nights === 1 ? '' : 's'}</span> : null}
      </div>

      <Facts items={[
        ['City', [h.city, h.country].filter(Boolean).join(', ') || null],
        ['Hotel code', h.hotelCode],
        ['Rooms', h.rooms],
        ['Room category', h.roomCategory],
        ['Room type', h.roomType],
        ['Meal plan', h.mealPlan],
        ['Guests', [h.adults ? `${h.adults} adult` : null, h.children ? `${h.children} child` : null].filter(Boolean).join(', ') || null],
        ['Room rate', money(h.roomRate, h.currency)],
        ['Confirmation no.', h.confirmationNumber],
        ['Confirmed at', h.confirmedAt ? dt(h.confirmedAt) : null],
      ]} />

      {h.guests.length > 0 && (
        <MiniTable head={['Guest', 'Type']} rows={h.guests.map((g) => [g.name ?? '—', g.type ?? '—'])} />
      )}

      {h.specialRequests && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-900">
          <span className="font-semibold">Special requests: </span>{h.specialRequests}
        </div>
      )}

      <Inspector label="room_breakdown" value={h.roomBreakdown} />
      <Inspector label="cancellation_info" value={h.cancellation} />
      <Inspector label="hotel_data" value={h.raw.hotelData} />
      <Inspector label="guest_data" value={h.raw.guestData} />
    </Card>
  )
}

function InsuranceCard({ i }: { i: Insurance }) {
  return (
    <Card
      icon={<Shield className="w-4 h-4" />}
      title={<span>{i.planName ?? i.policyType ?? 'Travel insurance'} <span className="text-slate-400 font-normal">{i.provider ?? ''}</span></span>}
      badge={i.status}
      right={<span className="text-sm font-bold text-emerald-700 whitespace-nowrap">{money(i.total ?? i.premium, i.currency)}</span>}
    >
      <Facts items={[
        ['Policy no.', i.policyNumber],
        ['Policy type', i.policyType],
        ['Destination', i.destinationCountry],
        ['Cover from', d(i.coverageStart)],
        ['Cover to', d(i.coverageEnd)],
        ['Days', i.coverageDays],
        ['Travellers', i.travelerCount],
        ['Premium', money(i.premium, i.currency)],
        ['Sum insured', money(i.coverageAmount, i.currency)],
        ['Issued at', i.issuedAt ? dt(i.issuedAt) : null],
        ['Expires', i.expiresAt ? dt(i.expiresAt) : null],
      ]} />

      {i.travelers.length > 0 && (
        <MiniTable
          head={['Traveller', 'Passport / NIC', 'Date of birth']}
          rows={i.travelers.map((t) => [
            <span key="n" className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-slate-400" />{t.name ?? '—'}</span>,
            <span key="p" className="font-mono text-xs">{t.passport ?? '—'}</span>,
            t.dob ? d(t.dob) : '—',
          ])}
        />
      )}

      <Inspector label="coverage_details" value={i.coverageDetails} />
      <Inspector label="insurance_data" value={i.raw.insuranceData} />
      <Inspector label="traveler_data" value={i.raw.travelerData} />
    </Card>
  )
}

function LifestyleCard({ l }: { l: Lifestyle }) {
  return (
    <Card
      icon={<Sparkles className="w-4 h-4" />}
      title={l.name ?? 'Experience'}
      badge={l.status}
      right={<span className="text-sm font-bold text-emerald-700 whitespace-nowrap">{money(l.total, l.currency)}</span>}
    >
      <Facts items={[
        ['Category', [l.category, l.subCategory].filter(Boolean).join(' · ') || null],
        ['Service date', d(l.serviceDate)],
        ['Time', l.serviceTime],
        ['Adults', l.adults],
        ['Children', l.children],
        ['Packages', l.packages],
        ['Unit price', money(l.unitPrice, l.currency)],
        ['Discount', money(l.discount, l.currency)],
        ['Paid', money(l.paid, l.currency)],
        ['Confirmation no.', l.confirmationNumber],
        ['Confirmed at', l.confirmedAt ? dt(l.confirmedAt) : null],
      ]} />

      {l.participants.length > 0 && (
        <MiniTable head={['Participant', 'Type']} rows={l.participants.map((p) => [p.name ?? '—', p.type ?? '—'])} />
      )}

      {l.specialRequests && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-900">
          <span className="font-semibold">Special requests: </span>{l.specialRequests}
        </div>
      )}

      <Inspector label="cancellation_info" value={l.cancellation} />
      <Inspector label="lifestyle_data" value={l.raw.lifestyleData} />
      <Inspector label="participant_data" value={l.raw.participantData} />
    </Card>
  )
}
