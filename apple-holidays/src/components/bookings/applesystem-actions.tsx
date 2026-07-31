'use client'

/**
 * AppleSystem actions for an already-imported booking.
 *
 * Two buttons on the booking detail page:
 *
 *  • "Refetch Itinerary" — re-pulls the quote from AppleSystem and replaces the
 *    stored itinerary. The import path is idempotent, so a booking created
 *    before a mapper fix keeps its stale itinerary and every agenda generated
 *    from it stays wrong; this is the only way to correct one in place. It
 *    overwrites data, so it asks first and shows a before/after diff.
 *
 *  • "Raw API Response" — read-only popup of the untouched
 *    `POST /api/quotation/template/quote` payload for this booking's IS number,
 *    for checking what AppleSystem actually sent.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Code2, Copy, Check } from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { readApiResponse } from '@/lib/utils'

interface ItinPreview {
  dayNo: number
  date: string
  title: string
  description?: string | null
}

interface RefetchResult {
  quotationNo: string
  previousCount: number
  newCount: number
  previous: ItinPreview[]
  itineraryItems: ItinPreview[]
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [refetching, setRefetching] = useState(false)
  const [result, setResult] = useState<RefetchResult | null>(null)

  const [rawOpen, setRawOpen] = useState(false)
  const [rawLoading, setRawLoading] = useState(false)
  const [raw, setRaw] = useState<RawResult | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function doRefetch() {
    setRefetching(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/as-refetch`, { method: 'POST' })
      const json = await readApiResponse<RefetchResult>(res)
      if (!json.success) throw new Error(json.error || 'Refetch failed')
      setResult(json.data ?? null)
      toast.success(json.message || 'Itinerary refetched')
      onRefetched?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refetch failed')
      setConfirmOpen(false)
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
    setConfirmOpen(false)
    setResult(null)
  }

  if (!canRefetch && !canViewRaw) return null

  return (
    <>
      {canRefetch && (
        <button
          onClick={() => { setResult(null); setConfirmOpen(true) }}
          className="btn btn-sm bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 flex items-center gap-1.5"
          title="Re-pull this booking's itinerary from AppleSystem"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refetch Itinerary
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

      {/* ── Refetch: confirm, then show what changed ───────────────────────── */}
      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title={result ? 'Itinerary Refetched' : 'Refetch Itinerary from AppleSystem?'}
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
              AppleSystem and <strong>replaces the stored itinerary</strong> with the current one.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>Every existing itinerary day is deleted and rewritten.</li>
              <li>Any manual edits to the itinerary will be lost.</li>
              <li>
                Dates, pax, pricing and accommodations are <strong>not</strong> touched.
              </li>
            </ul>
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
              The existing agenda is not regenerated automatically — open the Agenda page and
              regenerate it after this finishes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Quotation <span className="font-mono">{result.quotationNo}</span> —{' '}
              <strong>{result.previousCount}</strong> item(s) replaced with{' '}
              <strong>{result.newCount}</strong>. Regenerate the agenda to apply it.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <ItinColumn label={`Before (${result.previousCount})`} items={result.previous} muted />
              <ItinColumn label={`After (${result.newCount})`} items={result.itineraryItems} />
            </div>
          </div>
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

function ItinColumn({ label, items, muted }: { label: string; items: ItinPreview[]; muted?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-sm text-slate-400">None</p>}
        {items.map((it, i) => (
          <div
            key={`${it.dayNo}-${i}`}
            className={`rounded-lg border px-3 py-2 ${muted ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50'}`}
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
