'use client'

/**
 * Print flight tickets — A4, double-sided, three tickets a sheet, cut apart.
 *
 * Where the details come from, best first:
 *   1. the issued Aahaas e-ticket — fetched from Aahaas on open, or uploaded —
 *      each passenger beside their own e-ticket number, the airline PNR, the
 *      real times and baggage; gaps filled from, and checked against, …
 *   2. the store's flight booking (the GDS record), when no e-ticket is issued;
 *   3. whatever the desk types here — every field can be corrected.
 *
 * "Preview" draws the real sheet front beside the form as it is edited.
 *
 * Nothing is saved: the sheets are built from what is on screen when Print is
 * pressed. Printer settings (flip edge, back-side nudge) are remembered in this
 * browser, because they belong to the printer, not the booking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, EyeOff, FileUp, Loader2, Plus, Printer, RefreshCw, Trash2, Ticket } from 'lucide-react'
import Modal from '@/components/ui/modal'
import { checkTicketData } from '@/lib/flight-ticket/eticket-parse'
import { readApiResponse, cn } from '@/lib/utils'
import {
  DEFAULT_PRINT_OPTIONS, type FlightTicketData, type TicketPassenger, type TicketPrintOptions, type TicketSegment,
} from '@/lib/flight-ticket/types'

const OPTIONS_KEY = 'ops.flightTicket.printOptions'
const PREVIEW_KEY = 'ops.flightTicket.preview'
const PER_SHEET = 3

const emptySegment = (): TicketSegment => ({
  airline: null, flightNo: null, cabin: 'Economy', status: null,
  from: { code: '', airport: null, city: null, time: null, date: null },
  to: { code: '', airport: null, city: null, time: null, date: null },
  duration: null, checkedBaggage: null, cabinBaggage: null, meal: null,
})

const emptyData = (orderId: string | null): FlightTicketData => ({
  orderId, bookingRef: null, airlinePnr: null, status: null, issuedOn: null,
  passengers: [{ name: '', type: 'Adult', eticket: null }], segments: [emptySegment()],
  contact: { phone: null, email: null }, refundable: null, dateChange: null, source: 'manual', warnings: [],
})

const SOURCE_LABEL: Record<FlightTicketData['source'], string> = {
  'aahaas-eticket': 'From the issued e-ticket (fetched from Aahaas)',
  'eticket-pdf': 'From the uploaded e-ticket PDF',
  store: 'From the Aahaas store booking',
  manual: 'Typed in',
}

function loadOptions(): TicketPrintOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    return raw ? { ...DEFAULT_PRINT_OPTIONS, ...JSON.parse(raw) } : DEFAULT_PRINT_OPTIONS
  } catch {
    return DEFAULT_PRINT_OPTIONS
  }
}

function Field({ label, value, onChange, placeholder, className, type = 'text', mono }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void
  placeholder?: string; className?: string; type?: string; mono?: boolean
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">{label}</span>
      <input type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={cn('w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none', mono && 'font-mono')} />
    </label>
  )
}

export default function FlightTicketDialog({ bookingRef, open, onClose }: { bookingRef: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<FlightTicketData | null>(null)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState<'upload' | 'pdf' | 'html' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opts, setOpts] = useState<TicketPrintOptions>(DEFAULT_PRINT_OPTIONS)
  const [preview, setPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const previewSeq = useRef(0)

  const api = `/api/bookings/${encodeURIComponent(bookingRef)}/flight-tickets`

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotes([])
    try {
      const json = await readApiResponse<{ orderId: number; data: FlightTicketData | null; notes?: string[] }>(await fetch(api, { cache: 'no-store' }))
      if (!json.success) throw new Error(json.error || 'Could not load the flight')
      const d = json.data!
      setData(d.data ?? emptyData(String(d.orderId)))
      const n = d.notes ?? []
      setNotes(d.data ? n : [...n, 'No issued e-ticket or store flight booking was found. Upload the e-ticket PDF or type the details.'])
    } catch (e) {
      setError((e as Error).message)
      setData(emptyData(null))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!open) return
    setOpts(loadOptions())
    try { setPreview(localStorage.getItem(PREVIEW_KEY) === '1') } catch { /* private window */ }
    load()
  }, [open, load])

  const saveOpts = (next: TicketPrintOptions) => {
    setOpts(next)
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(next)) } catch { /* private window */ }
  }

  const upload = async (file: File) => {
    setBusy('upload')
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const json = await readApiResponse<{ data: FlightTicketData }>(await fetch(`${api}/eticket`, { method: 'POST', body: form }))
      if (!json.success || !json.data) throw new Error(json.error || 'The e-ticket could not be read')
      setData(json.data.data)
      setNotes([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const render = async (format: 'pdf' | 'html') => {
    if (!data) return
    if (issues.length > 0 && !window.confirm(`These tickets are not complete:\n\n• ${issues.join('\n• ')}\n\nPrint anyway?`)) return
    setBusy(format)
    setError(null)
    // Open the tab now, inside the click — a window opened after an await is a popup to the browser.
    const tab = format === 'html' ? window.open('', '_blank') : null
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, options: opts, format }),
      })
      if (!res.ok) {
        const json = await readApiResponse(res)
        throw new Error(json.error || `Could not build the tickets (${res.status})`)
      }
      const url = URL.createObjectURL(await res.blob())
      if (format === 'html') {
        if (tab) tab.location.href = url
        else window.open(url, '_blank')
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = `Aahaas-Tickets-${data.bookingRef ?? data.orderId ?? bookingRef}.pdf`
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      tab?.close()
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const isEticket = data?.source === 'eticket-pdf' || data?.source === 'aahaas-eticket'
  const patch = (p: Partial<FlightTicketData>) => setData((d) => (d ? { ...d, ...p } : d))
  const setPax = (i: number, p: Partial<TicketPassenger>) => setData((d) => d && ({ ...d, passengers: d.passengers.map((x, j) => (j === i ? { ...x, ...p } : x)) }))
  const setSeg = (i: number, f: (s: TicketSegment) => TicketSegment) => setData((d) => d && ({ ...d, segments: d.segments.map((x, j) => (j === i ? f(x) : x)) }))

  const count = useMemo(() => {
    if (!data) return { tickets: 0, sheets: 0 }
    const pax = data.passengers.filter((p) => p.name.trim()).length
    const segs = data.segments.filter((s) => s.from.code && s.to.code).length
    const tickets = pax * (opts.perSegment ? segs : Math.min(1, segs))
    return { tickets, sheets: Math.ceil(tickets / PER_SHEET) }
  }, [data, opts.perSegment])

  // Re-checked on every edit, so what is printed is what was checked.
  const issues = useMemo(() => (data ? checkTicketData({ ...data, passengers: data.passengers.filter((p) => p.name.trim()) }) : []), [data])

  const togglePreview = () => {
    const next = !preview
    setPreview(next)
    try { localStorage.setItem(PREVIEW_KEY, next ? '1' : '0') } catch { /* private window */ }
  }

  // The real sheet, redrawn a moment after the desk stops typing — the same
  // renderer as the print, so the preview is what will come out of the printer.
  useEffect(() => {
    if (!open || !preview || !data || count.tickets === 0) { setPreviewHtml(null); return }
    const seq = ++previewSeq.current
    const t = setTimeout(async () => {
      setPreviewBusy(true)
      try {
        const res = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, options: { ...opts, cropMarks: false }, format: 'html' }),
        })
        if (!res.ok || seq !== previewSeq.current) return
        // Front of the first sheet only, fitted to the pane.
        const html = (await res.text()).replace('</head>', '<style>body{margin:0;background:#e2e8f0;zoom:.56}.sheet~.sheet{display:none}.sheet{margin:3mm auto!important}</style></head>')
        setPreviewHtml(html)
      } catch { /* the form still works; the preview is a convenience */ } finally {
        if (seq === previewSeq.current) setPreviewBusy(false)
      }
    }, 700)
    return () => clearTimeout(t)
  }, [open, preview, data, opts, api, count.tickets])

  return (
    <Modal open={open} onClose={onClose} size="4xl" title="Print flight tickets"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <p className="text-xs text-slate-500">
            {count.tickets} ticket{count.tickets === 1 ? '' : 's'} · {count.sheets} A4 sheet{count.sheets === 1 ? '' : 's'} ({count.sheets * 2} pages, front + back)
          </p>
          <div className="flex gap-2">
            <button onClick={() => render('html')} disabled={!!busy || !count.tickets} className="btn btn-secondary btn-sm">
              {busy === 'html' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />} Open print view
            </button>
            <button onClick={() => render('pdf')} disabled={!!busy || !count.tickets} className="btn btn-primary btn-sm">
              {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download PDF
            </button>
          </div>
        </div>
      }
    >
      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-6"><Loader2 className="w-4 h-4 animate-spin" /> Fetching the issued e-ticket and store booking from Aahaas…</div>
      ) : data && (
        <div className="space-y-5 text-sm">
          {/* Source */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-rose-500" />
              <span className="font-semibold text-slate-800">{SOURCE_LABEL[data.source]}</span>
              {!isEticket && <span className="text-xs text-slate-500">— the e-ticket PDF is the most exact source</span>}
            </div>
            <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={!!busy || loading} className="btn btn-secondary btn-sm" title="Read the issued e-ticket and store booking again — your edits here are replaced">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Fetch again
            </button>
            <button onClick={togglePreview} className={cn('btn btn-sm', preview ? 'btn-primary' : 'btn-secondary')}>
              {preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {preview ? 'Hide preview' : 'Preview'}
            </button>
            <label className={cn('btn btn-sm cursor-pointer', isEticket ? 'btn-secondary' : 'btn-primary')}>
              {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
              {isEticket ? 'Use another e-ticket PDF' : 'Upload e-ticket PDF'}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
            </label>
            </div>
          </div>

          {issues.length === 0 && !error && (
            <p className="flex gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> Every detail a ticket needs is present — booking ref, airline PNR, each passenger&apos;s e-ticket number, flight, times and dates.
            </p>
          )}
          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-200/60 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-slate-600 bg-white/70 border-b border-slate-200">
                <span>Live preview — front of sheet 1, exactly as it prints</span>
                {previewBusy && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> updating…</span>}
              </div>
              {previewHtml
                ? <iframe title="Ticket preview" srcDoc={previewHtml} sandbox="" className="w-full h-[440px] bg-slate-200" />
                : <p className="px-3 py-10 text-center text-xs text-slate-500">{count.tickets ? 'Drawing…' : 'Add a passenger and a flight (from / to codes) to see the ticket.'}</p>}
            </div>
          )}
          {(notes.length > 0 || error || data.warnings.length > 0 || issues.length > 0) && (
            <div className="space-y-1.5">
              {error && <p className="flex gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>}
              {notes.map((n) => <p key={n} className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-xs"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}</p>)}
              {data.warnings.map((w) => (
                <p key={w} className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-xs"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</p>
              ))}
              {issues.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-xs">
                  <p className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle className="w-3.5 h-3.5" /> Check before printing</p>
                  <ul className="list-disc pl-5 space-y-0.5">{issues.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Booking */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="Booking ref" value={data.bookingRef} onChange={(v) => patch({ bookingRef: v.toUpperCase() })} mono />
            <Field label="Airline PNR" value={data.airlinePnr} onChange={(v) => patch({ airlinePnr: v.toUpperCase() })} mono />
            <Field label="Status" value={data.status} onChange={(v) => patch({ status: v.toUpperCase() })} placeholder="TICKETED" />
            <Field label="Refundable" value={data.refundable} onChange={(v) => patch({ refundable: v })} placeholder="Yes / No" />
            <Field label="Date change" value={data.dateChange} onChange={(v) => patch({ dateChange: v })} placeholder="Permitted" />
          </div>

          {/* Passengers */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Passengers — one ticket each</h4>
              <button onClick={() => setData({ ...data, passengers: [...data.passengers, { name: '', type: 'Adult', eticket: null }] })} className="text-xs text-brand-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add passenger</button>
            </div>
            <div className="space-y-2">
              {data.passengers.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_170px_28px] gap-2 items-end">
                  <Field label={`Passenger ${i + 1}`} value={p.name} onChange={(v) => setPax(i, { name: v })} placeholder="Name as on passport" />
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Type</span>
                    <select value={p.type ?? 'Adult'} onChange={(e) => setPax(i, { type: e.target.value })} className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm">
                      <option>Adult</option><option>Child</option><option>Infant</option>
                    </select>
                  </label>
                  <Field label="E-ticket no." value={p.eticket} onChange={(v) => setPax(i, { eticket: v.replace(/[^\d]/g, '') || null })} placeholder="13 digits" mono />
                  <button onClick={() => setData({ ...data, passengers: data.passengers.filter((_, j) => j !== i) })} className="p-1.5 text-slate-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Flights */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Flights</h4>
              <button onClick={() => setData({ ...data, segments: [...data.segments, emptySegment()] })} className="text-xs text-brand-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add flight</button>
            </div>
            <div className="space-y-3">
              {data.segments.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-[1.4fr_0.8fr_0.9fr_0.6fr_28px] gap-2 items-end">
                    <Field label="Airline" value={s.airline} onChange={(v) => setSeg(i, (x) => ({ ...x, airline: v }))} />
                    <Field label="Flight no." value={s.flightNo} onChange={(v) => setSeg(i, (x) => ({ ...x, flightNo: v.toUpperCase() }))} mono />
                    <Field label="Class" value={s.cabin} onChange={(v) => setSeg(i, (x) => ({ ...x, cabin: v }))} />
                    <Field label="Duration" value={s.duration} onChange={(v) => setSeg(i, (x) => ({ ...x, duration: v }))} placeholder="1h 30m" />
                    <button onClick={() => setData({ ...data, segments: data.segments.filter((_, j) => j !== i) })} className="p-1.5 text-slate-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  {(['from', 'to'] as const).map((side) => (
                    <div key={side} className="grid grid-cols-2 md:grid-cols-[70px_1fr_1.6fr_110px_150px] gap-2 items-end">
                      <Field label={side === 'from' ? 'From' : 'To'} value={s[side].code} onChange={(v) => setSeg(i, (x) => ({ ...x, [side]: { ...x[side], code: v.toUpperCase().slice(0, 3), city: null } }))} placeholder="CMB" mono />
                      <Field label="City (printed big)" value={s[side].city} onChange={(v) => setSeg(i, (x) => ({ ...x, [side]: { ...x[side], city: v } }))} placeholder="From the code" />
                      <Field label="Airport" value={s[side].airport} onChange={(v) => setSeg(i, (x) => ({ ...x, [side]: { ...x[side], airport: v } }))} />
                      <Field label={side === 'from' ? 'Departs' : 'Arrives'} type="time" value={s[side].time} onChange={(v) => setSeg(i, (x) => ({ ...x, [side]: { ...x[side], time: v || null } }))} />
                      <Field label="Date" type="date" value={s[side].date} onChange={(v) => setSeg(i, (x) => ({ ...x, [side]: { ...x[side], date: v || null } }))} />
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Checked baggage" value={s.checkedBaggage} onChange={(v) => setSeg(i, (x) => ({ ...x, checkedBaggage: v }))} placeholder="30 kg" />
                    <Field label="Cabin baggage" value={s.cabinBaggage} onChange={(v) => setSeg(i, (x) => ({ ...x, cabinBaggage: v }))} placeholder="7 kg / 1 piece" />
                    <Field label="Meal" value={s.meal} onChange={(v) => setSeg(i, (x) => ({ ...x, meal: v }))} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Printer */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Printer (remembered on this computer)</h4>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600">Double-sided flip</span>
                {(['long', 'short'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1 text-sm">
                    <input type="radio" checked={opts.flip === f} onChange={() => saveOpts({ ...opts, flip: f })} /> {f === 'long' ? 'Long edge (usual)' : 'Short edge'}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={opts.cropMarks} onChange={(e) => saveOpts({ ...opts, cropMarks: e.target.checked })} /> Crop marks</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={opts.perSegment} onChange={(e) => saveOpts({ ...opts, perSegment: e.target.checked })} /> One ticket per flight</label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-32" label="Back nudge → (mm)" type="number" value={String(opts.backOffsetX)} onChange={(v) => saveOpts({ ...opts, backOffsetX: Math.max(-8, Math.min(8, Number(v) || 0)) })} />
              <Field className="w-32" label="Back nudge ↓ (mm)" type="number" value={String(opts.backOffsetY)} onChange={(v) => saveOpts({ ...opts, backOffsetY: Math.max(-8, Math.min(8, Number(v) || 0)) })} />
              <p className="text-xs text-slate-500 flex-1 min-w-[220px]">
                Leave at 0 first. If the back prints a little off, hold the sheet to the light and enter how far the back must move (− left/up, + right/down).
              </p>
            </div>
            <ol className="text-xs text-slate-600 list-decimal pl-4 space-y-0.5">
              <li>Paper <b>A4</b>, scale <b>Actual size / 100%</b> — never “Fit to page”.</li>
              <li>Print on both sides, <b>flip on {opts.flip} edge</b> (the setting above must match the printer).</li>
              <li>Cut on the crop marks: three tickets per sheet, 190 × 88 mm each.</li>
            </ol>
          </div>
        </div>
      )}
    </Modal>
  )
}
