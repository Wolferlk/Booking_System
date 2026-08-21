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
  AlertTriangle, Check, CheckCircle2, Circle, Download, Eye, FileText, ImagePlus, ListPlus,
  Loader2, MessageCircle, Plus, RefreshCw, Save, Search, Tags, Trash2, Undo2, Upload, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SendDocsWhatsAppDialog } from './SendDocsWhatsAppDialog'
import {
  BUILTIN_LOGOS, DEFAULT_LOGO, DEFAULT_ORIENTATION, DOC_BLURB, DOC_KINDS, DOC_LABEL,
  NAME_BOARD_ACCENTS, NAME_BOARD_THEMES, SUB_LOGOS, catalogLine, missingCatalogItems, money,
  orientationOf, rowId, tourLineTotal, tourTotal, transportTotals,
  type DocOrientation, type NameBoardTheme, type SettlementDocKind, type SettlementDocPack,
  type SettlementDocState, type TourLine,
} from '@/lib/sl-settlement-docs'
import { TICKET_GROUP_OF, TOUR_TICKET_GROUPS, normaliseTicketName } from '@/lib/sl-tour-tickets'

/** Where a line the desk typed in itself is grouped — it is in no catalogue. */
const ADDED_HERE = 'Added on this sheet'

/**
 * Print a document with the browser this page is open in.
 *
 * Used when the server has no Chromium to render a PDF with. The document goes
 * into an off-screen same-origin iframe and that frame is printed, so the print
 * job is the settlement pack alone — not this dark dialog around it, and with
 * no window for a pop-up blocker to stop.
 *
 * Deliberately *not* sandboxed, unlike the preview pane: `print()` on a
 * sandboxed frame is refused, and this is our own server-rendered document with
 * no script in it. The frame is left in place until the print job is done
 * because removing it early cancels the job in every browser.
 */
function printInBrowser(html: string): Promise<void> {
  return new Promise(resolve => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
    frame.srcdoc = html

    let done = false
    const cleanUp = () => {
      if (done) return
      done = true
      frame.remove()
      resolve()
    }

    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) { cleanUp(); return }
      win.addEventListener('afterprint', cleanUp)
      // A last resort: Safari never fires `afterprint` for an iframe, and a
      // dialog left open for two minutes has been answered one way or another.
      setTimeout(cleanUp, 120_000)
      win.focus()
      win.print()
      resolve()
    }

    document.body.appendChild(frame)
  })
}

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

/**
 * Which way up this sheet prints.
 *
 * The defaults are the paper the desk already uses — the name board landscape
 * because it is held up in an arrivals hall, the three settlement forms
 * portrait — and they are what a booking gets without anybody touching this.
 * It is here because paper is occasionally not standard: a narrow board stand,
 * an itinerary that wants the wider sheet. The choice is part of the pack, so
 * it is kept by Save like everything else on these documents and comes back the
 * same way next time the file is opened.
 */
function OrientationPicker({
  kind, pack, patch, canWrite,
}: {
  kind: SettlementDocKind
  pack: SettlementDocPack
  patch: Patch
  canWrite: boolean
}) {
  const current = orientationOf(pack, kind)
  const fallback = DEFAULT_ORIENTATION[kind]

  const set = (v: DocOrientation) => {
    if (!canWrite) return
    patch(p => ({ ...p, layout: { ...DEFAULT_ORIENTATION, ...p.layout, [kind]: v } }))
  }

  const options: { id: DocOrientation; label: string; w: string; h: string }[] = [
    { id: 'portrait',  label: 'Portrait',  w: 'w-6', h: 'h-8' },
    { id: 'landscape', label: 'Landscape', w: 'w-8', h: 'h-6' },
  ]

  return (
    <Section
      title="Paper"
      hint={`A4, printed ${fallback} for this sheet unless you turn it round. Saved with the documents.`}
    >
      <div className="flex items-center gap-2">
        {options.map(o => {
          const on = current === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => set(o.id)}
              disabled={!canWrite}
              className={cn(
                'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left disabled:opacity-50',
                on
                  ? 'bg-yellow-500/10 border-yellow-500/40'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700',
              )}
            >
              <span
                className={cn(
                  'rounded-sm border-2 flex-shrink-0',
                  o.w, o.h,
                  on ? 'border-yellow-400/80 bg-yellow-400/10' : 'border-slate-600 bg-slate-800/60',
                )}
              />
              <span className="min-w-0">
                <span className={cn('block text-[11px] font-bold', on ? 'text-yellow-200' : 'text-slate-300')}>
                  {o.label}
                  {on ? <Check className="w-3 h-3 inline ml-1 -mt-px" /> : null}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {o.id === fallback ? 'Default for this sheet' : 'A4, turned round'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {current !== fallback && canWrite ? (
        <div className="mt-2.5">
          <RowButton onClick={() => set(fallback)}>
            <Undo2 className="w-3 h-3" /> Back to {fallback}
          </RowButton>
        </div>
      ) : null}
    </Section>
  )
}

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

/** A logo as the gallery lists it. */
interface GalleryLogo { url: string; label: string; uploadedAt?: string | null }

/**
 * The marks the board may be printed with.
 *
 * The gallery is the bucket, read once when the board tab is opened: whatever
 * anyone has uploaded is what everyone may choose from, so a logo added for one
 * booking is on the next person's list without anything being seeded or synced.
 */
function useLogoGallery(active: boolean) {
  const [builtin, setBuiltin]   = useState<GalleryLogo[]>(BUILTIN_LOGOS)
  const [uploaded, setUploaded] = useState<GalleryLogo[]>([])
  const [canUpload, setCanUpload] = useState(false)
  const [loading, setLoading]   = useState(false)
  const asked = useRef(false)

  useEffect(() => {
    if (!active || asked.current) return
    asked.current = true
    setLoading(true)
    fetch('/api/srilanka/drive-log/documents/logos')
      .then(r => r.json())
      .then(json => {
        const d = json?.data
        if (!d) return
        if (Array.isArray(d.builtin)) setBuiltin(d.builtin)
        if (Array.isArray(d.uploaded)) setUploaded(d.uploaded)
        setCanUpload(!!d.canUpload)
      })
      .catch(() => { /* the built-in marks are still selectable offline */ })
      .finally(() => setLoading(false))
  }, [active])

  const add = useCallback((logo: GalleryLogo) => {
    setUploaded(prev => [logo, ...prev.filter(l => l.url !== logo.url)])
  }, [])

  return { builtin, uploaded, canUpload, loading, add }
}

/** A switch. Reads as on/off across the room, which a checkbox does not. */
function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 text-left group"
    >
      <span
        className={cn(
          'relative w-9 h-5 rounded-full flex-shrink-0 transition-colors',
          checked ? 'bg-emerald-500/80' : 'bg-slate-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold text-slate-200 group-hover:text-white transition-colors">{label}</span>
        {hint ? <span className="block text-[10px] text-slate-500 leading-snug">{hint}</span> : null}
      </span>
    </button>
  )
}

/** A miniature of one layout, drawn in the chosen accent. */
function ThemeSwatch({ theme, accent }: { theme: NameBoardTheme; accent: string }) {
  const bar = { background: accent }
  return (
    <span className="block h-12 rounded-md bg-white overflow-hidden relative border border-slate-300">
      {theme === 'ribbon' ? (
        <>
          <span className="absolute inset-x-0 top-0 h-3" style={bar} />
          <span className="absolute inset-x-0 bottom-0 h-1.5" style={bar} />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-14 rounded-sm bg-slate-800" />
        </>
      ) : theme === 'frame' ? (
        <>
          <span className="absolute inset-1 border" style={{ borderColor: accent }} />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-12 rounded-sm bg-slate-800" />
        </>
      ) : theme === 'minimal' ? (
        <>
          <span className="absolute left-2 top-2 h-1.5 w-5 rounded-sm bg-slate-300" />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-16 rounded-sm bg-slate-800" />
          <span className="absolute left-2 bottom-2.5 h-1 w-8 rounded-sm" style={bar} />
        </>
      ) : (
        <>
          <span className="absolute inset-x-0 top-0 h-1" style={bar} />
          <span
            className="absolute inset-0"
            style={{ background: `radial-gradient(60% 60% at 50% 45%, ${accent}22, #fff 70%)` }}
          />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-16 rounded-sm bg-slate-800" />
          <span className="absolute left-1/2 bottom-2.5 -translate-x-1/2 h-1 w-6 rounded-sm" style={bar} />
        </>
      )}
    </span>
  )
}

/**
 * The name board editor.
 *
 * The board is the one sheet in the pack a *guest* sees, so it is the one sheet
 * worth dressing: the desk picks a layout, a colour and the mark at the top,
 * and the preview beside it is the real print. Everything here is stored on the
 * pack, so a board that was got right once prints the same way next time.
 */
function NameBoardEditor({ pack, patch, canWrite }: { pack: SettlementDocPack; patch: Patch; canWrite: boolean }) {
  const nb = pack.nameBoard
  const set = <K extends keyof typeof nb>(k: K, v: (typeof nb)[K]) =>
    patch(p => ({ ...p, nameBoard: { ...p.nameBoard, [k]: v } }))

  const gallery = useLogoGallery(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const current = nb.logoUrl ?? DEFAULT_LOGO

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/srilanka/drive-log/documents/logos', { method: 'POST', body })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The logo could not be uploaded')
      const logo = json.data.logo as GalleryLogo
      gallery.add(logo)
      set('logoUrl', logo.url)
      toast.success('Logo added to the gallery')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const logos: GalleryLogo[] = [...gallery.builtin, ...gallery.uploaded]

  return (
    <div className="space-y-4">
      {/* What it says */}
      <Section title="What the board says" hint="Read from ten metres away — the name is printed as large as it fits.">
        <div className="space-y-3">
          <label className="block">
            <span className={LABEL}>Guest name</span>
            <input
              type="text"
              value={nb.guestName}
              placeholder="Mr & Mrs Perera"
              onChange={e => set('guestName', e.target.value)}
              className={cn(INPUT, 'text-base font-black py-2.5 tracking-tight')}
            />
          </label>
          <Text label="Line underneath" value={nb.subtitle} onChange={v => set('subtitle', v)} placeholder="Welcome to Sri Lanka" />
          <Text label="Footnote" value={nb.footnote} onChange={v => set('footnote', v)} placeholder="9 pax · UL 504" />
          <div className="pt-1">
            <Toggle
              checked={nb.showReference}
              onChange={v => set('showReference', v)}
              label="Print the tour number in the corner"
              hint="Leave off for a guest who should not see a booking reference."
            />
          </div>
        </div>
      </Section>

      {/* Layout */}
      <Section title="Board design" hint="Four dressings of the same sheet. The name stays the same size in all of them.">
        <div className="grid grid-cols-2 gap-2.5">
          {NAME_BOARD_THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('theme', t.id)}
              className={cn(
                'rounded-xl border p-2 text-left transition-all',
                nb.theme === t.id
                  ? 'border-yellow-500/60 bg-yellow-500/10 ring-1 ring-yellow-500/30'
                  : 'border-slate-800 bg-slate-950/50 hover:border-slate-700',
              )}
            >
              <ThemeSwatch theme={t.id} accent={nb.accent} />
              <span className="mt-2 flex items-center gap-1.5">
                <span className={cn('text-[11px] font-black', nb.theme === t.id ? 'text-yellow-200' : 'text-slate-200')}>
                  {t.label}
                </span>
                {nb.theme === t.id ? <Check className="w-3 h-3 text-yellow-300" /> : null}
              </span>
              <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">{t.blurb}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <span className={LABEL}>Accent colour</span>
          <div className="flex flex-wrap items-center gap-2">
            {NAME_BOARD_ACCENTS.map(a => (
              <button
                key={a.value}
                type="button"
                title={a.label}
                onClick={() => set('accent', a.value)}
                className={cn(
                  'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center',
                  nb.accent.toLowerCase() === a.value.toLowerCase() ? 'border-white' : 'border-slate-700',
                )}
                style={{ background: a.value }}
              >
                {nb.accent.toLowerCase() === a.value.toLowerCase()
                  ? <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                  : null}
              </button>
            ))}
            <label className="ml-1 inline-flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">
              <input
                type="color"
                value={nb.accent}
                onChange={e => set('accent', e.target.value)}
                className="w-7 h-7 rounded-full bg-transparent border border-slate-700 cursor-pointer p-0"
              />
              Custom
            </label>
          </div>
        </div>
      </Section>

      {/* Logos */}
      <Section title="Logo" hint="Printed large at the top of the board. Upload one and it stays in the gallery for everyone.">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-24 h-16 rounded-xl bg-white border border-slate-700 flex items-center justify-center p-2 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current} alt="" className="max-h-full max-w-full object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-slate-200 truncate">
              {logos.find(l => l.url === current)?.label ?? 'Selected logo'}
            </p>
            <p className="text-[10px] text-slate-500 truncate">{current}</p>
            {nb.logoUrl && nb.logoUrl !== DEFAULT_LOGO ? (
              <button
                type="button"
                onClick={() => set('logoUrl', null)}
                className="mt-1 text-[10px] font-bold text-slate-400 hover:text-white underline underline-offset-2"
              >
                Back to the default mark
              </button>
            ) : (
              <p className="mt-1 text-[10px] text-emerald-400/80 font-bold">House default</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {logos.map(l => (
            <button
              key={l.url}
              type="button"
              title={l.label}
              onClick={() => set('logoUrl', l.url === DEFAULT_LOGO ? null : l.url)}
              className={cn(
                'h-14 rounded-lg bg-white border p-1.5 flex items-center justify-center transition-all',
                current === l.url ? 'border-yellow-400 ring-2 ring-yellow-400/40' : 'border-slate-700 hover:border-slate-400',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.url} alt={l.label} className="max-h-full max-w-full object-contain" />
            </button>
          ))}

          {canWrite && gallery.canUpload ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-14 rounded-lg border border-dashed border-slate-700 hover:border-yellow-500/60 hover:text-yellow-300 text-slate-400 flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-50"
            >
              {uploading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ImagePlus className="w-4 h-4" />}
              <span className="text-[9px] font-bold uppercase tracking-wide">{uploading ? 'Saving' : 'Add logo'}</span>
            </button>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) upload(f)
          }}
        />
        {gallery.loading ? (
          <p className="mt-2 text-[10px] text-slate-500 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Reading the gallery…
          </p>
        ) : (
          <p className="mt-2 text-[10px] text-slate-600 flex items-center gap-1.5">
            <Upload className="w-3 h-3" /> PNG, JPEG or WebP, under 3 MB. Uploads are kept in the bucket.
          </p>
        )}
      </Section>

      {/* House marks */}
      <Section title="House marks" hint="The small row along the foot of the board.">
        <Toggle
          checked={nb.showSubLogos}
          onChange={v => set('showSubLogos', v)}
          label="Show the aahaas and Apple Holidays marks"
          hint="Printed small at the bottom, whichever logo is large at the top."
        />
        <div className={cn('mt-3 flex items-center gap-3 transition-opacity', nb.showSubLogos ? 'opacity-100' : 'opacity-30')}>
          {SUB_LOGOS.map(url => (
            <span key={url} className="h-9 px-2 rounded-lg bg-white border border-slate-700 flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="max-h-6 max-w-[70px] object-contain" />
            </span>
          ))}
        </div>
      </Section>
    </div>
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

// ── Tour settlement ───────────────────────────────────────────────────────────

/**
 * The shared rate card, opened over the sheet.
 *
 * Every Tour Settlement in the office settles the same thirty-odd gates, and
 * until now each handler retyped the prices from memory — which is how one
 * attraction ends up settled at three rates in a week. This panel is that price
 * list, edited once and read by every sheet opened afterwards.
 *
 * Editing the card never reaches back into a booking that has already been
 * saved: "Fill blanks" and "Overwrite rates" are buttons somebody presses, on
 * the sheet in front of them.
 */
interface RateRow {
  name: string
  adultRate: number | null
  childRate: number | null
  note: string
  group: string | null
  inCatalog: boolean
  updatedAt: string | null
  updatedBy: string | null
}

/** A figure typed into a small grid cell. Empty stays empty — it is not zero. */
function CellNumber({
  value, onChange, placeholder, className, disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const seen = useRef(value)

  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setDraft(value === null ? '' : String(value))
    }
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      placeholder={placeholder ?? '—'}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        const trimmed = raw.replace(/,/g, '').trim()
        if (trimmed === '') { seen.current = null; onChange(null); return }
        const n = Number(trimmed)
        if (Number.isFinite(n)) { seen.current = n; onChange(n) }
      }}
      className={cn(INPUT, 'text-right tabular-nums px-2 py-1', className)}
    />
  )
}

function RateCardPanel({
  canWrite, onFill, onClose,
}: {
  canWrite: boolean
  onFill: (rates: RateRow[], mode: 'blanks' | 'all') => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<RateRow[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/srilanka/drive-log/documents/rate-card')
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error ?? 'The rate card could not be loaded')
        return json.data as { rates: RateRow[]; notice: string | null }
      })
      .then(data => {
        if (cancelled) return
        setRows(data.rates)
        setNotice(data.notice)
      })
      .catch(err => {
        if (cancelled) return
        setRows([])
        toast.error((err as Error).message)
      })
    return () => { cancelled = true }
  }, [])

  const set = (name: string, field: 'adultRate' | 'childRate', v: number | null) => {
    setDirty(true)
    setRows(rs => (rs ?? []).map(r => (r.name === name ? { ...r, [field]: v } : r)))
  }

  const save = async () => {
    if (!rows || !canWrite) return
    setSaving(true)
    try {
      const res = await fetch('/api/srilanka/drive-log/documents/rate-card', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: rows.map(r => ({ name: r.name, adultRate: r.adultRate, childRate: r.childRate, note: r.note })) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The rate card could not be saved')
      setRows(json.data.rates as RateRow[])
      setNotice(json.data.notice ?? null)
      setDirty(false)
      toast.success('Rate card saved — every sheet opened from now on starts from these prices')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const shown = useMemo(() => {
    const list = rows ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter(r => r.name.toLowerCase().includes(needle))
  }, [rows, q])

  const priced = (rows ?? []).filter(r => r.adultRate !== null || r.childRate !== null).length

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 md:inset-x-24 lg:inset-x-40 z-[61] flex flex-col rounded-2xl bg-[#0c1225] border border-slate-700 shadow-2xl shadow-black/70 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
            <Tags className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm">Entrance rate card</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              The gate price for every attraction, shared by every booking. {priced} of {(rows ?? []).length} priced.
            </p>
          </div>
          <div className="relative hidden sm:block">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Find an attraction"
              className={cn(INPUT, 'pl-8 w-56')}
            />
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {notice ? (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {notice}
            </div>
          ) : null}

          {rows === null ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading the rate card…
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_110px_110px] gap-2 px-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold sticky top-0 bg-[#0c1225] py-1">
                <span>Attraction</span>
                <span className="text-right">Adult rate</span>
                <span className="text-right">Child rate</span>
              </div>
              {shown.map(r => {
                const on = r.adultRate !== null || r.childRate !== null
                return (
                  <div
                    key={r.name}
                    className={cn(
                      'grid grid-cols-[1fr_110px_110px] gap-2 items-center rounded-lg px-2 py-1 border border-transparent',
                      on ? 'bg-slate-900/60 border-slate-800' : 'hover:bg-slate-900/40',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn('block text-xs truncate', on ? 'text-slate-100 font-bold' : 'text-slate-500')}>
                        {r.name}
                      </span>
                      <span className="block text-[10px] text-slate-600 truncate">
                        {r.group ?? 'Added by the desk'}
                        {r.updatedBy ? ` · ${r.updatedBy}` : ''}
                      </span>
                    </span>
                    <CellNumber value={r.adultRate} onChange={v => set(r.name, 'adultRate', v)} disabled={!canWrite} />
                    <CellNumber value={r.childRate} onChange={v => set(r.name, 'childRate', v)} disabled={!canWrite} />
                  </div>
                )
              })}
              {shown.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">Nothing matches “{q}”.</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
            <RowButton onClick={() => { onFill(rows ?? [], 'blanks'); onClose() }}>
              <Plus className="w-3 h-3" /> Fill blanks on this sheet
            </RowButton>
            <RowButton onClick={() => { onFill(rows ?? [], 'all'); onClose() }}>
              <RefreshCw className="w-3 h-3" /> Overwrite this sheet&rsquo;s rates
            </RowButton>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600 hidden md:inline">
              Saved rates are shared. This booking&rsquo;s figures stay with this booking.
            </span>
            <button
              type="button"
              onClick={save}
              disabled={!canWrite || saving || !dirty || rows === null}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors',
                canWrite && dirty
                  ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
                  : 'bg-slate-800/60 border border-slate-700 text-slate-500 cursor-not-allowed',
              )}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save rate card
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The Tour Settlement editor.
 *
 * The sheet is the whole catalogue of attractions, not a blank list: the ones
 * this tour took are lit and bold, the ones it did not stay faded underneath so
 * a handler scanning the sheet can see what was considered. Typing any figure
 * on a faded line lights it — nobody prices a ticket they are not settling —
 * and the toggle puts it back.
 *
 * Adults and children are priced apart because every gate in the country
 * charges that way. Both counts come off the booking's own P&L split and both
 * are editable, because a child who turned twelve mid-tour is charged as an
 * adult at the gate.
 */
function TourEditor({ pack, patch, canWrite }: { pack: SettlementDocPack; patch: Patch; canWrite: boolean }) {
  const to = pack.tour
  const total = useMemo(() => tourTotal(to), [to])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const [rateCard, setRateCard] = useState(false)

  const adults   = pack.header.paxAdults
  const children = pack.header.paxChildren

  const setDoc = (changes: Partial<SettlementDocPack['tour']>) =>
    patch(p => ({ ...p, tour: { ...p.tour, ...changes } }))

  const setLine = (id: string, changes: Partial<TourLine>) =>
    patch(p => ({ ...p, tour: { ...p.tour, lines: p.tour.lines.map(l => (l.id === id ? { ...l, ...changes } : l)) } }))

  /**
   * A figure typed onto a line lights it.
   *
   * Pricing a ticket you are not settling is not a thing anybody does, and
   * making the desk reach for a separate toggle first is the kind of friction
   * that sends people back to the spreadsheet. Clearing figures never puts a
   * line out again — only the toggle does, because deactivating a line the
   * moment its last box is emptied would fight somebody retyping a rate.
   */
  const setFigure = (l: TourLine, field: 'perPersonRate' | 'count' | 'childRate' | 'childCount' | 'totalCost', v: number | null) =>
    setLine(l.id, { [field]: v, ...(v !== null && !l.active ? { active: true } : {}) })

  const toggle = (l: TourLine) => {
    // Lighting a line with no counts on it fills them from the booking, which
    // is what the handler was about to type anyway.
    const counts = l.active ? {} : {
      count:      l.count      ?? (l.perPersonRate !== null ? adults : null),
      childCount: l.childCount ?? (l.childRate !== null ? children : null),
    }
    setLine(l.id, { active: !l.active, ...counts })
  }

  /** The sheet, grouped the way a handler thinks about a day. */
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const order = [...TOUR_TICKET_GROUPS.map(g => g.title), ADDED_HERE]
    const buckets = new Map<string, TourLine[]>(order.map(t => [t, []]))

    for (const l of to.lines) {
      if (filter === 'on' && !l.active) continue
      if (filter === 'off' && l.active) continue
      if (needle && !l.name.toLowerCase().includes(needle)) continue
      const title = TICKET_GROUP_OF[l.name] ?? ADDED_HERE
      const bucket = buckets.get(title)
      if (bucket) bucket.push(l)
      else buckets.set(title, [l])
    }
    return Array.from(buckets.entries()).filter(([, ls]) => ls.length > 0)
  }, [to.lines, q, filter])

  const settled = to.lines.filter(l => l.active)
  const missing = useMemo(() => missingCatalogItems(to.lines), [to.lines])

  /** Push the shared card's prices onto this sheet. */
  const fillFromCard = (rates: RateRow[], mode: 'blanks' | 'all') => {
    const card = new Map(rates.map(r => [normaliseTicketName(r.name), r]))
    let touched = 0
    patch(p => ({
      ...p,
      tour: {
        ...p.tour,
        lines: p.tour.lines.map(l => {
          const r = card.get(normaliseTicketName(l.name))
          if (!r) return l
          const next = { ...l }
          if (r.adultRate !== null && (mode === 'all' || l.perPersonRate === null)) next.perPersonRate = r.adultRate
          if (r.childRate !== null && (mode === 'all' || l.childRate === null)) next.childRate = r.childRate
          if (next.perPersonRate !== l.perPersonRate || next.childRate !== l.childRate) touched++
          return next
        }),
      },
    }))
    toast.success(touched ? `${touched} line${touched === 1 ? '' : 's'} priced from the rate card` : 'Nothing on this sheet needed a rate')
  }

  /** The booking's split, onto every line that is priced for that half. */
  const applyPax = () => {
    patch(p => ({
      ...p,
      tour: {
        ...p.tour,
        lines: p.tour.lines.map(l => (!l.active ? l : {
          ...l,
          count:      l.perPersonRate !== null ? p.header.paxAdults   : l.count,
          childCount: l.childRate     !== null ? p.header.paxChildren : l.childCount,
        })),
      },
    }))
    toast.success('Pax counts taken from the booking')
  }

  const chip = (id: 'all' | 'on' | 'off', label: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={cn(
        'px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors',
        filter === id
          ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200'
          : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700',
      )}
    >
      {label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      {rateCard ? (
        <RateCardPanel canWrite={canWrite} onFill={fillFromCard} onClose={() => setRateCard(false)} />
      ) : null}

      <Section title="Who ran the tour">
        <div className="grid grid-cols-2 gap-3">
          <Text label="Guide name" value={to.guideName} onChange={v => setDoc({ guideName: v })} />
          <Text label="Chauffeur name" value={to.chauffeurName} onChange={v => setDoc({ chauffeurName: v })} />
        </div>
      </Section>

      <Section
        title="Who is being charged for"
        hint="Adults and children off the booking's own P&L split. Every gate prices them apart, so the sheet does too."
      >
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          <Money label="Adults" value={adults} onChange={v => patch(p => ({ ...p, header: { ...p.header, paxAdults: v, pax: (v ?? 0) + (p.header.paxChildren ?? 0) || null } }))} />
          <Money label="Children" value={children} onChange={v => patch(p => ({ ...p, header: { ...p.header, paxChildren: v, pax: (p.header.paxAdults ?? 0) + (v ?? 0) || null } }))} />
          <div>
            <span className={LABEL}>Total pax</span>
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 tabular-nums text-right">
              {pack.header.pax ?? '—'}
            </div>
          </div>
          <RowButton onClick={applyPax}>
            <Users className="w-3 h-3" /> Use on every settled line
          </RowButton>
        </div>
      </Section>

      <Section
        title="Entrance tickets"
        hint="The whole catalogue is on the sheet. Price a line and it lights up and totals; leave it faded and it is not charged."
      >
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Find an attraction"
              className={cn(INPUT, 'pl-8')}
            />
          </div>
          {chip('all', 'All', to.lines.length)}
          {chip('on', 'Settled', settled.length)}
          {chip('off', 'Not taken', to.lines.length - settled.length)}
          <RowButton onClick={() => setRateCard(true)}>
            <Tags className="w-3 h-3" /> Rate card
          </RowButton>
        </div>

        <div className="grid grid-cols-[22px_1fr_78px_52px_78px_52px_86px_24px] gap-1.5 px-1 pb-1 text-[9px] uppercase tracking-wider text-slate-500 font-bold">
          <span />
          <span>Item</span>
          <span className="text-right">Adult rate</span>
          <span className="text-right">Ad</span>
          <span className="text-right">Child rate</span>
          <span className="text-right">Ch</span>
          <span className="text-right">Total</span>
          <span />
        </div>

        <div className="space-y-3">
          {groups.map(([title, lines]) => (
            <div key={title}>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-1 pb-1 flex items-center gap-2">
                {title}
                <span className="h-px flex-1 bg-slate-800" />
              </p>
              <div className="space-y-1">
                {lines.map(l => {
                  const lineTotal = tourLineTotal(l)
                  return (
                    <div
                      key={l.id}
                      className={cn(
                        'grid grid-cols-[22px_1fr_78px_52px_78px_52px_86px_24px] gap-1.5 items-center rounded-lg px-1 py-1 border transition-colors',
                        l.active
                          ? 'bg-slate-900/70 border-slate-700'
                          : 'border-transparent opacity-55 hover:opacity-90',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(l)}
                        title={l.active ? 'Taken on this tour — click to leave it off the sheet' : 'Not taken — click to settle it'}
                        className="flex items-center justify-center"
                      >
                        {l.active
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <Circle className="w-4 h-4 text-slate-600" />}
                      </button>
                      <input
                        type="text"
                        value={l.name}
                        onChange={e => setLine(l.id, { name: e.target.value })}
                        placeholder="Attraction"
                        className={cn(
                          INPUT, 'px-2 py-1 truncate',
                          l.active ? 'font-bold text-slate-50' : 'text-slate-400',
                        )}
                      />
                      <CellNumber value={l.perPersonRate} onChange={v => setFigure(l, 'perPersonRate', v)} />
                      <CellNumber value={l.count} onChange={v => setFigure(l, 'count', v)} placeholder={adults === null ? '—' : String(adults)} />
                      <CellNumber value={l.childRate} onChange={v => setFigure(l, 'childRate', v)} />
                      <CellNumber value={l.childCount} onChange={v => setFigure(l, 'childCount', v)} placeholder={children === null ? '—' : String(children)} />
                      <CellNumber
                        value={l.totalCost}
                        onChange={v => setFigure(l, 'totalCost', v)}
                        placeholder={money(lineTotal) || '—'}
                        className={l.active && l.totalCost === null && lineTotal !== null ? 'text-emerald-300/80' : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => patch(p => ({ ...p, tour: { ...p.tour, lines: p.tour.lines.filter(x => x.id !== l.id) } }))}
                        className="p-1 text-slate-600 hover:text-rose-300 transition-colors"
                        title="Take this line off the sheet altogether"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Nothing here matches that. {filter !== 'all' ? 'Try “All”.' : ''}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <RowButton onClick={() => patch(p => ({
              ...p,
              tour: {
                ...p.tour,
                lines: [...p.tour.lines, {
                  id: rowId('e'), name: '',
                  perPersonRate: null, count: p.header.paxAdults,
                  childRate: null, childCount: null,
                  totalCost: null, active: true,
                }],
              },
            }))}>
              <Plus className="w-3 h-3" /> Add an item
            </RowButton>
            {missing.length ? (
              <RowButton onClick={() => patch(p => ({
                ...p,
                tour: { ...p.tour, lines: [...p.tour.lines, ...missing.map((item, i) => catalogLine(item, p.tour.lines.length + i + 1))] },
              }))}>
                <ListPlus className="w-3 h-3" /> Put back {missing.length} catalogue item{missing.length === 1 ? '' : 's'}
              </RowButton>
            ) : null}
          </div>
          <span className="text-[11px] text-slate-400">
            {settled.length} settled · total{' '}
            <span className="tabular-nums font-black text-slate-100">{money(total) || '—'}</span>
          </span>
        </div>
      </Section>

      <Section
        title="What prints"
        hint="A driver is normally handed the lines he is settling. Turn this on to print the whole catalogue, the untaken ones greyed."
      >
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={to.showUnusedOnPrint}
            onChange={e => setDoc({ showUnusedOnPrint: e.target.checked })}
            className="w-4 h-4 rounded border-slate-700 bg-slate-950 accent-yellow-500"
          />
          <span className="text-xs text-slate-300">
            Print the lines that were not taken, faded
          </span>
        </label>
      </Section>

      <Section title="Note">
        <Text label="Printed at the foot" value={to.note} onChange={v => setDoc({ note: v })} area />
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
  /** The WhatsApp send box, over this dialog. */
  const [sendingTo, setSendingTo] = useState(false)

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

  /**
   * Get the sheets out of the screen and onto paper.
   *
   * `kinds` empty means the whole pack — board first, then the three forms.
   *
   * The server renders the PDF where it has a Chromium to do it with. Where it
   * has not — an arm64 host the bundled x64 build cannot run on — it answers
   * with the *same* HTML document instead, and the operator's own browser
   * prints it: Chrome's "Save as PDF" produces the identical sheets, mixed
   * orientation and all, because the `@page` boxes are in the document itself.
   * The desk gets its paperwork either way and never sees the difference except
   * in which dialog opens.
   */
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

      const what = kinds.length === 1 ? DOC_LABEL[kinds[0]] : 'All four documents'

      if (res.headers.get('X-Print-Fallback') === 'browser') {
        await printInBrowser(await res.text())
        toast.success(`${what} — choose "Save as PDF" in the print dialog`, { duration: 6000 })
        return
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const stem = (pack.header.tourNo || pack.bookingRef).replace(/[^A-Za-z0-9_-]+/g, '-')
      a.href = url
      a.download = kinds.length === 1 ? `${stem}-${kinds[0]}.pdf` : `${stem}-settlement-documents.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success(kinds.length === 1 ? `${what} downloaded` : 'All four documents downloaded')
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
      {/* The paperwork's other destination: the driver's phone, not the printer. */}
      {sendingTo ? (
        <SendDocsWhatsAppDialog
          bookingRef={bookingRef}
          title={title}
          pack={pack}
          onClose={() => setSendingTo(false)}
        />
      ) : null}
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
              onClick={() => setSendingTo(true)}
              disabled={loading || !pack}
              title="Send the documents to the driver on WhatsApp"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Send to driver
            </button>
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

              <OrientationPicker kind={tab} pack={pack} patch={patch} canWrite={canWrite} />

              {tab === 'name_board' ? (
                <NameBoardEditor pack={pack} patch={patch} canWrite={canWrite} />
              ) : (
                <>
                  <HeaderEditor pack={pack} patch={patch} />
                  {tab === 'transport'   ? <TransportEditor  pack={pack} patch={patch} /> : null}
                  {tab === 'local_visit' ? <LocalVisitEditor pack={pack} patch={patch} /> : null}
                  {tab === 'tour'        ? <TourEditor       pack={pack} patch={patch} canWrite={canWrite} /> : null}
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
