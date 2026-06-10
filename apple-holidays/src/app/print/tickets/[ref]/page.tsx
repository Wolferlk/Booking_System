'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'

interface Ticket {
  id: string
  type: string
  qty: number
  supplier: string | null
  costPerUnit: string | null
  totalCost: string | null
  currency: string
  status: string
  activated: boolean
  purchasedAt: string | null
  reference: string | null
  notes: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  pnlLine: {
    activity: string
    paymentStatus: string
    paymentRefNumber: string | null
    category: string
  } | null
  agendaItem: { date: string; location: string; toPoint?: string } | null
}

interface BookingInfo {
  bookingRef: string
  agent: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  fileHandler: string | null
  agentBookingId: string | null
  passengers: { name: string; isLead?: boolean }[]
}

const CATEGORY_LABEL: Record<string, string> = {
  HOTEL: 'Hotel Voucher',
  TICKETS: 'Entrance Ticket',
  CRUISE: 'Cruise Ticket',
  WATER: 'Water Activity Ticket',
  GUIDES: 'Guide Service Voucher',
  FLIGHT_TICKETS: 'Flight Ticket',
  TRANSPORT: 'Transfer Voucher',
  MEALS: 'Meal Voucher',
  OTHER: 'Service Voucher',
}

const CATEGORY_COLOR: Record<string, string> = {
  HOTEL: '#2563eb',
  TICKETS: '#7c3aed',
  CRUISE: '#0891b2',
  WATER: '#0284c7',
  GUIDES: '#16a34a',
  FLIGHT_TICKETS: '#dc2626',
  TRANSPORT: '#ea580c',
  MEALS: '#d97706',
  OTHER: '#64748b',
}

export default function PrintTicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [booking, setBooking] = useState<BookingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const printTriggered = useRef(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/tickets?bookingRef=${ref}`).then(r => r.json()),
      fetch(`/api/bookings/${ref}`).then(r => r.json()),
    ]).then(([ticketRes, bookingRes]) => {
      if (ticketRes.success) setTickets((ticketRes.data as Ticket[]).filter(t => t.activated))
      if (bookingRes.success) setBooking(bookingRes.data)
    }).finally(() => setLoading(false))
  }, [ref])

  useEffect(() => {
    if (loading || printTriggered.current || tickets.length === 0) return

    const imageTickets = tickets.filter(t => t.fileUrl && t.fileType === 'image')

    if (imageTickets.length === 0) {
      printTriggered.current = true
      setTimeout(() => window.print(), 400)
      return
    }

    // Wait for all receipt images to fully load before printing
    let loaded = 0
    const total = imageTickets.length

    const tryPrint = () => {
      loaded++
      if (loaded >= total && !printTriggered.current) {
        printTriggered.current = true
        setTimeout(() => window.print(), 200)
      }
    }

    imageTickets.forEach(ticket => {
      const img = new window.Image()
      img.onload = tryPrint
      img.onerror = tryPrint // still print even if an image fails to load
      img.src = ticket.fileUrl!
    })

    // Fallback: force print after 5 seconds even if images haven't reported
    const fallback = setTimeout(() => {
      if (!printTriggered.current) {
        printTriggered.current = true
        window.print()
      }
    }, 5000)

    return () => clearTimeout(fallback)
  }, [loading, tickets])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: '#64748b', fontSize: 14 }}>Loading tickets and receipts...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (!tickets.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <p style={{ color: '#64748b' }}>No activated tickets found for booking {ref}</p>
    </div>
  )

  const allPassengers = booking?.passengers ?? []
  const leadPassenger = allPassengers.find(p => p.isLead) ?? allPassengers[0]

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; background: #fff; }

        .ticket-page {
          width: 210mm;
          min-height: 297mm;
          padding: 12mm 14mm 10mm 14mm;
          display: flex;
          flex-direction: column;
          page-break-after: always;
          break-after: page;
        }
        .ticket-page:last-child {
          page-break-after: avoid;
          break-after: avoid;
        }

        .receipt-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .receipt-img {
          max-width: 100%;
          max-height: 340px;
          width: auto;
          height: auto;
          object-fit: contain;
          display: block;
          margin: 0 auto;
        }

        @media print {
          @page { margin: 0; size: A4 portrait; }
          html, body { width: 210mm; }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
        }

        @media screen {
          body { background: #9ca3af; padding: 20px 0; }
          .ticket-page {
            margin: 0 auto 24px auto;
            border-radius: 6px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.18);
            background: #fff;
          }
        }
      `}</style>

      {tickets.map((ticket) => {
        const cat = ticket.pnlLine?.category ?? 'OTHER'
        const label = CATEGORY_LABEL[cat] ?? 'Voucher'
        const color = CATEGORY_COLOR[cat] ?? '#64748b'
        const isImage = ticket.fileType === 'image' || (ticket.fileUrl ? /\.(jpe?g|png|webp|gif)$/i.test(ticket.fileUrl) : false)
        const isPdf = ticket.fileType === 'pdf' || (ticket.fileUrl ? /\.pdf$/i.test(ticket.fileUrl) : false)

        const detailRows = [
          { label: 'Lead Passenger', value: leadPassenger?.name ?? '—' },
          { label: 'Agent', value: booking?.agent ?? '—' },
          { label: 'Travel Dates', value: booking ? `${formatDate(booking.arrivalDate)} — ${formatDate(booking.departureDate)}` : '—' },
          { label: 'Pax', value: booking ? `${booking.paxAdults} Adult${booking.paxAdults !== 1 ? 's' : ''}${booking.paxChildren > 0 ? ` + ${booking.paxChildren} Child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}` : '—' },
          ticket.agendaItem?.date ? { label: 'Service Date', value: formatDate(ticket.agendaItem.date) } : null,
          ticket.agendaItem?.location ? { label: 'Location', value: ticket.agendaItem.location + (ticket.agendaItem.toPoint ? ` → ${ticket.agendaItem.toPoint}` : '') } : null,
          { label: 'Quantity', value: `${ticket.qty} pax` },
          ticket.supplier ? { label: 'Supplier / Provider', value: ticket.supplier } : null,
        ].filter(Boolean) as { label: string; value: string }[]

        return (
          <div key={ticket.id} className="ticket-page">

            {/* ── HEADER ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 10, borderBottom: `3px solid ${color}`, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: 8, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontWeight: 900, fontSize: 15 }}>AH</span>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>AppleHolidays</div>
                  <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 1.2, textTransform: 'uppercase' }}>MMT Vietnam</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-block', background: color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>
                  Booking: <strong style={{ color: '#0f172a', fontFamily: 'monospace', fontSize: 12 }}>{booking?.bookingRef ?? ref}</strong>
                </div>
                {booking?.agentBookingId && (
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>Agent Ref: {booking.agentBookingId}</div>
                )}
              </div>
            </div>

            {/* ── TICKET TITLE ── */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>{ticket.type}</div>
              {ticket.pnlLine?.activity && ticket.pnlLine.activity !== ticket.type && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{ticket.pnlLine.activity}</div>
              )}
            </div>

            {/* ── REFERENCE NUMBER ── */}
            {ticket.reference && (
              <div style={{ border: `2px solid ${color}`, borderRadius: 8, padding: '10px 16px', marginBottom: 12, background: color + '15' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2, color, fontWeight: 700, marginBottom: 3 }}>Confirmation / Reference Number</div>
                <div style={{ fontSize: 24, fontWeight: 900, color, fontFamily: 'monospace', letterSpacing: 2 }}>{ticket.reference}</div>
              </div>
            )}

            {/* ── DETAIL GRID ── */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {detailRows.map((row, idx) => (
                  <div key={idx} style={{
                    padding: '8px 12px',
                    background: idx % 2 === 0 ? '#f8fafc' : '#ffffff',
                    borderBottom: idx < detailRows.length - 2 ? '1px solid #e2e8f0' : 'none',
                  }}>
                    <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', fontWeight: 700, marginBottom: 2 }}>{row.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#0f172a' }}>{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PASSENGER LIST ── */}
            {allPassengers.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', fontWeight: 700, marginBottom: 5 }}>All Passengers</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {allPassengers.map((p, i) => (
                    <div key={i} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '3px 9px', fontSize: 10, fontWeight: 600, color: '#334155' }}>
                      {p.name}{p.isLead ? ' ★' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── NOTES ── */}
            {ticket.notes && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '7px 11px', marginBottom: 12, fontSize: 10, color: '#92400e', lineHeight: 1.5 }}>
                <strong>Notes: </strong>{ticket.notes}
              </div>
            )}

            {/* ── RECEIPT IMAGE — full size, same page ── */}
            {ticket.fileUrl && isImage && (
              <div className="receipt-block" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>
                  Receipt / Confirmation Document
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden', background: '#f8fafc', padding: 6, textAlign: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ticket.fileUrl}
                    alt="Receipt"
                    className="receipt-img"
                  />
                  {ticket.fileName && (
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, paddingBottom: 2 }}>{ticket.fileName}</div>
                  )}
                </div>
              </div>
            )}

            {/* ── PDF receipt note ── */}
            {ticket.fileUrl && isPdf && (
              <div className="receipt-block" style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '14px 16px', marginBottom: 10, background: '#f8fafc', textAlign: 'center' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>Receipt Attached (PDF)</div>
                <div style={{ fontSize: 28 }}>📄</div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 6, fontWeight: 600 }}>{ticket.fileName ?? 'receipt.pdf'}</div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3 }}>View digital copy for full document</div>
              </div>
            )}

            {/* Spacer to push footer to bottom */}
            <div style={{ flex: 1 }} />

            {/* ── FOOTER ── */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <div style={{ fontSize: 8, color: '#94a3b8' }}>
                AppleHolidays · MMT Vietnam · Printed {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>
                {booking?.bookingRef ?? ref} · TKT-{ticket.id.slice(-8).toUpperCase()}
              </div>
            </div>

          </div>
        )
      })}
    </>
  )
}
