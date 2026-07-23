'use client'

/**
 * Boarding-pass style ticket card, shared by the printable tickets page and the
 * printable agenda so a purchased ticket looks identical wherever it appears.
 *
 * Two states:
 *  - a supplier photo/scan exists → the photo is the ticket, framed with a header
 *    strip carrying the reference and guest details;
 *  - no photo → we draw the ticket ourselves (perforated stub + decorative
 *    barcode), so the document never shows an empty placeholder.
 *
 * Inline styles only: these render inside print routes that ship no Tailwind.
 */

import {
  parseTicketNotes, ticketFacts, ticketCode, ticketFileKind,
  categoryColor, categoryIcon, categoryLabel, paxLabel, barcodeBars,
} from '@/lib/ticket-notes'
import { formatDate } from '@/lib/utils'

export interface StubTicket {
  id: string
  type: string
  qty: number
  supplier: string | null
  costPerUnit?: string | null
  totalCost: string | null
  currency: string
  status: string
  purchasedAt?: string | null
  reference: string | null
  notes: string | null
  fileUrl: string | null
  fileName?: string | null
  fileType?: string | null
  category?: string | null
  driverName?: string | null
  driverPhone?: string | null
  vehicleType?: string | null
  vehicleNumber?: string | null
  pnlLine?: { activity?: string | null; paymentRefNumber?: string | null; category?: string | null } | null
  agendaItem?: { date?: string | null; location?: string | null; toPoint?: string | null } | null
}

function Barcode({ seed, color, height }: { seed: string; color: string; height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height }}>
      {barcodeBars(seed).map((w, i) => (
        <span key={i} style={{ width: w, height: '100%', background: i % 5 === 0 ? color : '#0f172a', opacity: i % 3 === 0 ? 1 : 0.75 }} />
      ))}
    </div>
  )
}

export function TicketStub({
  ticket,
  bookingRef,
  compact = false,
}: {
  ticket: StubTicket
  bookingRef: string
  compact?: boolean
}) {
  const category = ticket.category ?? ticket.pnlLine?.category ?? 'OTHER'
  const color = categoryColor(category)
  const icon = categoryIcon(category)
  const label = categoryLabel(category)
  const meta = parseTicketNotes(ticket.notes)
  const facts = ticketFacts(ticket, meta, d => formatDate(d as string))
  const kind = ticketFileKind(ticket)
  const code = ticketCode(ticket.id)

  const scale = compact ? 0.82 : 1
  const px = (n: number) => Math.round(n * scale * 10) / 10

  return (
    <div
      className="ticket-stub"
      style={{
        border: `1px solid ${color}55`,
        borderLeft: `${px(5)}px solid ${color}`,
        borderRadius: px(10),
        overflow: 'hidden',
        background: '#fff',
        marginBottom: px(12),
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
      }}
    >
      {/* ── Header strip ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: px(10), padding: `${px(7)}px ${px(11)}px`,
        background: `linear-gradient(90deg, ${color}18 0%, ${color}05 70%, #ffffff 100%)`,
        borderBottom: `1px solid ${color}33`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(8), minWidth: 0 }}>
          <span style={{
            width: px(24), height: px(24), borderRadius: px(6), background: color,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: px(12), flexShrink: 0,
          }}>{icon}</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: px(11.5), fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>{ticket.type}</p>
            <p style={{ fontSize: px(7.5), color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {label}
              {ticket.pnlLine?.activity && ticket.pnlLine.activity !== ticket.type
                ? <span style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}> · {ticket.pnlLine.activity}</span>
                : null}
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{
            display: 'inline-block', background: '#dcfce7', color: '#15803d',
            fontSize: px(7), fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase',
            padding: `${px(2)}px ${px(6)}px`, borderRadius: px(3),
          }}>
            ✓ {ticket.status === 'PAID' ? 'Paid' : 'Purchased'}
          </span>
          <p style={{ fontSize: px(7), color: '#94a3b8', fontFamily: 'monospace', marginTop: px(2) }}>{code}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* ── Body ── */}
        <div style={{ flex: 1, padding: `${px(9)}px ${px(11)}px`, minWidth: 0 }}>
          {ticket.reference && (
            <div style={{
              border: `1px dashed ${color}`, borderRadius: px(6), background: `${color}0f`,
              padding: `${px(5)}px ${px(9)}px`, marginBottom: px(8), display: 'inline-block',
            }}>
              <p style={{ fontSize: px(6.5), fontWeight: 800, letterSpacing: 1, color, textTransform: 'uppercase' }}>
                Confirmation / Reference
              </p>
              <p style={{ fontSize: px(14), fontWeight: 900, color, fontFamily: 'monospace', letterSpacing: 1.5 }}>
                {ticket.reference}
              </p>
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)',
            gap: `${px(6)}px ${px(10)}px`,
          }}>
            {facts.map(fact => (
              <div key={fact.label} style={{ minWidth: 0 }}>
                <p style={{ fontSize: px(6.5), color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {fact.label}
                </p>
                <p style={{ fontSize: px(9), fontWeight: 700, color: '#0f172a', marginTop: px(1), wordBreak: 'break-word' }}>
                  {fact.value}
                </p>
              </div>
            ))}
          </div>

          {meta.remarks && (
            <p style={{ fontSize: px(8), color: '#64748b', marginTop: px(7), fontStyle: 'italic' }}>
              {meta.remarks}
            </p>
          )}
          {meta.details.length > 0 && (
            <p style={{ fontSize: px(8), color: '#64748b', marginTop: px(4) }}>
              {meta.details.join(' · ')}
            </p>
          )}
        </div>

        {/* ── Perforated stub ── */}
        <div style={{
          width: px(compact ? 74 : 96),
          flexShrink: 0,
          borderLeft: '1.5px dashed #cbd5e1',
          background: '#f8fafc',
          padding: `${px(9)}px ${px(8)}px`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: px(4),
          textAlign: 'center',
        }}>
          <p style={{ fontSize: px(6.5), color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7 }}>
            Admits
          </p>
          <p style={{ fontSize: px(17), fontWeight: 900, color, lineHeight: 1 }}>{meta.pax ?? ticket.qty}</p>
          <p style={{ fontSize: px(7), color: '#64748b', fontWeight: 700 }}>
            {paxLabel(meta.pax ?? ticket.qty, meta.paxType)?.replace(/^\d+\s/, '') ?? 'Pax'}
          </p>
          <Barcode seed={ticket.id} color={color} height={px(18)} />
          <p style={{ fontSize: px(6), color: '#94a3b8', fontFamily: 'monospace' }}>{bookingRef}</p>
        </div>
      </div>

      {/* ── Attached supplier document ── */}
      {kind === 'image' && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: px(7), background: '#f8fafc', textAlign: 'center' }}>
          <p style={{ fontSize: px(6.5), color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: px(5) }}>
            Supplier Ticket / Receipt
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ticket.fileUrl!}
            alt={ticket.fileName ?? 'Ticket'}
            style={{
              maxWidth: '100%',
              maxHeight: compact ? 220 : 360,
              width: 'auto', height: 'auto',
              objectFit: 'contain',
              display: 'block', margin: '0 auto',
              border: '1px solid #e2e8f0', borderRadius: px(4), background: '#fff',
            }}
          />
          {ticket.fileName && (
            <p style={{ fontSize: px(7), color: '#94a3b8', marginTop: px(4) }}>{ticket.fileName}</p>
          )}
        </div>
      )}

      {kind === 'pdf' && (
        <div style={{
          borderTop: '1px solid #e2e8f0', padding: `${px(7)}px ${px(11)}px`, background: '#f8fafc',
          display: 'flex', alignItems: 'center', gap: px(8),
        }}>
          <span style={{ fontSize: px(16) }}>📄</span>
          <div>
            <p style={{ fontSize: px(8.5), fontWeight: 700, color: '#334155' }}>
              {ticket.fileName ?? 'Supplier ticket (PDF)'}
            </p>
            <p style={{ fontSize: px(7), color: '#94a3b8' }}>Full supplier document follows on the next page(s).</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default TicketStub
