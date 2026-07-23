'use client'

/**
 * Printable ticket pack.
 *
 * Only PURCHASED / PAID tickets are printed — drafts are internal work-in-progress
 * and must never reach a customer document. Each ticket gets its own page: the
 * supplier's scan when one was uploaded, otherwise a ticket we draw ourselves.
 *
 * When a ticket's receipt is a PDF, every page of that PDF is rendered (client-side
 * with pdf.js) and appended right after the ticket's own page, so the supplier
 * document is merged into the same printout instead of living in a separate file.
 */

import { useEffect, useState, useRef, Fragment } from 'react'
import { useParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { normalizeUploadUrl } from '@/lib/upload-path'
import { TicketStub, type StubTicket } from '@/components/tickets/ticket-stub'
import { isPurchasedTicket, ticketFileKind } from '@/lib/ticket-notes'

interface BookingInfo {
  bookingRef: string
  agent: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxInfants?: number
  fileHandler: string | null
  agentBookingId: string | null
  isNumber?: string | null
  passengers: { name: string; isLead?: boolean; type?: string | null }[]
}

export default function PrintTicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const [tickets, setTickets] = useState<StubTicket[]>([])
  const [booking, setBooking] = useState<BookingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  // Rendered pages for each PDF receipt, keyed by ticket id (data-URL images).
  const [pdfPages, setPdfPages] = useState<Record<string, string[]>>({})
  const [pdfDone, setPdfDone] = useState(false)
  const printTriggered = useRef(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/tickets?bookingRef=${ref}`).then(r => r.json()),
      fetch(`/api/bookings/${ref}`).then(r => r.json()),
    ]).then(([ticketRes, bookingRes]) => {
      if (ticketRes.success) {
        setTickets((ticketRes.data as StubTicket[])
          .filter(t => (t as { activated?: boolean }).activated !== false)
          .filter(t => isPurchasedTicket(t.status)))
      }
      if (bookingRes.success) setBooking(bookingRes.data)
    }).finally(() => setLoading(false))
  }, [ref])

  // Rasterise every PDF receipt into per-page images so they merge into the print.
  useEffect(() => {
    if (loading) return
    const pdfTickets = tickets.filter(t => ticketFileKind(t) === 'pdf' && t.fileUrl)
    if (pdfTickets.length === 0) { setPdfDone(true); return }

    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        // Served as a static module worker from /public (see scripts/copy-pdf-worker.mjs).
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'

        const result: Record<string, string[]> = {}
        for (const t of pdfTickets) {
          try {
            const url = normalizeUploadUrl(t.fileUrl) ?? t.fileUrl!
            const data = await fetch(url).then(r => r.arrayBuffer())
            const doc = await pdfjs.getDocument({ data }).promise
            const pages: string[] = []
            for (let n = 1; n <= doc.numPages; n++) {
              const page = await doc.getPage(n)
              const viewport = page.getViewport({ scale: 2 })
              const canvas = document.createElement('canvas')
              canvas.width = viewport.width
              canvas.height = viewport.height
              await page.render({ canvas, viewport }).promise
              pages.push(canvas.toDataURL('image/jpeg', 0.85))
            }
            result[t.id] = pages
          } catch {
            // A PDF that won't render just falls back to the stub's note — skip it.
          }
        }
        if (!cancelled) setPdfPages(result)
      } finally {
        if (!cancelled) setPdfDone(true)
      }
    })()

    return () => { cancelled = true }
  }, [loading, tickets])

  useEffect(() => {
    if (loading || !pdfDone || printTriggered.current || tickets.length === 0) return

    const imageTickets = tickets.filter(t => ticketFileKind(t) === 'image')

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
  }, [loading, pdfDone, tickets])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: '#64748b', fontSize: 14 }}>Loading purchased tickets…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (!tickets.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif', flexDirection: 'column', gap: 6, textAlign: 'center', padding: 24 }}>
      <p style={{ color: '#0f172a', fontSize: 16, fontWeight: 700 }}>No purchased tickets for {ref}</p>
      <p style={{ color: '#64748b', fontSize: 13 }}>Draft tickets are not printed — mark a ticket as purchased to include it here.</p>
    </div>
  )

  const allPassengers = booking?.passengers ?? []
  const leadPassenger = allPassengers.find(p => p.isLead) ?? allPassengers[0]
  const paxSummary = booking
    ? `${booking.paxAdults} Adult${booking.paxAdults !== 1 ? 's' : ''}`
      + (booking.paxChildren > 0 ? ` · ${booking.paxChildren} Child${booking.paxChildren !== 1 ? 'ren' : ''}` : '')
      + ((booking.paxInfants ?? 0) > 0 ? ` · ${booking.paxInfants} Infant${booking.paxInfants !== 1 ? 's' : ''}` : '')
    : '—'

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1e293b; }

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

        /* A merged supplier-PDF page: keep each source page on one printed sheet. */
        .pdf-page { justify-content: flex-start; }
        .pdf-page img {
          max-height: 255mm;
          object-fit: contain;
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

      {tickets.map((ticket, idx) => {
        const supplierPages = pdfPages[ticket.id] ?? []
        return (
        <Fragment key={ticket.id}>
        <div className="ticket-page">

          {/* ── HEADER ── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            paddingBottom: 10, borderBottom: '3px solid #d97706', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 42, height: 42, borderRadius: 8, background: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: 15 }}>AH</span>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Apple Holidays</div>
                <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  Purchased Ticket {idx + 1} of {tickets.length}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#475569' }}>
                Booking: <strong style={{ color: '#0f172a', fontFamily: 'monospace', fontSize: 12 }}>{booking?.bookingRef ?? ref}</strong>
              </div>
              {booking?.isNumber && (
                <div style={{ fontSize: 9, color: '#2563eb', fontFamily: 'monospace', marginTop: 1 }}>IS: {booking.isNumber}</div>
              )}
              {booking?.agentBookingId && (
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>Agent Ref: {booking.agentBookingId}</div>
              )}
            </div>
          </div>

          {/* ── TRIP STRIP ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
            border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc',
            padding: '8px 11px', marginBottom: 14,
          }}>
            {[
              { label: 'Lead Passenger', value: leadPassenger?.name ?? '—' },
              { label: 'Travel Dates', value: booking ? `${formatDate(booking.arrivalDate)} — ${formatDate(booking.departureDate)}` : '—' },
              { label: 'Party', value: paxSummary },
              { label: 'Agent', value: booking?.agent ?? '—' },
            ].map(cell => (
              <div key={cell.label}>
                <p style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{cell.label}</p>
                <p style={{ fontSize: 9.5, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>{cell.value}</p>
              </div>
            ))}
          </div>

          {/* ── THE TICKET ── */}
          <TicketStub ticket={ticket} bookingRef={booking?.bookingRef ?? ref} />

          {/* ── TRAVELLING PARTY ── */}
          {allPassengers.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <p style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', fontWeight: 800, marginBottom: 5 }}>
                Travelling Party ({allPassengers.length})
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {allPassengers.map((p, i) => (
                  <span key={i} style={{
                    background: p.isLead ? '#fffbeb' : '#f1f5f9',
                    border: `1px solid ${p.isLead ? '#fcd34d' : '#e2e8f0'}`,
                    borderRadius: 4, padding: '3px 9px', fontSize: 10, fontWeight: 600, color: '#334155',
                  }}>
                    {p.name}{p.type ? ` (${p.type.toLowerCase()})` : ''}{p.isLead ? ' ★' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Spacer to push footer to bottom */}
          <div style={{ flex: 1 }} />

          {/* ── FOOTER ── */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 8, color: '#94a3b8' }}>
              Apple Holidays · Printed {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>
              {booking?.bookingRef ?? ref} · Ticket {idx + 1}/{tickets.length}
            </div>
          </div>

        </div>

        {/* ── Merged supplier PDF pages ── */}
        {supplierPages.map((src, p) => (
          <div key={`${ticket.id}-pdf-${p}`} className="ticket-page pdf-page">
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              paddingBottom: 6, borderBottom: '1px solid #e2e8f0', marginBottom: 10,
            }}>
              <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Supplier Document — {ticket.type}
                {supplierPages.length > 1 ? ` (page ${p + 1} of ${supplierPages.length})` : ''}
              </div>
              <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>
                {booking?.bookingRef ?? ref} · Ticket {idx + 1}/{tickets.length}
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${ticket.type} supplier document page ${p + 1}`}
              style={{ display: 'block', width: '100%', height: 'auto', margin: '0 auto', objectFit: 'contain' }}
            />
          </div>
        ))}
        </Fragment>
        )
      })}
    </>
  )
}
