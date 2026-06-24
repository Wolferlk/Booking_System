'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { formatDate, formatCurrency, computePNLTotals } from '@/lib/utils'

export default function PrintBookingPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [booking, setBooking] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/bookings/${ref}`)
      .then(r => r.json())
      .then(json => { if (json.success) setBooking(json.data) })
      .finally(() => setLoading(false))
  }, [ref])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-slate-500 text-sm">Loading…</div>
  )
  if (!booking) return (
    <div className="flex items-center justify-center min-h-screen text-slate-500 text-sm">Booking not found.</div>
  )

  const role = session?.user?.role ?? ''
  const allowedRoles = ['BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowedRoles.includes(role)) return (
    <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">Access denied.</div>
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passengers: any[] = booking.passengers ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flights: any[] = booking.flights ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accommodations: any[] = booking.accommodations ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itinerary: any[] = booking.itineraryItems ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets: any[] = booking.tickets ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: any[] = booking.payments ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emergencyContacts: any[] = booking.emergencyContacts ?? []
  const pnl = booking.pnl ? computePNLTotals(booking.pnl) : null

  const totalPaid = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum: number, p) => sum + Number(p.amount ?? 0), 0)
  const balance = Number(booking.quotedTotal ?? 0) - totalPaid

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; }
        }
        body { font-family: 'Inter', Arial, sans-serif; background: white; color: #1e293b; }
        * { box-sizing: border-box; }
      `}</style>

      {/* Print / Download button */}
      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={() => window.print()}
          className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow hover:bg-brand-700 transition-colors"
        >
          Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          className="bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg shadow hover:bg-slate-300 transition-colors"
        >
          Close
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-10 text-sm text-slate-800">

        {/* ─── Header ─── */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-slate-200">
          <div>
            <div className="text-2xl font-bold text-brand-700 tracking-tight">Apple Holidays</div>
            <div className="text-xs text-slate-400 mt-0.5">Confidential — For internal use only</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-mono font-bold text-slate-900">{booking.bookingRef}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Status: <span className="font-semibold uppercase">{booking.status?.replace(/_/g, ' ')}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Printed: {formatDate(new Date().toISOString(), 'dd MMM yyyy')}</div>
          </div>
        </div>

        {/* ─── Booking Summary ─── */}
        <Section title="Booking Summary">
          <Grid cols={3}>
            <Field label="Agent / Tour Operator" value={booking.agent} />
            <Field label="File Handler" value={booking.fileHandler} />
            <Field label="Agent Booking ID" value={booking.agentBookingId} />
            <Field label="Arrival" value={formatDate(booking.arrivalDate)} />
            <Field label="Departure" value={formatDate(booking.departureDate)} />
            <Field label="Currency" value={booking.currency} />
            <Field label="Adults" value={String(booking.paxAdults ?? 0)} />
            <Field label="Children" value={String(booking.paxChildren ?? 0)} />
            <Field label="Quoted Total" value={formatCurrency(booking.quotedTotal, booking.currency)} />
          </Grid>
          {booking.amendmentNote && (
            <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              <span className="font-semibold">Amendment Note: </span>{booking.amendmentNote}
            </div>
          )}
          {booking.terms && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Terms &amp; Conditions</div>
              <p className="text-xs text-slate-600 whitespace-pre-line">{booking.terms}</p>
            </div>
          )}
          {booking.exclusions && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Exclusions</div>
              <p className="text-xs text-slate-600 whitespace-pre-line">{booking.exclusions}</p>
            </div>
          )}
        </Section>

        {/* ─── Passengers ─── */}
        {passengers.length > 0 && (
          <Section title="Passengers">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Age</Th>
                  <Th>Passport No.</Th>
                  <Th>Nationality</Th>
                  <Th>Passport Expiry</Th>
                </tr>
              </thead>
              <tbody>
                {passengers.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <Td>
                      {p.name}
                      {p.isLead && <span className="ml-1 text-[9px] bg-brand-100 text-brand-700 px-1 py-0.5 rounded">Lead</span>}
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
          </Section>
        )}

        {/* ─── Emergency Contacts ─── */}
        {emergencyContacts.length > 0 && (
          <Section title="Emergency Contacts">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Name</Th>
                  <Th>Relationship</Th>
                  <Th>Phone</Th>
                </tr>
              </thead>
              <tbody>
                {emergencyContacts.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <Td>{c.name}</Td>
                    <Td>{c.relationship}</Td>
                    <Td className="font-mono">{c.phone}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ─── Flights ─── */}
        {flights.length > 0 && (
          <Section title="Flights">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Flight No.</Th>
                  <Th>Date</Th>
                  <Th>From</Th>
                  <Th>Dep.</Th>
                  <Th>To</Th>
                  <Th>Arr.</Th>
                  <Th>Class</Th>
                </tr>
              </thead>
              <tbody>
                {flights.map((f) => (
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
          </Section>
        )}

        {/* ─── Accommodation ─── */}
        {accommodations.length > 0 && (
          <Section title="Accommodation">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Hotel</Th>
                  <Th>City</Th>
                  <Th>Check-in</Th>
                  <Th>Check-out</Th>
                  <Th>Nights</Th>
                  <Th>Room Type</Th>
                  <Th>Contact</Th>
                </tr>
              </thead>
              <tbody>
                {accommodations.map((a) => (
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
          </Section>
        )}

        {/* ─── Itinerary ─── */}
        {itinerary.length > 0 && (
          <Section title={`Itinerary (${itinerary.length} days)`}>
            <div className="space-y-3">
              {itinerary.map((item) => (
                <div key={item.id} className="flex gap-3 pb-3 border-b border-slate-100 last:border-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center">
                    <span className="text-brand-700 text-xs font-bold">D{item.dayNo}</span>
                  </div>
                  <div className="flex-1 pt-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{item.title}</span>
                      <span className="text-slate-400 text-xs">{formatDate(item.date)}</span>
                      {item.meetingTime && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                          Meet: {item.meetingTime}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>
                    )}
                    {/* Agenda items from tourAgenda */}
                    {item.activities && Array.isArray(item.activities) && item.activities.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {item.activities.map((a: any) => (
                          <li key={a.id} className="text-xs text-slate-500">• {a.title} {a.time && `(${a.time})`}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ─── Tour Agenda (if separate from itinerary) ─── */}
        {booking.tourAgenda?.items?.length > 0 && (
          <Section title="Tour Agenda">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Date</Th>
                  <Th>Time</Th>
                  <Th>Meet</Th>
                  <Th>Activity</Th>
                  <Th>Location</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {booking.tourAgenda.items.map((item: any) => (
                  <tr key={item.id} className="border-b border-slate-100">
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
          </Section>
        )}

        {/* ─── Tickets ─── */}
        {tickets.length > 0 && (
          <Section title="Tickets">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <Th>Type</Th>
                  <Th>Name / Description</Th>
                  <Th>Date</Th>
                  <Th>Qty</Th>
                  <Th>Unit Cost</Th>
                  <Th>Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <Td>{t.ticketType}</Td>
                    <Td className="font-medium">{t.name ?? t.description ?? '—'}</Td>
                    <Td>{t.date ? formatDate(t.date) : '—'}</Td>
                    <Td>{t.quantity ?? 1}</Td>
                    <Td>{t.unitCost ? formatCurrency(t.unitCost, booking.currency) : '—'}</Td>
                    <Td className="font-semibold">
                      {t.totalCost ? formatCurrency(t.totalCost, booking.currency) : '—'}
                    </Td>
                    <Td>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                        t.status === 'CONFIRMED' ? 'bg-green-100 text-green-700'
                        : t.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-slate-100 text-slate-600'
                      }`}>{t.status}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ─── Payments ─── */}
        {(payments.length > 0 || booking.quotedTotal) && (
          <Section title="Payments">
            {payments.length > 0 && (
              <table className="w-full text-xs border-collapse mb-4">
                <thead>
                  <tr className="bg-slate-100">
                    <Th>Date</Th>
                    <Th>Type</Th>
                    <Th>Reference</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <Td>{formatDate(p.paidAt ?? p.createdAt)}</Td>
                      <Td>{p.paymentType ?? p.method ?? '—'}</Td>
                      <Td className="font-mono text-slate-500">{p.reference ?? '—'}</Td>
                      <Td className="font-semibold">{formatCurrency(p.amount, booking.currency)}</Td>
                      <Td>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
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

            {/* Payment summary */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-xs">
                <SummaryRow label="Quoted Total" value={formatCurrency(booking.quotedTotal, booking.currency)} />
                <SummaryRow label="Total Paid" value={formatCurrency(totalPaid, booking.currency)} className="text-green-700" />
                <div className="border-t border-slate-200 pt-1 mt-1">
                  <SummaryRow
                    label="Balance Due"
                    value={formatCurrency(balance, booking.currency)}
                    className={balance > 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}
                    bold
                  />
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* ─── P&L Summary (staff only) ─── */}
        {pnl && ['BT_USER', 'SUPER_ADMIN', 'AC_USER'].includes(role) && (
          <Section title="P&L Summary">
            <div className="grid grid-cols-4 gap-4">
              <PnlBox label="Revenue" value={formatCurrency(pnl.totalRevenue)} />
              <PnlBox label="Cost" value={formatCurrency(pnl.totalCost)} />
              <PnlBox
                label="Gross Profit"
                value={formatCurrency(pnl.profit)}
                highlight={pnl.profit >= 0 ? 'green' : 'red'}
              />
              <PnlBox
                label="Margin"
                value={pnl.totalRevenue > 0 ? `${((pnl.profit / pnl.totalRevenue) * 100).toFixed(1)}%` : '—'}
                highlight={pnl.profit >= 0 ? 'green' : 'red'}
              />
            </div>
          </Section>
        )}

        {/* ─── Footer ─── */}
        <div className="mt-10 pt-6 border-t border-slate-200 flex justify-between text-[10px] text-slate-400">
          <span>Apple Holidays — Confidential</span>
          <span>{booking.bookingRef} · {session?.user?.name}</span>
        </div>

      </div>
    </>
  )
}

/* ── Small helpers ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 pb-1.5 border-b border-slate-200">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div className={`grid gap-x-6 gap-y-3`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">{label}</div>
      <div className="text-sm font-medium text-slate-900 mt-0.5">{value || '—'}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-slate-700 ${className}`}>{children}</td>
}

function SummaryRow({
  label, value, className = '', bold = false
}: {
  label: string; value: string; className?: string; bold?: boolean
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''} ${className}`}>
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function PnlBox({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const colorClass = highlight === 'green' ? 'text-green-600' : highlight === 'red' ? 'text-red-600' : 'text-slate-900'
  return (
    <div className="bg-slate-50 rounded p-3 text-center border border-slate-200">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-base font-bold ${colorClass}`}>{value}</div>
    </div>
  )
}
