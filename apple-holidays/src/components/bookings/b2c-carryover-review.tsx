'use client'

/**
 * "Carry over from the old version" — the Travel Experience review.
 *
 * Lives on the ACTIVE booking of an amended Aahaas B2C order. Lists everything
 * the team did on the replaced version that the store doesn't know about
 * (reconfirmations, AI-call plan, daily-message time, hand-typed notes and
 * contacts), each pre-ticked or not by the same rule as the B2B update, with
 * editable values. Nothing is written until TE presses Confirm.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, Loader2, Pencil, ShieldCheck, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { readApiResponse } from '@/lib/utils'
import type { CarryItem, CarryPreview, CarryState } from '@/lib/b2c-carryover'

type Preview = CarryPreview & { canConfirm: boolean }

const GROUP_ORDER = ['Hotel reconfirmations', 'AI calls', 'Daily WhatsApp', 'Manual edits', 'Guest notes & contacts', 'Old version']

export default function B2cCarryoverReview({ bookingRef, fromRef, onApplied }: { bookingRef: string; fromRef: string; onApplied?: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-carryover?from=${encodeURIComponent(fromRef)}`)
      const json = await readApiResponse<Preview>(res)
      if (!json.success || !json.data) throw new Error(json.error ?? 'Could not load the carry-over')
      setPreview(json.data)
      setTicked(new Set(json.data.items.filter((i) => i.recommended).map((i) => i.key)))
      setValues(Object.fromEntries(json.data.items.filter((i) => i.editable).map((i) => [i.key, i.value ?? ''])))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [bookingRef, fromRef])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const m = new Map<string, CarryItem[]>()
    for (const i of preview?.items ?? []) m.set(i.group, [...(m.get(i.group) ?? []), i])
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const)
  }, [preview])

  async function confirm() {
    if (!preview) return
    setBusy(true)
    try {
      const selection = preview.items.filter((i) => ticked.has(i.key)).map((i) => ({ key: i.key, ...(i.editable ? { value: values[i.key] ?? '' } : {}) }))
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-carryover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromRef: preview.fromRef, fingerprint: preview.fingerprint, selection }),
      })
      const json = await readApiResponse<CarryState>(res)
      if (!json.success || !json.data) throw new Error(json.error ?? 'Carry-over failed')
      const failed = json.data.applied.filter((a) => !a.ok)
      if (failed.length) toast.warning(`Applied with ${failed.length} problem(s): ${failed.map((f) => `${f.label} — ${f.note}`).join('; ')}`)
      else toast.success(`Carried over ${json.data.applied.length} item(s) from ${preview.fromRef}`)
      setOpen(false)
      await load()
      onApplied?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Carry-over failed')
      if (/changed/i.test(String(e))) await load()
    } finally {
      setBusy(false)
    }
  }

  if (err) return <p className="px-5 py-3 text-xs text-rose-600">Carry-over: {err}</p>
  if (!preview) return <p className="flex items-center gap-1.5 px-5 py-3 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what to carry over from {fromRef}…</p>

  const state = preview.state
  const pending = preview.items.length
  const recommended = preview.items.filter((i) => i.recommended).length

  return (
    <>
      {/* Strip on the version card */}
      <div className={`flex flex-col gap-2 border-t px-5 py-3 md:flex-row md:items-center md:justify-between ${pending && !state ? 'border-amber-200 bg-amber-50/70' : 'border-slate-100 bg-slate-50/60'}`}>
        <div className="flex items-start gap-2 text-sm">
          {state ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
          <div>
            {state ? (
              <p className="text-slate-700">
                Carry-over from <b className="font-mono">{state.fromRef}</b> confirmed by <b>{state.by}</b> on {new Date(state.at).toLocaleString('en-GB')}
                {' '}· {state.applied.filter((a) => a.ok).length} applied{state.applied.some((a) => !a.ok) ? `, ${state.applied.filter((a) => !a.ok).length} failed` : ''}
                {pending > 0 && <> · <b className="text-amber-700">{pending} more to review</b></>}
              </p>
            ) : pending > 0 ? (
              <p className="text-amber-900">
                <b>Waiting for Travel Experience:</b> {pending} thing{pending > 1 ? 's' : ''} the team did on <b className="font-mono">{fromRef}</b> (reconfirmations, AI calls, daily messages, manual edits) — check they still suit the updated booking.
              </p>
            ) : (
              <p className="text-slate-600">Nothing from <b className="font-mono">{fromRef}</b> needs carrying over.</p>
            )}
            {state?.applied.some((a) => !a.ok) && (
              <p className="mt-0.5 text-xs text-rose-600">{state.applied.filter((a) => !a.ok).map((a) => `${a.label}: ${a.note}`).join(' · ')}</p>
            )}
          </div>
        </div>
        {(pending > 0 || preview.info.length > 0) && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-3 py-2 text-sm font-semibold shadow-sm md:self-auto ${pending ? 'bg-amber-500 text-white hover:bg-amber-600' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <ClipboardCheck className="h-4 w-4" /> {pending ? `Review carry-over (${recommended}/${pending} suggested)` : 'View notes'}
          </button>
        )}
      </div>

      {/* Review */}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}>
          <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-emerald-50 px-6 py-4">
              <div>
                <p className="text-base font-bold text-slate-900">Carry over from <span className="font-mono">{preview.fromRef}</span> → <span className="font-mono text-emerald-700">{bookingRef}</span></p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Ticked = suggested. Untick anything that no longer suits the updated booking; <Pencil className="inline h-3 w-3" /> to change a value first.
                  Nothing is written until you confirm. Nothing is deleted.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-4">
              {preview.info.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-sky-200 bg-sky-50 p-3">
                  {preview.info.map((t) => (
                    <p key={t} className="flex items-start gap-1.5 text-xs text-sky-900"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t}</p>
                  ))}
                </div>
              )}

              {groups.map(([group, list]) => (
                <section key={group}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className={`text-[11px] font-bold uppercase tracking-wider ${group === 'Old version' ? 'text-violet-600' : 'text-slate-500'}`}>{group}</h4>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                      onClick={() => setTicked((t) => {
                        const n = new Set(t)
                        const all = list.every((i) => n.has(i.key))
                        list.forEach((i) => (all ? n.delete(i.key) : n.add(i.key)))
                        return n
                      })}
                    >
                      {list.every((i) => ticked.has(i.key)) ? 'Untick all' : 'Tick all'}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {list.map((i) => {
                      const on = ticked.has(i.key)
                      const edited = i.editable && (values[i.key] ?? '') !== (i.value ?? '')
                      return (
                        <li key={i.key} className={`rounded-xl border p-3 transition ${on ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white opacity-80'}`}>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n })}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-800">{i.label}</span>
                                {!i.recommended && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">your call</span>}
                                {edited && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">edited</span>}
                              </div>
                              <div className="mt-1 grid gap-1 text-xs md:grid-cols-2">
                                <p className="whitespace-pre-line text-slate-500"><span className="font-semibold text-slate-400">Old ({preview.fromRef}): </span>{i.from ?? '—'}</p>
                                <p className="whitespace-pre-line text-slate-700"><span className="font-semibold text-slate-400">Updated now: </span>{i.to ?? <i className="text-slate-400">empty</i>}</p>
                              </div>
                              {i.warning && <p className="mt-1 flex items-start gap-1 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{i.warning}</p>}
                            </div>
                          </label>
                          {i.editable && (
                            <div className="ml-7 mt-2">
                              {editing === i.key ? (
                                <textarea
                                  autoFocus
                                  rows={Math.min(6, Math.max(2, (values[i.key] ?? '').split('\n').length))}
                                  value={values[i.key] ?? ''}
                                  onChange={(e) => setValues((v) => ({ ...v, [i.key]: e.target.value }))}
                                  onBlur={() => setEditing(null)}
                                  className="w-full rounded-lg border border-violet-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                                />
                              ) : (
                                <button type="button" onClick={() => { setEditing(i.key); setTicked((t) => new Set(t).add(i.key)) }} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800">
                                  <Pencil className="h-3 w-3" /> Will write: <span className="max-w-[28rem] truncate font-normal text-slate-600">{values[i.key] || '(empty)'}</span>
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                {ticked.size} of {preview.items.length} ticked
                {!preview.canConfirm && <span className="ml-1 font-semibold text-rose-600">· Only Travel Experience (or an admin) can confirm.</span>}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  <XCircle className="mr-1 inline h-4 w-4" /> Not now
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy || !preview.canConfirm || ticked.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm suitable &amp; apply ({ticked.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
