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
 *    correct it in place. Nothing is written until the operator has seen it:
 *    the first call is a dry run that lists every proposed change with its
 *    before/after, each with a checkbox, and only the ticked ones are applied.
 *    If AppleSystem moved between preview and apply the server refuses and
 *    hands back a fresh preview to review instead.
 *
 *    The full sync never writes workflow state — status, tickets, driver
 *    allocation, client confirmation, QC and the operation checklist are all
 *    left exactly as they are. See `src/lib/as-booking-sync.ts`.
 *
 *    The time of the last successful full sync is shown next to the button.
 *
 *    A package/notes field that somebody edited on the booking page is never
 *    overwritten silently: the sync parks AppleSystem's version and this
 *    component asks, field by field, whether to replace the edit or skip it.
 *    Nothing is written for those fields until that answer comes back. The
 *    prompt also appears on load for conflicts raised by the automatic
 *    pre-arrival sync, which has nobody to ask at the time it runs.
 *
 *  • "Raw API Response" — read-only popup of the untouched
 *    `POST /api/quotation/template/quote` payload for this booking's IS number,
 *    for checking what AppleSystem actually sent.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Code2, Copy, Check, Plane, Hotel, Map, Lock, ShieldCheck, AlertTriangle, PenLine, Users } from 'lucide-react'
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

interface SyncConflict {
  field: string
  stored: string | null
  incoming: string
  editedAt: string
  editedBy: string
}

interface PendingConflicts {
  at: string
  quotationNo: string | null
  revision: number | null
  items: SyncConflict[]
}

type Decision = 'replace' | 'skip'

interface FullSyncResult {
  bookingRef: string
  quotationNo: string | null
  revision: number | null
  fields: FieldChange[]
  sections: SectionChange[]
  /** Hand-edited fields the sync refused to overwrite, awaiting a decision. */
  conflicts: SyncConflict[]
  unchanged: boolean
  syncedAt: string
  preview: boolean
  fingerprint: string
  declined: string[]
  itinerary?: { previous: ItinPreview[]; next: ItinPreview[] }
  accommodations?: { previous: AccPreview[]; next: AccPreview[] }
  seed?: { passengers: string[]; emergencyContacts: string[] }
}

/** Ticked changes on the review screen, keyed `f:<field>`, `c:<field>`, `s:<section>`. */
type Picks = Record<string, boolean>

/** Which proposed changes a picker option shows. */
function inScope(type: FetchType, key: string): boolean {
  if (type === 'full') return true
  return key === (type === 'itinerary' ? 's:itinerary' : 's:accommodations')
}

/** Every change in a preview this scope can show, keyed as in {@link Picks}. */
function reviewKeys(type: FetchType, r: FullSyncResult): string[] {
  return [
    ...r.fields.map((f) => `f:${f.field}`),
    ...r.conflicts.map((c) => `c:${c.field}`),
    ...r.sections.filter((s) => !s.skipped).map((s) => `s:${s.section}`),
  ].filter((k) => inScope(type, k))
}

/**
 * Default ticks: every plain change on, every hand-edited field off — an edit
 * made here is only overwritten when somebody says so.
 */
function defaultPicks(type: FetchType, r: FullSyncResult): Picks {
  return Object.fromEntries(reviewKeys(type, r).map((k) => [k, !k.startsWith('c:')]))
}

interface LastSync {
  at: string
  by: string
  mode: 'manual' | 'prearrival'
  quotationNo: string | null
  revision: number | null
  changed: string[]
  pending?: string[]
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

  // Review flow: pick a scope → dry-run preview → tick changes → apply.
  const [confirmType, setConfirmType] = useState<FetchType | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FullSyncResult | null>(null)
  const [picks, setPicks] = useState<Picks>({})
  const [refetching, setRefetching] = useState(false)
  const [fullResult, setFullResult] = useState<FullSyncResult | null>(null)

  const [lastSync, setLastSync] = useState<LastSync | null>(null)

  // Hand-edited fields AppleSystem disagrees with. Held separately from the
  // sync result because the pre-arrival sync raises them too, with nobody in
  // front of the screen — those are waiting here on the next page load.
  const [pending, setPending] = useState<PendingConflicts | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [resolving, setResolving] = useState(false)

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
      const json = await readApiResponse<{ lastSync: LastSync | null; pendingConflicts: PendingConflicts | null }>(res)
      if (json.success) {
        setLastSync(json.data?.lastSync ?? null)
        setPending(json.data?.pendingConflicts ?? null)
      }
    } catch {
      /* the pill is informational — a failed load just leaves it hidden */
    }
  }, [bookingRef])

  useEffect(() => {
    if (canRefetch || canViewRaw) void loadLastSync()
  }, [canRefetch, canViewRaw, loadLastSync])

  const syncUrl = `/api/bookings/${encodeURIComponent(bookingRef)}/as-sync`

  async function loadPreview(type: FetchType) {
    setPreviewing(true)
    setPreviewError(null)
    try {
      const res = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      const json = await readApiResponse<FullSyncResult>(res)
      if (!json.success || !json.data) throw new Error(json.error || 'Could not load the changes from AppleSystem')
      setPreview(json.data)
      setPicks(defaultPicks(type, json.data))
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Could not load the changes from AppleSystem')
    } finally {
      setPreviewing(false)
    }
  }

  function pick(type: FetchType) {
    setPickerOpen(false)
    setPreview(null)
    setFullResult(null)
    setPicks({})
    setConfirmType(type)
    void loadPreview(type)
  }

  async function applySelected() {
    if (!confirmType || !preview) return
    const ticked = (prefix: string) =>
      Object.entries(picks).filter(([k, on]) => on && k.startsWith(prefix)).map(([k]) => k.slice(2))
    // Only a full review shows the hand-edited fields, so only there does an
    // unticked one count as "keep mine"; otherwise it stays waiting.
    const keptConflicts = confirmType === 'full'
      ? preview.conflicts.map((c) => c.field).filter((f) => !picks[`c:${f}`])
      : []

    setRefetching(true)
    try {
      const res = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection: {
            fields: ticked('f:'),
            conflicts: ticked('c:'),
            sections: ticked('s:'),
            keptConflicts,
            fingerprint: preview.fingerprint,
          },
        }),
      })
      const json = await readApiResponse<FullSyncResult>(res)
      if (res.status === 409 && json.data?.preview) {
        // AppleSystem or the booking moved since the preview — re-review.
        setPreview(json.data)
        setPicks(defaultPicks(confirmType, json.data))
        toast.warning(json.error || 'AppleSystem changed — please review again')
        return
      }
      if (!json.success || !json.data) throw new Error(json.error || 'Update failed')
      setFullResult(json.data)
      const raised = json.data.conflicts
      setPending(
        raised.length > 0
          ? {
              at: json.data.syncedAt,
              quotationNo: json.data.quotationNo,
              revision: json.data.revision,
              items: raised,
            }
          : null,
      )
      setDecisions({})
      if (json.data.unchanged) toast.info(json.message || 'Nothing was changed')
      else toast.success(json.message || 'Booking updated from AppleSystem')
      onRefetched?.()
      void loadLastSync()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setRefetching(false)
    }
  }

  function openConflicts() {
    // Nothing is preselected: each field is an explicit answer, so a stray
    // "Apply" can never silently overwrite an edit nobody looked at.
    setDecisions({})
    setConflictOpen(true)
  }

  async function applyDecisions() {
    if (!pending) return
    setResolving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/as-sync/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      })
      const json = await readApiResponse<{ pending: PendingConflicts | null }>(res)
      if (!json.success) throw new Error(json.error || 'Could not apply those decisions')
      setPending(json.data?.pending ?? null)
      setDecisions({})
      setConflictOpen(false)
      toast.success(json.message || 'Decisions applied')
      onRefetched?.()
      void loadLastSync()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not apply those decisions')
    } finally {
      setResolving(false)
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
    setPreview(null)
    setPreviewError(null)
    setPicks({})
    setFullResult(null)
  }

  if (!canRefetch && !canViewRaw) return null

  const scopeLabel =
    confirmType === 'itinerary' ? 'itinerary'
    : confirmType === 'accommodations' ? 'hotels'
    : 'booking'
  const visibleKeys = confirmType && preview ? reviewKeys(confirmType, preview) : []
  const pickedCount = visibleKeys.filter((k) => picks[k]).length

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

      {canRefetch && pending && pending.items.length > 0 && (
        <button
          onClick={openConflicts}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
          title="AppleSystem sent different text for fields that were edited here — choose replace or skip"
        >
          <AlertTriangle className="w-3 h-3" />
          {pending.items.length} edited field{pending.items.length === 1 ? '' : 's'} need a decision
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
            You will see every change first and choose which ones to apply.
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

      {/* ── Review: preview every change, tick which to apply ──────────────── */}
      <Modal
        open={confirmType !== null}
        onClose={closeConfirm}
        title={
          fullResult
            ? 'Booking Updated from AppleSystem'
            : `Review ${scopeLabel} changes from AppleSystem`
        }
        size="4xl"
        footer={
          fullResult ? (
            <>
              {fullResult.conflicts.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => { closeConfirm(); openConflicts() }}
                  icon={<AlertTriangle className="w-3.5 h-3.5" />}
                >
                  Resolve {fullResult.conflicts.length} edited field{fullResult.conflicts.length === 1 ? '' : 's'}
                </Button>
              )}
              <Button onClick={closeConfirm}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closeConfirm} disabled={refetching}>
                {visibleKeys.length ? 'Cancel — change nothing' : 'Close'}
              </Button>
              {visibleKeys.length > 0 && (
                <Button loading={refetching} disabled={pickedCount === 0 || previewing} onClick={applySelected}>
                  Accept {pickedCount} of {visibleKeys.length} change{visibleKeys.length === 1 ? '' : 's'}
                </Button>
              )}
            </>
          )
        }
      >
        {fullResult ? (
          <FullSyncSummary result={fullResult} onResolve={() => { closeConfirm(); openConflicts() }} />
        ) : previewing ? (
          <p className="py-10 text-center text-sm text-slate-500">
            <RefreshCw className="mr-2 inline w-4 h-4 animate-spin" />
            Checking <span className="font-mono">{isNumber || bookingRef}</span> against AppleSystem…
          </p>
        ) : previewError ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{previewError}</p>
            <Button variant="secondary" onClick={() => confirmType && loadPreview(confirmType)}>Try again</Button>
          </div>
        ) : preview && confirmType ? (
          <ChangeReview
            type={confirmType}
            preview={preview}
            picks={picks}
            onToggle={(k) => setPicks((p) => ({ ...p, [k]: !p[k] }))}
            onAll={(on) => setPicks(Object.fromEntries(visibleKeys.map((k) => [k, on])))}
          />
        ) : null}
      </Modal>

      {/* ── Replace or skip: fields edited here that AppleSystem disagrees with ── */}
      <Modal
        open={conflictOpen}
        onClose={() => setConflictOpen(false)}
        title="Edited fields — replace or skip?"
        size="4xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflictOpen(false)} disabled={resolving}>
              Decide later
            </Button>
            <Button
              loading={resolving}
              disabled={!pending || pending.items.some((i) => !decisions[i.field])}
              onClick={applyDecisions}
            >
              Apply {Object.keys(decisions).length || ''} decision{Object.keys(decisions).length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        {pending && pending.items.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              These fields were edited here after they came from AppleSystem, and quotation{' '}
              <span className="font-mono">{pending.quotationNo || '—'}</span> now says something different.
              <strong> Nothing has been written for them.</strong> Choose one per field — skipping keeps the
              edit and asks again on the next fetch.
            </p>

            {pending.items.map((item) => {
              const choice = decisions[item.field]
              return (
                <div key={item.field} className="rounded-lg border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {FIELD_LABELS[item.field] ?? item.field}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <PenLine className="w-3 h-3" />
                      Edited by {item.editedBy} · {fmtDateTime(item.editedAt)}
                    </p>
                  </div>
                  <div className="grid gap-3 p-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setDecisions((d) => ({ ...d, [item.field]: 'skip' }))}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left transition-colors',
                        choice === 'skip'
                          ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                          : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50',
                      )}
                    >
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Skip — keep this (edited here)
                      </p>
                      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-700">
                        {item.stored ?? <em className="text-slate-400">empty</em>}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisions((d) => ({ ...d, [item.field]: 'replace' }))}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left transition-colors',
                        choice === 'replace'
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                          : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50',
                      )}
                    >
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Replace — take AppleSystem&apos;s version
                      </p>
                      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-700">
                        {item.incoming}
                      </p>
                    </button>
                  </div>
                </div>
              )
            })}

            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              Replacing also hands the field back to AppleSystem — later syncs will update it without
              asking, until somebody edits it here again.
            </p>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">Nothing is waiting for a decision.</p>
        )}
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
function FullSyncSummary({ result, onResolve }: { result: FullSyncResult; onResolve: () => void }) {
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
        {result.declined.length > 0 && (
          <span className="text-slate-500"> {result.declined.length} change(s) you did not accept were left as they were.</span>
        )}
      </p>

      {result.conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5" />
            {result.conflicts.length} field(s) edited here were left untouched
          </p>
          <p className="mt-1 text-[11px] text-amber-900">
            AppleSystem sent different text for{' '}
            {result.conflicts.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ')}. Nothing was
            written for them — each one needs a replace or skip.
          </p>
          <button
            onClick={onResolve}
            className="mt-2 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
          >
            Review them now
          </button>
        </div>
      )}

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

/**
 * The dry-run preview with a checkbox per change. Plain fields come first as a
 * table, then hand-edited fields (unticked by default), then the collections
 * that would be replaced or seeded, each expandable to its before/after rows.
 */
function ChangeReview({
  type,
  preview,
  picks,
  onToggle,
  onAll,
}: {
  type: FetchType
  preview: FullSyncResult
  picks: Picks
  onToggle: (key: string) => void
  onAll: (on: boolean) => void
}) {
  const fields = type === 'full' ? preview.fields : []
  const conflicts = type === 'full' ? preview.conflicts : []
  const changing = preview.sections.filter((s) => !s.skipped && inScope(type, `s:${s.section}`))
  const unchanged = preview.sections.filter((s) => s.skipped && inScope(type, `s:${s.section}`))
  const total = fields.length + conflicts.length + changing.length

  const box = (key: string) => (
    <input
      type="checkbox"
      checked={!!picks[key]}
      onChange={() => onToggle(key)}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-700">
          Quotation <span className="font-mono">{preview.quotationNo || '—'}</span>
          {preview.revision != null && <span className="text-slate-500"> · rev {preview.revision}</span>}
          {' — '}
          {total === 0
            ? 'this already matches AppleSystem. There is nothing to update.'
            : <><strong>{total}</strong> change{total === 1 ? '' : 's'} found. <strong>Nothing has been saved yet</strong> — tick the ones to accept.</>}
        </p>
        {total > 1 && (
          <div className="flex gap-1.5 text-[11px]">
            <button onClick={() => onAll(true)} className="rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50">Select all</button>
            <button onClick={() => onAll(false)} className="rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50">Select none</button>
          </div>
        )}
      </div>

      {fields.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold">Current</th>
                <th className="px-3 py-2 font-semibold">AppleSystem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((f) => {
                const key = `f:${f.field}`
                const on = !!picks[key]
                return (
                  <tr
                    key={f.field}
                    onClick={() => onToggle(key)}
                    className={cn('cursor-pointer align-top', on ? 'bg-emerald-50/40' : 'opacity-60 hover:opacity-100')}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{box(key)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{FIELD_LABELS[f.field] ?? f.field}</td>
                    <td className="max-w-[18rem] px-3 py-2 text-slate-500">
                      <span className={cn('line-clamp-3 whitespace-pre-wrap', on && 'line-through decoration-red-300')}>
                        {f.from ?? <em className="text-slate-400">empty</em>}
                      </span>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2 font-medium text-emerald-700">
                      <span className="line-clamp-3 whitespace-pre-wrap">{f.to ?? <em className="text-slate-400">empty</em>}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5" />
            Edited here by hand — left unticked so your edit is kept unless you choose otherwise
          </p>
          {conflicts.map((c) => {
            const key = `c:${c.field}`
            return (
              <label key={c.field} className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2', picks[key] ? 'border-emerald-300 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40')}>
                {box(key)}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                    Replace {FIELD_LABELS[c.field] ?? c.field} with AppleSystem&apos;s version
                    <span className="flex items-center gap-1 text-[11px] font-normal text-slate-500">
                      <PenLine className="w-3 h-3" /> edited by {c.editedBy} · {fmtDateTime(c.editedAt)}
                    </span>
                  </p>
                  <div className="mt-1.5 grid gap-2 md:grid-cols-2">
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                      <span className="block text-[10px] font-semibold uppercase text-slate-400">Current (edited here)</span>
                      {c.stored ?? <em className="text-slate-400">empty</em>}
                    </p>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-emerald-200 bg-white px-2 py-1 text-[11px] text-emerald-800">
                      <span className="block text-[10px] font-semibold uppercase text-slate-400">AppleSystem</span>
                      {c.incoming}
                    </p>
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      )}

      {changing.map((sec) => {
        const key = `s:${sec.section}`
        const verb = sec.section === 'itinerary' || sec.section === 'accommodations' ? 'Replace' : 'Add'
        return (
          <div key={sec.section} className={cn('rounded-lg border', picks[key] ? 'border-emerald-300' : 'border-slate-200')}>
            <label className={cn('flex cursor-pointer items-start gap-3 px-3 py-2', picks[key] ? 'bg-emerald-50/60' : 'bg-slate-50')}>
              {box(key)}
              <span className="flex-1 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                  {sec.section === 'itinerary' ? <Map className="w-3.5 h-3.5" />
                    : sec.section === 'accommodations' ? <Hotel className="w-3.5 h-3.5" />
                    : <Users className="w-3.5 h-3.5" />}
                  {verb} {SECTION_LABELS[sec.section].toLowerCase()}
                  <span className="font-normal text-slate-500">
                    {verb === 'Replace' ? `${sec.previousCount} → ${sec.newCount} rows` : `${sec.newCount} from AppleSystem`}
                  </span>
                </span>
                {verb === 'Replace' && (
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Manual edits to these rows are replaced; hotel address/contact and itinerary inclusions are carried across.
                  </span>
                )}
              </span>
            </label>
            {sec.section === 'itinerary' && preview.itinerary && (
              <div className="grid gap-4 border-t border-slate-100 p-3 md:grid-cols-2">
                <ItinColumn label={`Current (${preview.itinerary.previous.length})`} items={preview.itinerary.previous} muted />
                <ItinColumn label={`AppleSystem (${preview.itinerary.next.length})`} items={preview.itinerary.next} />
              </div>
            )}
            {sec.section === 'accommodations' && preview.accommodations && (
              <div className="grid gap-4 border-t border-slate-100 p-3 md:grid-cols-2">
                <AccColumn label={`Current (${preview.accommodations.previous.length})`} items={preview.accommodations.previous} muted />
                <AccColumn label={`AppleSystem (${preview.accommodations.next.length})`} items={preview.accommodations.next} />
              </div>
            )}
            {(sec.section === 'passengers' || sec.section === 'emergencyContacts') && preview.seed && (
              <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-600">
                {preview.seed[sec.section].join(', ') || '—'}
              </p>
            )}
          </div>
        )
      })}

      {unchanged.length > 0 && (
        <p className="text-[11px] text-slate-500">
          No change: {unchanged.map((s) => `${SECTION_LABELS[s.section]} (${s.skipped})`).join(' · ')}
        </p>
      )}

      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
        <ShieldCheck className="mr-1 inline w-3.5 h-3.5" />
        Unticked changes are left exactly as they are. Booking status, the operation checklist, tickets,
        drivers, agenda, P&amp;L and confirmations are never touched. The agenda is not regenerated —
        open the Agenda page afterwards if the itinerary or dates changed.
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
