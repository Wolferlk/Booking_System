'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import { formatDate, formatCurrency, computePNLTotals } from '@/lib/utils'

type SectionKey =
  | 'header' | 'bookingSummary' | 'agentNames' | 'quotedTotal'
  | 'customerNames' | 'accommodation' | 'itinerary' | 'tourAgenda'
  | 'payments' | 'pnlSummary' | 'profit' | 'drivers'
  | 'tickets' | 'termsConditions' | 'exclusions'

const SECTION_DEFS: { key: SectionKey; label: string; desc: string }[] = [
  { key: 'header',         label: 'Header',               desc: 'Logo & booking reference' },
  { key: 'bookingSummary', label: 'Booking Summary',       desc: 'Dates, pax, currency' },
  { key: 'agentNames',     label: 'Agent / Tour Operator', desc: 'Agent name & file handler' },
  { key: 'quotedTotal',    label: 'Quoted Total',          desc: 'Price shown to agent' },
  { key: 'customerNames',  label: 'Passenger Details',     desc: 'Names, passport, nationality' },
  { key: 'accommodation',  label: 'Accommodation',         desc: 'Hotel list & room types' },
  { key: 'itinerary',      label: 'Itinerary',             desc: 'Day-by-day programme' },
  { key: 'tourAgenda',     label: 'Tour Agenda',           desc: 'Detailed activity schedule' },
  { key: 'drivers',        label: 'Drivers',               desc: 'Assigned driver & vehicle' },
  { key: 'payments',       label: 'Payments',              desc: 'Payment history & balance' },
  { key: 'pnlSummary',     label: 'P&L Summary',           desc: 'Revenue & cost totals (staff only)' },
  { key: 'profit',         label: 'Profit & Margin',       desc: 'Net profit figures (staff only)' },
  { key: 'tickets',        label: 'Tickets & Vouchers',    desc: 'Each ticket on its own page' },
  { key: 'termsConditions',label: 'Terms & Conditions',    desc: 'Booking T&Cs (shown at end)' },
  { key: 'exclusions',     label: 'Exclusions',            desc: 'Not included items (shown at end)' },
]

type Sel = Record<SectionKey, boolean>

const DEFAULT_SEL: Sel = SECTION_DEFS.reduce((acc, s) => ({ ...acc, [s.key]: true }), {} as Sel)

export default function PrintBookingPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session, status: authStatus } = useSession()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [booking, setBooking] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<'select' | 'preview'>('select')
  const [sel, setSel] = useState<Sel>(DEFAULT_SEL)

  useEffect(() => {
    if (authStatus === 'unauthenticated') return
    if (authStatus !== 'authenticated') return
    fetch(`/api/bookings/${ref}`)
      .then(r => r.json())
      .then(j => { if (j.success) setBooking(j.data) })
      .finally(() => setLoading(false))
  }, [ref, authStatus])

  const role = session?.user?.role ?? ''
  const isStaff = ['BT_USER', 'GT_USER', 'TE_USER', 'SUPER_ADMIN'].includes(role)
  const canSeePnl = ['BT_USER', 'SUPER_ADMIN', 'AC_USER'].includes(role)

  if (authStatus === 'loading' || loading) return (
    <div className="flex items-center justify-center min-h-screen bg-white text-slate-500 text-sm">Loading…</div>
  )
  if (!isStaff) return (
    <div className="flex items-center justify-center min-h-screen bg-white text-red-500 text-sm">Access denied.</div>
  )
  if (!booking) return (
    <div className="flex items-center justify-center min-h-screen bg-white text-slate-500 text-sm">Booking not found.</div>
  )

  // ── data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passengers: any[] = booking.passengers ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flights: any[] = booking.flights ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accommodations: any[] = booking.accommodations ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itinerary: any[] = booking.itineraryItems ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agendaItems: any[] = booking.tourAgenda?.items ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets: any[] = booking.tickets ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: any[] = booking.payments ?? []
  const pnl = booking.pnl && canSeePnl ? computePNLTotals(booking.pnl) : null

  const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED')
  const totalPaid = confirmedPayments.reduce((s: number, p) => s + Number(p.amount ?? 0), 0)
  const balanceDue = Number(booking.quotedTotal ?? 0) - totalPaid

  // drivers deduplicated from agenda assignments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driversMap = new Map<string, any>()
  agendaItems.forEach(item => {
    if (item.assignment?.driverName) {
      const key = item.assignment.driverName
      if (!driversMap.has(key)) driversMap.set(key, item.assignment)
    }
  })
  const drivers = Array.from(driversMap.values())

  // ── selection phase
  if (phase === 'select') {
    const toggleAll = (v: boolean) =>
      setSel(SECTION_DEFS.reduce((acc, s) => ({ ...acc, [s.key]: v }), {} as Sel))

    return (
      <div className="min-h-screen bg-slate-50 flex items-start justify-center py-12 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg">
          <div className="p-6 border-b border-slate-100">
            <h1 className="text-xl font-bold text-slate-900">Print Options</h1>
            <p className="text-sm text-slate-500 mt-1">
              Select the sections to include in the document for <span className="font-mono font-semibold text-brand-700">{ref}</span>
            </p>
          </div>
          <div className="p-6 space-y-2 max-h-[60vh] overflow-y-auto">
            {SECTION_DEFS.map(s => (
              <label key={s.key} className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={sel[s.key]}
                  onChange={e => setSel(prev => ({ ...prev, [s.key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-brand-600 flex-shrink-0"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-800">{s.label}</div>
                  <div className="text-xs text-slate-400">{s.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="p-6 border-t border-slate-100 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button onClick={() => toggleAll(true)}  className="text-xs text-brand-600 hover:underline">All</button>
              <span className="text-slate-300">|</span>
              <button onClick={() => toggleAll(false)} className="text-xs text-slate-400 hover:underline">None</button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.close()} className="btn btn-secondary btn-sm">Cancel</button>
              <button
                onClick={() => setPhase('preview')}
                className="btn btn-primary btn-sm"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── preview / print phase
  const show = (k: SectionKey) => sel[k]

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8fafc; font-family: 'Inter', Arial, sans-serif; }
        @media print {
          body { background: white; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; break-before: page; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      `}</style>

      {/* Toolbar – hidden on print */}
      <div className="no-print sticky top-0 z-50 bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-brand-400">{ref}</span>
          <span className="text-slate-400 text-sm">·</span>
          <span className="text-slate-300 text-sm">{Object.values(sel).filter(Boolean).length} sections selected</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPhase('select')} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg transition-colors">
            ← Change Sections
          </button>
          <button
            onClick={() => window.print()}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition-colors"
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* A4 document */}
      <div className="max-w-[800px] mx-auto bg-white my-6 shadow-lg print:shadow-none print:my-0 print:mx-0 print:max-w-none">
        <div className="px-12 py-10 text-[13px] text-slate-800 leading-relaxed">

          {/* ── HEADER ── */}
          {show('header') && (
            <div className="flex items-center justify-between mb-8 pb-6 border-b-2 border-slate-200 avoid-break">
              <div className="flex items-center gap-4">
                <Image src="/png/aahaas.png" alt="Apple Holidays" width={160} height={60} className="object-contain" style={{ maxHeight: 56 }} />
              </div>
              <div className="text-right">
                <div className="text-2xl font-black font-mono text-slate-900">{booking.bookingRef}</div>
                <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">
                  {booking.status?.replace(/_/g, ' ')}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Printed: {formatDate(new Date().toISOString())}</div>
              </div>
            </div>
          )}

          {/* ── BOOKING SUMMARY ── */}
          {show('bookingSummary') && (
            <PrintSection title="Booking Summary">
              <div className="grid grid-cols-3 gap-x-8 gap-y-4">
                {show('agentNames') && <>
                  <Field label="Agent / Tour Operator" value={booking.agent} />
                  <Field label="File Handler" value={booking.fileHandler} />
                  <Field label="Agent Booking ID" value={booking.agentBookingId} />
                </>}
                <Field label="Arrival" value={formatDate(booking.arrivalDate)} />
                <Field label="Departure" value={formatDate(booking.departureDate)} />
                <Field label="Currency" value={booking.currency} />
                <Field label="Adults" value={String(booking.paxAdults ?? 0)} />
                <Field label="Children" value={String(booking.paxChildren ?? 0)} />
                {show('quotedTotal') && <Field label="Quoted Total" value={formatCurrency(booking.quotedTotal, booking.currency)} />}
              </div>
              {booking.amendmentNote && (
                <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  <span className="font-semibold">Amendment: </span>{booking.amendmentNote}
                </div>
              )}
            </PrintSection>
          )}

          {/* ── PASSENGERS ── */}
          {show('customerNames') && passengers.length > 0 && (
            <PrintSection title="Passengers">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Name</Th><Th>Type</Th><Th>Age</Th><Th>Passport No.</Th><Th>Nationality</Th><Th>Expiry</Th>
                  </tr>
                </thead>
                <tbody>
                  {passengers.map(p => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <Td>
                        {p.name}
                        {p.isLead && <span className="ml-1 text-[9px] bg-brand-100 text-brand-700 px-1 rounded">Lead</span>}
                      </Td>
                      <Td>{p.type}</Td>
                      <Td>{p.age ?? '—'}</Td>
                      <Td className="font-mono">{p.passportNo ?? '—'}</Td>
                      <Td>{p.nationality ?? '—'}</Td>
                      <Td>{p.passportExpiry ? formatDate(p.passportExpiry) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSection>
          )}

          {/* ── FLIGHTS ── */}
          {flights.length > 0 && (
            <PrintSection title="Flights">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Flight</Th><Th>Date</Th><Th>From</Th><Th>Dep.</Th><Th>To</Th><Th>Arr.</Th><Th>Class</Th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map(f => (
                    <tr key={f.id} className="border-b border-slate-100">
                      <Td className="font-mono font-semibold">{f.flightNo}</Td>
                      <Td>{formatDate(f.date)}</Td>
                      <Td className="font-mono">{f.fromApt}</Td>
                      <Td>{f.depTime}</Td>
                      <Td className="font-mono">{f.toApt}</Td>
                      <Td>{f.arrTime}</Td>
                      <Td>{f.cabinClass ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSection>
          )}

          {/* ── ACCOMMODATION ── */}
          {show('accommodation') && accommodations.length > 0 && (
            <PrintSection title="Accommodation">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Hotel</Th><Th>City</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Nights</Th><Th>Room</Th><Th>Contact</Th>
                  </tr>
                </thead>
                <tbody>
                  {accommodations.map(a => (
                    <tr key={a.id} className="border-b border-slate-100">
                      <Td className="font-semibold">{a.hotel}</Td>
                      <Td>{a.city}</Td>
                      <Td>{formatDate(a.checkIn)}</Td>
                      <Td>{formatDate(a.checkOut)}</Td>
                      <Td>{a.nights}</Td>
                      <Td>{a.roomType ?? '—'}</Td>
                      <Td>{a.contact ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSection>
          )}

          {/* ── ITINERARY ── */}
          {show('itinerary') && itinerary.length > 0 && (
            <PrintSection title={`Itinerary — ${itinerary.length} Days`}>
              <div className="space-y-3">
                {itinerary.map(item => (
                  <div key={item.id} className="flex gap-3 pb-3 border-b border-slate-100 last:border-0 avoid-break">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
                      <span className="text-brand-700 text-xs font-bold">D{item.dayNo}</span>
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{item.title}</span>
                        <span className="text-slate-400 text-xs">{formatDate(item.date)}</span>
                        {item.meetingTime && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            Meet: {item.meetingTime}
                          </span>
                        )}
                      </div>
                      {item.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </PrintSection>
          )}

          {/* ── TOUR AGENDA ── */}
          {show('tourAgenda') && agendaItems.length > 0 && (
            <PrintSection title="Tour Agenda">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Date</Th><Th>Time</Th><Th>Meet</Th><Th>Activity</Th><Th>Location</Th><Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {agendaItems.map(item => (
                    <tr key={item.id} className="border-b border-slate-100 avoid-break">
                      <Td>{formatDate(item.date)}</Td>
                      <Td>{item.time ?? '—'}</Td>
                      <Td>{item.meetingTime ?? '—'}</Td>
                      <Td className="font-medium">{item.title}</Td>
                      <Td>{item.location ?? '—'}</Td>
                      <Td className="text-slate-400">{item.notes ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSection>
          )}

          {/* ── DRIVERS ── */}
          {show('drivers') && drivers.length > 0 && (
            <PrintSection title="Driver Assignments">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Driver Name</Th><Th>Phone</Th><Th>Vehicle Type</Th><Th>Plate No.</Th><Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <Td className="font-semibold">{d.driverName ?? '—'}</Td>
                      <Td className="font-mono">{d.driverPhone ?? '—'}</Td>
                      <Td>{d.vehicleType ?? '—'}</Td>
                      <Td className="font-mono">{d.vehiclePlate ?? '—'}</Td>
                      <Td className="text-slate-400">{d.notes ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSection>
          )}

          {/* ── PAYMENTS ── */}
          {show('payments') && (
            <PrintSection title="Payments">
              {payments.length > 0 && (
                <table className="w-full text-xs border-collapse mb-4">
                  <thead>
                    <tr className="bg-slate-100">
                      <Th>Date</Th><Th>Label</Th><Th>Method</Th><Th>Amount</Th><Th>Status</Th><Th>Notes</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-slate-100">
                        <Td>{formatDate(p.paidAt ?? p.createdAt)}</Td>
                        <Td>{p.label ?? p.type ?? '—'}</Td>
                        <Td>{p.method ?? '—'}</Td>
                        <Td className="font-semibold">{formatCurrency(p.amount, booking.currency)}</Td>
                        <Td>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            p.status === 'CONFIRMED' ? 'bg-green-100 text-green-700'
                            : p.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                          }`}>{p.status}</span>
                        </Td>
                        <Td className="text-slate-400">{p.notes ?? '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {show('quotedTotal') && (
                <div className="flex justify-end">
                  <div className="w-56 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Quoted Total</span>
                      <span>{formatCurrency(booking.quotedTotal, booking.currency)}</span>
                    </div>
                    <div className="flex justify-between text-green-600">
                      <span>Total Paid</span>
                      <span>{formatCurrency(totalPaid, booking.currency)}</span>
                    </div>
                    <div className={`flex justify-between font-bold pt-1 border-t border-slate-200 ${balanceDue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      <span>Balance Due</span>
                      <span>{balanceDue > 0 ? formatCurrency(balanceDue, booking.currency) : '✓ Paid'}</span>
                    </div>
                  </div>
                </div>
              )}
            </PrintSection>
          )}

          {/* ── P&L SUMMARY ── */}
          {show('pnlSummary') && pnl && (
            <PrintSection title="P&L Summary">
              <div className="grid grid-cols-4 gap-3">
                <PnlBox label="Revenue" value={formatCurrency(pnl.totalRevenue)} />
                <PnlBox label="Cost" value={formatCurrency(pnl.totalCost)} />
                {show('profit') && <>
                  <PnlBox label="Profit" value={formatCurrency(pnl.profit)} highlight={pnl.profit >= 0 ? 'green' : 'red'} />
                  <PnlBox
                    label="Margin"
                    value={pnl.totalRevenue > 0 ? `${((pnl.profit / pnl.totalRevenue) * 100).toFixed(1)}%` : '—'}
                    highlight={pnl.profit >= 0 ? 'green' : 'red'}
                  />
                </>}
              </div>
            </PrintSection>
          )}

          {/* ── TERMS & CONDITIONS (at bottom) ── */}
          {show('termsConditions') && booking.terms && (
            <PrintSection title="Terms & Conditions">
              <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{booking.terms}</p>
            </PrintSection>
          )}

          {/* ── EXCLUSIONS (at bottom) ── */}
          {show('exclusions') && booking.exclusions && (
            <PrintSection title="Exclusions">
              <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{booking.exclusions}</p>
            </PrintSection>
          )}

          {/* Footer */}
          <div className="mt-10 pt-4 border-t border-slate-200 flex justify-between text-[10px] text-slate-400">
            <span>Apple Holidays — MMT Vietnam — Confidential</span>
            <span>{booking.bookingRef} · {session?.user?.name}</span>
          </div>

          {/* ── TICKETS — each on its own page ── */}
          {show('tickets') && tickets.map(t => (
            <div key={t.id} className="page-break">
              <div className="px-0 py-0">
                {/* Ticket header */}
                <div className="flex items-center justify-between mb-6 pb-4 border-b-2 border-slate-200">
                  <Image src="/png/aahaas.png" alt="Apple Holidays" width={120} height={44} className="object-contain" style={{ maxHeight: 44 }} />
                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">Ticket / Voucher</div>
                    <div className="text-lg font-mono font-bold text-slate-900">{booking.bookingRef}</div>
                  </div>
                </div>

                <div className="border-2 border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xl font-bold text-slate-900">{t.name ?? t.description ?? 'Ticket'}</div>
                      <div className="text-sm text-slate-500 mt-1">{t.ticketType}</div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                      t.status === 'PAID' || t.status === 'PURCHASED' ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>{t.status}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-xs border-t border-slate-100 pt-4">
                    {t.date && <Field label="Date" value={formatDate(t.date)} />}
                    {t.quantity && <Field label="Quantity" value={String(t.quantity)} />}
                    {t.unitCost && <Field label="Unit Cost" value={formatCurrency(t.unitCost, booking.currency)} />}
                    {t.totalCost && <Field label="Total Cost" value={formatCurrency(t.totalCost, booking.currency)} />}
                    {t.reference && <Field label="Reference" value={t.reference} />}
                    {t.supplier && <Field label="Supplier" value={t.supplier} />}
                  </div>

                  {t.notes && (
                    <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                      <span className="font-medium">Notes: </span>{t.notes}
                    </div>
                  )}

                  {/* Passengers reference */}
                  <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="font-medium">Passengers: </span>
                    {passengers.filter(p => p.isLead).map(p => p.name).join(', ') || passengers.slice(0, 3).map(p => p.name).join(', ')}
                    {booking.paxAdults > 0 && ` · ${booking.paxAdults} adults${booking.paxChildren > 0 ? `, ${booking.paxChildren} children` : ''}`}
                  </div>
                </div>

                <div className="mt-4 text-[10px] text-slate-400 text-center">
                  Apple Holidays — MMT Vietnam · {booking.bookingRef}
                </div>
              </div>
            </div>
          ))}

        </div>
      </div>
    </>
  )
}

// ── small helpers

function PrintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7 avoid-break">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 pb-1.5 border-b border-slate-200">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value || '—'}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-slate-700 ${className}`}>{children}</td>
}

function PnlBox({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center border border-slate-200">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-sm font-bold ${highlight === 'green' ? 'text-green-600' : highlight === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
