'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Search, Loader2, PlaneTakeoff, Plus, Pencil, Trash2, X, Users, CalendarDays,
  Ban, CheckCircle2, AlertTriangle, Clock, Plane, Radar, DownloadCloud, Sparkles,
  Building2, User2, Mail, Phone, MessageCircle, StickyNote, Wand2, Upload,
  Hotel, BedDouble, Utensils, MapPin, FileText, Download, Send,
} from 'lucide-react'

interface Flight {
  id: string; flightNo: string; date: string; fromApt: string; depTime: string
  toApt: string; arrTime: string; airline: string | null; notes: string | null
}
interface Accommodation {
  id: string; city: string; hotel: string; checkIn: string; checkOut: string
  address: string | null; contact: string | null; nights: number; roomType: string | null; mealType: string | null
}
interface Booking {
  id: string; bookingRef: string; isNumber: string | null; cntlNumber: string | null
  agent: string | null; fileHandler: string | null; status: string; operationCountry: string | null
  arrivalDate: string; departureDate: string; paxAdults: number; paxChildren: number; paxInfants: number
  cancelRequestedAt: string | null; cancelledByName: string | null; cancellationReason: string | null
  agentEmail: string | null; agentPhone: string | null; agentWhatsapp: string | null
  contactEmail: string | null; contactPhone: string | null; contactWhatsapp: string | null
  importantNotes: string | null
  passengers: { name: string }[]; flights: Flight[]; accommodations: Accommodation[]
}

const FLAG: Record<string, string> = { SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬🇲🇾', ALL: '🌐' }
const EMPTY_FLIGHT = { flightNo: '', date: '', fromApt: '', depTime: '', toApt: '', arrTime: '', airline: '', notes: '' }
const EMPTY_HOTEL = { city: '', hotel: '', checkIn: '', checkOut: '', address: '', contact: '', roomType: '', mealType: '' }
type DetailsForm = {
  agentEmail: string; agentPhone: string; agentWhatsapp: string
  contactEmail: string; contactPhone: string; contactWhatsapp: string; importantNotes: string
}
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Parse a JSON response defensively. A gateway 502/504 (Amplify, timeout) returns
 * an HTML error page, so res.json() would throw "Unexpected token '<'". Return a
 * normalised { success, error } object instead of crashing the promise.
 */
async function safeJson(res: Response): Promise<{ success?: boolean; error?: string; message?: string; data?: any }> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text)
  } catch {
    if (res.status === 502 || res.status === 504) {
      return { success: false, error: 'The server took too long to generate the PDF. Please try again in a moment.' }
    }
    return { success: false, error: `Request failed (${res.status}). Please try again.` }
  }
}
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
  const [cancelFees, setCancelFees] = useState<{ note: string; amount: string }[]>([{ note: '', amount: '' }])
  const [cancelling, setCancelling] = useState(false)

  // celebratory overlay after a successful action
  const [celebrate, setCelebrate] = useState<null | 'flight' | 'cancel' | 'import'>(null)

  // AppleSystem auto-import (fires when a booking isn't found locally)
  const [importing, setImporting] = useState(false)

  // details editor (agent + guest contact + important notes)
  const [detailsForm, setDetailsForm] = useState<DetailsForm | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)

  // hotel editor
  const [hotelEdit, setHotelEdit] = useState<{ mode: 'add' | 'edit'; hotel: typeof EMPTY_HOTEL; id?: string } | null>(null)
  const [savingHotel, setSavingHotel] = useState(false)

  // PDF download + email
  const [pdfBusy, setPdfBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  // AI flight import (upload image/pdf OR paste text → extract → review → add)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTab, setAiTab] = useState<'upload' | 'paste'>('upload')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiFlights, setAiFlights] = useState<typeof EMPTY_FLIGHT[] | null>(null)
  const [aiSource, setAiSource] = useState('')
  const [aiAdding, setAiAdding] = useState(false)

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const query = q.trim()
    if (!query) return
    setSearching(true); setActive(null); setResults(null)
    try {
      const res = await fetch(`/api/filehandler/bookings/search?q=${encodeURIComponent(query)}`)
      const d = await res.json()
      if (!d.success) { toast.error(d.error); setResults([]); return }
      const found: Booking[] = d.data.results
      if (found.length === 0) { await autoImport(query); return }
      setResults(found)
      if (found.length === 1) setActive(found[0])
    } finally { setSearching(false) }
  }

  // Not in our system → pull it from AppleSystem and import it live.
  async function autoImport(query: string) {
    setImporting(true)
    try {
      const res = await fetch('/api/filehandler/bookings/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      })
      const d = await res.json()
      if (!d.success || !d.data?.booking) {
        // 404 "not_found_anywhere" (or any failure) → fall back to the empty state.
        setResults([])
        return
      }
      const b: Booking = d.data.booking
      setResults([b]); setActive(b)
      setCelebrate('import'); setTimeout(() => setCelebrate(null), 3000)
    } catch {
      setResults([])
    } finally { setImporting(false) }
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
      const fees = cancelFees
        .map(f => ({ note: f.note.trim(), amount: Number(f.amount) || 0 }))
        .filter(f => f.note || f.amount > 0)
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim(), fees }),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setCancelOpen(false); setCancelReason(''); setCancelFees([{ note: '', amount: '' }])
      await refreshActive(active.bookingRef)
      setCelebrate('cancel'); setTimeout(() => setCelebrate(null), 2600)
    } finally { setCancelling(false) }
  }

  async function saveDetails() {
    if (!active || !detailsForm) return
    setSavingDetails(true)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/details`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(detailsForm),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setDetailsForm(null)
      toast.success('Details updated')
      await refreshActive(active.bookingRef)
    } finally { setSavingDetails(false) }
  }

  async function saveHotel() {
    if (!active || !hotelEdit) return
    const h = hotelEdit.hotel
    if (!h.hotel.trim() || !h.city.trim() || !h.checkIn || !h.checkOut) {
      toast.error('Hotel, city, check-in and check-out are required'); return
    }
    setSavingHotel(true)
    try {
      const isEdit = hotelEdit.mode === 'edit'
      const url = `/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/accommodations${isEdit ? `?accId=${hotelEdit.id}` : ''}`
      const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(h) })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setHotelEdit(null)
      toast.success(isEdit ? 'Hotel updated' : 'Hotel added')
      await refreshActive(active.bookingRef)
    } finally { setSavingHotel(false) }
  }

  async function deleteHotel(id: string) {
    if (!active || !confirm('Remove this hotel?')) return
    const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/accommodations?accId=${id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Hotel removed')
    await refreshActive(active.bookingRef)
  }

  // ── PDF download + email ───────────────────────────────────────────────────
  async function downloadPdf() {
    if (!active) return
    setPdfBusy(true)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/pdf`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || 'Could not generate the PDF'); return
      }
      // Filename comes from the Content-Disposition header set by the API.
      const disp = res.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `${active.isNumber || active.bookingRef}_Updates.PDF`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success('PDF downloaded')
    } catch {
      toast.error('Could not generate the PDF')
    } finally { setPdfBusy(false) }
  }

  // "Save & Confirm" — mails the updated booking PDF to the file handler's own inbox.
  async function confirmAndEmail() {
    if (!active) return
    setConfirmBusy(true)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ self: true }),
      })
      const d = await safeJson(res)
      if (!d.success) { toast.error(d.error || 'Could not send the confirmation email'); return }
      toast.success(`Confirmation emailed to ${d.data?.to ?? 'your inbox'}`)
    } catch {
      toast.error('Could not send the confirmation email')
    } finally { setConfirmBusy(false) }
  }

  function openEmail() {
    if (!active) return
    setEmailTo(active.agentEmail || active.contactEmail || '')
    setEmailMsg('')
    setEmailOpen(true)
  }

  async function sendPdfEmail() {
    if (!active || !emailTo.trim()) { toast.error('Enter a recipient email'); return }
    setEmailSending(true)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTo.trim(), message: emailMsg.trim() }),
      })
      const d = await safeJson(res)
      if (!d.success) { toast.error(d.error || 'Email failed'); return }
      setEmailOpen(false)
      toast.success(`Sent to ${emailTo.trim()}`)
    } catch {
      toast.error('Email failed')
    } finally { setEmailSending(false) }
  }

  // ── AI flight extraction ──────────────────────────────────────────────────
  function openAi() { setAiOpen(true); setAiTab('upload'); setAiText(''); setAiFlights(null); setAiSource('') }

  async function extractFromFile(file: File) {
    if (!active) return
    setAiBusy(true); setAiFlights(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/flights/extract`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setAiFlights(d.data.flights); setAiSource(d.data.source ?? file.name)
      if (!d.data.flights.length) toast.error(d.message ?? 'No flights found')
    } finally { setAiBusy(false) }
  }

  async function extractFromText() {
    if (!active || !aiText.trim()) { toast.error('Paste some flight text first'); return }
    setAiBusy(true); setAiFlights(null)
    try {
      const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/flights/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText }),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setAiFlights(d.data.flights); setAiSource('pasted text')
      if (!d.data.flights.length) toast.error(d.message ?? 'No flights found in the text')
    } finally { setAiBusy(false) }
  }

  async function addExtractedFlights() {
    if (!active || !aiFlights?.length) return
    setAiAdding(true)
    try {
      let ok = 0
      for (const f of aiFlights) {
        if (!f.flightNo?.trim() && !f.fromApt?.trim()) continue
        const res = await fetch(`/api/filehandler/bookings/${encodeURIComponent(active.bookingRef)}/flights`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...f, date: (f.date || '').slice(0, 10) }),
        })
        if ((await res.json()).success) ok++
      }
      setAiOpen(false); setAiFlights(null)
      await refreshActive(active.bookingRef)
      if (ok) { toast.success(`${ok} flight${ok === 1 ? '' : 's'} added`); setCelebrate('flight'); setTimeout(() => setCelebrate(null), 2600) }
      else toast.error('No valid flights to add')
    } finally { setAiAdding(false) }
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
        @keyframes fhSweep  { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes fhPing   { 0%{transform:scale(.4);opacity:.9} 100%{transform:scale(1.6);opacity:0} }
        @keyframes fhBar    { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        @keyframes fhFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
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

            {/* Export actions — confirm (email the handler), download, or email to someone */}
            <div className="mt-4 pt-4 border-t border-white/8 space-y-2">
              <button onClick={confirmAndEmail} disabled={confirmBusy}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {confirmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save &amp; Confirm — email me a copy
              </button>
              <div className="flex flex-wrap gap-2">
                <button onClick={downloadPdf} disabled={pdfBusy}
                  className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/12 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-emerald-400" />} Download PDF
                </button>
                <button onClick={openEmail}
                  className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/12 text-white font-bold text-sm flex items-center justify-center gap-2">
                  <Mail className="w-4 h-4 text-emerald-400" /> Email to…
                </button>
              </div>
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

          {/* Agent & Guest contact + Important notes */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/8 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-sm flex items-center gap-2"><User2 className="w-4 h-4 text-emerald-400" /> Contacts &amp; Notes</h3>
              <button onClick={() => setDetailsForm({
                agentEmail: active.agentEmail ?? '', agentPhone: active.agentPhone ?? '', agentWhatsapp: active.agentWhatsapp ?? '',
                contactEmail: active.contactEmail ?? '', contactPhone: active.contactPhone ?? '', contactWhatsapp: active.contactWhatsapp ?? '',
                importantNotes: active.importantNotes ?? '',
              })}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/20 flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <ContactBlock title="Agent" icon={<Building2 className="w-3.5 h-3.5" />}
                email={active.agentEmail} phone={active.agentPhone} whatsapp={active.agentWhatsapp} />
              <ContactBlock title="Guest / Tourist" icon={<User2 className="w-3.5 h-3.5" />}
                email={active.contactEmail} phone={active.contactPhone} whatsapp={active.contactWhatsapp} />
            </div>

            <div className="mt-4 pt-4 border-t border-white/6">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1"><StickyNote className="w-3.5 h-3.5" /> Important Notes</p>
              <p className={`text-sm whitespace-pre-wrap ${active.importantNotes ? 'text-amber-100/90' : 'text-slate-600'}`}>{active.importantNotes || 'No notes yet.'}</p>
            </div>
          </div>

          {/* Hotel details */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold text-sm flex items-center gap-2"><Hotel className="w-4 h-4 text-emerald-400" /> Hotel Details</h3>
              <button onClick={() => setHotelEdit({ mode: 'add', hotel: { ...EMPTY_HOTEL } })}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/20 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Hotel
              </button>
            </div>
            {active.accommodations.length === 0 ? (
              <div className="text-center py-8 rounded-2xl border border-dashed border-white/10 text-slate-500">
                <Hotel className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No hotels yet. Add the first one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {active.accommodations.map(a => (
                  <div key={a.id} className="rounded-2xl bg-white/[0.03] border border-white/8 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-bold text-sm">{a.hotel}</p>
                        <p className="text-slate-500 text-xs flex items-center gap-1"><MapPin className="w-3 h-3" /> {a.city}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => setHotelEdit({ mode: 'edit', id: a.id, hotel: { city: a.city, hotel: a.hotel, checkIn: a.checkIn.slice(0, 10), checkOut: a.checkOut.slice(0, 10), address: a.address ?? '', contact: a.contact ?? '', roomType: a.roomType ?? '', mealType: a.mealType ?? '' } })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-white/5"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteHotel(a.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(a.checkIn)} → {fmtDate(a.checkOut)} · {a.nights} night{a.nights === 1 ? '' : 's'}</span>
                      {a.roomType && <span className="flex items-center gap-1"><BedDouble className="w-3 h-3" /> {a.roomType}</span>}
                      {a.mealType && <span className="flex items-center gap-1"><Utensils className="w-3 h-3" /> {a.mealType}</span>}
                    </div>
                    {(a.address || a.contact) && <p className="text-slate-500 text-xs mt-1.5">{[a.address, a.contact].filter(Boolean).join(' · ')}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Flights */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold text-sm flex items-center gap-2"><PlaneTakeoff className="w-4 h-4 text-emerald-400" /> Flight Details</h3>
              <div className="flex items-center gap-2">
                <button onClick={openAi}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/20 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5" /> AI Auto-fill
                </button>
                <button onClick={() => setEditing({ mode: 'add', flight: { ...EMPTY_FLIGHT } })}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/20 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add Flight
                </button>
              </div>
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

          {/* Cancellation fees — optional list of note + amount with a live total. */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Cancellation Fees</span>
              <span className="text-[11px] text-slate-500">Optional</span>
            </div>
            <div className="space-y-2">
              {cancelFees.map((fee, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={`${INPUT} flex-1`}
                    placeholder="Fee note (e.g. Hotel non-refundable)"
                    value={fee.note}
                    onChange={e => setCancelFees(prev => prev.map((f, idx) => idx === i ? { ...f, note: e.target.value } : f))}
                  />
                  <input
                    type="number" min="0" step="0.01"
                    className={`${INPUT} w-24 text-right`}
                    placeholder="0.00"
                    value={fee.amount}
                    onChange={e => setCancelFees(prev => prev.map((f, idx) => idx === i ? { ...f, amount: e.target.value } : f))}
                  />
                  <button type="button"
                    onClick={() => setCancelFees(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [{ note: '', amount: '' }])}
                    className="shrink-0 p-2 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10" aria-label="Remove fee line">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button type="button"
                onClick={() => setCancelFees(prev => [...prev, { note: '', amount: '' }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300">
                <Plus className="w-3.5 h-3.5" /> Add fee line
              </button>
              <span className="text-sm font-bold text-white">
                Total: {cancelFees.reduce((s, f) => s + (Number(f.amount) || 0), 0).toFixed(2)}
              </span>
            </div>
          </div>

          <button onClick={requestCancel} disabled={cancelling || !cancelReason.trim()}
            className="w-full mt-4 py-3.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Send to Accounts Team
          </button>
        </Modal>
      )}

      {/* Contacts & notes editor */}
      {detailsForm && active && (
        <Modal onClose={() => setDetailsForm(null)}>
          <h3 className="text-white font-black text-base mb-4 flex items-center gap-2"><User2 className="w-5 h-5 text-emerald-400" /> Edit Contacts &amp; Notes</h3>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto -mx-1 px-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-emerald-300/80 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Agent</p>
            <div className="grid grid-cols-1 gap-3">
              <L label="Agent Email"><input className={INPUT} value={detailsForm.agentEmail} onChange={e => setDetailsForm(s => s && ({ ...s, agentEmail: e.target.value }))} placeholder="agent@example.com" /></L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Contact Phone"><input className={INPUT} value={detailsForm.agentPhone} onChange={e => setDetailsForm(s => s && ({ ...s, agentPhone: e.target.value }))} placeholder="+94 ..." /></L>
                <L label="WhatsApp"><input className={INPUT} value={detailsForm.agentWhatsapp} onChange={e => setDetailsForm(s => s && ({ ...s, agentWhatsapp: e.target.value }))} placeholder="+94 ..." /></L>
              </div>
            </div>
            <p className="text-[11px] font-black uppercase tracking-wider text-emerald-300/80 flex items-center gap-1.5 pt-1"><User2 className="w-3.5 h-3.5" /> Guest / Tourist</p>
            <div className="grid grid-cols-1 gap-3">
              <L label="Guest Email"><input className={INPUT} value={detailsForm.contactEmail} onChange={e => setDetailsForm(s => s && ({ ...s, contactEmail: e.target.value }))} placeholder="guest@example.com" /></L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Contact Phone"><input className={INPUT} value={detailsForm.contactPhone} onChange={e => setDetailsForm(s => s && ({ ...s, contactPhone: e.target.value }))} placeholder="+..." /></L>
                <L label="WhatsApp"><input className={INPUT} value={detailsForm.contactWhatsapp} onChange={e => setDetailsForm(s => s && ({ ...s, contactWhatsapp: e.target.value }))} placeholder="+..." /></L>
              </div>
            </div>
            <L label="Important Notes"><textarea className={`${INPUT} min-h-[90px] resize-none`} value={detailsForm.importantNotes} onChange={e => setDetailsForm(s => s && ({ ...s, importantNotes: e.target.value }))} placeholder="Anything the ops team must know…" /></L>
          </div>
          <button onClick={saveDetails} disabled={savingDetails}
            className="w-full mt-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {savingDetails ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Details
          </button>
        </Modal>
      )}

      {/* Hotel editor */}
      {hotelEdit && active && (
        <Modal onClose={() => setHotelEdit(null)}>
          <h3 className="text-white font-black text-base mb-4 flex items-center gap-2"><Hotel className="w-5 h-5 text-emerald-400" /> {hotelEdit.mode === 'add' ? 'Add Hotel' : 'Edit Hotel'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <L label="Hotel *"><input className={INPUT} value={hotelEdit.hotel.hotel} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, hotel: e.target.value } }))} placeholder="Shangri-La" /></L>
            <L label="City *"><input className={INPUT} value={hotelEdit.hotel.city} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, city: e.target.value } }))} placeholder="Colombo" /></L>
            <L label="Check-in *"><input type="date" className={INPUT} value={hotelEdit.hotel.checkIn} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, checkIn: e.target.value } }))} style={{ colorScheme: 'dark' }} /></L>
            <L label="Check-out *"><input type="date" className={INPUT} value={hotelEdit.hotel.checkOut} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, checkOut: e.target.value } }))} style={{ colorScheme: 'dark' }} /></L>
            <L label="Room Type"><input className={INPUT} value={hotelEdit.hotel.roomType} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, roomType: e.target.value } }))} placeholder="Deluxe Double" /></L>
            <L label="Meal Plan"><input className={INPUT} value={hotelEdit.hotel.mealType} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, mealType: e.target.value } }))} placeholder="Half Board" /></L>
            <L label="Contact"><input className={INPUT} value={hotelEdit.hotel.contact} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, contact: e.target.value } }))} placeholder="+94 ..." /></L>
            <L label="Address"><input className={INPUT} value={hotelEdit.hotel.address} onChange={e => setHotelEdit(s => s && ({ ...s, hotel: { ...s.hotel, address: e.target.value } }))} placeholder="Street, area" /></L>
          </div>
          <button onClick={saveHotel} disabled={savingHotel}
            className="w-full mt-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {savingHotel ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {hotelEdit.mode === 'add' ? 'Add Hotel' : 'Save Changes'}
          </button>
        </Modal>
      )}

      {/* AI flight import */}
      {aiOpen && active && (
        <Modal onClose={() => setAiOpen(false)}>
          <h3 className="text-white font-black text-base mb-1 flex items-center gap-2"><Wand2 className="w-5 h-5 text-cyan-300" /> AI Flight Auto-fill</h3>
          <p className="text-slate-400 text-sm mb-4">Upload a ticket/itinerary image or PDF, or paste flight text — AI reads it, corrects it, and fills the flights for you.</p>

          <div className="inline-flex rounded-xl bg-white/5 p-1 mb-4">
            {([['upload', 'Upload', Upload], ['paste', 'Paste text', FileText]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setAiTab(k); setAiFlights(null) }}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all ${aiTab === k ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {aiBusy ? (
            <div className="py-10 flex flex-col items-center gap-3 text-cyan-200">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-300 animate-spin" />
                <Wand2 className="absolute inset-0 m-auto w-6 h-6" />
              </div>
              <p className="text-sm font-semibold">Reading &amp; correcting flight details…</p>
            </div>
          ) : aiFlights ? (
            <div>
              {aiFlights.length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center">No flights detected. Try a clearer image or paste the text.</p>
              ) : (
                <>
                  <p className="text-emerald-300 text-xs font-bold mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {aiFlights.length} flight{aiFlights.length === 1 ? '' : 's'} found in {aiSource}</p>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto -mx-1 px-1">
                    {aiFlights.map((f, i) => (
                      <div key={i} className="rounded-xl bg-white/[0.04] border border-white/8 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-cyan-200 font-bold">{f.flightNo || 'Flight'}</span>
                          <span className="text-slate-500 text-xs">{f.date}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-white">
                          <span className="font-bold">{f.fromApt || '—'}</span>
                          <span className="text-slate-500 text-xs">{f.depTime}</span>
                          <Plane className="w-3.5 h-3.5 text-cyan-400/60" />
                          <span className="text-slate-500 text-xs">{f.arrTime}</span>
                          <span className="font-bold">{f.toApt || '—'}</span>
                          {f.airline && <span className="ml-auto text-slate-500 text-xs">{f.airline}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={addExtractedFlights} disabled={aiAdding}
                    className="w-full mt-4 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {aiAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Add {aiFlights.length} Flight{aiFlights.length === 1 ? '' : 's'} to Booking
                  </button>
                  <button onClick={() => setAiFlights(null)} className="w-full mt-2 text-slate-500 text-xs font-semibold hover:text-slate-300">← Try a different source</button>
                </>
              )}
            </div>
          ) : aiTab === 'upload' ? (
            <label className="block cursor-pointer">
              <div className="rounded-2xl border-2 border-dashed border-cyan-400/30 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all py-10 text-center">
                <Upload className="w-8 h-8 mx-auto text-cyan-300 mb-2" />
                <p className="text-white font-semibold text-sm">Tap to upload image or PDF</p>
                <p className="text-slate-500 text-xs mt-1">JPG · PNG · WebP · PDF</p>
              </div>
              <input type="file" accept="image/*,.pdf" className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) extractFromFile(file); e.currentTarget.value = '' }} />
            </label>
          ) : (
            <div>
              <textarea className={`${INPUT} min-h-[140px] resize-none font-mono text-xs`} value={aiText} onChange={e => setAiText(e.target.value)}
                placeholder={'Paste flight details, e.g.\nEK 655  25 Dec  CMB 04:15 → DXB 07:20\nEmirates, Terminal 3'} />
              <button onClick={extractFromText} disabled={!aiText.trim()}
                className="w-full mt-3 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                <Wand2 className="w-4 h-4" /> Extract &amp; Correct
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* Email PDF modal */}
      {emailOpen && active && (
        <Modal onClose={() => setEmailOpen(false)}>
          <h3 className="text-white font-black text-base mb-1 flex items-center gap-2"><Mail className="w-5 h-5 text-emerald-400" /> Email Booking Update</h3>
          <p className="text-slate-400 text-sm mb-4">Send the <span className="text-white font-semibold">{active.bookingRef}</span> update PDF as an attachment.</p>
          <div className="space-y-4">
            <L label="Recipient Email *"><input type="email" className={INPUT} value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="agent@example.com" /></L>
            <L label="Message (optional)"><textarea className={`${INPUT} min-h-[90px] resize-none`} value={emailMsg} onChange={e => setEmailMsg(e.target.value)} placeholder="Add a short note for the recipient…" /></L>
          </div>
          <button onClick={sendPdfEmail} disabled={emailSending || !emailTo.trim()}
            className="w-full mt-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Email
          </button>
        </Modal>
      )}

      {/* AppleSystem import scanner overlay */}
      {importing && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-[#05121a]/85 backdrop-blur-sm" />
          <div className="relative text-center px-6" style={{ animation: 'fhCardIn .3s ease-out both' }}>
            {/* radar */}
            <div className="relative w-40 h-40 mx-auto mb-6">
              {[0, 1, 2].map(i => (
                <span key={i} className="absolute inset-0 rounded-full border border-cyan-400/40" style={{ animation: `fhPing 2s ease-out ${i * 0.6}s infinite` }} />
              ))}
              <div className="absolute inset-0 rounded-full border-2 border-cyan-400/25" />
              <div className="absolute inset-0 origin-center" style={{ animation: 'fhSweep 1.6s linear infinite' }}>
                <div className="absolute left-1/2 top-1/2 h-1/2 w-1/2 origin-top-left"
                  style={{ background: 'conic-gradient(from 0deg, rgba(34,211,238,.45), transparent 60%)', borderTopLeftRadius: '100%' }} />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 flex items-center justify-center" style={{ animation: 'fhFloat 2.4s ease-in-out infinite' }}>
                  <DownloadCloud className="w-8 h-8 text-cyan-200" />
                </div>
              </div>
              <Plane className="absolute -right-2 top-3 w-6 h-6 text-emerald-300" style={{ animation: 'fhFloat 2s ease-in-out infinite' }} />
            </div>
            <p className="text-white font-black text-xl flex items-center justify-center gap-2">
              <Radar className="w-5 h-5 text-cyan-300 animate-pulse" /> Not in the system yet…
            </p>
            <p className="text-cyan-200/80 text-sm mt-1">Fetching &amp; importing this booking from <span className="font-semibold text-cyan-100">AppleSystem</span></p>
            {/* progress shimmer */}
            <div className="mt-5 w-64 h-1.5 mx-auto rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent" style={{ animation: 'fhBar 1.1s ease-in-out infinite' }} />
            </div>
          </div>
        </div>
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
            ) : celebrate === 'import' ? (
              <>
                <div className="relative w-24 h-24 mx-auto mb-3 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-cyan-500/20" />
                  <Sparkles className="w-12 h-12 text-cyan-200" style={{ animation: 'fhBurst .6s ease-out both' }} />
                </div>
                <p className="text-white font-black text-xl">Imported from AppleSystem ✨</p>
                <p className="text-cyan-200 text-sm mt-1">New booking pulled in and ready to edit.</p>
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

function ContactBlock({ title, icon, email, phone, whatsapp }: {
  title: string; icon: React.ReactNode; email: string | null; phone: string | null; whatsapp: string | null
}) {
  const empty = !email && !phone && !whatsapp
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/6 p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300/70 flex items-center gap-1.5 mb-2">{icon}{title}</p>
      {empty ? (
        <p className="text-slate-600 text-xs">No contact info yet.</p>
      ) : (
        <div className="space-y-1.5">
          {email && <p className="text-xs text-slate-300 flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" /> {email}</p>}
          {phone && <p className="text-xs text-slate-300 flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" /> {phone}</p>}
          {whatsapp && <p className="text-xs text-slate-300 flex items-center gap-2"><MessageCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" /> {whatsapp}</p>}
        </div>
      )}
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
