'use client'

/**
 * The option comparison board.
 *
 * Side-by-side quotes for one stay, with the arithmetic that actually decides
 * between them: total for the stay, cost per person per night, variance against
 * the P&L hotel budget, and how long the free-cancellation window is.
 *
 * Selecting requires a reason. The options *not* chosen are kept forever, and
 * together with that reason they are what makes the choice auditable rather
 * than a screenshot in a chat thread.
 */

import { useMemo, useState } from 'react'
import { Check, Star, Trash2 } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMoney, daysBetween, type Numeric } from '@/lib/reservation-shared'
import { MealPlanChip, MoneyVariance, EmptyState, fmtDay } from './reservation-ui'

export interface OptionRow {
  id: string
  hotelName: string
  starRating: number | null
  roomType: string | null
  mealPlan: string
  roomCount: number
  currency: string
  nettRate: Numeric
  totalCost: Numeric
  availability: string
  cancelPolicy: string | null
  freeCancelUntil: string | null
  distanceNote: string | null
  pros: string | null
  cons: string | null
  quoteValidUntil: string | null
  selected: boolean
  selectedReason: string | null
}

interface Props {
  options: OptionRow[]
  nights: number
  pax: number
  budget: Numeric
  /** Locked once the stay is confirmed — the comparison becomes a record. */
  readOnly?: boolean
  onSelect: (optionId: string, reason: string) => Promise<void>
  onRemove: (optionId: string) => Promise<void>
}

type SortKey = 'total' | 'rating' | 'flexibility'

const AVAILABILITY_STYLES: Record<string, string> = {
  AVAILABLE:  'bg-emerald-100 text-emerald-700',
  ON_REQUEST: 'bg-amber-100 text-amber-800',
  FULL:       'bg-red-100 text-red-700',
  UNKNOWN:    'bg-slate-100 text-slate-600',
}

export default function OptionBoard({
  options, nights, pax, budget, readOnly, onSelect, onRemove,
}: Props) {
  const [sort, setSort] = useState<SortKey>('total')
  const [selecting, setSelecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(() => {
    const rows = [...options]
    rows.sort((a, b) => {
      // The chosen option always leads, whatever the sort.
      if (a.selected !== b.selected) return a.selected ? -1 : 1
      if (sort === 'rating') return (b.starRating ?? 0) - (a.starRating ?? 0)
      if (sort === 'flexibility') {
        return freeDays(b.freeCancelUntil) - freeDays(a.freeCancelUntil)
      }
      const at = a.totalCost == null ? Infinity : Number(a.totalCost)
      const bt = b.totalCost == null ? Infinity : Number(b.totalCost)
      return at - bt
    })
    return rows
  }, [options, sort])

  const cheapest = useMemo(() => {
    const totals = options.map(o => (o.totalCost == null ? Infinity : Number(o.totalCost)))
    const min = Math.min(...totals)
    return Number.isFinite(min) ? min : null
  }, [options])

  if (options.length === 0) {
    return (
      <EmptyState
        title="No options yet"
        hint="Add the quotes as they come back from the properties. Keeping the ones you turn down is what makes the final choice defensible."
      />
    )
  }

  async function confirmSelect(id: string) {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onSelect(id, reason.trim())
      setSelecting(null)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">Sort by</span>
        {([['total', 'Total cost'], ['rating', 'Star rating'], ['flexibility', 'Flexibility']] as const).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={cn(
                'rounded-md px-2 py-1 font-medium transition',
                sort === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map(o => {
          const total = o.totalCost == null ? null : Number(o.totalCost)
          const perPaxNight = total !== null && pax > 0 && nights > 0
            ? Math.round((total / (pax * nights)) * 100) / 100
            : null
          const isCheapest = total !== null && cheapest !== null && total === cheapest
          const flexDays = freeDays(o.freeCancelUntil)

          return (
            <div
              key={o.id}
              className={cn(
                'relative rounded-lg border bg-white p-3 shadow-sm transition',
                o.selected ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              {o.selected && (
                <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Check className="h-3 w-3" /> Selected
                </span>
              )}

              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{o.hotelName}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {o.starRating != null && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-500">
                        <Star className="h-3 w-3 fill-current" />{o.starRating}
                      </span>
                    )}
                    <MealPlanChip plan={o.mealPlan as never} />
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', AVAILABILITY_STYLES[o.availability] ?? AVAILABILITY_STYLES.UNKNOWN)}>
                      {o.availability.replace('_', ' ').toLowerCase()}
                    </span>
                  </div>
                </div>
                {!readOnly && !o.selected && (
                  <button
                    onClick={() => onRemove(o.id)}
                    className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                    title="Remove this option"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-1 border-t border-slate-100 pt-2 text-xs">
                <Row label="Total">
                  <MoneyVariance amount={o.totalCost} budget={budget} currency={o.currency} />
                </Row>
                <Row label="Per pax / night">
                  <span className="font-mono tabular-nums text-slate-700">
                    {perPaxNight === null ? '—' : formatMoney(perPaxNight, o.currency)}
                  </span>
                </Row>
                <Row label="Rooms × nights">
                  <span className="text-slate-700">{o.roomCount} × {nights}</span>
                </Row>
                <Row label="Free cancel">
                  <span className={cn(
                    'font-medium',
                    flexDays >= 14 ? 'text-emerald-600' : flexDays >= 7 ? 'text-amber-600' : 'text-red-600',
                  )}>
                    {o.freeCancelUntil ? `${fmtDay(o.freeCancelUntil)} (${flexDays}d)` : 'not captured'}
                  </span>
                </Row>
                {o.quoteValidUntil && (
                  <Row label="Quote valid to">
                    <span className="text-slate-700">{fmtDay(o.quoteValidUntil)}</span>
                  </Row>
                )}
              </div>

              {isCheapest && !o.selected && (
                <div className="mt-2 rounded bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">
                  Lowest total of the {options.length} options
                </div>
              )}

              {(o.pros || o.cons || o.distanceNote) && (
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] leading-relaxed">
                  {o.distanceNote && <p className="text-slate-500">{o.distanceNote}</p>}
                  {o.pros && <p className="text-emerald-700">+ {o.pros}</p>}
                  {o.cons && <p className="text-red-600">− {o.cons}</p>}
                </div>
              )}

              {o.selected && o.selectedReason && (
                <div className="mt-2 rounded bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
                  <span className="font-medium">Chosen because:</span> {o.selectedReason}
                </div>
              )}

              {!readOnly && !o.selected && (
                selecting === o.id ? (
                  <div className="mt-2 space-y-1.5">
                    <input
                      autoFocus
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Why this one? (required)"
                      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => confirmSelect(o.id)} disabled={!reason.trim()} loading={busy}>
                        Select
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setSelecting(null); setReason('') }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => { setSelecting(o.id); setReason('') }}
                  >
                    Select this option
                  </Button>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      {children}
    </div>
  )
}

function freeDays(iso: string | null): number {
  return iso ? daysBetween(new Date(), iso) : -1
}
