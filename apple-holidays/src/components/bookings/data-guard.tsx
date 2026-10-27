'use client'

/**
 * Booking-page side of data protection (lib/data-protection.ts):
 *
 *   • a padlock on the Flights / Hotels / Passengers cards — a locked section
 *     is left alone by TC re-syncs and version switches (hand edits still work)
 *   • a tag on every flight saying whether the next re-sync keeps it
 *     ("Kept on re-sync" — typed in here) or owns it ("From TC")
 *   • "Restore" — bring back flights an older version of the booking held
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { History, Lock, LockOpen, ShieldCheck, FileText, ArrowRight, Loader2, Check } from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import {
  LOCK_SECTION_LABELS, type BookingLocks, type DataProtectionPolicy, type LockSection,
} from '@/lib/data-protection'

interface GuardState {
  policy: DataProtectionPolicy
  locks: BookingLocks
  canLock: Record<LockSection, boolean>
  flights: { manualIds: string[]; importIds: string[]; baselineKnown: boolean } | null
  restorable: number
}

export interface DataGuard {
  state: GuardState | null
  refresh: () => Promise<void>
  setLock: (section: LockSection, locked: boolean, note?: string) => Promise<boolean>
  isLocked: (section: LockSection) => boolean
}

/** Load the booking's protection state. `version` re-fetches after the booking reloads. */
export function useDataGuard(bookingRef: string, version?: unknown): DataGuard {
  const [state, setState] = useState<GuardState | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/data-guard`)
      const json = await res.json()
      if (json.success) setState(json.data)
    } catch {
      // Protection still runs server-side; only the badges are missing.
    }
  }, [bookingRef])

  useEffect(() => { refresh() }, [refresh, version])

  const setLock = useCallback(async (section: LockSection, locked: boolean, note?: string) => {
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/data-guard`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, locked, note }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setState(prev => prev ? { ...prev, locks: json.data.locks } : prev)
      toast.success(locked
        ? `${LOCK_SECTION_LABELS[section]} locked — re-syncs will leave them as they are`
        : `${LOCK_SECTION_LABELS[section]} unlocked`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the lock')
      return false
    }
  }, [bookingRef])

  const isLocked = useCallback(
    (section: LockSection) => Boolean(state?.policy.bookingLocks && state.locks[section]),
    [state],
  )

  return { state, refresh, setLock, isLocked }
}

/* ── Padlock ────────────────────────────────────────────────────────────── */

export function SectionLockButton({ section, guard }: { section: LockSection; guard: DataGuard }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const s = guard.state
  if (!s?.policy.bookingLocks || !s.canLock[section]) return null
  const locked = guard.isLocked(section)
  const label = LOCK_SECTION_LABELS[section]

  async function apply() {
    setBusy(true)
    const ok = await guard.setLock(section, !locked, note)
    setBusy(false)
    if (ok) { setOpen(false); setNote('') }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={locked ? `${label} are locked against re-sync` : `Lock ${label.toLowerCase()} against re-sync`}
        className={cn(
          'text-xs flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors',
          locked ? 'text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100' : 'text-slate-400 hover:text-slate-600',
        )}
      >
        {locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
        {locked && 'Locked'}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-30 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-left">
          <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            {locked ? <LockOpen className="w-3.5 h-3.5 text-slate-500" /> : <Lock className="w-3.5 h-3.5 text-amber-600" />}
            {locked ? `Unlock ${label.toLowerCase()}?` : `Lock ${label.toLowerCase()}?`}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {locked
              ? `The next TC re-sync from OneDrive or a version switch may rewrite the ${label.toLowerCase()} again.`
              : `A TC re-sync from OneDrive, a TC amendment email or a version switch will leave the ${label.toLowerCase()} exactly as they are. You can still edit them here.`}
          </p>
          {!locked && (
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Why? (optional) — e.g. flights confirmed with guest"
              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300"
              onKeyDown={e => { if (e.key === 'Enter') apply() }}
            />
          )}
          <div className="mt-2.5 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
            <button
              onClick={apply}
              disabled={busy}
              className={cn(
                'text-xs font-semibold px-3 py-1 rounded-lg text-white disabled:opacity-60 flex items-center gap-1',
                locked ? 'bg-slate-700 hover:bg-slate-800' : 'bg-amber-500 hover:bg-amber-600',
              )}
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              {locked ? 'Unlock' : 'Lock'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Thin strip at the top of a locked card: who locked it and why. */
export function LockedStrip({ section, guard }: { section: LockSection; guard: DataGuard }) {
  if (!guard.isLocked(section)) return null
  const l = guard.state!.locks[section]!
  return (
    <div className="flex items-start gap-2 px-4 py-2 bg-amber-50/70 border-b border-amber-100 text-[11px] text-amber-800">
      <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <span>
        Locked by <b>{l.by}</b>{l.at && <> · {formatDate(l.at)}</>} — re-syncs leave these as they are.
        {l.note && <span className="block text-amber-700/80 italic">“{l.note}”</span>}
      </span>
    </div>
  )
}

/* ── Per-flight origin ──────────────────────────────────────────────────── */

export function FlightOriginTag({ flightId, guard }: { flightId: string; guard: DataGuard }) {
  const s = guard.state
  if (!s?.policy.keepManualFlights || !s.flights || guard.isLocked('flights')) return null
  if (s.flights.manualIds.includes(flightId)) {
    return (
      <span
        title="Added or edited here — a TC re-sync from OneDrive keeps this flight"
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1 py-px"
      >
        <ShieldCheck className="w-2.5 h-2.5" /> Kept on re-sync
      </span>
    )
  }
  if (s.flights.importIds.includes(flightId)) {
    return (
      <span
        title="Written by the last TC import — the next TC re-sync may update it. Edit it here and it becomes yours."
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-100 rounded px-1 py-px"
      >
        <FileText className="w-2.5 h-2.5" /> From TC
      </span>
    )
  }
  return null
}

/* ── Restore ────────────────────────────────────────────────────────────── */

interface RestorableFlight {
  fingerprint: string
  flightNo: string
  date: string
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline: string | null
  notes: string | null
  lastSeenVersion: number
  lastSeenAt: string
  lastSeenSource: string | null
  replaces: { id: string; depTime: string; arrTime: string; fromApt: string; toApt: string; notes: string | null } | null
}

const SOURCE_LABEL: Record<string, string> = {
  onedrive: 'OneDrive', mail: 'Email', restore: 'Version switch', manual: 'Manual', b2c: 'B2C',
}

export function FlightRestoreButton({ guard, onClick }: { guard: DataGuard; onClick: () => void }) {
  const s = guard.state
  if (!s?.policy.flightRestore || !s.canLock.flights) return null
  return (
    <button
      onClick={onClick}
      title="Bring back flights an older version of this booking had"
      className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
    >
      <History className="w-3 h-3" /> Restore
      {s.restorable > 0 && (
        <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
          {s.restorable}
        </span>
      )}
    </button>
  )
}

export function FlightRestoreModal({
  bookingRef, open, onClose, onRestored,
}: {
  bookingRef: string
  open: boolean
  onClose: () => void
  onRestored: () => void
}) {
  const [items, setItems] = useState<RestorableFlight[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setItems(null)
    setPicked(new Set())
    fetch(`/api/bookings/${bookingRef}/flights/restore`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error)
        setItems(json.data.flights)
      })
      .catch(err => { toast.error(err instanceof Error ? err.message : 'Could not load history'); setItems([]) })
  }, [open, bookingRef])

  const toggle = (fp: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(fp)) next.delete(fp)
    else next.add(fp)
    return next
  })

  async function restore() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/flights/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints: Array.from(picked) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const { created, replaced } = json.data as { created: number; replaced: number }
      toast.success(`Restored ${created + replaced} flight${created + replaced === 1 ? '' : 's'}`, {
        description: replaced ? `${replaced} updated in place · ${created} added back` : undefined,
      })
      onRestored()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restore flights from history"
      size="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-slate-500">
            {picked.size ? `${picked.size} selected` : 'Nothing is removed — restore only adds or puts details back'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={restore} loading={saving} disabled={!picked.size}>
              Restore {picked.size || ''}
            </Button>
          </div>
        </div>
      }
    >
      {items === null && (
        <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading older versions…
        </div>
      )}

      {items?.length === 0 && (
        <div className="py-10 text-center">
          <ShieldCheck className="w-8 h-8 mx-auto text-emerald-400" />
          <p className="mt-2 text-sm font-semibold text-slate-700">Nothing to restore</p>
          <p className="text-xs text-slate-400 mt-1">Every flight from this booking&apos;s saved versions is still on it.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Flights that older versions of <b>{bookingRef}</b> had, and the booking doesn&apos;t have now.
            </p>
            <button
              onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map(i => i.fingerprint)))}
              className="text-xs text-brand-600 hover:text-brand-700"
            >
              {picked.size === items.length ? 'Clear' : 'Select all'}
            </button>
          </div>

          {items.map(f => {
            const on = picked.has(f.fingerprint)
            return (
              <button
                key={f.fingerprint}
                onClick={() => toggle(f.fingerprint)}
                className={cn(
                  'w-full text-left rounded-xl border px-3 py-2.5 transition-colors flex items-start gap-3',
                  on ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <span className={cn(
                  'mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                  on ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-300',
                )}>
                  {on && <Check className="w-3 h-3" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{f.flightNo}</span>
                    <span className="text-xs text-slate-400">{formatDate(f.date)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-600">
                    <b>{f.fromApt}</b> {f.depTime} <ArrowRight className="w-3 h-3 text-slate-300" /> <b>{f.toApt}</b> {f.arrTime}
                    {f.airline && <span className="text-slate-400">· {f.airline}</span>}
                  </span>
                  {f.notes && <span className="block text-[11px] text-amber-600 mt-0.5">{f.notes}</span>}
                  {f.replaces && (
                    <span className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px] text-violet-700 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">
                      Puts back details — now {f.replaces.fromApt} {f.replaces.depTime || '—'} → {f.replaces.toApt} {f.replaces.arrTime || '—'}
                    </span>
                  )}
                  <span className="block text-[10px] text-slate-400 mt-1">
                    Last seen in V{f.lastSeenVersion}
                    {f.lastSeenSource && <> · {SOURCE_LABEL[f.lastSeenSource] ?? f.lastSeenSource}</>}
                    {' · '}{formatDateTime(f.lastSeenAt)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
