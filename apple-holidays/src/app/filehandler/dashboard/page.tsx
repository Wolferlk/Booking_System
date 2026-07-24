'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Search, Loader2, PlaneTakeoff, Plus, Pencil, Trash2, X, Users, CalendarDays,
  Ban, CheckCircle2, AlertTriangle, MapPin, Clock, Plane,
} from 'lucide-react'

interface Flight {
  id: string; flightNo: string; date: string; fromApt: string; depTime: string
  toApt: string; arrTime: string; airline: string | null; notes: string | null
}
interface Booking {
  id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null
  agent: string | null; fileHandler: string | null; status: string; operationCountry: string | null
  arrivalDate: string; departureDate: string; paxAdults: number; paxChildren: number; paxInfants: number
  cancelRequestedAt: string | null; cancelledByName: string | null; cancellationReason: string | null
  passengers: { name: string }[]; flights: Flight[]
}

const FLAG: Record<string, string> = { SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬🇲🇾', ALL: '🌐' }
const EMPTY_FLIGHT = { flightNo: '', date: '', fromApt: '', depTime: '', toApt: '', arrTime: '', airline: '', notes: '' }
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const INPUT = 'w-full bg-[#0c1a24] border border-white/12 rounded-lg py-2.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15'

export default function FileHandlerDashboard() {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Booking[] | null>(null)
  const [active, setActive] = useState<Booking | null>(null)

  // flight editor
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; flight: typeof EMPTY_FLIGHT; id?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // cancel modal
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // celebratory overlay after a successful action
  const [celebrate, setCelebrate] = useState<null | 'flight' | 'cancel'>(null)

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim()) return
    setSearching(true); setActive(null)
    try {
      const res = await fetch(`/api/filehandler/bookings/search?q=${encodeURIComponent(q.trim())}`)
      const d = await res.json()
      if (!d.success) { toast.error(d.error); setResults([]); return }
      setResults(d.data.results)
      if (d.data.results.length === 1) setActive(d.data.results[0])
    } finally { setSearching(false) }
  }

  async function refreshActive(ref: string) {
    const res = await fetch(`/api/filehandler/bookings/search?q=${encodeURIComponent(ref)}`)
    const d = await res.json()
    if (d.success) {
      const found = (d.data.results as Booking[]).find(b => b.bookingRef === ref)
      if (found) { setActive(found); setResults(rs => rs?.map(b => b.bookingRef === ref ? found : b) ?? rs) }
    }
  }

  async function saveFlight() {
    if (!active || !editing) return
    const f = editing.flight
    if (!f.flightNo.trim() || !f.date || !f.fromApt.trim() || !f.toApt.trim()) {
      toast.error('Flight no, date, from and to airports are required'); return
    }
    setSaving(true)
    try {
      const isEdit = editing.mode === 'edit'
      const url = `/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/flights${isEdit ? `?flightId=${editing.id}` : ''}`
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setEditing(null)
      await refreshActive(active.bookingRef)
      if (!isEdit) { setCelebrate('flight'); setTimeout(() => setCelebrate(null), 2600) }
      else toast.success('Flight updated')
    } finally { setSaving(false) }
  }

  async function deleteFlight(id: string) {
    if (!active) return
    if (!confirm('Remove this flight?')) return
    const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/flights?flightId=${id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Flight removed')
    await refreshActive(active.bookingRef)
  }

  async function requestCancel() {
    if (!active || !cancelReason.trim()) { toast.error('A reason is required'); return }
    setCancelling(true)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setCancelOpen(false); setCancelReason('')
      await refreshActive(active.bookingRef)
      setCelebrate('cancel'); setTimeout(() => setCelebrate(null), 2600)
    } finally { setCancelling(false) }
  }

  const isPendingCancel = active?.status === 'PENDING_CANCELLATION'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24">
      <style>{`
        @keyframes fhCardIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fhTakeoff{ 0%{transform:translate(0,0) rotate(0);opacity:0} 20%{opacity:1} 100%{transform:translate(120px,-120px) rotate(20deg);opacity:0} }
        @keyframes fhBurst  { 0%{transform:scale(.4);opacity:0} 50%{opacity:1} 100%{transform:scale(1.15);opacity:1} }
        @keyframes fhConf   { 0%{transform:translateY(-10vh) rotate(0)} 100%{transform:translateY(110vh) rotate(680deg)} }
        @keyframes fhPulse  { 0%,100%{opacity:.5} 50%{opacity:1} }
        .fh-card{animation:fhCardIn .35s ease-out both}
      `}</style>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-black text-white flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center"><Plane className="w-5 h-5 text-emerald-400" /></span>
          Booking Search
        </h1>
        <p className="text-slate-500 text-sm mt-1">Find a booking by <span className="text-emerald-300">Booking ref</span>, <span className="text-emerald-300">IS number</span>, or <span className="text-emerald-300">CNTL number</span>.</p>
      </div>

      {/* Search bar */}
      <form onSubmit={runSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. IS12345 / VN00123 / CNTL-889"
            className="w-full bg-[#0c1a24] border border-white/12 rounded-xl py-3.5 pl-11 pr-4 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20" />
        </div>
        <button type="submit" disabled={searching || !q.trim()}
          className="px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-40 flex items-center gap-2">
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </form>

      {/* Results list (when >1) */}
      {results && !active && (
        results.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-semibold">No bookings found for “{q}”</p>
            <p className="text-sm mt-1">Try the full Booking ref, IS number, or CNTL number.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {results.map(b => (
              <button key={b.id} onClick={() => setActive(b)}
                className="fh-card w-full text-left p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 hover:border-emerald-400/30 transition-all flex items-center gap-3">
                <span className="text-xl">{FLAG[b.operationCountry ?? ''] ?? '🌐'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm">{b.bookingRef}</p>
                  <p className="text-slate-500 text-xs truncate">{b.isNumber ? `IS ${b.isNumber} · ` : ''}{b.passengers[0]?.name ?? b.agent ?? '—'}</p>
                </div>
                <StatusPill status={b.status} />
              </button>
            ))}
          </div>
        )
      )}

      {/* Active booking detail */}
      {active && (
        <div className="fh-card space-y-5">
          {results && results.length > 1 && (
            <button onClick={() => setActive(null)} className="text-emerald-400 text-sm font-semibold flex items-center gap-1">← Back to results</button>
          )}

          {/* Booking header card */}
          <div className="rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/8 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{FLAG[active.operationCountry ?? ''] ?? '🌐'}</span>
                  <h2 className="text-white font-black text-lg">{active.bookingRef}</h2>
                </div>
                <p className="text-slate-400 text-sm mt-1">{active.passengers[0]?.name ?? '—'}</p>
              </div>
              <StatusPill status={active.status} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <Meta label="IS Number" value={active.isNumber ?? '—'} />
              <Meta label="CNTL" value={active.cntlNumber ?? '—'} />
              <Meta label="Agent" value={active.agent ?? '—'} />
              <Meta label="File Handler" value={active.fileHandler ?? '—'} highlight />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Meta icon={<CalendarDays className="w-3.5 h-3.5" />} label="Arrival" value={fmtDate(active.arrivalDate)} />
              <Meta icon={<CalendarDays className="w-3.5 h-3.5" />} label="Departure" value={fmtDate(active.departureDate)} />
            </div>
            <div className="mt-3">
              <Meta icon={<Users className="w-3.5 h-3.5" />} label="Passengers" value={`${active.paxAdults} adult${active.paxAdults === 1 ? '' : 's'}${active.paxChildren ? ` · ${active.paxChildren} child` : ''}${active.paxInfants ? ` · ${active.paxInfants} infant` : ''}`} />
            </div>
          </div>

          {/* Pending cancel banner */}
          {isPendingCancel && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3" style={{ animation: 'fhPulse 2s ease-in-out infinite' }}>
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-bold text-sm">Cancellation pending accounts approval</p>
                <p className="text-amber-200/70 text-xs mt-0.5">Requested by {active.cancelledByName ?? 'you'}. Reason: {active.cancellationReason ?? '—'}</p>
              </div>
            </div>
          )}

          {/* Flights */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold text-sm flex items-center gap-2"><PlaneTakeoff className="w-4 h-4 text-emerald-400" /> Flight Details</h3>
              <button onClick={() => setEditing({ mode: 'add', flight: { ...EMPTY_FLIGHT } })}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/20 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Flight
              </button>
            </div>

            {active.flights.length === 0 ? (
              <div className="text-center py-8 rounded-2xl border border-dashed border-white/10 text-slate-500">
                <Plane className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No flights yet. Add the first one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {active.flights.map(f => (
                  <div key={f.id} className="rounded-2xl bg-white/[0.03] border border-white/8 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-black text-sm">{f.flightNo}</span>
                        {f.airline && <span className="text-slate-500 text-xs">{f.airline}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing({ mode: 'edit', id: f.id, flight: { flightNo: f.flightNo, date: f.date.slice(0, 10), fromApt: f.fromApt, depTime: f.depTime, toApt: f.toApt, arrTime: f.arrTime, airline: f.airline ?? '', notes: f.notes ?? '' } })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-white/5"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteFlight(f.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <div className="text-center"><p className="text-white font-bold">{f.fromApt}</p><p className="text-slate-500 text-xs flex items-center gap-1 justify-center"><Clock className="w-3 h-3" />{f.depTime || '—'}</p></div>
                      <div className="flex-1 flex items-center gap-1 text-slate-600"><div className="flex-1 h-px bg-white/10" /><Plane className="w-3.5 h-3.5 text-emerald-400/60" /><div className="flex-1 h-px bg-white/10" /></div>
                      <div className="text-center"><p className="text-white font-bold">{f.toApt}</p><p className="text-slate-500 text-xs flex items-center gap-1 justify-center"><Clock className="w-3 h-3" />{f.arrTime || '—'}</p></div>
                    </div>
                    <p className="text-slate-500 text-xs mt-2 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(f.date)}{f.notes ? ` · ${f.notes}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cancel request */}
          {!isPendingCancel && (
            <button onClick={() => setCancelOpen(true)}
              className="w-full py-3.5 rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/15 font-bold text-sm flex items-center justify-center gap-2 transition-all">
              <Ban className="w-4 h-4" /> Request Cancellation
            </button>
          )}
        </div>
      )}

      {/* Flight editor modal */}
      {editing && active && (
        <Modal onClose={() => setEditing(null)}>
          <h3 className="text-white font-black text-base mb-4 flex items-center gap-2">
            <PlaneTakeoff className="w-5 h-5 text-emerald-400" /> {editing.mode === 'add' ? 'Add Flight' : 'Edit Flight'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <L label="Flight No *"><input className={INPUT} value={editing.flight.flightNo} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, flightNo: e.target.value } }))} placeholder="EK654" /></L>
            <L label="Date *"><input type="date" className={INPUT} value={editing.flight.date} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, date: e.target.value } }))} style={{ colorScheme: 'dark' }} /></L>
            <L label="From (airport) *"><input className={INPUT} value={editing.flight.fromApt} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, fromApt: e.target.value.toUpperCase() } }))} placeholder="CMB" /></L>
            <L label="Dep time"><input className={INPUT} value={editing.flight.depTime} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, depTime: e.target.value } }))} placeholder="14:35" /></L>
            <L label="To (airport) *"><input className={INPUT} value={editing.flight.toApt} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, toApt: e.target.value.toUpperCase() } }))} placeholder="DXB" /></L>
            <L label="Arr time"><input className={INPUT} value={editing.flight.arrTime} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, arrTime: e.target.value } }))} placeholder="18:05" /></L>
            <L label="Airline"><input className={INPUT} value={editing.flight.airline} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, airline: e.target.value } }))} placeholder="Emirates" /></L>
            <L label="Notes"><input className={INPUT} value={editing.flight.notes} onChange={e => setEditing(s => s && ({ ...s, flight: { ...s.flight, notes: e.target.value } }))} placeholder="Terminal 3" /></L>
          </div>
          <button onClick={saveFlight} disabled={saving}
            className="w-full mt-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {editing.mode === 'add' ? 'Add Flight' : 'Save Changes'}
          </button>
        </Modal>
      )}

      {/* Cancel modal */}
      {cancelOpen && active && (
        <Modal onClose={() => setCancelOpen(false)}>
          <h3 className="text-white font-black text-base mb-1 flex items-center gap-2"><Ban className="w-5 h-5 text-red-400" /> Request Cancellation</h3>
          <p className="text-slate-400 text-sm mb-4">Cancelling <span className="text-white font-semibold">{active.bookingRef}</span>. This goes to the accounts team for approval — the booking is not cancelled until they approve.</p>
          <L label="Reason *">
            <textarea className={`${INPUT} min-h-[90px] resize-none`} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Why should this booking be cancelled?" />
          </L>
          <button onClick={requestCancel} disabled={cancelling || !cancelReason.trim()}
            className="w-full mt-4 py-3.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Send to Accounts Team
          </button>
        </Modal>
      )}

      {/* Celebratory overlay */}
      {celebrate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          {[...Array(24)].map((_, i) => (
            <span key={i} className="absolute top-0 w-2 h-3 rounded-sm" style={{
              left: `${(i * 4.2) % 100}%`,
              background: ['#34d399', '#22d3ee', '#a7f3d0', '#f59e0b'][i % 4],
              animation: `fhConf ${2 + (i % 5) * 0.3}s linear ${(i % 7) * 0.1}s forwards`,
            }} />
          ))}
          <div className="relative text-center" style={{ animation: 'fhBurst .5s cubic-bezier(.34,1.56,.64,1) both' }}>
            {celebrate === 'flight' ? (
              <>
                <div className="relative w-24 h-24 mx-auto mb-3">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/20" />
                  <PlaneTakeoff className="absolute inset-0 m-auto w-12 h-12 text-emerald-300" style={{ animation: 'fhTakeoff 1.4s ease-in .3s infinite' }} />
                </div>
                <p className="text-white font-black text-xl">Flight Added! ✈️</p>
                <p className="text-emerald-300 text-sm mt-1">Live on the ops screen now.</p>
              </>
            ) : (
              <>
                <div className="w-24 h-24 mx-auto mb-3 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-amber-300" />
                </div>
                <p className="text-white font-black text-xl">Sent to Accounts 📨</p>
                <p className="text-amber-200 text-sm mt-1">Awaiting their approval to cancel.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cancel = status === 'PENDING_CANCELLATION' || status === 'CANCELLED'
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${cancel ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function Meta({ label, value, icon, highlight }: { label: string; value: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">{icon}{label}</p>
      <p className={`text-sm font-semibold mt-0.5 truncate ${highlight ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-[#071a24] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl" style={{ animation: 'fhCardIn .3s ease-out both' }}>
        <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5"><X className="w-4 h-4" /></button>
        {children}
      </div>
    </div>
  )
}
