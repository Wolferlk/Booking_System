'use client'

import { CheckCircle2, XCircle, MinusCircle, Send, Loader2, Clock, Mail, MessageCircle } from 'lucide-react'

interface QCCheck {
  label: string
  passed: boolean
  na: boolean
  detail: string
}

interface BookingQCPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any
  onAutoSend: () => void
  autoSending: boolean
  daysUntilTrip: number
}

function computeQCChecks(booking: BookingQCPanelProps['booking']): {
  checks: QCCheck[]
  allPass: boolean
} {
  const confirmedStatuses = ['GT_VERIFIED', 'OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS', 'COMPLETED']

  // Check 1: Client Confirmation
  const clientConfirmed = confirmedStatuses.includes(booking.status as string)
  const clientCheck: QCCheck = {
    label: 'Client Confirmation',
    passed: clientConfirmed,
    na: false,
    detail: clientConfirmed
      ? 'Client has confirmed the booking'
      : 'Awaiting client confirmation (status must reach GT Verified)',
  }

  // Check 2: Driver Allocation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agendaItems: any[] = booking.tourAgenda?.items ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverItems = agendaItems.filter((i: any) => i.serviceType !== 'OWN_ARRANGEMENT')
  const allDriversAssigned = driverItems.every(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (i: any) => i.assignment?.driverId
  )
  const driverCheck: QCCheck = {
    label: 'Driver Allocation',
    passed: driverItems.length === 0 ? true : allDriversAssigned,
    na: driverItems.length === 0,
    detail: driverItems.length === 0
      ? 'No transfer items in agenda'
      : allDriversAssigned
        ? `All ${driverItems.length} transfer(s) have drivers assigned`
        : `${driverItems.filter((i: any) => !i.assignment?.driverId).length} of ${driverItems.length} transfers still need drivers`,
  }

  // Check 3: Ticket Activation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets: any[] = booking.tickets ?? []
  const activeTickets = tickets.filter((t: any) => t.activated)
  const allTicketsPurchased = activeTickets.every(
    (t: any) => t.status === 'PURCHASED' || t.status === 'PAID'
  )
  const ticketCheck: QCCheck = {
    label: 'Ticket Activation',
    passed: activeTickets.length === 0 ? true : allTicketsPurchased,
    na: activeTickets.length === 0,
    detail: activeTickets.length === 0
      ? 'No tickets added to this booking'
      : allTicketsPurchased
        ? `All ${activeTickets.length} ticket(s) purchased`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : `${activeTickets.filter((t: any) => t.status === 'DRAFT').length} ticket(s) still in Draft`,
  }

  const checks = [clientCheck, driverCheck, ticketCheck]
  const allPass = checks.every(c => c.passed)

  return { checks, allPass }
}

export default function BookingQCPanel({ booking, onAutoSend, autoSending, daysUntilTrip }: BookingQCPanelProps) {
  const { checks, allPass } = computeQCChecks(booking)

  const qcPassedAt: string | null   = booking.qcPassedAt        ?? null
  const emailSentAt: string | null  = booking.qcAutoEmailSentAt ?? null
  const waSentAt: string | null     = booking.qcAutoWaSentAt    ?? null
  const bothSent = !!emailSentAt && !!waSentAt

  // Derive reason WhatsApp wasn't sent
  const hasCustomerPhone = !!(booking.contactWhatsapp || booking.contactPhone)
  const waNotSentReason = !waSentAt
    ? (hasCustomerPhone ? 'Not yet sent — will auto-send on QC1 pass' : 'No customer phone/WhatsApp on file')
    : null
  const emailNotSentReason = !emailSentAt
    ? 'Not yet sent — will auto-send on QC1 pass'
    : null

  const t7 = daysUntilTrip - 7
  const t7Label =
    daysUntilTrip <= 0 ? 'Trip has started'
    : t7 > 0 ? `Send in ${t7}d (T−7)`
    : t7 === 0 ? 'Today is T−7 — send now!'
    : `${Math.abs(t7)}d overdue (T−7 passed)`
  const t7Urgent = daysUntilTrip > 0 && t7 <= 0

  return (
    <div className={`rounded-xl border-2 p-5 ${
      allPass
        ? bothSent
          ? 'border-green-200 bg-green-50/40'
          : 'border-emerald-300 bg-emerald-50'
        : 'border-slate-200 bg-white'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            allPass ? 'bg-green-500' : 'bg-slate-300'
          }`}>
            {allPass
              ? <CheckCircle2 className="w-5 h-5 text-white" />
              : <Clock className="w-5 h-5 text-white" />
            }
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">
              QC Status
              {allPass && <span className="ml-2 text-xs font-semibold bg-green-500 text-white px-2 py-0.5 rounded-full">1st QC PASS</span>}
            </p>
            {qcPassedAt && (
              <p className="text-[10px] text-slate-400">
                Passed {new Date(qcPassedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>

        {/* T-7 indicator */}
        {daysUntilTrip > 0 && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            t7Urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {t7Label}
          </span>
        )}
      </div>

      {/* Checklist */}
      <div className="space-y-2 mb-4">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-2.5">
            {check.na ? (
              <MinusCircle className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
            ) : check.passed ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className={`text-sm font-semibold ${
                check.na ? 'text-slate-400' : check.passed ? 'text-slate-800' : 'text-slate-700'
              }`}>
                {check.label}
                {check.na && <span className="ml-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide">N/A</span>}
              </p>
              <p className={`text-xs ${
                check.na ? 'text-slate-400' : check.passed ? 'text-slate-500' : 'text-red-500'
              }`}>
                {check.detail}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Send status & action */}
      {allPass && (
        <div className="border-t border-green-200 pt-4 space-y-3">
          {/* Sent status */}
          <div className="flex flex-wrap gap-3">
            <div className={`flex flex-col gap-0.5 text-xs px-2.5 py-1.5 rounded-lg ${
              emailSentAt ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-50 text-slate-500 border border-slate-200'
            }`}>
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium">
                  {emailSentAt
                    ? `Email sent ${new Date(emailSentAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                    : 'Email not sent'}
                </span>
              </div>
              {emailNotSentReason && (
                <p className="text-[10px] text-slate-400 pl-5">{emailNotSentReason}</p>
              )}
            </div>
            <div className={`flex flex-col gap-0.5 text-xs px-2.5 py-1.5 rounded-lg ${
              waSentAt ? 'bg-green-50 text-green-700 border border-green-200'
              : hasCustomerPhone ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-red-50 text-red-600 border border-red-200'
            }`}>
              <div className="flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium">
                  {waSentAt
                    ? `WhatsApp sent ${new Date(waSentAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                    : 'WhatsApp not sent'}
                </span>
              </div>
              {waNotSentReason && (
                <p className={`text-[10px] pl-5 ${hasCustomerPhone ? 'text-amber-600' : 'text-red-500 font-semibold'}`}>
                  {waNotSentReason}
                </p>
              )}
            </div>
          </div>

          {/* Send button */}
          {!bothSent && (
            <button
              onClick={onAutoSend}
              disabled={autoSending}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {autoSending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending Type-1 Messages…</>
                : <><Send className="w-4 h-4" /> Send Type-1 Messages (Email + WhatsApp)</>
              }
            </button>
          )}
          {bothSent && (
            <button
              onClick={onAutoSend}
              disabled={autoSending}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-4 rounded-lg border border-green-300 text-green-700 text-xs font-medium hover:bg-green-50 transition-colors disabled:opacity-60"
            >
              {autoSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Resend Type-1 Messages
            </button>
          )}
        </div>
      )}

      {!allPass && (
        <p className="text-xs text-slate-400 border-t border-slate-100 pt-3 mt-1">
          Complete all 3 checks above to unlock auto Type-1 message sending (7 days before trip).
        </p>
      )}
    </div>
  )
}
