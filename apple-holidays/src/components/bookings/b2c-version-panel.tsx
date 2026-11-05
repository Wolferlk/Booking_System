'use client'

/**
 * Aahaas B2C store versions on the booking page.
 *
 *   REPLACED booking (an older store version that has a newer one in ops):
 *     a banner pointing at the active booking; the page tells the parent to
 *     blur and lock everything under it (with a "peek" to read it anyway).
 *
 *   ACTIVE booking with earlier versions:
 *     a version timeline (V1 → V2 …), what each store version changed, and,
 *     when an older version has a booking of its own, its details side by side
 *     with this one, changed rows highlighted.
 *
 * A version with no booking of its own is carried by the active booking, so it
 * reads as this booking's version, never as something missing from OPS.
 *
 * Nothing shows for a booking the store never amended.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, Eye, EyeOff, GitBranch, History, Layers, Sparkles } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import type { B2cVersionEntry, B2cVersionLink } from '@/lib/b2c-version-links'
import type { B2cLineChange } from '@/lib/b2c-same-order'
import B2cCarryoverReview from './b2c-carryover-review'

interface Snapshot {
  ref: string
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxInfants: number
  quotedTotal: number | null
  currency: string
  operationCountry: string | null
  destination: string | null
  createdAt: string
  opsVersion: number
  lead: string | null
  hotels: string[]
  flights: number
  itinerary: number
  tickets: number
}

export type VersionViewState = 'active' | 'superseded' | null

interface LiveStatus {
  applied: boolean
  lastError: string | null
  leftForReview: string[]
}

const holder = (v: B2cVersionEntry) => v.heldBy ?? v.ref

const CHANGE_WORDS: Record<string, string> = { added: 'Added', removed: 'Taken off', repriced: 'Repriced', rebooked: 'Rebooked' }

function changeLine(c: B2cLineChange): string {
  const name = c.productName || `Line ${c.checkoutLineId}`
  const price = c.changeType === 'repriced' && c.oldTotal != null && c.newTotal != null
    ? ` · ${c.currency ?? ''} ${c.oldTotal.toLocaleString('en-US')} → ${c.newTotal.toLocaleString('en-US')}`.replace('  ', ' ')
    : ''
  return `${CHANGE_WORDS[c.changeType] ?? c.changeType}: ${name}${price}${c.supplierHeld ? ' · supplier still holds it' : ''}`
}

const day = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const money = (n: number | null, cur: string) => (n == null ? '—' : `${cur === 'USD' ? '$' : `${cur} `}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const pax = (s: Snapshot) => `${s.paxAdults} adult${s.paxAdults === 1 ? '' : 's'}, ${s.paxChildren} child${s.paxChildren === 1 ? '' : 'ren'}${s.paxInfants ? `, ${s.paxInfants} infant${s.paxInfants === 1 ? '' : 's'}` : ''}`
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

function rowsFor(s: Snapshot): Record<string, string> {
  return {
    'Travel dates': `${day(s.arrivalDate)} → ${day(s.departureDate)}`,
    Pax: pax(s),
    'Lead passenger': s.lead ?? '—',
    Total: money(s.quotedTotal, s.currency),
    Destination: s.destination || label(s.operationCountry ?? '—'),
    Hotels: s.hotels.length ? s.hotels.join('\n') : '—',
    'Flights / itinerary / tickets': `${s.flights} / ${s.itinerary} / ${s.tickets}`,
    'OPS status': label(s.status),
    'Imported to OPS': day(s.createdAt),
  }
}

export default function B2cVersionPanel({
  bookingRef,
  onState,
  peeking,
  onPeek,
  onChange,
}: {
  bookingRef: string
  onState?: (s: VersionViewState) => void
  peeking?: boolean
  onPeek?: (on: boolean) => void
  /** The carry-over wrote to this booking — reload it. */
  onChange?: () => void
}) {
  const [link, setLink] = useState<B2cVersionLink | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null)
  const [changes, setChanges] = useState<B2cLineChange[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-versions`)
        const json = await readApiResponse<{ link: B2cVersionLink | null; snapshots: Snapshot[]; liveStatus?: LiveStatus | null; changes?: B2cLineChange[] }>(res)
        if (!alive || !json.success) return
        setLink(json.data?.link ?? null)
        setSnapshots(json.data?.snapshots ?? [])
        setLiveStatus(json.data?.liveStatus ?? null)
        setChanges(json.data?.changes ?? [])
        onState?.(json.data?.link?.state ?? null)
      } catch {
        /* informational */
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingRef])

  const snap = useMemo(() => new Map(snapshots.map((s) => [s.ref, s])), [snapshots])
  if (!link) return null

  const total = link.versions.length
  // Newest first: a booking can hold several versions.
  const mine = [...link.versions].reverse().find((v) => holder(v) === bookingRef)
  const active = link.activeRef ? snap.get(link.activeRef) : undefined
  const activeEntry = [...link.versions].reverse().find((v) => holder(v) === link.activeRef)

  // ── Timeline (shared) ──────────────────────────────────────────────────────
  const timeline = (
    <ol className="flex flex-wrap items-center gap-2">
      {link.versions.map((v, i) => {
        // The live version is the one to work on, whichever booking carries it.
        const isActive = link.liveOrderId != null ? v.live : v.ref != null && v.ref === link.activeRef
        const isMe = v === mine
        const openable = v.ref && v.ref !== bookingRef
        const chip = (
          <span
            className={[
              'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition',
              isActive
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm shadow-emerald-100'
                : 'border-slate-200 bg-white/70 text-slate-500',
              isMe ? 'ring-2 ring-offset-1 ring-violet-400' : '',
              openable ? 'hover:border-violet-300 hover:text-violet-700' : '',
            ].join(' ')}
          >
            <span className={`rounded-md px-1.5 py-0.5 font-bold ${isActive ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>V{v.version}</span>
            <span className={`font-mono font-semibold ${isActive || v.sameOrder ? '' : 'line-through decoration-slate-400'}`}>{v.orderId}</span>
            <span className="text-[10px] uppercase tracking-wide">
              {isActive ? 'Active' : v.live ? 'Live in store' : v.sameOrder ? 'Earlier version' : 'Replaced'}
            </span>
            {isMe && <span className="text-[10px] font-semibold text-violet-600">(this page)</span>}
          </span>
        )
        return (
          <li key={`${v.orderId}:${v.version}`} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
            {openable ? <Link href={`/dashboard/bookings/${v.ref}`}>{chip}</Link> : chip}
          </li>
        )
      })}
    </ol>
  )

  // ── Replaced booking ───────────────────────────────────────────────────────
  if (link.state === 'superseded') {
    return (
      <div data-version-banner className="relative overflow-hidden rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 via-white to-emerald-50 p-5 shadow-md">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -bottom-12 h-40 w-40 rounded-full bg-violet-200/50 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200">
              <History className="h-6 w-6" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-violet-700">
                Old version · replaced by an updated booking
              </p>
              <p className="text-sm text-slate-700">
                The customer amended this booking in the Aahaas store. This is <b>version {mine?.version ?? link.version}</b> of {total}
                {' '}(order <b className="font-mono">{bookingRef}</b>) and is <b>disabled</b> — kept for history only.
                {link.activeRef ? <> Work on <b className="font-mono">{link.activeRef}</b>{activeEntry ? <> (V{activeEntry.version})</> : null} instead.</> : null}
              </p>
              {active && (
                <p className="text-xs text-slate-500">
                  Active booking: {day(active.arrivalDate)} → {day(active.departureDate)} · {pax(active)} · {money(active.quotedTotal, active.currency)}
                  {active.lead ? <> · {active.lead}</> : null}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onPeek && (
              <button
                type="button"
                onClick={() => onPeek(!peeking)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50"
              >
                {peeking ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {peeking ? 'Blur again' : 'Peek at old version'}
              </button>
            )}
            {link.activeRef && (
              <Link
                href={`/dashboard/bookings/${link.activeRef}`}
                className="group inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
              >
                <Sparkles className="h-4 w-4" /> Open active booking {link.activeRef}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
        </div>
        <div className="relative mt-4 border-t border-violet-100 pt-3">{timeline}</div>
      </div>
    )
  }

  // ── Active booking with earlier versions ───────────────────────────────────
  const current = snap.get(bookingRef)
  const previousEntries = link.versions.filter((v) => v.ref && v.ref !== bookingRef && v.version < (mine?.version ?? Infinity))
  const previous = previousEntries.length ? snap.get(previousEntries[previousEntries.length - 1].ref!) : undefined
  const curRows = current ? rowsFor(current) : null
  const prevRows = previous ? rowsFor(previous) : null
  const changed = curRows && prevRows ? Object.keys(curRows).filter((k) => k !== 'OPS status' && k !== 'Imported to OPS' && curRows[k] !== prevRows[k]) : []
  const earlierInStoreOnly = link.versions.filter((v) => !v.ref && v.version < (mine?.version ?? Infinity))
  // Every version is on this one booking: nothing was replaced, nothing to go and open.
  const oneBooking = link.versions.every((v) => holder(v) === bookingRef)
  const liveEntry = link.versions.find((v) => v.live)
  const shownChanges = [...changes].sort((a, b) => b.version - a.version)

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 bg-gradient-to-r from-emerald-50 via-white to-violet-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow shadow-emerald-200">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
              Active booking · store version {mine?.version ?? link.version} of {total}
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                <GitBranch className="h-3 w-3" /> Updated booking
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {oneBooking
                ? <>The customer amended order <b className="font-mono">{link.chainId}</b> in the Aahaas store. Every version is on this one booking.</>
                : <>The customer amended order <b className="font-mono">{link.chainId}</b> in the Aahaas store. Earlier versions are disabled; this is the one to work on.</>}
            </p>
          </div>
        </div>
        {previous && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 md:self-auto"
          >
            {open ? 'Hide' : 'Show'} previous booking details
            {changed.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-amber-800">{changed.length} changed</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-3">{timeline}</div>

      {liveStatus && !liveStatus.applied && liveEntry && (
        <p className="border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          <b>Version {liveEntry.version} is not on this booking yet.</b>{' '}
          {liveStatus.lastError ?? 'Press Update Booking to review and apply it.'}
        </p>
      )}
      {liveStatus?.applied && liveStatus.leftForReview.length > 0 && (
        <p className="border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          Left for you in Update Booking, because they were edited here: {liveStatus.leftForReview.join(', ')}.
        </p>
      )}
      {shownChanges.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What each version changed</p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {shownChanges.slice(0, 12).map((c, i) => (
              <li key={`${c.version}:${c.checkoutLineId}:${c.changeType}:${i}`}><b className="text-slate-700">V{c.version}</b> · {changeLine(c)}</li>
            ))}
          </ul>
          {shownChanges.length > 12 && <p className="mt-1 text-xs text-slate-400">and {shownChanges.length - 12} more</p>}
        </div>
      )}

      {previous && curRows && prevRows && open && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="w-48 pb-2 font-semibold">Detail</th>
                  <th className="pb-2 font-semibold">
                    <Link href={`/dashboard/bookings/${previous.ref}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-violet-700">
                      Previous · {previous.ref} <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">replaced</span>
                    </Link>
                  </th>
                  <th className="pb-2 font-semibold text-emerald-700">Now · {bookingRef}</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(curRows).map((k) => {
                  const diff = changed.includes(k)
                  return (
                    <tr key={k} className={`border-t border-slate-100 align-top ${diff ? 'bg-amber-50/70' : ''}`}>
                      <td className="py-2 pr-3 text-xs font-semibold text-slate-500">
                        {diff && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" />}{k}
                      </td>
                      <td className={`whitespace-pre-line py-2 pr-3 ${diff ? 'text-slate-400 line-through decoration-rose-300' : 'text-slate-500'}`}>{prevRows[k]}</td>
                      <td className={`whitespace-pre-line py-2 ${diff ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{curRows[k]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {changed.length === 0 && <p className="mt-2 text-xs text-slate-500">The headline details match — the change is in the store lines (services, rates or extras).</p>}
        </div>
      )}
      {previous && <B2cCarryoverReview bookingRef={bookingRef} fromRef={previous.ref} onApplied={onChange} />}
      {!previous && !oneBooking && earlierInStoreOnly.length > 0 && (
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Earlier version{earlierInStoreOnly.length > 1 ? 's' : ''} {earlierInStoreOnly.map((v) => v.orderId).join(', ')} {earlierInStoreOnly.length > 1 ? 'were' : 'was'} never imported to OPS on {earlierInStoreOnly.length > 1 ? 'their' : 'its'} own — this booking carries the whole history.
        </p>
      )}
    </div>
  )
}
