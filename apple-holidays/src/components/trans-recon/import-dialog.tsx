'use client'

/**
 * Import a desk's own transport workbook into a Trans-Reconsultation sheet.
 * See src/lib/trans-recon/excel-import.ts — the server re-reads the file on
 * every step; this dialog only carries the desk's choices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, FileSpreadsheet, Link2, Loader2, Plus, Sparkles, Upload, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, readApiResponse } from '@/lib/utils'
import { RECON_COUNTRY_META, fmtMoney, type Half, type ReconCountry } from '@/lib/trans-recon/shared'

type Field = 'serviceDate' | 'tourNo' | 'guestName' | 'pax' | 'pickUp' | 'dropOff' | 'time' | 'details' | 'rateText' | 'remarks'
const FIELD_LABEL: Record<Field, string> = {
  serviceDate: 'Date', tourNo: 'Tour no', guestName: 'Guest', pax: 'Pax', pickUp: 'Pick up', dropOff: 'Drop off',
  time: 'Time', details: 'Details', rateText: 'Rate', remarks: 'Remarks',
}

interface Match { key: string | null; score: number; why: string[]; by: 'AUTO' | 'AI' | 'YOU' | null; alternatives: { key: string; score: number }[] }
interface Row {
  row: number; serviceDate: string | null; tourNo: string | null; guestName: string | null; pax: string | null
  pickUp: string | null; dropOff: string | null; time: string | null; details: string | null
  rateText: string | null; rate: number | null; remarks: string | null; notes: string[]
  inPeriod: boolean; booking: { bookingRef: string; cancelled: boolean } | null; match: Match | null; warnings: string[]
  /** The P&L line DETAILS names, in the booking's P&L currency. */
  pnl: { id: string; activity: string; category: string; value: number; currency: string; score: number; via: 'exact' | 'words' } | null
  pnlBooking: string | null
}
interface Candidate { key: string; kind: 'MC' | 'MANUAL'; date: string; bookingRef: string | null; tourNo: string | null; guestName: string | null; pickUp: string | null; dropOff: string | null; time: string | null; details: string | null; rate: number | null; approvalStatus: string }
interface Preview {
  file: string; sheets: { name: string; rows: number; headerRow: number | null }[]; sheetName: string; headerRow: number | null
  columns: Partial<Record<Field, string>>; headers: Record<string, string>; usedAi: boolean
  detected: { country: ReconCountry | null; countryWhy: string; year: number | null; month: number | null; half: Half | null; periodWhy: string; periodVotes: { key: string; label: string; count: number }[] }
  ready: boolean
  chosen: { country: ReconCountry | null; year: number | null; month: number | null; half: Half | null; start?: string; end?: string; title?: string }
  existing?: { id: string; status: string; lines: number; lastImportFile: string | null; lastImportAt: string | null } | null
  rows: Row[]
  candidates?: Candidate[]
  mcOnly?: string[]
  summary?: { rows: number; importable: number; paired: number; newLines: number; outside: number; mcOnly: number; totalRate: number; unrated: number; rateChanges: number; approvedChanges: number; pnlNamed: number }
}

export interface ImportTarget { country: ReconCountry; year: number; month: number; half: Half }

const pad = (n: number) => String(n).padStart(2, '0')
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

export function ImportDialog({ open, onClose, allowed, fixed, onDone }: {
  open: boolean; onClose: () => void; allowed: ReconCountry[]; fixed?: ImportTarget | null; onDone: (sheetId: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [pv, setPv] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'ai' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Partial<ImportTarget>>(fixed ?? {})
  const [links, setLinks] = useState<Record<string, string>>({})
  const [sheet, setSheet] = useState<string | null>(null)
  const [columns, setColumns] = useState<Partial<Record<Field, string>> | null>(null)
  const [applyText, setApplyText] = useState(true)
  const [unmatchedMc, setUnmatchedMc] = useState<'keep' | 'remove'>('keep')
  const [showMcOnly, setShowMcOnly] = useState(false)
  const [showCols, setShowCols] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** The choices the current preview was made with — a re-read happens only when they move. */
  const lastSig = useRef('')
  const sigOf = (t: Partial<ImportTarget>, sh: string | null, cols: unknown, ln: unknown) =>
    JSON.stringify([t.country ?? null, t.year ?? null, t.month ?? null, t.half ?? null, sh, cols, ln])

  useEffect(() => {
    if (!open) return
    setFile(null); setPv(null); setError(null); setLinks({}); setSheet(null); setColumns(null)
    setTarget(fixed ?? {}); setApplyText(true); setUnmatchedMc('keep'); setShowMcOnly(false); setShowCols(false)
    lastSig.current = ''
    // Reset only when the dialog opens: callers pass `fixed` as a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = useCallback(async (mode: 'preview' | 'commit', extra: Record<string, unknown> = {}, f: File | null = file) => {
    if (!f) return null
    const fd = new FormData()
    fd.append('file', f)
    fd.append('mode', mode)
    fd.append('options', JSON.stringify({
      ...target, ...(sheet ? { sheet } : {}), ...(columns ? { columns, headerRow: pv?.headerRow ?? 1 } : {}),
      links, applyText, unmatchedMc, ...extra,
    }))
    const res = await fetch('/api/trans-recon/import', { method: 'POST', body: fd })
    const json = await readApiResponse<Preview & { sheetId: string; updated: number; added: number; removed: number; skipped: number; pnlPaired: number; pnlFromDetails: number }>(res)
    if (!json.success) throw new Error(json.error || 'Import failed')
    return json.data!
  }, [file, target, sheet, columns, links, applyText, unmatchedMc, pv?.headerRow])

  const preview = useCallback(async (f: File | null = file, extra: Record<string, unknown> = {}, kind: 'preview' | 'ai' = 'preview') => {
    setBusy(kind); setError(null)
    try {
      const out = await send('preview', extra, f)
      if (out) {
        setPv(out)
        const c = out.chosen
        const used = { country: c.country ?? undefined, year: c.year ?? undefined, month: c.month ?? undefined, half: c.half ?? undefined }
        // Filling in what was detected is not a change of mind — the signature
        // records it, so the effect below does not read the file again.
        lastSig.current = sigOf(used, sheet, columns, links)
        if (!fixed) setTarget(used)
        if (kind === 'ai') {
          const n = out.rows.filter(r => r.match?.by === 'AI').length
          toast[n ? 'success' : 'message'](n ? `AI paired ${n} more row${n === 1 ? '' : 's'}` : 'AI found no confident pairs for the rest')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the workbook')
    } finally { setBusy(null) }
  }, [send, file, fixed, sheet, columns, links])

  // Re-read when a choice that changes the pairing moves.
  useEffect(() => {
    if (!file || !pv || busy) return
    if (sigOf(target, sheet, columns, links) === lastSig.current) return
    preview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.country, target.year, target.month, target.half, sheet, columns, links, busy])

  const pick = (f: File | undefined | null) => {
    if (!f) return
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(f.name)) { toast.error('Choose an .xlsx, .xls or .csv file'); return }
    setFile(f); setPv(null); setLinks({}); setSheet(null); setColumns(null)
    preview(f)
  }

  const commit = async () => {
    setBusy('commit'); setError(null)
    try {
      const out = await send('commit')
      if (!out) return
      toast.success(`Imported — ${out.updated} line${out.updated === 1 ? '' : 's'} updated, ${out.added} added${out.removed ? `, ${out.removed} struck off` : ''}${out.pnlFromDetails ? `, ${out.pnlFromDetails} P&L line${out.pnlFromDetails === 1 ? '' : 's'} taken from DETAILS` : ''}${out.pnlPaired ? `, ${out.pnlPaired} more paired with the P&L` : ''}`)
      onDone(out.sheetId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally { setBusy(null) }
  }

  const candBy = useMemo(() => new Map((pv?.candidates ?? []).map(c => [c.key, c])), [pv])
  const candLabel = (c: Candidate) => `${short(c.date)} · ${c.bookingRef ?? c.tourNo ?? '—'} · ${(c.pickUp ?? '—').slice(0, 28)} → ${(c.dropOff ?? '—').slice(0, 28)}${c.time ? ` · ${c.time}` : ''}${c.kind === 'MANUAL' ? ' · manual' : ''}`
  const lastCol = useMemo(() => {
    const letters = Object.values(pv?.columns ?? {}).concat(Object.keys(pv?.headers ?? {}))
    const max = Math.max(9, ...letters.map(l => l.charCodeAt(0) - 64))
    return Array.from({ length: Math.min(26, max + 3) }, (_, i) => String.fromCharCode(65 + i))
  }, [pv])

  if (!open) return null
  const s = pv?.summary
  const ready = pv?.ready && s
  const unpaired = pv?.rows.filter(r => r.inPeriod && !r.match?.key && links[String(r.row)] !== 'NEW' && links[String(r.row)] !== 'SKIP').length ?? 0
  const monthValue = target.year && target.month ? `${target.year}-${pad(target.month)}` : ''
  const sheetCur = target.country ? RECON_COUNTRY_META[target.country].currency : ''

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><FileSpreadsheet className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="font-bold text-slate-800">Import the desk&apos;s Excel</div>
            <div className="text-xs text-slate-500">Read the workbook, pair every row with its MC movement, then create or fill that period&apos;s sheet.</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 p-5">
          {/* Drop zone */}
          {!pv && (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }}
              onClick={() => inputRef.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition',
                drag ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40')}>
              {busy ? <Loader2 className="h-8 w-8 animate-spin text-indigo-500" /> : <Upload className="h-8 w-8 text-slate-400" />}
              <div className="text-sm font-semibold text-slate-700">{busy ? `Reading ${file?.name ?? 'the workbook'}…` : 'Drop the Excel here, or click to choose'}</div>
              <div className="text-xs text-slate-400">e.g. “Malaysia 16th to 30th September 2026.xlsx” — .xlsx, .xls or .csv, up to 8 MB</div>
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={e => pick(e.target.files?.[0])} />
            </div>
          )}

          {error && <div className="flex gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {pv && (
            <>
              {/* What the file is */}
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Workbook</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-800" title={pv.file}>{pv.file}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    {pv.sheets.length > 1 ? (
                      <select value={sheet ?? pv.sheetName} onChange={e => { setSheet(e.target.value); setColumns(null) }} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]">
                        {pv.sheets.map(x => <option key={x.name} value={x.name}>{x.name} ({x.rows} rows)</option>)}
                      </select>
                    ) : <span>Sheet “{pv.sheetName}”</span>}
                    <span>· header on row {pv.headerRow ?? '?'}</span>
                    {pv.usedAi && <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 font-semibold text-violet-700"><Bot className="h-3 w-3" />columns read by AI</span>}
                    <button onClick={() => setShowCols(v => !v)} className="font-semibold text-indigo-600 hover:underline">columns</button>
                    <button onClick={() => { setPv(null); setFile(null) }} className="font-semibold text-indigo-600 hover:underline">other file</button>
                  </div>
                </div>
                <div className={cn('rounded-xl p-3 ring-1', target.country ? 'bg-slate-50 ring-slate-200' : 'bg-amber-50 ring-amber-200')}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Country</div>
                  <select disabled={!!fixed} value={target.country ?? ''} onChange={e => setTarget(t => ({ ...t, country: (e.target.value || undefined) as ReconCountry | undefined }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-semibold">
                    <option value="">Pick…</option>
                    {allowed.map(c => <option key={c} value={c}>{RECON_COUNTRY_META[c].flag} {RECON_COUNTRY_META[c].label}</option>)}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">Detected {pv.detected.country ? RECON_COUNTRY_META[pv.detected.country].label : 'nothing'} — {pv.detected.countryWhy}</div>
                </div>
                <div className={cn('rounded-xl p-3 ring-1', target.half ? 'bg-slate-50 ring-slate-200' : 'bg-amber-50 ring-amber-200')}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Half month</div>
                  <div className="mt-1 flex gap-2">
                    <input type="month" disabled={!!fixed} value={monthValue}
                      onChange={e => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) setTarget(t => ({ ...t, year: y, month: m })) }}
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-semibold" />
                    <select disabled={!!fixed} value={target.half ?? ''} onChange={e => setTarget(t => ({ ...t, half: (Number(e.target.value) || undefined) as Half | undefined }))}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-semibold">
                      <option value="">Pick…</option><option value={1}>1st – 15th</option><option value={2}>16th – end</option>
                    </select>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{pv.detected.periodWhy}</div>
                  {pv.detected.periodVotes.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1">{pv.detected.periodVotes.map(v => <span key={v.key} className="rounded bg-white px-1.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{v.label}: {v.count}</span>)}</div>
                  )}
                </div>
              </div>

              {showCols && (
                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <div className="mb-2 text-xs font-semibold text-slate-600">Which column is which — change one to re-read the sheet</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(Object.keys(FIELD_LABEL) as Field[]).map(f => (
                      <label key={f} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px]">
                        <span className="font-semibold text-slate-600">{FIELD_LABEL[f]}</span>
                        <select value={(columns ?? pv.columns)[f] ?? ''} onChange={e => setColumns({ ...(columns ?? pv.columns), [f]: e.target.value || undefined })}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]">
                          <option value="">—</option>
                          {lastCol.map(l => <option key={l} value={l}>{l}{pv.headers[l] ? ` · ${pv.headers[l]}` : ''}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {!ready && (
                <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Pick the country and the half month to pair the rows with the MC Report.
                </div>
              )}

              {ready && s && (
                <>
                  <div className={cn('flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm ring-1', pv.existing ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200')}>
                    <CheckCircle2 className="h-4 w-4" />
                    <b>{pv.chosen.title}</b>
                    {pv.existing
                      ? <span>— sheet exists ({pv.existing.status.toLowerCase()}, {pv.existing.lines} lines){pv.existing.lastImportFile ? `; last imported from “${pv.existing.lastImportFile}”` : ''}. The Excel will update it.</span>
                      : <span>— no sheet yet. It will be generated from the MC Report first, then the Excel applied.</span>}
                  </div>

                  <div className="grid grid-cols-3 gap-2 md:grid-cols-8">
                    {[
                      ['Rows read', s.rows], ['Paired with MC', s.paired], ['New lines', s.newLines], ['P&L from DETAILS', `${s.pnlNamed}/${s.importable}`],
                      ['Outside period', s.outside], ['MC not in Excel', s.mcOnly], ['Total rate', fmtMoney(s.totalRate)], ['Without a rate', s.unrated],
                    ].map(([l, v]) => (
                      <div key={String(l)} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{l}</div>
                        <div className="text-base font-bold tabular-nums text-slate-800">{v}</div>
                      </div>
                    ))}
                  </div>
                  {s.approvedChanges > 0 && (
                    <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {s.approvedChanges} line{s.approvedChanges === 1 ? '' : 's'} Accounts already decided will get a different rate and go back to them as pending.
                    </div>
                  )}

                  {/* Rows */}
                  <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                    <div className="max-h-[48vh] overflow-auto">
                      <table className="w-full min-w-[1100px] text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <tr>{['Row', 'Date', 'Tour no', 'Guest', 'Pick up → drop off', 'Time', 'Details', 'Rate', 'MC line'].map(h => <th key={h} className={cn('px-2 py-2 text-left', h === 'Rate' && 'text-right')}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {pv.rows.map(r => {
                            const link = links[String(r.row)]
                            const m = r.match
                            const c = m?.key ? candBy.get(m.key) : undefined
                            const state = !r.inPeriod ? 'OUT' : link === 'SKIP' ? 'SKIP' : c ? 'PAIRED' : 'NEW'
                            const options = [
                              ...(m?.key && !m.alternatives.some(a => a.key === m.key) ? [{ key: m.key, score: m.score }] : []),
                              ...(m?.alternatives ?? []),
                            ]
                            const sameDay = (pv.candidates ?? []).filter(x => x.date === r.serviceDate && !options.some(o => o.key === x.key))
                            return (
                              <tr key={r.row} className={cn('border-t border-slate-100 align-top', state === 'OUT' && 'opacity-45', state === 'SKIP' && 'opacity-45 line-through', state === 'NEW' && 'bg-amber-50/40')}>
                                <td className="px-2 py-1.5 font-mono text-slate-400">{r.row}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-700">{r.serviceDate ? short(r.serviceDate) : '—'}</td>
                                <td className="px-2 py-1.5"><span className="font-mono font-bold text-slate-800">{r.tourNo ?? '—'}</span>{r.booking && r.booking.bookingRef !== r.tourNo && <div className="text-[10px] text-indigo-600">= {r.booking.bookingRef}</div>}</td>
                                <td className="px-2 py-1.5 text-slate-600">{r.guestName}<div className="text-[10px] text-slate-400">{r.pax}</div></td>
                                <td className="max-w-[240px] px-2 py-1.5 text-slate-600">{r.pickUp ?? '—'} <span className="text-slate-300">→</span> {r.dropOff ?? '—'}</td>
                                <td className="px-2 py-1.5 tabular-nums text-slate-600">{r.time}</td>
                                <td className="max-w-[280px] px-2 py-1.5">
                                  <div className="line-clamp-2 text-slate-500" title={r.details ?? ''}>{r.details}</div>
                                  {r.pnl && (
                                    <div className="mt-1 rounded-md bg-emerald-50 px-1.5 py-1 ring-1 ring-emerald-200" title={`${r.pnlBooking} P&L · ${r.pnl.category} · ${r.pnl.via === 'exact' ? 'named exactly' : 'matched on words'} ${Math.round(r.pnl.score * 100)}%`}>
                                      <div className="flex items-start gap-1 text-[10px] font-semibold text-emerald-800">
                                        <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />
                                        <span className="line-clamp-2 flex-1">P&amp;L: {r.pnl.activity}</span>
                                        <span className="shrink-0 tabular-nums">{fmtMoney(r.pnl.value, r.pnl.currency)}</span>
                                      </div>
                                      {r.rate != null && (() => {
                                        const d = Math.round((r.rate - r.pnl.value) * 100) / 100
                                        return r.pnl.currency === sheetCur ? (
                                          <div className="pl-4 text-[10px] tabular-nums text-emerald-700">
                                            Excel {fmtMoney(r.rate)} − P&amp;L {fmtMoney(r.pnl.value)} =
                                            <b className={cn('ml-1', d > 0.005 ? 'text-rose-600' : d < -0.005 ? 'text-emerald-700' : '')}>{d > 0 ? '+' : ''}{fmtMoney(d)}</b>
                                          </div>
                                        ) : (
                                          <div className="pl-4 text-[10px] text-amber-700">P&amp;L is in {r.pnl.currency}; the sheet compares it in {sheetCur} at its FX rate</div>
                                        )
                                      })()}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums"><b className="text-slate-800">{r.rate != null ? fmtMoney(r.rate) : '—'}</b>{r.rateText && /[+\s]/.test(r.rateText.trim()) && <div className="text-[10px] text-slate-400">{r.rateText}</div>}</td>
                                <td className="w-[300px] px-2 py-1.5">
                                  {state === 'OUT' ? <span className="text-[11px] text-slate-400">skipped</span> : (
                                    <>
                                      <div className="flex items-center gap-1.5">
                                        {state === 'PAIRED' && (m?.by === 'AI'
                                          ? <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 text-[10px] font-bold text-violet-700"><Bot className="h-3 w-3" />AI {Math.round((m?.score ?? 0) * 100)}%</span>
                                          : m?.by === 'YOU' ? <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700"><Link2 className="h-3 w-3" />picked</span>
                                          : <span className={cn('inline-flex items-center gap-0.5 rounded px-1.5 text-[10px] font-bold', (m?.score ?? 0) >= 0.7 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}><Sparkles className="h-3 w-3" />{Math.round((m?.score ?? 0) * 100)}%</span>)}
                                        {state === 'NEW' && <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800"><Plus className="h-3 w-3" />new line</span>}
                                        <select value={link ?? (m?.key ?? 'NEW')} onChange={e => setLinks(l => ({ ...l, [String(r.row)]: e.target.value }))}
                                          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]">
                                          {options.map(o => { const x = candBy.get(o.key); return x ? <option key={o.key} value={o.key}>{candLabel(x)} ({Math.round(o.score * 100)}%)</option> : null })}
                                          {sameDay.length > 0 && <optgroup label="Other lines that day">{sameDay.map(x => <option key={x.key} value={x.key}>{candLabel(x)}</option>)}</optgroup>}
                                          <option value="NEW">➕ Add as a new line</option>
                                          <option value="SKIP">⊘ Skip this row</option>
                                        </select>
                                      </div>
                                      {c && m?.why.length ? <div className="mt-0.5 text-[10px] text-slate-400">matched on {m.why.join(', ')}{c.rate != null && r.rate != null && Math.abs(c.rate - r.rate) > 0.005 ? ` · sheet rate ${fmtMoney(c.rate)} → ${fmtMoney(r.rate)}` : ''}</div> : null}
                                    </>
                                  )}
                                  {[...r.notes, ...r.warnings].map((w, i) => <div key={i} className="mt-0.5 text-[10px] text-amber-700">⚠ {w}</div>)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* MC lines the workbook does not mention */}
                  {(pv.mcOnly?.length ?? 0) > 0 && (
                    <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200">
                      <button onClick={() => setShowMcOnly(v => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm">
                        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition', showMcOnly && 'rotate-180')} />
                        <b className="text-slate-700">{pv.mcOnly!.length} MC line{pv.mcOnly!.length === 1 ? '' : 's'} are not in this Excel</b>
                        <span className="text-xs text-slate-500">— movements on the MC Report the desk did not list</span>
                        <span className="ml-auto flex items-center gap-3 text-xs" onClick={e => e.stopPropagation()}>
                          <label className="flex items-center gap-1"><input type="radio" checked={unmatchedMc === 'keep'} onChange={() => setUnmatchedMc('keep')} /> keep them</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={unmatchedMc === 'remove'} onChange={() => setUnmatchedMc('remove')} /> strike them off (can be put back)</label>
                        </span>
                      </button>
                      {showMcOnly && (
                        <div className="max-h-48 overflow-auto border-t border-slate-200 px-4 py-2">
                          {pv.mcOnly!.map(k => { const c = candBy.get(k); return c ? <div key={k} className="py-0.5 text-[11px] text-slate-600">{candLabel(c)}</div> : null })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {pv && ready && s && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={applyText} onChange={e => setApplyText(e.target.checked)} />
              Use the Excel&apos;s wording too (date, tour, guest, pax, places, time, details) — not only the rates
            </label>
            <div className="ml-auto flex items-center gap-2">
              {unpaired > 0 && (
                <button onClick={() => preview(file, { aiPair: true }, 'ai')} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100 disabled:opacity-50">
                  {busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />} Ask AI to pair the {unpaired} unpaired
                </button>
              )}
              <button onClick={onClose} disabled={!!busy} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={commit} disabled={!!busy || !s.importable || pv.existing?.status === 'LOCKED'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'commit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {pv.existing ? 'Import into the sheet' : 'Create the sheet & import'} ({s.importable} rows)
              </button>
            </div>
          </div>
        )}
        {busy === 'preview' && pv && <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-reading…</div>}
      </div>
    </div>
  )
}
