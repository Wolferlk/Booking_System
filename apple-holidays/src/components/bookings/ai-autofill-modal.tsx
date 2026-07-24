'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Wand2, Upload, FileText, HardDrive, Sparkles, CheckCircle2, X,
} from 'lucide-react'

/**
 * Shared "AI Auto-fill" popup used by the booking detail cards (Passengers,
 * Flights, Accommodation). It handles the extraction round-trip only —
 * uploading a file / pasting text, showing what the AI read back, and handing
 * the reviewed rows to the caller. Nothing is saved from here: `onApply` opens
 * the card's normal edit form pre-filled, so the handler always confirms.
 */
export interface AiAutofillModalProps<T> {
  open: boolean
  onClose: () => void
  /** Popup heading, e.g. "AI Flight Auto-fill". */
  title: string
  /** One-line explanation under the heading. */
  description: string
  /** POST endpoint accepting multipart `file` or JSON `{ text }`. */
  endpoint: string
  /** Key holding the array inside the API's `data` object. */
  resultKey: string
  /** Singular noun used in counts and empty states, e.g. "flight". */
  itemNoun: string
  /** Placeholder shown in the paste-text box. */
  pastePlaceholder: string
  /** Renders one extracted row in the review list. */
  renderItem: (item: T, index: number) => React.ReactNode
  /** Called with the extracted rows when the handler accepts them. */
  onApply: (items: T[]) => void
  /** Optional third source — browse the booking's linked OneDrive folder. */
  onPickFromDrive?: () => void
}

export default function AiAutofillModal<T>({
  open, onClose, title, description, endpoint, resultKey, itemNoun,
  pastePlaceholder, renderItem, onApply, onPickFromDrive,
}: AiAutofillModalProps<T>) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<T[] | null>(null)
  const [source, setSource] = useState('')

  // Fresh start every time the popup is opened.
  useEffect(() => {
    if (open) { setTab('upload'); setText(''); setItems(null); setSource(''); setBusy(false) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function runExtraction(init: RequestInit, fallbackSource: string) {
    setBusy(true); setItems(null)
    try {
      const res = await fetch(endpoint, init)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Extraction failed')
      const rows: T[] = json.data?.[resultKey] ?? []
      setItems(rows)
      setSource(json.data?.source ?? fallbackSource)
      if (rows.length === 0) toast.info(json.message ?? `No ${itemNoun} details found`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(false)
    }
  }

  function extractFromFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    runExtraction({ method: 'POST', body: fd }, file.name)
  }

  function extractFromText() {
    if (!text.trim()) { toast.error(`Paste some ${itemNoun} text first`); return }
    runExtraction({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 'pasted text')
  }

  const count = items?.length ?? 0

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <style>{`@keyframes aiFillIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }`}</style>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full sm:max-w-md bg-[#071a24] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto"
        style={{ animation: 'aiFillIn .3s ease-out both' }}
      >
        <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5">
          <X className="w-4 h-4" />
        </button>

        <h3 className="text-white font-black text-base mb-1 flex items-center gap-2 pr-8">
          <Wand2 className="w-5 h-5 text-cyan-300" /> {title}
        </h3>
        <p className="text-slate-400 text-sm mb-4">{description}</p>

        {/* Source tabs */}
        <div className="inline-flex rounded-xl bg-white/5 p-1 mb-4">
          {([['upload', 'Upload', Upload], ['paste', 'Paste text', FileText]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setItems(null) }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all ${
                tab === key ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {busy ? (
          <div className="py-10 flex flex-col items-center gap-3 text-cyan-200">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-300 animate-spin" />
              <Wand2 className="absolute inset-0 m-auto w-6 h-6" />
            </div>
            <p className="text-sm font-semibold">Reading &amp; correcting {itemNoun} details…</p>
          </div>
        ) : items ? (
          count === 0 ? (
            <div className="py-6 text-center">
              <p className="text-slate-400 text-sm">No {itemNoun} details detected. Try a clearer image or paste the text.</p>
              <button onClick={() => setItems(null)} className="mt-3 text-slate-500 text-xs font-semibold hover:text-slate-300">
                ← Try a different source
              </button>
            </div>
          ) : (
            <>
              <p className="text-emerald-300 text-xs font-bold mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> {count} {itemNoun}{count === 1 ? '' : 's'} found in {source}
              </p>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto -mx-1 px-1">
                {items.map((item, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.04] border border-white/8 p-3 text-sm">
                    {renderItem(item, i)}
                  </div>
                ))}
              </div>
              <button
                onClick={() => { onApply(items); onClose() }}
                className="w-full mt-4 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Review &amp; Fill {count} {itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1)}{count === 1 ? '' : 's'}
              </button>
              <button onClick={() => setItems(null)} className="w-full mt-2 text-slate-500 text-xs font-semibold hover:text-slate-300">
                ← Try a different source
              </button>
            </>
          )
        ) : tab === 'upload' ? (
          <>
            <label className="block cursor-pointer">
              <div className="rounded-2xl border-2 border-dashed border-cyan-400/30 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all py-10 text-center">
                <Upload className="w-8 h-8 mx-auto text-cyan-300 mb-2" />
                <p className="text-white font-semibold text-sm">Tap to upload image or PDF</p>
                <p className="text-slate-500 text-xs mt-1">JPG · PNG · WebP · PDF</p>
              </div>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) extractFromFile(file); e.target.value = '' }}
              />
            </label>

            {onPickFromDrive && (
              <button
                onClick={() => { onClose(); onPickFromDrive() }}
                className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 text-sm font-semibold transition-colors"
              >
                <HardDrive className="w-4 h-4" /> Pick from the booking&apos;s OneDrive
              </button>
            )}
          </>
        ) : (
          <div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={pastePlaceholder}
              className="w-full min-h-[140px] resize-none bg-[#0c1a24] border border-white/12 rounded-lg py-2.5 px-3 font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15"
            />
            <button
              onClick={extractFromText}
              disabled={!text.trim()}
              className="w-full mt-3 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Wand2 className="w-4 h-4" /> Extract &amp; Correct
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
