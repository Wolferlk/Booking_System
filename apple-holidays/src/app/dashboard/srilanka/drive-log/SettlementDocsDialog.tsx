'use client'

/**
 * The settlement paperwork for one booking — view, edit, save, download.
 *
 * ---- What it is for ----
 *
 * The Sri Lankan desk fills four sheets in by hand for every file: a name board
 * for the arrivals hall, a Transport Settlement, a Local Visit Settlement and a
 * Tour Settlement. Everything printable about them is already in the two
 * systems — the tour number, the dates, the pax, the handler, the driver, the
 * movement chart, the costed attractions, the driver's bank details — so this
 * screen fills the drafts in, lets a human correct them, and prints the pack.
 *
 * ---- Edit on the left, the real sheet on the right ----
 *
 * The preview is not a mock-up of the form: it is the *same renderer* the PDF
 * uses, served as HTML into an iframe. There is one layout, so what is checked
 * on screen is what comes out of the printer. It re-renders a beat after typing
 * stops rather than on every keystroke, because each render is a server call.
 *
 * ---- Saving ----
 *
 * The pack is saved whole, per booking, and a saved pack always wins over the
 * derived draft — these sheets carry approved extras and agreed rates that
 * exist nowhere else, and nothing refreshes them out from under the desk.
 * "Reset to derived" throws the saved version away deliberately, and says so.
 *
 * Downloading does **not** require saving: the pack on screen is posted to the
 * print route and rendered as it stands, so an unsaved correction still prints.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Check, Download, Eye, FileText, Loader2, Plus, RefreshCw, Save,
  Trash2, Undo2, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DOC_BLURB, DOC_KINDS, DOC_LABEL, money, rowId, tourLineTotal, tourTotal, transportTotals,
  type SettlementDocKind, type SettlementDocPack, type SettlementDocState,
} from '@/lib/sl-settlement-docs'

interface DocsResponse extends SettlementDocState {
  canWrite: boolean
}

// ── Small field primitives ────────────────────────────────────────────────────

const LABEL = 'block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1'
const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-100 ' +
  'placeholder:text-slate-600 focus:outline-none focus:border-slate-600 transition-colors'

function Text({
  label, value, onChange, placeholder, mono, area,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  area?: boolean
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {area ? (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={cn(INPUT, 'resize-y leading-relaxed', mono && 'font-mono')}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={cn(INPUT, mono && 'font-mono')}
        />
      )}
    </label>
  )
}

/**
 * A money box.
 *
 * Empty means "nobody has written a figure", which is a different statement
 * from zero on a settlement sheet — so the field keeps its own string and only
 * reports a number when one was actually typed.
 */
function Money({
  label, value, onChange, placeholder,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const seen = useRef(value)

  // Follow the pack when it changes underneath us (load, reset, pull-in), but
  // never fight the person typing.
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setDraft(value === null ? '' : String(value))
    }
  }, [value])

  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder ?? '—'}
        onChange={e => {
          const raw = e.target.value
          setDraft(raw)
          const trimmed = raw.replace(/,/g, '').trim()
          if (trimmed === '') { seen.current = null; onChange(null); return }
          const n = Number(trimmed)
          if (Number.isFinite(n)) { seen.current = n; onChange(n) }
        }}
        className={cn(INPUT, 'text-right tabular-nums')}
      />
    </label>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs font-black text-slate-200 uppercase tracking-wide">{title}</p>
      {hint ? <p className="text-[11px] text-slate-500 mt-0.5 mb-3">{hint}</p> : <div className="mb-3" />}
      {children}
    </div>
  )
}

function RowButton({ onClick, children, tone = 'slate' }: { onClick: () => void; children: React.ReactNode; tone?: 'slate' | 'rose' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors',
        tone === 'rose'
          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
          : 'bg-slate-800/70 border-slate-700 text-slate-200 hover:border-slate-600',
      )}
    >
      {children}
    </button>
  )
}

// ── The editors ───────────────────────────────────────────────────────────────

type Patch = (fn: (p: SettlementDocPack) => SettlementDocPack) => void

function HeaderEditor({ pack, patch }: { pack: SettlementDocPack; patch: Patch }) {
  const set = <K extends keyof SettlementDocPack['header']>(k: K, v: SettlementDocPack['header'][K]) =>
    patch(p => ({ ...p, header: { ...p.header, [k]: v } }))

  return (
    <Section title="Header" hint="Printed at the top of all three settlement forms.">
      <div className="grid grid-cols-2 gap-3">
        <Text label="Tour no" value={pack.header.tourNo} onChange={v => set('tourNo', v)} mono />
        <Money label="No of pax" value={pack.header.pax} onChange={v => set('pax', v)} />
        <label className="block">
          <span className={LABEL}>Arrival</span>
          <input
            type="date"
            value={pack.header.arrivalDate ?? ''}
            onChange={e => set('arrivalDate', e.target.value || null)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Departure</span>
          <input
            type="date"
            value={pack.header.departureDate ?? ''}
            onChange={e => set('departureDate', e.target.value || null)}
            className={INPUT}
          />
        </label>
        <Text label="Tour handler" value={pack.header.tourHandler} onChange={v => set('tourHandler', v)} />
        <Text label="Guide" value={pack.header.guideName} onChange={v => set('guideName', v)} />
        <Text label="Driver" value={pack.header.driverName} onChange={v => set('driverName', v)} />
        <Text label="Vehicle / plate" value={pack.header.vehiclePlate} onChange={v => set('vehiclePlate', v)} mono />
      </div>
    </Section>
  )
}

function NameBoardEditor({ pack, patch }: { pack: SettlementDocPack; patch: Patch }) {
  const nb = pack.nameBoard
  const set = <K extends keyof typeof nb>(k: K, v: (typeof nb)[K]) =>
    patch(p => ({ ...p, nameBoard: { ...p.nameBoard, [k]: v } }))

  return (
    <Section title="Name board" hint="Landscape sheet. The name is printed as large as it fits; everything else is small.">
      <div className="space-y-3">
        <Text label="Guest name" value={nb.guestName} onChange={v => set('guestName', v)} placeholder="Mr & Mrs Perera" />
        <Text label="Line underneath" value={nb.subtitle} onChange={v => set('subtitle', v)} placeholder="Welcome to Sri Lanka" />
        <Text label="Footnote" value={nb.footnote} onChange={v => set('footnote', v)} placeholder="9 pax · UL 504" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={nb.showReference}
            onChange={e => set('showReference', e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-950"
          />
          <span className="text-[11px] text-slate-300 font-bold">Print the tour number in the corner</span>
        </label>
      </div>
    </Section>
  )
}

function TransportEditor({ pack, patch }: { pack: SettlementDocPack; patch: Patch }) {
  const t = pack.transport
  const totals = useMemo(() => transportTotals(t), [t])

  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) =>
    patch(p => ({ ...p, transport: { ...p.transport, [k]: v } }))
  const setTotal = <K extends keyof typeof t.totals>(k: K, v: (typeof t.totals)[K]) =>
    patch(p => ({ ...p, transport: { ...p.transport, totals: { ...p.transport.totals, [k]: v } } }))

  const setLine = (id: string, field: 'date' | 'description' | 'amount', v: string | number | null) =>
    patch(p => ({
      ...p,
      transport: {
        ...p.transport,
        lines: p.transport.lines.map(l => (l.id === id ? { ...l, [field]: v } : l)),
      },
    }))

  return (
    <div className="space-y-4">
      <Section title="Vehicle & package" hint="The package cost comes from the accounts system's transport lines; the rest is agreed with the driver.">
        <div className="grid grid-cols-2 gap-3">
          <Text label="Vehicle type" value={t.vehicleType} onChange={v => set('vehicleType', v)} />
          <Money label="Per km rate" value={t.perKmRate} onChange={v => set('perKmRate', v)} />
          <Money label="Max mileage" value={t.maxMileage} onChange={v => set('maxMileage', v)} />
          <Money label="Km run" value={t.km} onChange={v => set('km', v)} />
          <Money label="Package cost" value={t.packageCost} onChange={v => set('packageCost', v)} />
        </div>
      </Section>

      <Section
        title="Extras claimed"
        hint="One line per movement, prefilled from the tour chart. The amount column is for what is claimed on top of the package — extra mileage, a diversion, an approved detour."
      >
        <div className="space-y-2">
          {t.lines.map(l => (
            <div key={l.id} className="grid grid-cols-[110px_1fr_110px_auto] gap-2 items-start">
              <input
                type="date"
                value={l.date}
                onChange={e => setLine(l.id, 'date', e.target.value)}
                className={INPUT}
              />
              <textarea
                rows={2}
                value={l.description}
                onChange={e => setLine(l.id, 'description', e.target.value)}
                placeholder="Kandy – Nuwara Eliya · ext 120 km × 160 (approved: landslide)"
                className={cn(INPUT, 'resize-y')}
              />
              <input
                type="text"
                inputMode="decimal"
                value={l.amount === null ? '' : String(l.amount)}
                placeholder="—"
                onChange={e => {
                  const raw = e.target.value.replace(/,/g, '').trim()
                  if (raw === '') return setLine(l.id, 'amount', null)
                  const n = Number(raw)
                  if (Number.isFinite(n)) setLine(l.id, 'amount', n)
                }}
                className={cn(INPUT, 'text-right tabular-nums')}
              />
              <button
                type="button"
                onClick={() => patch(p => ({ ...p, transport: { ...p.transport, lines: p.transport.lines.filter(x => x.id !== l.id) } }))}
                className="p-1.5 mt-0.5 text-slate-500 hover:text-rose-300 transition-colors"
                title="Remove this line"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <RowButton onClick={() => patch(p => ({
              ...p,
              transport: { ...p.transport, lines: [...p.transport.lines, { id: rowId('t'), date: '', description: '', amount: null }] },
            }))}>
              <Plus className="w-3 h-3" /> Add line
            </RowButton>
            <span className="text-[11px] text-slate-500">
              Extras <span className="tabular-nums font-bold text-slate-300">{money(totals.extras) || '—'}</span>
            </span>
          </div>
        </div>
      </Section>

      <Section title="Totals" hint="Written exactly as the paper form does — a rate and an amount side by side. Total cost and total amount are added up for you.">
        <div className="grid grid-cols-2 gap-3">
          <Money label="Total mileage rate" value={t.totals.totalMileageRate} onChange={v => setTotal('totalMileageRate', v)} />
          <Money label="Total mileage amount" value={t.totals.totalMileageAmount} onChange={v => setTotal('totalMileageAmount', v)} />
          <Money label="Batta rate" value={t.totals.battaRate} onChange={v => setTotal('battaRate', v)} />
          <Money label="Batta days" value={t.totals.battaCount} onChange={v => setTotal('battaCount', v)} />
          <Money label="Batta amount" value={t.totals.battaAmount} onChange={v => setTotal('battaAmount', v)} />
          <Money label="Highway tickets" value={t.totals.highwayTickets} onChange={v => setTotal('highwayTickets', v)} />
          <Money label="Parking tickets" value={t.totals.parkingTickets} onChange={v => setTotal('parkingTickets', v)} />
          <Money label="Fuel advance" value={t.totals.fuelAdvance} onChange={v => setTotal('fuelAdvance', v)} />
          <Money label="Tour advance" value={t.totals.tourAdvance} onChange={v => setTotal('tourAdvance', v)} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Total cost</p>
            <p className="tabular-nums font-black text-slate-100">{money(totals.totalCost) || '—'}</p>
          </div>
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/25 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400/80 font-bold">Total amount due</p>
            <p className="tabular-nums font-black text-emerald-200">{money(totals.balance) || '—'}</p>
          </div>
        </div>
      </Section>

      <Section title="Payment" hint="Copied from the driver's registered bank details; correct it here if the cheque goes elsewhere.">
        <div className="space-y-3">
          <Text label="Issue the cheque in favour of" value={t.chequeFavour} onChange={v => set('chequeFavour', v)} />
          <Text label="Bank details" value={t.bankDetails} onChange={v => set('bankDetails', v)} area mono />
          <Text label="ID no" value={t.idNo} onChange={v => set('idNo', v)} mono />
          <Text label="Note printed on the sheet" value={t.note} onChange={v => set('note', v)} area />
        </div>
      </Section>
    </div>
  )
}

function LocalVisitEditor({ pack, patch }: { pack: SettlementDocPack; patch: Patch }) {
  const lv = pack.localVisit

  const setShop = (sectionId: string, shopId: string, field: 'name' | 'note', v: string) =>
    patch(p => ({
      ...p,
      localVisit: {
        ...p.localVisit,
        sections: p.localVisit.sections.map(s => s.id !== sectionId ? s : {
          ...s,
          shops: s.shops.map(sh => (sh.id === shopId ? { ...sh, [field]: v } : sh)),
        }),
      },
    }))

  return (
    <div className="space-y-4">
      <Section title="Driver / supplier reference" hint="Printed under the header on the local visit sheet.">
        <Text label="Reference" value={lv.driverRef} onChange={v => patch(p => ({ ...p, localVisit: { ...p.localVisit, driverRef: v } }))} mono />
      </Section>

      {lv.sections.map(sec => (
        <Section key={sec.id} title={sec.title || 'Untitled stop'}>
          <div className="space-y-2">
            <input
              type="text"
              value={sec.title}
              onChange={e => patch(p => ({
                ...p,
                localVisit: { ...p.localVisit, sections: p.localVisit.sections.map(s => s.id === sec.id ? { ...s, title: e.target.value } : s) },
              }))}
              className={cn(INPUT, 'font-bold')}
              placeholder="Stop name"
            />
            {sec.shops.map(shop => (
              <div key={shop.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  type="text"
                  value={shop.name}
                  onChange={e => setShop(sec.id, shop.id, 'name', e.target.value)}
                  placeholder="Shop"
                  className={INPUT}
                />
                <input
                  type="text"
                  value={shop.note}
                  onChange={e => setShop(sec.id, shop.id, 'note', e.target.value)}
                  placeholder="Left blank for the shop to sign and seal"
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() => patch(p => ({
                    ...p,
                    localVisit: {
                      ...p.localVisit,
                      sections: p.localVisit.sections.map(s => s.id !== sec.id ? s : { ...s, shops: s.shops.filter(x => x.id !== shop.id) }),
                    },
                  }))}
                  className="p-1.5 text-slate-500 hover:text-rose-300 transition-colors"
                  title="Remove this shop"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <RowButton onClick={() => patch(p => ({
                ...p,
                localVisit: {
                  ...p.localVisit,
                  sections: p.localVisit.sections.map(s => s.id !== sec.id ? s : { ...s, shops: [...s.shops, { id: rowId('shop'), name: '', note: '' }] }),
                },
              }))}>
                <Plus className="w-3 h-3" /> Add shop
              </RowButton>
              <RowButton
                tone="rose"
                onClick={() => patch(p => ({
                  ...p,
                  localVisit: { ...p.localVisit, sections: p.localVisit.sections.filter(s => s.id !== sec.id) },
                }))}
              >
                <Trash2 className="w-3 h-3" /> Remove stop
              </RowButton>
            </div>
          </div>
        </Section>
      ))}

      <div className="flex items-center justify-between">
        <RowButton onClick={() => patch(p => ({
          ...p,
          localVisit: { ...p.localVisit, sections: [...p.localVisit.sections, { id: rowId('sec'), title: '', shops: [{ id: rowId('shop'), name: '', note: '' }] }] },
        }))}>
          <Plus className="w-3 h-3" /> Add stop
        </RowButton>
      </div>

      <Section title="Note">
        <Text label="Printed at the foot" value={lv.note} onChange={v => patch(p => ({ ...p, localVisit: { ...p.localVisit, note: v } }))} area />
      </Section>
    </div>
  )
}

function TourEditor({ pack, patch }: { pack: SettlementDocPack; patch: Patch }) {
  const to = pack.tour
  const total = useMemo(() => tourTotal(to), [to])

  const setLine = (id: string, field: 'name' | 'perPersonRate' | 'count' | 'totalCost', v: string | number | null) =>
    patch(p => ({ ...p, tour: { ...p.tour, lines: p.tour.lines.map(l => (l.id === id ? { ...l, [field]: v } : l)) } }))

  const numberCell = (id: string, field: 'perPersonRate' | 'count' | 'totalCost', value: number | null, placeholder: string) => (
    <input
      type="text"
      inputMode="decimal"
      value={value === null ? '' : String(value)}
      placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value.replace(/,/g, '').trim()
        if (raw === '') return setLine(id, field, null)
        const n = Number(raw)
        if (Number.isFinite(n)) setLine(id, field, n)
      }}
      className={cn(INPUT, 'text-right tabular-nums')}
    />
  )

  return (
    <div className="space-y-4">
      <Section title="Who ran the tour">
        <div className="grid grid-cols-2 gap-3">
          <Text label="Guide name" value={to.guideName} onChange={v => patch(p => ({ ...p, tour: { ...p.tour, guideName: v } }))} />
          <Text label="Chauffeur name" value={to.chauffeurName} onChange={v => patch(p => ({ ...p, tour: { ...p.tour, chauffeurName: v } }))} />
        </div>
      </Section>

      <Section
        title="Entrance tickets"
        hint="Prefilled from the attraction lines the accounts system costed. Leave the total blank to have it read rate × count."
      >
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_100px_70px_110px_auto] gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
            <span>Item</span><span className="text-right">Per person</span><span className="text-right">Count</span><span className="text-right">Total</span><span />
          </div>
          {to.lines.map(l => (
            <div key={l.id} className="grid grid-cols-[1fr_100px_70px_110px_auto] gap-2 items-center">
              <input
                type="text"
                value={l.name}
                onChange={e => setLine(l.id, 'name', e.target.value)}
                placeholder="Sigiriya"
                className={INPUT}
              />
              {numberCell(l.id, 'perPersonRate', l.perPersonRate, '—')}
              {numberCell(l.id, 'count', l.count, '—')}
              {numberCell(l.id, 'totalCost', l.totalCost, money(tourLineTotal(l)) || '—')}
              <button
                type="button"
                onClick={() => patch(p => ({ ...p, tour: { ...p.tour, lines: p.tour.lines.filter(x => x.id !== l.id) } }))}
                className="p-1.5 text-slate-500 hover:text-rose-300 transition-colors"
                title="Remove this line"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <RowButton onClick={() => patch(p => ({
              ...p,
              tour: { ...p.tour, lines: [...p.tour.lines, { id: rowId('e'), name: '', perPersonRate: null, count: p.header.pax, totalCost: null }] },
            }))}>
              <Plus className="w-3 h-3" /> Add ticket
            </RowButton>
            <span className="text-[11px] text-slate-400">
              Total tour cost <span className="tabular-nums font-black text-slate-100">{money(total) || '—'}</span>
            </span>
          </div>
        </div>
      </Section>

      <Section title="Note">
        <Text label="Printed at the foot" value={to.note} onChange={v => patch(p => ({ ...p, tour: { ...p.tour, note: v } }))} area />
      </Section>
    </div>
  )
}

// ── The dialog ────────────────────────────────────────────────────────────────

export function SettlementDocsDialog({
  bookingRef, title, onClose,
}: {
  bookingRef: string
  /** What the row calls this booking — shown in the heading while it loads. */
  title: string
  onClose: () => void
}) {
  const [state, setState]   = useState<DocsResponse | null>(null)
  const [pack, setPack]     = useState<SettlementDocPack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [tab, setTab]       = useState<SettlementDocKind>('name_board')
  const [dirty, setDirty]   = useState(false)
  const [busy, setBusy]     = useState<'save' | 'reset' | 'download' | null>(null)

  const [preview, setPreview]         = useState<string | null>(null)
  const [previewing, setPreviewing]   = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // ── Load ──
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    fetch(`/api/srilanka/drive-log/documents?ref=${encodeURIComponent(bookingRef)}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error ?? 'The documents could not be loaded')
        return json.data as DocsResponse
      })
      .then(data => {
        if (cancelled) return
        setState(data); setPack(data.pack); setDirty(false)
      })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [bookingRef])

  const patch: Patch = useCallback(fn => {
    setPack(p => (p ? fn(p) : p))
    setDirty(true)
  }, [])

  // ── Preview ──
  //
  // Rendered by the same code as the PDF, a beat after typing stops. The
  // request id guard is the usual one: a slow render must never overwrite a
  // newer one's answer, or the pane would show a sheet that has been edited since.
  const previewId = useRef(0)

  const renderPreview = useCallback(async (p: SettlementDocPack, kind: SettlementDocKind) => {
    const id = ++previewId.current
    setPreviewing(true); setPreviewError(null)
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents/print?ref=${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: p, docs: kind, format: 'html' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? 'The preview could not be rendered')
      }
      const html = await res.text()
      if (id === previewId.current) setPreview(html)
    } catch (err) {
      if (id === previewId.current) setPreviewError((err as Error).message)
    } finally {
      if (id === previewId.current) setPreviewing(false)
    }
  }, [bookingRef])

  useEffect(() => {
    if (!pack) return
    const t = setTimeout(() => { renderPreview(pack, tab) }, 500)
    return () => clearTimeout(t)
  }, [pack, tab, renderPreview])

  // ── Save / reset / download ──

  const save = async () => {
    if (!pack) return
    setBusy('save')
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents?ref=${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The documents could not be saved')
      const data = json.data as DocsResponse
      setState(data); setPack(data.pack); setDirty(false)
      toast.success('Documents saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    if (!confirm('Throw away the saved version of these documents and go back to the figures the systems derive? Anything typed in — approved extras, batta, signatures — is lost.')) return
    setBusy('reset')
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents?ref=${encodeURIComponent(bookingRef)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The saved documents could not be cleared')
      const data = json.data as DocsResponse
      setState(data); setPack(data.pack); setDirty(false)
      toast.success('Back to the derived draft')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** `kinds` empty means the whole pack — one PDF, board first. */
  const download = async (kinds: SettlementDocKind[]) => {
    if (!pack) return
    setBusy('download')
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents/print?ref=${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack, docs: kinds.join(','), format: 'pdf' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? 'The download could not be generated')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const stem = (pack.header.tourNo || pack.bookingRef).replace(/[^A-Za-z0-9_-]+/g, '-')
      a.href = url
      a.download = kinds.length === 1 ? `${stem}-${kinds[0]}.pdf` : `${stem}-settlement-documents.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success(kinds.length === 1 ? `${DOC_LABEL[kinds[0]]} downloaded` : 'All four documents downloaded')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Pull one field's derived value back in.
   *
   * Offered per document rather than for the whole pack: a desk that has spent
   * ten minutes on the transport extras should be able to refresh the tour
   * tickets without losing them.
   */
  const pullDerived = (kind: SettlementDocKind) => {
    if (!state) return
    patch(p => {
      const d = state.derived
      switch (kind) {
        case 'name_board':  return { ...p, nameBoard: d.nameBoard }
        case 'transport':   return { ...p, transport: { ...d.transport, note: p.transport.note } }
        case 'local_visit': return { ...p, localVisit: d.localVisit }
        case 'tour':        return { ...p, tour: { ...d.tour, note: p.tour.note } }
      }
    })
    toast.success(`${DOC_LABEL[kind]} reset to the derived figures`)
  }

  const canWrite = state?.canWrite ?? false

  return (
    <>
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-3 md:inset-6 z-50 flex flex-col rounded-2xl bg-[#0c1225] border border-slate-800 shadow-2xl shadow-black/60 overflow-hidden">

        {/* ── Head ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center">
            <FileText className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base truncate">Settlement documents · {title}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {loading ? 'Loading…'
                : state?.saved
                  ? `Saved version${state.savedBy ? ` by ${state.savedBy}` : ''}${state.savedAt ? ` · ${new Date(state.savedAt).toLocaleString('en-GB', { hour12: false })}` : ''}`
                  : 'Draft — filled in from the booking and the accounts figures, not saved yet'}
              {dirty ? <span className="text-amber-300 font-bold"> · unsaved changes</span> : null}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canWrite ? (
              <>
                <button
                  onClick={reset}
                  disabled={!!busy || loading || !state?.saved}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-40"
                  title="Throw the saved version away"
                >
                  {busy === 'reset' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Reset
                </button>
                <button
                  onClick={save}
                  disabled={!!busy || loading || !pack}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs font-bold text-sky-300 hover:bg-sky-500/20 transition-colors disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                </button>
              </>
            ) : null}
            <button
              onClick={() => download([tab])}
              disabled={!!busy || loading || !pack}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> This sheet
            </button>
            <button
              onClick={() => download([...DOC_KINDS])}
              disabled={!!busy || loading || !pack}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-xs font-bold text-yellow-300 hover:bg-yellow-500/20 transition-colors disabled:opacity-40"
            >
              {busy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download all
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-800 flex-shrink-0 overflow-x-auto">
          {DOC_KINDS.map(k => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-[11px] font-bold whitespace-nowrap transition-colors',
                tab === k
                  ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200'
                  : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700',
              )}
            >
              {DOC_LABEL[k]}
            </button>
          ))}
          <span className="ml-2 text-[11px] text-slate-600 hidden lg:block">{DOC_BLURB[tab]}</span>
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading the booking and the accounts figures…
          </div>
        ) : error || !pack ? (
          <div className="flex-1 flex items-center justify-center px-8">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-center gap-2 max-w-lg">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error ?? 'These documents could not be built.'}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(380px,44%)_1fr]">

            {/* Editor */}
            <div className="overflow-y-auto px-5 py-4 space-y-4 border-r border-slate-800">
              {state?.notices?.length ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 space-y-1">
                  {state.notices.map((n, i) => (
                    <p key={i} className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {n}</p>
                  ))}
                </div>
              ) : null}

              {!canWrite ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                  You may print these sheets but not change them — editing is for the operations desk, Accounts
                  and admins. Anything you type here prints, but will not be saved.
                </div>
              ) : null}

              {tab === 'name_board' ? (
                <NameBoardEditor pack={pack} patch={patch} />
              ) : (
                <>
                  <HeaderEditor pack={pack} patch={patch} />
                  {tab === 'transport'   ? <TransportEditor  pack={pack} patch={patch} /> : null}
                  {tab === 'local_visit' ? <LocalVisitEditor pack={pack} patch={patch} /> : null}
                  {tab === 'tour'        ? <TourEditor       pack={pack} patch={patch} /> : null}
                </>
              )}

              <div className="flex items-center justify-between pt-1 pb-4">
                <RowButton onClick={() => pullDerived(tab)}>
                  <RefreshCw className="w-3 h-3" /> Refill from the systems
                </RowButton>
                <span className="text-[10px] text-slate-600">
                  Rupees. A blank box prints blank — never as a zero.
                </span>
              </div>
            </div>

            {/* Preview */}
            <div className="relative bg-slate-800/40 overflow-hidden hidden lg:block">
              <div className="absolute top-2 left-3 z-10 flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                <Eye className="w-3 h-3" /> Exactly what will print
                {previewing ? <Loader2 className="w-3 h-3 animate-spin text-slate-500" /> : <Check className="w-3 h-3 text-emerald-400/70" />}
              </div>
              {previewError ? (
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{previewError}</div>
                </div>
              ) : null}
              {preview ? (
                <iframe
                  title="Document preview"
                  srcDoc={preview}
                  // Sandboxed with nothing granted: the preview is a static
                  // rendering and has no business running script or navigating.
                  sandbox=""
                  className="w-full h-full bg-white pt-7"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Rendering…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
