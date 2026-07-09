'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  MessageCircle, Send, Loader2, CheckCircle2, Calendar, Plane, Hotel,
  ChevronDown, ChevronUp, Star, RefreshCw, Clock, Sparkles, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripDay {
  dayNo: number
  date: string
  isArrival: boolean
  isDeparture: boolean
  agendaCount: number
  flightCount: number
  checkIn: string | null
  checkOut: string | null
  lastSentAt: string | null
}

interface GuestFeedback {
  purpose: string | null
  accommodationRoom: string | null
  accommodationFood: string | null
  restaurantFood: string | null
  restaurantAmbience: string | null
  transportVehicle: string | null
  transportDriver: string | null
  overallExperience: string | null
  remarks: string | null
  clientName: string | null
  submittedAt: string
}

interface PanelData {
  bookingRef: string
  leadName: string | null
  contact: string | null
  hasContact: boolean
  arrivalDate: string
  departureDate: string
  days: TripDay[]
  feedbackRequestSentAt: string | null
  feedback: GuestFeedback | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RATING_STYLE: Record<string, { label: string; cls: string; emoji: string }> = {
  EXCELLENT: { label: 'Excellent', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', emoji: '🤩' },
  GOOD:      { label: 'Good',      cls: 'bg-sky-100 text-sky-700 border-sky-200',             emoji: '😊' },
  AVERAGE:   { label: 'Average',   cls: 'bg-amber-100 text-amber-700 border-amber-200',       emoji: '😐' },
  POOR:      { label: 'Poor',      cls: 'bg-rose-100 text-rose-700 border-rose-200',          emoji: '😞' },
}
const PURPOSE_LABEL: Record<string, string> = { BUSINESS: 'Only Business', LEISURE: 'Only Leisure', BOTH: 'Business & Leisure' }

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
}
function fmtSent(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomerWhatsappPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData]       = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [sendingDate, setSendingDate] = useState<string | null>(null)
  const [sendingFeedback, setSendingFeedback] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/whatsapp-customer`).then(r => r.json())
      if (res.success) setData(res.data as PanelData)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [bookingRef])

  useEffect(() => { if (open && !data) load() }, [open, data, load])

  async function sendBriefing(date: string) {
    setSendingDate(date)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/whatsapp-customer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'briefing', date }),
      }).then(r => r.json())
      if (res.success) { toast.success(res.message); load() }
      else toast.error(res.error ?? 'Send failed')
    } catch { toast.error('Send failed') } finally { setSendingDate(null) }
  }

  async function sendFeedback() {
    setSendingFeedback(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/whatsapp-customer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback' }),
      }).then(r => r.json())
      if (res.success) { toast.success(res.message); load() }
      else toast.error(res.error ?? 'Send failed')
    } catch { toast.error('Send failed') } finally { setSendingFeedback(false) }
  }

  return (
    <Card>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/70 transition-colors rounded-t-2xl"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0 shadow-sm">
          <MessageCircle className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            Customer WhatsApp
            {data?.feedback && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                <Star className="w-2.5 h-2.5" /> Feedback in
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500">Send daily trip details & the feedback form manually</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <CardBody className="border-t border-slate-100 pt-4 space-y-5">
          {loading && !data ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-emerald-500 animate-spin" /></div>
          ) : !data ? (
            <p className="text-sm text-slate-400 text-center py-6">Could not load messaging data.</p>
          ) : (
            <>
              {/* Contact banner */}
              <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs ${
                data.hasContact ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                <MessageCircle className="w-4 h-4 flex-shrink-0" />
                {data.hasContact
                  ? <span>Messages go to <span className="font-mono font-semibold">{data.contact}</span>{data.leadName ? ` · ${data.leadName}` : ''}</span>
                  : <span>No WhatsApp/phone number on this booking — add a contact number before sending.</span>}
                <button onClick={load} className="ml-auto text-slate-400 hover:text-slate-600" title="Refresh">
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Day-by-day sender */}
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Daily Trip Details
                </p>
                <div className="space-y-1.5">
                  {data.days.map(day => {
                    const parts: string[] = []
                    if (day.flightCount) parts.push(`${day.flightCount} flight${day.flightCount > 1 ? 's' : ''}`)
                    if (day.agendaCount) parts.push(`${day.agendaCount} movement${day.agendaCount > 1 ? 's' : ''}`)
                    if (day.checkIn) parts.push('check-in')
                    if (day.checkOut) parts.push('check-out')
                    const sending = sendingDate === day.date
                    return (
                      <div key={day.date} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex flex-col items-center justify-center flex-shrink-0 leading-none">
                          <span className="text-[8px] uppercase text-slate-400 font-bold">Day</span>
                          <span className="text-xs font-black">{day.dayNo}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-800">{fmtDay(day.date)}</span>
                            {day.isArrival && <Tag color="blue" icon={<Plane className="w-2.5 h-2.5" />}>Arrival</Tag>}
                            {day.isDeparture && <Tag color="violet" icon={<Plane className="w-2.5 h-2.5 rotate-90" />}>Departure</Tag>}
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {parts.length ? parts.join(' · ') : 'Free day — no fixed schedule'}
                          </p>
                        </div>
                        {day.lastSentAt && (
                          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium" title={`Last sent ${fmtSent(day.lastSentAt)}`}>
                            <CheckCircle2 className="w-3 h-3" /> Sent
                          </span>
                        )}
                        <button
                          onClick={() => sendBriefing(day.date)}
                          disabled={!data.hasContact || sending}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                            day.lastSentAt
                              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                        >
                          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {day.lastSentAt ? 'Resend' : 'Send'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Feedback form sender */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" /> Feedback Form
                </p>
                {data.feedback ? (
                  <FeedbackView feedback={data.feedback} />
                ) : (
                  <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-amber-50/60 border border-amber-100">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-700">
                        {data.feedbackRequestSentAt ? 'Feedback form sent — awaiting response' : 'No feedback yet'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {data.feedbackRequestSentAt
                          ? `Last sent ${fmtSent(data.feedbackRequestSentAt)}`
                          : 'Send the digital feedback form to the guest via WhatsApp.'}
                      </p>
                    </div>
                    <button
                      onClick={sendFeedback}
                      disabled={!data.hasContact || sendingFeedback}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {sendingFeedback ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      {data.feedbackRequestSentAt ? 'Resend form' : 'Send form'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardBody>
      )}
    </Card>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tag({ color, icon, children }: { color: 'blue' | 'violet'; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = color === 'blue' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-violet-100 text-violet-700 border-violet-200'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>
      {icon}{children}
    </span>
  )
}

function FeedbackView({ feedback }: { feedback: GuestFeedback }) {
  const rows: { label: string; value: string | null; icon: React.ReactNode }[] = [
    { label: 'Accommodation — Room',    value: feedback.accommodationRoom,  icon: <Hotel className="w-3 h-3" /> },
    { label: 'Accommodation — Food',    value: feedback.accommodationFood,  icon: <Hotel className="w-3 h-3" /> },
    { label: 'Restaurant — Food',       value: feedback.restaurantFood,     icon: <Sparkles className="w-3 h-3" /> },
    { label: 'Restaurant — Ambience',   value: feedback.restaurantAmbience, icon: <Sparkles className="w-3 h-3" /> },
    { label: 'Transport — Vehicle',     value: feedback.transportVehicle,   icon: <MapPin className="w-3 h-3" /> },
    { label: 'Transport — Driver',      value: feedback.transportDriver,    icon: <MapPin className="w-3 h-3" /> },
  ]

  return (
    <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-emerald-100 bg-white/60">
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-800">Feedback received</p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {fmtSent(feedback.submittedAt)}
            {feedback.clientName ? ` · ${feedback.clientName}` : ''}
          </p>
        </div>
        {feedback.overallExperience && <RatingBadge value={feedback.overallExperience} large />}
      </div>

      <div className="p-4 space-y-2.5">
        {feedback.purpose && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Purpose of stay</span>
            <span className="font-semibold text-slate-700">{PURPOSE_LABEL[feedback.purpose] ?? feedback.purpose}</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 flex items-center gap-1.5 min-w-0">
                <span className="text-slate-300">{r.icon}</span>
                <span className="truncate">{r.label}</span>
              </span>
              {r.value ? <RatingBadge value={r.value} /> : <span className="text-slate-300">—</span>}
            </div>
          ))}
        </div>
        {feedback.remarks && (
          <div className="mt-2 pt-3 border-t border-emerald-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Remarks</p>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{feedback.remarks}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function RatingBadge({ value, large }: { value: string; large?: boolean }) {
  const s = RATING_STYLE[value] ?? { label: value, cls: 'bg-slate-100 text-slate-600 border-slate-200', emoji: '' }
  return (
    <span className={`inline-flex items-center gap-1 font-bold rounded-full border ${s.cls} ${large ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'}`}>
      <span>{s.emoji}</span> {s.label}
    </span>
  )
}
