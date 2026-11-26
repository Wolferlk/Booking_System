'use client'

/**
 * MC Report → Daily WhatsApp → "Test send".
 *
 * Sends every picked daily plan to one or two saved staff test numbers instead
 * of the guests — each plan as its own WhatsApp, exactly as the guest would get
 * it (plus an optional TEST COPY header naming the booking and guest number).
 *
 * The run is driven from here in small chunks so the desk sees each message
 * land live, can stop mid-run, and can retry only what failed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Copy, FlaskConical, Info, Loader2, Plus, RotateCcw,
  Save, Send, Smartphone, Square, Trash2, X, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { checkPhone } from '@/lib/phone-intl'
import { cn, formatDate } from '@/lib/utils'

export type TestSendRow = { bookingRef: string; date: string; leadGuest: string | null; location: string | null }

type TestNumber = { label: string; phone: string }
type Slot = { label: string; phone: string; use: boolean }

type CellState =
  | { s: 'queued' }
  | { s: 'sending' }
  | { s: 'sent'; unconfirmed?: boolean; attachments?: number }
  | { s: 'failed'; reason: string }
  | { s: 'stopped' }

const CHUNK = 5
const keyOf = (r: { bookingRef: string; date: string }) => `${r.bookingRef}|${r.date}`

export default function TestSendStudio({ open, onClose, rows }: {
  open: boolean
  onClose: () => void
  rows: TestSendRow[]
}) {
  // ── Saved numbers ─────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<Slot[]>([])
  const [saved, setSaved] = useState<TestNumber[]>([])
  const [loadingNumbers, setLoadingNumbers] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Options ───────────────────────────────────────────────────────────────
  const [files, setFiles] = useState(false)

  // ── Run state ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [cells, setCells] = useState<Record<string, CellState>>({}) // `${ref}|${date}|${phone}`
  const [runPhones, setRunPhones] = useState<string[]>([])
  const [runRows, setRunRows] = useState<TestSendRow[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [onlyFailed, setOnlyFailed] = useState(false)
  const stopRef = useRef(false)

  const loadNumbers = useCallback(async () => {
    setLoadingNumbers(true)
    try {
      const res = await fetch('/api/mc-report/whatsapp-daily/test')
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not load test numbers')
      const nums: TestNumber[] = json.data.numbers ?? []
      setSaved(nums)
      setSlots(nums.length ? nums.map(n => ({ label: n.label, phone: `+${n.phone}`, use: true })) : [{ label: 'My phone', phone: '', use: true }])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load test numbers')
    } finally { setLoadingNumbers(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setPhase('setup'); setCells({}); setOnlyFailed(false); stopRef.current = false
    void loadNumbers()
  }, [open, loadNumbers])

  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Sorted the way a tester reads them: by day, then booking.
  const plan = useMemo(() => {
    const m = new Map<string, TestSendRow>()
    for (const r of rows) if (!m.has(keyOf(r))) m.set(keyOf(r), r)
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date) || a.bookingRef.localeCompare(b.bookingRef))
  }, [rows])

  const verdicts = slots.map(s => checkPhone(s.phone))
  const slotDigits = verdicts.map(v => (v.state === 'valid' ? v.digits : null))
  // Compared label-for-label with what the server stored (it fills blank labels as "Test N").
  const draft = slots
    .map((s, i) => ({ label: s.label.trim(), phone: slotDigits[i] ?? '' }))
    .filter((s, i, arr) => s.phone && arr.findIndex(x => x.phone === s.phone) === i)
    .map((s, i) => ({ label: s.label.slice(0, 40) || `Test ${i + 1}`, phone: s.phone }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.map(s => ({ label: s.label, phone: s.phone })))

  const savedSet = new Set(saved.map(s => s.phone))
  const chosen = slots
    .map((s, i) => ({ ...s, digits: slotDigits[i] }))
    .filter(s => s.use && s.digits && savedSet.has(s.digits)) as (Slot & { digits: string })[]
  const totalMessages = plan.length * chosen.length

  async function saveNumbers() {
    const bad = verdicts.findIndex((v, i) => slots[i].phone.trim() && v.state !== 'valid')
    if (bad >= 0) { toast.error(`Number ${bad + 1}: ${'reason' in verdicts[bad] ? (verdicts[bad] as { reason: string }).reason : 'needs a country code, e.g. +94…'}`); return }
    setSaving(true)
    try {
      const numbers = slots.map((s, i) => ({ label: s.label, phone: slotDigits[i] ?? '' })).filter(n => n.phone)
      const res = await fetch('/api/mc-report/whatsapp-daily/test', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not save')
      setSaved(json.data.numbers)
      toast.success(json.message ?? 'Saved')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save') }
    finally { setSaving(false) }
  }

  // ── The run ───────────────────────────────────────────────────────────────

  const cellKey = (r: TestSendRow, phone: string) => `${keyOf(r)}|${phone}`

  async function run(targetRows: TestSendRow[], phones: string[]) {
    if (!targetRows.length || !phones.length) return
    stopRef.current = false
    setRunPhones(phones)
    setCells(prev => {
      const next = { ...prev }
      for (const r of targetRows) for (const p of phones) next[cellKey(r, p)] = { s: 'queued' }
      return next
    })
    setStartedAt(Date.now()); setNow(Date.now())
    setPhase('running')

    for (let i = 0; i < targetRows.length; i += CHUNK) {
      if (stopRef.current) break
      const chunk = targetRows.slice(i, i + CHUNK)
      setCells(prev => {
        const next = { ...prev }
        for (const r of chunk) for (const p of phones) next[cellKey(r, p)] = { s: 'sending' }
        return next
      })
      try {
        const res = await fetch('/api/mc-report/whatsapp-daily/test', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk.map(r => ({ bookingRef: r.bookingRef, date: r.date })), phones, attachments: files }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? 'Send failed')
        const results = json.data.results as { bookingRef: string; date: string; phone: string; ok: boolean; reason?: string; unconfirmed?: boolean; attachments?: number }[]
        setCells(prev => {
          const next = { ...prev }
          for (const r of results) {
            next[`${r.bookingRef}|${r.date}|${r.phone}`] = r.ok
              ? { s: 'sent', unconfirmed: r.unconfirmed, attachments: r.attachments }
              : { s: 'failed', reason: r.reason ?? 'Send failed' }
          }
          return next
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Send failed'
        setCells(prev => {
          const next = { ...prev }
          for (const r of chunk) for (const p of phones) next[cellKey(r, p)] = { s: 'failed', reason }
          return next
        })
      }
    }

    if (stopRef.current) {
      setCells(prev => {
        const next = { ...prev }
        for (const k of Object.keys(next)) if (next[k].s === 'queued') next[k] = { s: 'stopped' }
        return next
      })
    }
    setPhase('done')
  }

  function start() {
    if (dirty) { toast.error('Save your test numbers first'); return }
    if (!chosen.length) { toast.error('Pick at least one saved test number'); return }
    if (!window.confirm(`Send ${totalMessages} test WhatsApp${totalMessages === 1 ? '' : 's'} to ${chosen.map(c => `+${c.digits}`).join(' & ')}?\n\nGuests will NOT receive anything.`)) return
    setRunRows(plan)
    setCells({})
    setOnlyFailed(false)
    void run(plan, chosen.map(c => c.digits))
  }

  function retryFailed() {
    const failedRows = runRows.filter(r => runPhones.some(p => {
      const c = cells[cellKey(r, p)]
      return c?.s === 'failed' || c?.s === 'stopped'
    }))
    if (!failedRows.length) return
    void run(failedRows, runPhones)
  }

  // ── Tallies ───────────────────────────────────────────────────────────────
  const all = Object.entries(cells).filter(([k]) => runPhones.some(p => k.endsWith(`|${p}`)))
  const count = (s: CellState['s']) => all.filter(([, c]) => c.s === s).length
  const nSent = count('sent'), nFailed = count('failed'), nStopped = count('stopped')
  const nQueued = count('queued') + count('sending')
  const nUnconfirmed = all.filter(([, c]) => c.s === 'sent' && c.unconfirmed).length
  const nDone = nSent + nFailed + nStopped
  const pct = all.length ? Math.round((nDone / all.length) * 100) : 0
  const elapsed = startedAt ? Math.max(1, Math.round((now - startedAt) / 1000)) : 0
  const eta = nDone && nQueued ? Math.round((elapsed / nDone) * nQueued) : null

  function copyReport() {
    const lines = [
      `Daily WhatsApp test — ${new Date().toLocaleString()}`,
      `To: ${runPhones.map(p => `+${p}`).join(', ')} · ${nSent} sent · ${nFailed} failed${nStopped ? ` · ${nStopped} stopped` : ''}`,
      '',
      ...runRows.flatMap(r => runPhones.map(p => {
        const c = cells[cellKey(r, p)]
        const st = c?.s === 'sent' ? (c.unconfirmed ? 'SENT (outside 24h)' : 'SENT') : c?.s === 'failed' ? `FAILED — ${c.reason}` : (c?.s ?? '').toUpperCase()
        return `${r.date}  ${r.bookingRef}  ${r.leadGuest ?? ''}  → +${p}  ${st}`
      })),
    ]
    void navigator.clipboard.writeText(lines.join('\n')).then(() => toast.success('Report copied'))
  }

  if (!open) return null
  const running = phase === 'running'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => !running && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="relative overflow-hidden border-b border-violet-100 bg-gradient-to-br from-violet-50 via-white to-emerald-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/30"><FlaskConical className="h-5 w-5" /></span>
              <div>
                <p className="text-base font-bold text-slate-900">Test send · Daily WhatsApp</p>
                <p className="text-xs text-slate-500">
                  {plan.length} daily plan{plan.length === 1 ? '' : 's'} → your test phone{chosen.length === 1 ? '' : 's'}, one WhatsApp each. <span className="font-semibold text-violet-700">Guests receive nothing.</span>
                </p>
              </div>
            </div>
            <button type="button" disabled={running} onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {phase === 'setup' ? (
            <div className="space-y-5 p-6">
              {/* Numbers */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Test numbers <span className="font-medium normal-case text-slate-400">· up to 2, saved to your account</span></p>
                  {slots.length < 2 && !loadingNumbers && (
                    <button type="button" onClick={() => setSlots(s => [...s, { label: `Test ${s.length + 1}`, phone: '', use: true }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"><Plus className="h-3.5 w-3.5" />Add number</button>
                  )}
                </div>
                {loadingNumbers ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading your saved numbers…</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {slots.map((slot, i) => {
                      const v = verdicts[i]
                      const isSaved = slotDigits[i] ? savedSet.has(slotDigits[i]!) : false
                      return (
                        <div key={i} className={cn('rounded-2xl border p-3 transition-all', slot.use && v.state === 'valid' ? 'border-violet-300 bg-violet-50/40 ring-2 ring-violet-100' : 'border-slate-200')}>
                          <div className="mb-2 flex items-center gap-2">
                            <button type="button" onClick={() => setSlots(s => s.map((x, j) => (j === i ? { ...x, use: !x.use } : x)))}
                              title={slot.use ? 'Included in this run' : 'Skipped in this run'}
                              className={cn('flex h-5 w-5 items-center justify-center rounded-md border', slot.use ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 bg-white')}>
                              {slot.use && <CheckCircle2 className="h-3.5 w-3.5" />}
                            </button>
                            <input value={slot.label} maxLength={40} onChange={e => setSlots(s => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none" placeholder="Label" />
                            {isSaved && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Saved</span>}
                            <button type="button" onClick={() => setSlots(s => s.filter((_, j) => j !== i))} className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-violet-400">
                            <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
                            <input value={slot.phone} inputMode="tel" placeholder="+94 77 123 4567"
                              onChange={e => setSlots(s => s.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                              className="min-w-0 flex-1 bg-transparent text-sm font-semibold tabular-nums outline-none" />
                          </div>
                          <p className={cn('mt-1.5 text-[10px]', v.state === 'valid' ? 'text-emerald-600' : v.state === 'empty' ? 'text-slate-400' : 'text-rose-600')}>
                            {v.state === 'valid' ? `✓ ${v.pretty}${v.unverified ? ' · unverified country code' : ''}` : v.state === 'empty' ? 'Include the country code' : ('reason' in v ? String(v.reason) : 'Add the country code, e.g. +94…')}
                          </p>
                        </div>
                      )
                    })}
                    {!slots.length && (
                      <button type="button" onClick={() => setSlots([{ label: 'My phone', phone: '', use: true }])} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 p-6 text-xs font-semibold text-slate-400 hover:border-violet-300 hover:text-violet-600"><Plus className="h-4 w-4" />Add a test number</button>
                    )}
                  </div>
                )}
                {dirty && !loadingNumbers && (
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span>Unsaved changes — save before sending.</span>
                    <button type="button" disabled={saving} onClick={() => void saveNumbers()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-white hover:bg-amber-600 disabled:opacity-50">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save</button>
                  </div>
                )}
              </section>

              {/* Options */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block text-xs font-bold text-slate-800">Exactly the guest’s message</span>
                    <span className="block text-[11px] leading-snug text-slate-500">Word-for-word the daily plan each guest receives — no test labels added.</span>
                  </span>
                </div>
                <Toggle on={files} onChange={setFiles} title="Include ticket files" hint="Also send each day's ticket/voucher photos & PDFs — more messages, but the full guest experience." />
              </section>

              {/* Math */}
              <section className="flex items-center gap-4 rounded-2xl bg-slate-900 px-5 py-4 text-white">
                <div className="text-center"><p className="text-2xl font-black tabular-nums">{plan.length}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">plans</p></div>
                <X className="h-4 w-4 text-slate-500" />
                <div className="text-center"><p className="text-2xl font-black tabular-nums">{chosen.length}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">number{chosen.length === 1 ? '' : 's'}</p></div>
                <span className="text-slate-500">=</span>
                <div className="text-center"><p className="text-2xl font-black tabular-nums text-emerald-400">{totalMessages}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">WhatsApps</p></div>
                <p className="ml-auto max-w-[15rem] text-[11px] leading-snug text-slate-400">
                  Sent one by one, in date order. Guests’ own plans are untouched; the auto-send will still go out to them.
                </p>
              </section>

              <div className="flex gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-[11px] leading-relaxed text-sky-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><b>Tip:</b> send “hi” from the test phone to the business WhatsApp first. That opens WhatsApp’s 24-hour window, so each plan arrives in full as free text instead of as a template.</span>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {/* Progress */}
              <div className="mb-4 rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {running ? <Loader2 className="h-4 w-4 animate-spin text-violet-600" /> : nFailed ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    <p className="text-sm font-bold text-slate-900">
                      {running ? (stopRef.current ? 'Stopping after this batch…' : 'Sending test plans…') : nFailed || nStopped ? 'Finished with issues' : 'All test plans sent'}
                    </p>
                  </div>
                  <p className="text-xs tabular-nums text-slate-500">{elapsed}s{eta !== null && running ? ` · ~${eta}s left` : ''}</p>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="flex h-full transition-all duration-500">
                    <div className="bg-emerald-500" style={{ width: `${all.length ? (nSent / all.length) * 100 : 0}%` }} />
                    <div className="bg-rose-500" style={{ width: `${all.length ? (nFailed / all.length) * 100 : 0}%` }} />
                    <div className="bg-slate-300" style={{ width: `${all.length ? (nStopped / all.length) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <Stat n={nSent} label="Sent" cls="text-emerald-600" />
                  <Stat n={nFailed} label="Failed" cls="text-rose-600" />
                  <Stat n={nQueued} label="Queued" cls="text-slate-500" />
                  <Stat n={pct} label="% done" cls="text-violet-600" />
                </div>
                {nUnconfirmed > 0 && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    {nUnconfirmed} went out as plain text outside the 24-hour window, so WhatsApp may not deliver them. Message the business number from the test phone and retry.
                  </p>
                )}
              </div>

              {/* Filter */}
              <div className="mb-2 flex items-center gap-1">
                {(['All', 'Failed'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setOnlyFailed(t === 'Failed')}
                    className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', (t === 'Failed') === onlyFailed ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                    {t}{t === 'Failed' && nFailed ? ` ${nFailed}` : ''}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-slate-400">{runPhones.map(p => `+${p}`).join(' · ')}</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                {runRows
                  .filter(r => !onlyFailed || runPhones.some(p => cells[cellKey(r, p)]?.s === 'failed'))
                  .map(r => (
                    <div key={keyOf(r)} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <span className="w-20 shrink-0 tabular-nums text-slate-400">{formatDate(r.date)}</span>
                      <span className="w-24 shrink-0 font-mono font-semibold text-slate-700">{r.bookingRef}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">{r.leadGuest ?? 'Guest'}{r.location ? <span className="text-slate-400"> · {r.location}</span> : null}</span>
                      <span className="flex shrink-0 gap-1.5">
                        {runPhones.map(p => <CellChip key={p} cell={cells[cellKey(r, p)]} phone={p} multi={runPhones.length > 1} />)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          {phase === 'setup' ? (
            <>
              <p className="mr-auto text-[11px] text-slate-400">Test copies are logged as “staff test copy” and never count as the guest’s plan.</p>
              <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="button" disabled={!totalMessages || dirty || loadingNumbers} onClick={start}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-600/25 hover:bg-violet-700 disabled:opacity-40">
                <Send className="h-3.5 w-3.5" />Send {totalMessages} test{totalMessages === 1 ? '' : 's'}
              </button>
            </>
          ) : running ? (
            <>
              <p className="mr-auto text-[11px] text-slate-400">Keep this window open until the run finishes.</p>
              <button type="button" onClick={() => { stopRef.current = true; setNow(Date.now()) }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">
                <Square className="h-3.5 w-3.5" />Stop
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={copyReport} className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><Copy className="h-3.5 w-3.5" />Copy report</button>
              {(nFailed > 0 || nStopped > 0) && (
                <button type="button" onClick={retryFailed} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600"><RotateCcw className="h-3.5 w-3.5" />Retry {nFailed + nStopped}</button>
              )}
              <button type="button" onClick={() => setPhase('setup')} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">New test</button>
              <button type="button" onClick={onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ on, onChange, title, hint }: { on: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className={cn('flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors', on ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 hover:border-slate-300')}>
      <span className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-emerald-500' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span>
        <span className="block text-xs font-bold text-slate-800">{title}</span>
        <span className="block text-[11px] leading-snug text-slate-500">{hint}</span>
      </span>
    </button>
  )
}

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-2">
      <p className={cn('text-lg font-black tabular-nums', cls)}>{n}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  )
}

function CellChip({ cell, phone, multi }: { cell: CellState | undefined; phone: string; multi: boolean }) {
  const tail = multi ? `…${phone.slice(-4)}` : ''
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
  if (!cell || cell.s === 'queued') return <span className={cn(base, 'bg-slate-100 text-slate-400')}>Queued {tail}</span>
  if (cell.s === 'sending') return <span className={cn(base, 'bg-violet-100 text-violet-700')}><Loader2 className="h-3 w-3 animate-spin" />{tail || 'Sending'}</span>
  if (cell.s === 'stopped') return <span className={cn(base, 'bg-slate-100 text-slate-500')}>Stopped {tail}</span>
  if (cell.s === 'failed') return <span title={cell.reason} className={cn(base, 'cursor-help bg-rose-100 text-rose-700')}><XCircle className="h-3 w-3" />{tail || 'Failed'}</span>
  return (
    <span title={cell.unconfirmed ? 'Sent as plain text outside the 24h window — WhatsApp may drop it' : `Sent${cell.attachments ? ` + ${cell.attachments} file${cell.attachments === 1 ? '' : 's'}` : ''}`}
      className={cn(base, cell.unconfirmed ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
      {cell.unconfirmed ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{tail || 'Sent'}{cell.attachments ? ` +${cell.attachments}` : ''}
    </span>
  )
}
