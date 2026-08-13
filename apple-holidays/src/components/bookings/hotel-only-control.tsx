'use client'

/**
 * The Hotel Only control — the button, the confirmation, and the banner.
 *
 * Marking a file Hotel Only switches off seven modules at once (itinerary,
 * agenda, drivers, tickets, flights, client reconfirmation, QC), which is far
 * too much to hide behind a bare toggle. So the confirmation does not ask "are
 * you sure?" — it *shows the consequence*: every waived module is listed with
 * the reason it no longer applies, and what stays on is spelled out just as
 * plainly, because the one thing a Hotel Only booking still owns is its hotel.
 *
 * Once set, the banner keeps that contract visible for everyone who opens the
 * booking afterwards, stamped with who decided and when.
 *
 * Rules live in `@/lib/hotel-only`; this file only renders them.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Hotel, BedDouble, ShieldCheck, Undo2, Loader2, Sparkles, CalendarCheck,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { HOTEL_ONLY_LABEL, HOTEL_ONLY_WAIVED } from '@/lib/hotel-only'

export interface HotelOnlyState {
  hotelOnly?: boolean | null
  hotelOnlyAt?: string | null
  hotelOnlyBy?: string | null
  hotelOnlyNote?: string | null
}

/** What a Hotel Only booking *keeps* — the other half of the contract. */
const KEPT: { icon: typeof BedDouble; label: string; why: string }[] = [
  { icon: BedDouble,     label: 'Accommodation',        why: 'The rooms, dates and meal plan are the booking' },
  { icon: ShieldCheck,   label: 'Hotel reconfirmation', why: 'Still reconfirmed with the property at D-10' },
  { icon: CalendarCheck, label: 'P&L and payments',     why: 'The file is still costed and settled as normal' },
]

function stamp(at?: string | null): string {
  if (!at) return ''
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Button + confirmation ────────────────────────────────────────────────────

export function HotelOnlyButton({
  bookingRef, state, disabled, onChanged,
}: {
  bookingRef: string
  state: HotelOnlyState
  /** False for roles that may look but not decide. */
  disabled?: boolean
  /** Called after a successful write so the page can refetch. */
  onChanged: () => void | Promise<void>
}) {
  const on = state.hotelOnly === true
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/hotel-only`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelOnly: !on, note }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not save')
      toast.success(json.message ?? (on ? 'Hotel Only removed' : 'Marked as Hotel Only'))
      setOpen(false)
      setNote('')
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (disabled) return null

  return (
    <>
      <button
        onClick={() => { setNote(''); setOpen(true) }}
        className={`btn btn-sm flex items-center gap-1.5 ${
          on
            ? 'bg-amber-500 text-white border border-amber-600 hover:bg-amber-600'
            : 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100'
        }`}
        title={on
          ? 'This booking is accommodation-only — click to restore the full checklist'
          : 'Accommodation only — waive itinerary, agenda, drivers, tickets, flights, client reconfirmation and QC'}
      >
        {on ? <Undo2 className="w-3.5 h-3.5" /> : <Hotel className="w-3.5 h-3.5" />}
        {on ? 'Remove Hotel Only' : 'Set Hotel Only'}
      </button>

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        size="2xl"
        title={on ? 'Remove the Hotel Only mark?' : `Mark ${bookingRef} as a ${HOTEL_ONLY_LABEL} booking?`}
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <p className="text-xs text-slate-400 hidden sm:block">
              Recorded against your name in the booking history.
            </p>
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <button
                onClick={submit}
                disabled={saving}
                className={`btn btn-sm text-white flex items-center gap-1.5 ${
                  on ? 'bg-slate-700 border border-slate-800 hover:bg-slate-800'
                     : 'bg-amber-500 border border-amber-600 hover:bg-amber-600'
                } disabled:opacity-60`}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : on ? <Undo2 className="w-3.5 h-3.5" /> : <Hotel className="w-3.5 h-3.5" />}
                {on ? 'Restore full checklist' : `Confirm — ${HOTEL_ONLY_LABEL}`}
              </button>
            </div>
          </div>
        }
      >
        {on ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-700">
                Every waived module comes back: the booking will again be chased for its
                itinerary, agenda, drivers, tickets, flights, client reconfirmation and QC,
                and it will reappear as outstanding on the operations board and daily report
                until those are done.
              </p>
            </div>
            {state.hotelOnlyBy && (
              <p className="text-xs text-slate-500">
                Marked by <span className="font-semibold text-slate-700">{state.hotelOnlyBy}</span>
                {stamp(state.hotelOnlyAt) && ` on ${stamp(state.hotelOnlyAt)}`}
                {state.hotelOnlyNote && ` — “${state.hotelOnlyNote}”`}
              </p>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason (optional)</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Why is the full checklist needed again?"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                <Hotel className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">Accommodation and nothing else.</p>
                <p className="text-sm text-amber-800 mt-0.5">
                  The guest arranges their own travel and their own days. Operations owns the
                  hotel — and only the hotel.
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                No longer required on this booking
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {HOTEL_ONLY_WAIVED.map(m => (
                  <div
                    key={m.key}
                    className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5"
                  >
                    <span className="text-base leading-none mt-0.5 opacity-60 grayscale">{m.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-500 line-through decoration-slate-300">{m.label}</p>
                      <p className="text-[11px] text-slate-400 leading-snug">{m.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Still required — unchanged
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {KEPT.map(k => (
                  <div key={k.label} className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                    <p className="text-sm font-medium text-emerald-800 flex items-center gap-1.5">
                      <k.icon className="w-3.5 h-3.5" /> {k.label}
                    </p>
                    <p className="text-[11px] text-emerald-700/80 leading-snug mt-0.5">{k.why}</p>
                  </div>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason (optional)</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Agent sold room-only; guest is self-driving"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </label>
          </div>
        )}
      </Modal>
    </>
  )
}

// ─── Banner ───────────────────────────────────────────────────────────────────

/**
 * Shown at the top of a marked booking. It exists so the *absence* of the
 * itinerary, agenda and QC panels below reads as a decision somebody made rather
 * than data that failed to load.
 */
export function HotelOnlyBanner({ state }: { state: HotelOnlyState }) {
  if (state.hotelOnly !== true) return null
  const when = stamp(state.hotelOnlyAt)

  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Hotel className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 flex items-center gap-2">
              {HOTEL_ONLY_LABEL} booking
            </p>
            <p className="text-xs text-amber-800/90 leading-snug">
              Accommodation only — no itinerary, agenda, drivers, tickets, flights,
              client reconfirmation or QC. Hotel reconfirmation still applies.
            </p>
          </div>
        </div>
        <div className="sm:ml-auto text-[11px] text-amber-700/90 sm:text-right shrink-0">
          {state.hotelOnlyBy && <p>Set by <span className="font-semibold">{state.hotelOnlyBy}</span></p>}
          {when && <p>{when}</p>}
        </div>
      </div>
      {state.hotelOnlyNote && (
        <p className="mt-3 pt-3 border-t border-amber-200/70 text-xs text-amber-900 italic">
          “{state.hotelOnlyNote}”
        </p>
      )}
    </div>
  )
}

/** The inline chip used next to a booking reference. */
export function HotelOnlyChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border bg-amber-50 text-amber-800 border-amber-300 ${className}`}
      title="Hotel Only — accommodation only; no agenda, drivers, tickets, flights, client reconfirmation or QC"
    >
      <Hotel className="w-3 h-3" /> {HOTEL_ONLY_LABEL}
    </span>
  )
}
