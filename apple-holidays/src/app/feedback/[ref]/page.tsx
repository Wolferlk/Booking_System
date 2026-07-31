'use client'

/**
 * Public guest feedback form — opened from the post-departure WhatsApp link.
 * No login; access is gated by the signed ?t= token validated server-side.
 * Digital version of the paper "Guest Feedback Form".
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import LogoSpinner from '@/components/shared/logo-spinner'

type Rating = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'
type Purpose = 'BUSINESS' | 'LEISURE' | 'BOTH'

interface BookingInfo {
  bookingRef: string
  leadName: string | null
  arrivalDate: string
  departureDate: string
  tourDestination: string | null
  alreadySubmitted: boolean
}

const RATING_OPTIONS: { value: Rating; label: string; emoji: string; color: string; ring: string }[] = [
  { value: 'EXCELLENT', label: 'Excellent', emoji: '🤩', color: 'bg-emerald-500', ring: 'ring-emerald-300' },
  { value: 'GOOD',      label: 'Good',      emoji: '😊', color: 'bg-sky-500',     ring: 'ring-sky-300' },
  { value: 'AVERAGE',   label: 'Average',   emoji: '😐', color: 'bg-amber-500',   ring: 'ring-amber-300' },
  { value: 'POOR',      label: 'Poor',      emoji: '😞', color: 'bg-rose-500',    ring: 'ring-rose-300' },
]

const PURPOSE_OPTIONS: { value: Purpose; label: string; emoji: string }[] = [
  { value: 'LEISURE',  label: 'Only Leisure',       emoji: '🏖️' },
  { value: 'BUSINESS', label: 'Only Business',      emoji: '💼' },
  { value: 'BOTH',     label: 'Business & Leisure', emoji: '🧳' },
]

const SECTIONS: { title: string; emoji: string; items: { key: RatingKey; label: string }[] }[] = [
  { title: 'Accommodation', emoji: '🏨', items: [
    { key: 'accommodationRoom', label: 'Room' },
    { key: 'accommodationFood', label: 'Quality of Food' },
  ]},
  { title: 'Restaurants', emoji: '🍽️', items: [
    { key: 'restaurantFood',     label: 'Quality of Food' },
    { key: 'restaurantAmbience', label: 'Ambience' },
  ]},
  { title: 'Transport & Guide', emoji: '🚗', items: [
    { key: 'transportVehicle', label: 'Quality of Vehicle' },
    { key: 'transportDriver',  label: 'Service Delivery of Driver' },
  ]},
]

type RatingKey =
  | 'accommodationRoom' | 'accommodationFood'
  | 'restaurantFood' | 'restaurantAmbience'
  | 'transportVehicle' | 'transportDriver'

export default function GuestFeedbackPage() {
  const params = useParams<{ ref: string }>()
  const sp = useSearchParams()
  const token = sp.get('t') ?? ''

  const [booking, setBooking]   = useState<BookingInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)

  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [ratings, setRatings] = useState<Partial<Record<RatingKey, Rating>>>({})
  const [overall, setOverall] = useState<Rating | null>(null)
  const [remarks, setRemarks] = useState('')
  const [clientName, setClientName] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/public/feedback/${encodeURIComponent(params.ref)}?t=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setBooking(json.data as BookingInfo)
        else setLoadError(json.error ?? 'This link is invalid or has expired.')
      })
      .catch(() => setLoadError('Could not load the feedback form. Please try again later.'))
      .finally(() => setLoading(false))
  }, [params.ref, token])

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/public/feedback/${encodeURIComponent(params.ref)}?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose,
          ...ratings,
          overallExperience: overall,
          remarks: remarks || null,
          clientName: clientName || null,
        }),
      })
      const json = await res.json()
      if (json.success) setSubmitted(true)
      else setSubmitError(json.error ?? 'Something went wrong — please try again.')
    } catch {
      setSubmitError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const answeredCount = Object.keys(ratings).length + (overall ? 1 : 0) + (purpose ? 1 : 0)
  const totalQuestions = 8

  // ── Shell states ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <LogoSpinner size={56} label="Loading your feedback form…" />
        </div>
      </Shell>
    )
  }

  if (loadError || !booking) {
    return (
      <Shell>
        <div className="text-center py-20 px-6">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">Link not valid</h2>
          <p className="text-sm text-slate-500">{loadError}</p>
        </div>
      </Shell>
    )
  }

  if (submitted || booking.alreadySubmitted) {
    return (
      <Shell>
        <div className="text-center py-20 px-6">
          <div className="text-6xl mb-4">💚</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Thank you{booking.leadName ? `, ${booking.leadName}` : ''}!</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            {submitted
              ? 'Your feedback has been received. Our management team reviews every response — we truly appreciate your time.'
              : 'Feedback for this trip has already been submitted. Thank you for travelling with Apple Holidays!'}
          </p>
        </div>
      </Shell>
    )
  }

  // ── The form ─────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Intro */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-[13px] leading-relaxed text-slate-600">
          Dear {booking.leadName ?? 'Guest'}, thank you for giving us the opportunity to be at your
          service{booking.tourDestination ? ` in ${booking.tourDestination}` : ''}. We&apos;d greatly
          appreciate a few minutes of your time — your comments are reviewed by our senior management
          team and corrective actions are taken immediately.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
          ✈️ Trip Ref: <span className="font-mono">{booking.bookingRef}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="px-5 pb-4">
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full transition-all duration-500"
            style={{ width: `${Math.round((answeredCount / totalQuestions) * 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-1 text-right">{answeredCount}/{totalQuestions} answered</p>
      </div>

      {/* A — Purpose */}
      <SectionCard step="A" title="Purpose of your stay" emoji="🎯">
        <div className="grid grid-cols-1 gap-2">
          {PURPOSE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPurpose(opt.value)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                purpose === opt.value
                  ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className="text-xl">{opt.emoji}</span>
              {opt.label}
              {purpose === opt.value && <span className="ml-auto text-amber-600">✓</span>}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* B — Satisfaction ratings */}
      <SectionCard step="B" title="Extent of satisfaction" emoji="⭐">
        <div className="space-y-5">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <p className="text-[13px] font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <span>{section.emoji}</span> {section.title}
              </p>
              <div className="space-y-3">
                {section.items.map(item => (
                  <RatingRow
                    key={item.key}
                    label={item.label}
                    value={ratings[item.key] ?? null}
                    onChange={v => setRatings(r => ({ ...r, [item.key]: v }))}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="pt-1 border-t border-dashed border-slate-200">
            <p className="text-[13px] font-bold text-slate-700 mb-2 flex items-center gap-1.5 mt-3">
              <span>🌟</span> Overall Experience
            </p>
            <RatingRow label="How was your trip overall?" value={overall} onChange={setOverall} />
          </div>
        </div>
      </SectionCard>

      {/* C — Remarks */}
      <SectionCard step="C" title="Remarks & suggestions" emoji="💬">
        <textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Anything you'd like to tell us — highlights, issues, suggestions…"
          className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 resize-none placeholder:text-slate-300"
        />
        <input
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          maxLength={255}
          placeholder="Your name (optional)"
          className="mt-3 w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-slate-300"
        />
      </SectionCard>

      {/* Submit */}
      <div className="px-5 pb-8 pt-2">
        {submitError && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-3">{submitError}</p>
        )}
        <button
          type="button"
          disabled={submitting || answeredCount === 0}
          onClick={submit}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold text-sm shadow-lg shadow-amber-200 hover:from-amber-600 hover:to-amber-700 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Sending…' : 'Submit Feedback'}
        </button>
        <p className="text-center text-[10px] text-slate-400 mt-3">
          We thank you for your assistance and co-operation. — Apple Holidays
        </p>
      </div>
    </Shell>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-slate-50 flex justify-center">
      <div className="w-full max-w-lg">
        {/* Brand header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-b-3xl px-6 pt-8 pb-6 text-center shadow-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/png/apple-logo.png" alt="Apple Holidays" className="h-12 mx-auto mb-3 object-contain" />
          <h1 className="text-white font-extrabold text-lg tracking-wide">Guest Feedback Form</h1>
          <p className="text-slate-400 text-[11px] mt-1">appleholidaysds.com</p>
        </div>
        <div className="bg-white/80 backdrop-blur rounded-3xl mx-3 -mt-3 mb-6 shadow-sm border border-slate-100 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ step, title, emoji, children }: {
  step: string; title: string; emoji: string; children: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-t border-slate-100">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-7 h-7 rounded-lg bg-slate-900 text-amber-400 text-xs font-black flex items-center justify-center">{step}</span>
        <h2 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">{emoji} {title}</h2>
      </div>
      {children}
    </div>
  )
}

function RatingRow({ label, value, onChange }: {
  label: string
  value: Rating | null
  onChange: (v: Rating) => void
}) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1.5">{label}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {RATING_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center gap-0.5 py-2 rounded-xl border text-[10px] font-semibold transition-all ${
              value === opt.value
                ? `${opt.color} text-white border-transparent ring-2 ${opt.ring} shadow-sm scale-[1.03]`
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            <span className="text-base leading-none">{opt.emoji}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
