'use client'

/**
 * AppleSystem actions for an already-imported booking.
 *
 * Two buttons on the booking detail page:
 *
 *  • "Fetch Data from API" — opens a picker for what to re-pull from
 *    AppleSystem: the whole booking (dates, pax, agent, totals, terms,
 *    itinerary, hotels, guest), or just the itinerary / just the hotels.
 *    Flights is disabled because the AppleSystem quote payload never carries
 *    flight data — see `flights: never[]` in `as-booking-map.ts`. The import
 *    path is idempotent, so a booking whose upstream quotation was amended
 *    after confirmation keeps the old copy forever; this is the only way to
 *    correct it in place. It overwrites data, so it asks first and shows a
 *    before/after diff.
 *
 *    The full sync never writes workflow state — status, tickets, driver
 *    allocation, client confirmation, QC and the operation checklist are all
 *    left exactly as they are. See `src/lib/as-booking-sync.ts`.
 *
 *    The time of the last successful full sync is shown next to the button.
 *
 *  • "Raw API Response" — read-only popup of the untouched
 *    `POST /api/quotation/template/quote` payload for this booking's IS number,
 *    for checking what AppleSystem actually sent.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Code2, Copy, Check, Plane, Hotel, Map, Lock, ShieldCheck } from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { readApiResponse, cn } from '@/lib/utils'

type FetchType = 'full' | 'itinerary' | 'accommodations'

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

interface FieldChange {
  field: string
  from: string | null
  to: string | null
}

interface SectionChange {
  section: 'itinerary' | 'accommodations' | 'passengers' | 'emergencyContacts'
  previousCount: number
  newCount: number
  skipped?: string
}

interface FullSyncResult {
  bookingRef: string
  quotationNo: string | null
  revision: number | null
  fields: FieldChange[]
  sections: SectionChange[]
  unchanged: boolean
  syncedAt: string
}

interface LastSync {
  at: string
  by: string
  mode: 'manual' | 'prearrival'
  quotationNo: string | null
  revision: number | null
  changed: string[]
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
    type: 'full',
    label: 'Everything (full booking sync)',
    description:
      'Dates, pax, agent, file handler, totals, terms, itinerary, hotels and guest details. ' +
      'Workflow status, tickets, drivers and confirmations are not touched.',
    icon: RefreshCw,
  },
  {
    type: 'itinerary',
    label: 'Itinerary only',
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
  const [fullResult, setFullResult] = useState<FullSyncResult | null>(null)

  const [lastSync, setLastSync] = useState<LastSync | null>(null)

  const [rawOpen, setRawOpen] = useState(false)
  const [rawLoading, setRawLoading] = useState(false)
  const [raw, setRaw] = useState<RawResult | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // "Last updated from API" marker. Loaded once; refreshed after every sync so
  // the pill is right without a page reload.
  const loadLastSync = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/as-sync`)
      const json = await readApiResponse<{ lastSync: LastSync | null }>(res)
      if (json.success) setLastSync(json.data?.lastSync ?? null)
    } catch {
      /* the pill is informational — a failed load just leaves it hidden */
    }
  }, [bookingRef])

  useEffect(() => {
    if (canRefetch || canViewRaw) void loadLastSync()
  }, [canRefetch, canViewRaw, loadLastSync])

  function pick(type: FetchType) {
    setPickerOpen(false)
    setItinResult(null)
    setAccResult(null)
    setFullResult(null)
    setConfirmType(type)
  }

  async function doRefetch() {
    if (!confirmType) return
    setRefetching(true)
    try {
      const endpoint =
        confirmType === 'full' ? 'as-sync'
        : confirmType === 'itinerary' ? 'as-refetch'
        : 'as-refetch-accommodations'
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/${endpoint}`, { method: 'POST' })
      if (confirmType === 'full') {
        const json = await readApiResponse<FullSyncResult>(res)
        if (!json.success) throw new Error(json.error || 'Sync failed')
        setFullResult(json.data ?? null)
        if (json.data?.unchanged) toast.info(json.message || 'Already up to date')
        else toast.success(json.message || 'Booking updated from AppleSystem')
      } else if (confirmType === 'itinerary') {
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
      void loadLastSync()
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
    setFullResult(null)
  }

  if (!canRefetch && !canViewRaw) return null

  const result =
    confirmType === 'full' ? fullResult
    : confirmType === 'itinerary' ? itinResult
    : confirmType === 'accommodations' ? accResult
    : null

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

      {lastSync && (
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
          title={`Last full sync from AppleSystem: ${fmtDateTime(lastSync.at)} by ${lastSync.by}${
            lastSync.changed.length ? ` — changed: ${lastSync.changed.join(', ')}` : ' — nothing changed'
          }`}
        >
          <RefreshCw className="w-3 h-3 text-slate-400" />
          <span>
            API updated <span className="font-semibold text-slate-700">{relTimeAgo(lastSync.at)}</span>
            {lastSync.mode === 'prearrival' && <span className="ml-1 text-slate-400">(auto)</span>}
          </span>
        </span>
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
          confirmType === 'full'
            ? (fullResult ? 'Booking Synced from AppleSystem' : 'Sync the whole booking from AppleSystem?')
            : result
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
              <Button loading={refetching} onClick={doRefetch}>
                {confirmType === 'full' ? 'Fetch & Update' : 'Refetch & Replace'}
              </Button>
            </>
          )
        }
      >
        {!result && confirmType === 'full' ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              This re-pulls <span className="font-mono font-semibold">{isNumber || bookingRef}</span> from
              AppleSystem and updates <strong>this booking&apos;s details</strong> to match what
              AppleSystem currently holds.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Updated</p>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-600">
                <li>Arrival &amp; departure dates, pax counts</li>
                <li>Agent, file handler, CNTL / IS number</li>
                <li>Quoted total &amp; currency</li>
                <li>Terms, inclusions, exclusions, value-added services</li>
                <li>Itinerary and hotels (replaced with the current ones)</li>
                <li>Guest &amp; emergency contact — only if none are recorded yet</li>
              </ul>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                <ShieldCheck className="w-3.5 h-3.5" /> Never touched
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-emerald-900">
                <li>Booking status and the operation checklist</li>
                <li>Tickets, driver allocation, agenda and P&amp;L</li>
                <li>Client verification, QC passes and confirmations</li>
                <li>Anything AppleSystem sends blank keeps its current value</li>
              </ul>
            </div>
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
              Manual edits to the itinerary and hotel rows are overwritten, and the agenda is not
              regenerated automatically — open the Agenda page afterwards if the dates moved.
            </p>
          </div>
        ) : !result ? (
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
        ) : confirmType === 'full' && fullResult ? (
          <FullSyncSummary result={fullResult} />
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

/** Human labels for the booking columns a sync can change. */
const FIELD_LABELS: Record<string, string> = {
  isNumber: 'IS number',
  cntlNumber: 'CNTL number',
  agent: 'Agent',
  fileHandler: 'File handler',
  arrivalDate: 'Arrival date',
  departureDate: 'Departure date',
  paxAdults: 'Adults',
  paxChildren: 'Children',
  quotedTotal: 'Quoted total',
  currency: 'Currency',
  terms: 'Terms & conditions',
  packageIncludes: 'Package includes',
  packageExcludes: 'Package excludes',
  valueAddedServices: 'Value-added services',
  contactEmail: 'Contact email',
}

const SECTION_LABELS: Record<SectionChange['section'], string> = {
  itinerary: 'Itinerary',
  accommodations: 'Hotels',
  passengers: 'Guests',
  emergencyContacts: 'Emergency contacts',
}

/** "2026-08-21T09:14:00Z" → "21 Aug 2026, 09:14". */
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Coarse "how long ago" label — the pill only needs the order of magnitude. */
function relTimeAgo(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDateTime(iso)
}

/**
 * What the full sync actually did: the scalar fields it rewrote (with
 * before/after), then one line per child collection — including the ones it
 * deliberately left alone and why.
 */
function FullSyncSummary({ result }: { result: FullSyncResult }) {
  const longValue = (v: string | null) => (v ?? '').length > 60

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Quotation <span className="font-mono">{result.quotationNo || '—'}</span>
        {result.revision != null && <span className="text-slate-500"> · rev {result.revision}</span>}
        {' — '}
        {result.unchanged
          ? 'this booking already matched AppleSystem. Nothing was changed.'
          : `${result.fields.length} field(s) updated.`}
      </p>

      {result.fields.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold">Before</th>
                <th className="px-3 py-2 font-semibold">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.fields.map((f) => (
                <tr key={f.field} className="align-top">
                  <td className="px-3 py-2 font-semibold text-slate-800">
                    {FIELD_LABELS[f.field] ?? f.field}
                  </td>
                  <td className={cn('px-3 py-2 text-slate-500', longValue(f.from) && 'max-w-[18rem]')}>
                    <span className="line-clamp-3 whitespace-pre-wrap">{f.from ?? <em className="text-slate-400">empty</em>}</span>
                  </td>
                  <td className={cn('px-3 py-2 font-medium text-emerald-700', longValue(f.to) && 'max-w-[18rem]')}>
                    <span className="line-clamp-3 whitespace-pre-wrap">{f.to ?? <em className="text-slate-400">empty</em>}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {result.sections.map((sec) => (
          <div
            key={sec.section}
            className={cn(
              'rounded-lg border px-3 py-2',
              sec.skipped ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50',
            )}
          >
            <p className="text-xs font-semibold text-slate-800">
              {SECTION_LABELS[sec.section]}{' '}
              <span className="font-normal text-slate-500">
                {sec.skipped ? `${sec.previousCount} kept` : `${sec.previousCount} → ${sec.newCount}`}
              </span>
            </p>
            {sec.skipped && <p className="mt-0.5 text-[11px] text-slate-500">{sec.skipped}</p>}
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
        Booking status, the operation checklist, tickets, driver allocation, agenda, P&amp;L and all
        confirmations were left untouched by this sync.
      </p>
    </div>
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
