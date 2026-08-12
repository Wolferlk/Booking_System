'use client'

/**
 * AppleSystem actions for an already-imported booking.
 *
 * Two buttons on the booking detail page:
 *
 *  • "Fetch Data from API" — opens a picker for which part of the booking to
 *    re-pull from AppleSystem (Itinerary, Accommodations; Flights is disabled
 *    because the AppleSystem quote payload never carries flight data — see
 *    `flights: never[]` in `as-booking-map.ts`). The import path is
 *    idempotent, so a booking created before a mapper fix keeps its stale
 *    data forever; this is the only way to correct it in place. It overwrites
 *    data, so it asks first and shows a before/after diff.
 *
 *  • "Raw API Response" — read-only popup of the untouched
 *    `POST /api/quotation/template/quote` payload for this booking's IS number,
 *    for checking what AppleSystem actually sent.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Code2, Copy, Check, Plane, Hotel, Map, Lock } from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { readApiResponse, cn } from '@/lib/utils'

type FetchType = 'itinerary' | 'accommodations'

interface ItinPreview {
  dayNo: number
  date: string
  title: string
  description?: string | null
}

interface AccPreview {
  city: string
  hotel: string
  checkIn: string
  checkOut: string
  nights: number
  roomType?: string | null
  mealType?: string | null
  ownArrangement?: boolean
}

interface ItinRefetchResult {
  quotationNo: string
  previousCount: number
  newCount: number
  previous: ItinPreview[]
  itineraryItems: ItinPreview[]
}

interface AccRefetchResult {
  quotationNo: string
  previousCount: number
  newCount: number
  previous: AccPreview[]
  accommodations: AccPreview[]
}

interface RawResult {
  isNumber: string
  quotationNo: string
  referenceId: string
  status?: string
  statusClass?: string
  endpoint: string
  requestBody: Record<string, string>
  raw: unknown
}

const FETCH_OPTIONS: {
  type: FetchType
  label: string
  description: string
  icon: typeof Map
}[] = [
  {
    type: 'itinerary',
    label: 'Itinerary',
    description: 'Day-by-day itinerary items and activities.',
    icon: Map,
  },
  {
    type: 'accommodations',
    label: 'Hotels / Accommodations',
    description: 'Hotel, room type, meal plan, check-in/out dates.',
    icon: Hotel,
  },
]

export default function AppleSystemActions({
  bookingRef,
  isNumber,
  canRefetch,
  canViewRaw,
  onRefetched,
}: {
  bookingRef: string
  isNumber?: string | null
  canRefetch: boolean
  canViewRaw: boolean
  onRefetched?: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const [confirmType, setConfirmType] = useState<FetchType | null>(null)
  const [refetching, setRefetching] = useState(false)
  const [itinResult, setItinResult] = useState<ItinRefetchResult | null>(null)
  const [accResult, setAccResult] = useState<AccRefetchResult | null>(null)

  const [rawOpen, setRawOpen] = useState(false)
  const [rawLoading, setRawLoading] = useState(false)
  const [raw, setRaw] = useState<RawResult | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function pick(type: FetchType) {
    setPickerOpen(false)
    setItinResult(null)
    setAccResult(null)
    setConfirmType(type)
  }

  async function doRefetch() {
    if (!confirmType) return
    setRefetching(true)
    try {
      const endpoint = confirmType === 'itinerary' ? 'as-refetch' : 'as-refetch-accommodations'
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/${endpoint}`, { method: 'POST' })
      if (confirmType === 'itinerary') {
        const json = await readApiResponse<ItinRefetchResult>(res)
        if (!json.success) throw new Error(json.error || 'Refetch failed')
        setItinResult(json.data ?? null)
        toast.success(json.message || 'Itinerary refetched')
      } else {
        const json = await readApiResponse<AccRefetchResult>(res)
        if (!json.success) throw new Error(json.error || 'Refetch failed')
        setAccResult(json.data ?? null)
        toast.success(json.message || 'Accommodations refetched')
      }
      onRefetched?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refetch failed')
      setConfirmType(null)
    } finally {
      setRefetching(false)
    }
  }

  async function openRaw() {
    setRawOpen(true)
    if (raw) return
    setRawLoading(true)
    setRawError(null)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/as-raw`)
      const json = await readApiResponse<RawResult>(res)
      if (!json.success) throw new Error(json.error || 'Could not load the raw response')
      setRaw(json.data ?? null)
    } catch (err) {
      setRawError(err instanceof Error ? err.message : 'Could not load the raw response')
    } finally {
      setRawLoading(false)
    }
  }

  async function copyRaw() {
    if (!raw) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw.raw, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  function closeConfirm() {
    setConfirmType(null)
    setItinResult(null)
    setAccResult(null)
  }

  if (!canRefetch && !canViewRaw) return null

  const result = confirmType === 'itinerary' ? itinResult : confirmType === 'accommodations' ? accResult : null

  return (
    <>
      {canRefetch && (
        <button
          onClick={() => setPickerOpen(true)}
          className="btn btn-sm bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 flex items-center gap-1.5"
          title="Re-pull part of this booking from AppleSystem"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Fetch Data from API
        </button>
      )}

      {canViewRaw && (
        <button
          onClick={openRaw}
          className="btn btn-sm bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 flex items-center gap-1.5"
          title="Show the raw AppleSystem API response for this IS number"
        >
          <Code2 className="w-3.5 h-3.5" /> Raw API Response
        </button>
      )}

      {/* ── Picker: what to fetch ───────────────────────────────────────────── */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Fetch Data from AppleSystem"
        size="md"
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-600 mb-3">
            Choose what to re-pull for <span className="font-mono font-semibold">{isNumber || bookingRef}</span>.
            This overwrites the selected data with what AppleSystem currently has.
          </p>
          {FETCH_OPTIONS.map(({ type, label, description, icon: Icon }) => (
            <button
              key={type}
              onClick={() => pick(type)}
              className="w-full flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-amber-300 hover:bg-amber-50 transition-colors"
            >
              <Icon className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{label}</span>
                <span className="block text-xs text-slate-500">{description}</span>
              </span>
            </button>
          ))}
          <div
            className="w-full flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left opacity-60 cursor-not-allowed"
            title="AppleSystem quotations do not carry flight data"
          >
            <Plane className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-slate-500">Flights</span>
              <span className="block text-xs text-slate-400">Not available — AppleSystem does not return flight data.</span>
            </span>
            <Lock className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
          </div>
        </div>
      </Modal>

      {/* ── Refetch: confirm, then show what changed ───────────────────────── */}
      <Modal
        open={confirmType !== null}
        onClose={closeConfirm}
        title={
          result
            ? `${confirmType === 'itinerary' ? 'Itinerary' : 'Accommodations'} Refetched`
            : `Refetch ${confirmType === 'itinerary' ? 'Itinerary' : 'Accommodations'} from AppleSystem?`
        }
        size={result ? '4xl' : 'lg'}
        footer={
          result ? (
            <Button onClick={closeConfirm}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeConfirm} disabled={refetching}>Cancel</Button>
              <Button loading={refetching} onClick={doRefetch}>Refetch &amp; Replace</Button>
            </>
          )
        }
      >
        {!result ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              This re-pulls <span className="font-mono font-semibold">{isNumber || bookingRef}</span> from
              AppleSystem and{' '}
              <strong>replaces the stored {confirmType === 'itinerary' ? 'itinerary' : 'accommodations'}</strong>{' '}
              with the current one.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              {confirmType === 'itinerary' ? (
                <>
                  <li>Every existing itinerary day is deleted and rewritten.</li>
                  <li>Any manual edits to the itinerary will be lost.</li>
                  <li>Dates, pax, pricing and accommodations are <strong>not</strong> touched.</li>
                </>
              ) : (
                <>
                  <li>Every existing hotel row is deleted and rewritten.</li>
                  <li>Any manual edits to accommodations will be lost.</li>
                  <li>Dates, pax, pricing and itinerary are <strong>not</strong> touched.</li>
                </>
              )}
            </ul>
            {confirmType === 'itinerary' && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                The existing agenda is not regenerated automatically — open the Agenda page and
                regenerate it after this finishes.
              </p>
            )}
          </div>
        ) : confirmType === 'itinerary' && itinResult ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Quotation <span className="font-mono">{itinResult.quotationNo}</span> —{' '}
              <strong>{itinResult.previousCount}</strong> item(s) replaced with{' '}
              <strong>{itinResult.newCount}</strong>. Regenerate the agenda to apply it.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <ItinColumn label={`Before (${itinResult.previousCount})`} items={itinResult.previous} muted />
              <ItinColumn label={`After (${itinResult.newCount})`} items={itinResult.itineraryItems} />
            </div>
          </div>
        ) : confirmType === 'accommodations' && accResult ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Quotation <span className="font-mono">{accResult.quotationNo}</span> —{' '}
              <strong>{accResult.previousCount}</strong> item(s) replaced with{' '}
              <strong>{accResult.newCount}</strong>.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <AccColumn label={`Before (${accResult.previousCount})`} items={accResult.previous} muted />
              <AccColumn label={`After (${accResult.newCount})`} items={accResult.accommodations} />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Raw API response ───────────────────────────────────────────────── */}
      <Modal
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        title={`Raw AppleSystem Response — ${isNumber || bookingRef}`}
        size="4xl"
        footer={
          <>
            {raw && (
              <Button variant="secondary" onClick={copyRaw} icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}>
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
            )}
            <Button onClick={() => setRawOpen(false)}>Close</Button>
          </>
        }
      >
        {rawLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading from AppleSystem…</p>
        ) : rawError ? (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{rawError}</p>
        ) : raw ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-700 space-y-1">
              <div><span className="text-slate-500">endpoint:</span> {raw.endpoint}</div>
              <div><span className="text-slate-500">body:</span> {JSON.stringify(raw.requestBody)}</div>
              <div>
                <span className="text-slate-500">is_number:</span> {raw.isNumber}
                {raw.statusClass && <span className="ml-3 text-slate-500">status:</span>}
                {raw.statusClass && ` ${raw.statusClass}`}
              </div>
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(raw.raw, null, 2)}
            </pre>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

function ItinColumn({ label, items, muted }: { label: string; items: ItinPreview[]; muted?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-sm text-slate-400">None</p>}
        {items.map((it, i) => (
          <div
            key={`${it.dayNo}-${i}`}
            className={cn('rounded-lg border px-3 py-2', muted ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50')}
          >
            <p className="text-[11px] font-mono text-slate-500">D{it.dayNo} · {it.date}</p>
            <p className="text-xs font-semibold text-slate-800">{it.title}</p>
            {it.description && (
              <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">{it.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AccColumn({ label, items, muted }: { label: string; items: AccPreview[]; muted?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-sm text-slate-400">None</p>}
        {items.map((it, i) => (
          <div
            key={`${it.hotel}-${it.checkIn}-${i}`}
            className={cn('rounded-lg border px-3 py-2', muted ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50')}
          >
            <p className="text-[11px] font-mono text-slate-500">{it.checkIn} → {it.checkOut} · {it.nights}n</p>
            <p className="text-xs font-semibold text-slate-800">
              {it.hotel || <span className="italic text-slate-400">Hotel not specified</span>}
            </p>
            <p className="text-[11px] text-slate-600">
              {it.city}
              {it.roomType ? ` · ${it.roomType}` : ''}
              {it.mealType ? ` · ${it.mealType}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
