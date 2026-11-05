'use client'

/**
 * Pick the P&L line that pays for one transport line — from OPS's own P&L,
 * from the Accounts system's Detailed P&L, or typed in when neither has it.
 * Options come ranked against the movement (src/lib/trans-recon/server.ts
 * pnlOptions); the choice is applied on the page and saved with the sheet.
 */
import { useEffect, useMemo, useState } from 'react'
import { Building2, Check, Database, Keyboard, Loader2, Search, Sparkles, X } from 'lucide-react'
import { cn, readApiResponse } from '@/lib/utils'
import { RECON_CURRENCIES, fmtMoney, type ReconLine } from '@/lib/trans-recon/shared'

interface Opt { id: string; activity: string; category: string; value: number; section?: string }
interface Options {
  bookingRef: string
  currency: string | null
  lines: Opt[]
  accounts: { available: boolean; message?: string; currency: string | null; label: string | null; lines: Opt[] }
  usedBy: Record<string, number>
  suggested: { id: string; score: number }[]
}

export type PnlChoice =
  | { kind: 'line'; id: string; activity: string; category: string; value: number; currency: string }
  | { kind: 'custom'; description: string; value: number; currency: string }
  | null

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

export function PnlPicker({ sheetId, line, bookingRef, sheetCurrency, siblings, onPick, onClose }: {
  sheetId: string
  line: ReconLine
  bookingRef: string
  sheetCurrency: string
  /** Other live lines of the same booking with no P&L yet — candidates for "use for these too". */
  siblings: ReconLine[]
  onPick: (choice: PnlChoice, alsoFor: string[]) => void
  onClose: () => void
}) {
  const [opts, setOpts] = useState<Options | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [also, setAlso] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState({ description: line.details?.slice(0, 200) ?? '', value: '', currency: sheetCurrency })

  useEffect(() => {
    let live = true
    const sp = new URLSearchParams({ bookingRef })
    if (!line.id.startsWith('tmp_')) sp.set('lineId', line.id)
    fetch(`/api/trans-recon/${sheetId}/pnl-options?${sp}`)
      .then(r => readApiResponse<Options>(r))
      .then(j => { if (!live) return; if (j.success) setOpts(j.data!); else setError(j.error || 'Could not load the P&L') })
      .catch(() => live && setError('Could not load the P&L'))
    return () => { live = false }
  }, [sheetId, bookingRef, line.id])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const needle = q.trim().toLowerCase()
  const filter = (list: Opt[]) => needle ? list.filter(o => o.activity.toLowerCase().includes(needle) || o.category.toLowerCase().includes(needle)) : list
  const all = useMemo(() => {
    const m = new Map<string, Opt & { currency: string; source: 'OPS' | 'ACCOUNTS' }>()
    if (!opts) return m
    for (const o of opts.lines) m.set(o.id, { ...o, currency: opts.currency || 'USD', source: 'OPS' })
    for (const o of opts.accounts.lines) m.set(o.id, { ...o, currency: opts.accounts.currency || 'USD', source: 'ACCOUNTS' })
    return m
  }, [opts])

  const choose = (o: Opt & { currency: string }) =>
    onPick({ kind: 'line', id: o.id, activity: o.activity, category: o.category, value: o.value, currency: o.currency }, Array.from(also))
  const customValue = Number(custom.value.replace(/,/g, ''))
  const customOk = custom.description.trim().length > 0 && custom.value.trim() !== '' && Number.isFinite(customValue) && customValue >= 0

  const Row = ({ o, score }: { o: Opt & { currency: string; source: 'OPS' | 'ACCOUNTS' }; score?: number }) => {
    const used = (opts?.usedBy[o.id] ?? 0) - (line.pnlLineItemId === o.id ? 1 : 0)
    return (
      <button onClick={() => choose(o)}
        className={cn('flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-indigo-50',
          o.id === line.pnlLineItemId && 'bg-indigo-50 ring-1 ring-indigo-200', o.category === 'HOTEL' && 'opacity-55')}>
        <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{o.category}</span>
        <span className="flex-1 text-xs leading-snug text-slate-700">
          {o.activity}
          <span className="mt-0.5 flex flex-wrap gap-1">
            {score != null && <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[9px] font-bold text-emerald-700"><Sparkles className="h-2.5 w-2.5" />fits {Math.round(score * 100)}%</span>}
            {used > 0 && <span className="rounded bg-violet-50 px-1 text-[9px] font-bold text-violet-600" title="Lines sharing a P&L line split its value">already on {used} line{used === 1 ? '' : 's'} — will be shared</span>}
            {o.id === line.pnlLineItemId && <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1 text-[9px] font-bold text-indigo-700"><Check className="h-2.5 w-2.5" />current</span>}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold tabular-nums text-slate-800">{fmtMoney(o.value, o.currency)}</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="my-10 w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-800">P&amp;L line for this movement</div>
            <div className="mt-0.5 text-xs text-slate-500">
              <b className="font-mono text-slate-700">{bookingRef}</b> · {fmtDay(line.serviceDate)}{line.time ? ` ${line.time}` : ''} · {line.pickUp ?? '—'} → {line.dropOff ?? '—'}
              {line.rate != null && <> · rate <b className="text-slate-700">{fmtMoney(line.rate, sheetCurrency)}</b></>}
            </div>
            {line.details && <div className="mt-1 line-clamp-2 text-[11px] text-slate-400">{line.details}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <Search className="h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the P&L lines…" className="flex-1 bg-transparent text-sm outline-none" />
          </div>

          {!opts && !error && <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the OPS and Accounts P&amp;L…</div>}
          {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div>}

          {opts && (
            <>
              {!needle && opts.suggested.length > 0 && (
                <section>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700"><Sparkles className="h-3 w-3" /> Best fit for this movement</div>
                  {opts.suggested.map(s => { const o = all.get(s.id); return o ? <Row key={`s-${s.id}`} o={o} score={s.score} /> : null })}
                </section>
              )}

              <section>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Database className="h-3 w-3" /> OPS P&amp;L {opts.currency ? `· ${opts.currency}` : ''}</div>
                {filter(opts.lines).length
                  ? filter(opts.lines).map(o => <Row key={o.id} o={all.get(o.id)!} />)
                  : <div className="px-2.5 py-2 text-xs text-slate-400">{opts.lines.length ? 'Nothing matches the search.' : 'This booking has no P&L lines in OPS.'}</div>}
              </section>

              <section>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Building2 className="h-3 w-3" /> Accounts P&amp;L {opts.accounts.label ? `· ${opts.accounts.label}` : ''} {opts.accounts.currency ? `· ${opts.accounts.currency}` : ''}</div>
                {!opts.accounts.available
                  ? <div className="px-2.5 py-2 text-xs text-slate-400">{opts.accounts.message}</div>
                  : filter(opts.accounts.lines).length
                    ? filter(opts.accounts.lines).map(o => <Row key={o.id} o={all.get(o.id)!} />)
                    : <div className="px-2.5 py-2 text-xs text-slate-400">Nothing matches the search.</div>}
              </section>
            </>
          )}

          <section className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Keyboard className="h-3 w-3" /> Or type the P&amp;L line</div>
            <div className="flex flex-wrap gap-2">
              <input value={custom.description} onChange={e => setCustom(c => ({ ...c, description: e.target.value }))} placeholder="Description, e.g. KLIA arrival transfer"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-300" />
              <input value={custom.value} onChange={e => setCustom(c => ({ ...c, value: e.target.value }))} placeholder="P&L value" inputMode="decimal"
                className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums outline-none focus:border-indigo-300" />
              <select value={custom.currency} onChange={e => setCustom(c => ({ ...c, currency: e.target.value }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
                {Array.from(new Set([sheetCurrency, ...RECON_CURRENCIES])).map(c => <option key={c}>{c}</option>)}
              </select>
              <button disabled={!customOk} onClick={() => onPick({ kind: 'custom', description: custom.description.trim(), value: Math.round(customValue * 100) / 100, currency: custom.currency }, Array.from(also))}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">Use</button>
            </div>
          </section>

          {siblings.length > 0 && (
            <section>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Also use the same P&amp;L line for</div>
              <div className="max-h-36 space-y-0.5 overflow-auto rounded-xl ring-1 ring-slate-200">
                {siblings.map(s => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50">
                    <input type="checkbox" checked={also.has(s.id)} onChange={e => setAlso(a => { const n = new Set(a); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} />
                    <span className="font-semibold">{fmtDay(s.serviceDate)}{s.time ? ` ${s.time}` : ''}</span>
                    <span className="flex-1 truncate">{s.pickUp ?? '—'} → {s.dropOff ?? '—'} · {s.details}</span>
                    {s.rate != null && <span className="tabular-nums">{fmtMoney(s.rate)}</span>}
                  </label>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">Lines sharing one P&amp;L line split its value by their rates, so the total is never counted twice.</div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <button onClick={() => onPick(null, Array.from(also))} className="text-xs font-semibold text-slate-500 hover:text-rose-600">No P&amp;L line for this movement</button>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        </div>
      </div>
    </div>
  )
}
