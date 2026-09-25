'use client'

/**
 * Passenger "Special Note" — the highlighted callout under a passenger on the
 * booking page's Passengers card, plus the "Special" chip beside their name.
 * Storage: src/lib/passenger-notes.ts (keyed by booking ref + passenger name).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Pencil, Trash2, Loader2, Check, X, Plus } from 'lucide-react'
import { passengerNameKey } from '@/lib/passenger-note-key'
import { formatDateTime } from '@/lib/utils'

const NOTE_MAX = 1000

export type PassengerNote = { note: string; updatedByName: string | null; updatedAt: string }

/** Loads every note on the booking once; `noteFor(name)` matches a passenger row. */
export function usePassengerNotes(ref: string) {
  const [notes, setNotes] = useState<Record<string, PassengerNote>>({})

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${ref}/passengers/notes`)
      const json = await res.json()
      if (json.success) setNotes(json.data ?? {})
    } catch { /* non-fatal — notes just don't show */ }
  }, [ref])

  useEffect(() => { reload() }, [reload])

  const noteFor = useCallback((name: string) => notes[passengerNameKey(name)] ?? null, [notes])

  async function save(passengerId: string, name: string, note: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/bookings/${ref}/passengers/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passengerId, note }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const key = passengerNameKey(name)
      setNotes(prev => {
        const next = { ...prev }
        if (json.data) next[key] = json.data
        else delete next[key]
        return next
      })
      toast.success(json.data ? 'Special note saved' : 'Special note removed')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
      return false
    }
  }

  const count = Object.keys(notes).length
  return { noteFor, save, count, reload }
}

/** Small gradient chip shown next to the passenger's name when they have a note. */
export function SpecialChip() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-sm shadow-orange-200">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
      Special
    </span>
  )
}

/** Header summary: "✦ 2 special notes". Renders nothing when there are none. */
export function SpecialCountChip({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      <Sparkles className="w-3 h-3" /> {count} special {count === 1 ? 'note' : 'notes'}
    </span>
  )
}

/**
 * The note itself. With a note: an amber→rose callout that anyone can read.
 * Without one: an "Add special note" prompt for editors (nothing for viewers).
 */
export function SpecialNoteBlock({
  note, canEdit, onSave, compactAdd = false,
}: {
  note: PassengerNote | null
  canEdit: boolean
  onSave: (text: string) => Promise<boolean>
  /** Hide the empty-state "Add" prompt (the row is collapsed). */
  compactAdd?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      const el = areaRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  function startEdit() {
    setDraft(note?.note ?? '')
    setEditing(true)
  }

  async function commit(text: string) {
    setSaving(true)
    const ok = await onSave(text)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-3 shadow-sm">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-2">
          <Sparkles className="w-3 h-3" /> Special Note
        </p>
        <textarea
          ref={areaRef}
          value={draft}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(false)
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(draft)
          }}
          placeholder="e.g. Wheelchair needed at arrival · Celebrating 25th anniversary — arrange a cake · Severe nut allergy"
          className="w-full resize-y rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-slate-400 mr-auto">{draft.length}/{NOTE_MAX} · Ctrl/⌘+Enter to save</span>
          {note && (
            <button
              type="button"
              disabled={saving}
              onClick={() => commit('')}
              className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-100 px-2 py-1 rounded-md disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing(false)}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:bg-white px-2 py-1 rounded-md disabled:opacity-50"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
          <button
            type="button"
            disabled={saving || !draft.trim()}
            onClick={() => commit(draft)}
            className="flex items-center gap-1 text-[11px] font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 px-2.5 py-1 rounded-md shadow-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
          </button>
        </div>
      </div>
    )
  }

  if (note) {
    return (
      <div className="group relative overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 pl-4 pr-3 py-2.5 shadow-sm">
        {/* accent stripe */}
        <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-400 via-orange-500 to-rose-500" />
        {/* soft glow */}
        <span className="pointer-events-none absolute -top-6 -right-6 h-16 w-16 rounded-full bg-amber-200/40 blur-2xl" />
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700">Special Note</p>
            <p className="mt-0.5 text-sm font-medium text-slate-800 whitespace-pre-wrap break-words">{note.note}</p>
            <p className="mt-1 text-[10px] text-slate-400">
              {note.updatedByName ? `${note.updatedByName} · ` : ''}{formatDateTime(note.updatedAt)}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={startEdit}
              title="Edit special note"
              className="flex-shrink-0 rounded-md p-1 text-amber-600 opacity-60 hover:opacity-100 hover:bg-white/70 transition"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!canEdit || compactAdd) return null
  return (
    <button
      type="button"
      onClick={startEdit}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 hover:border-amber-400 transition-colors"
    >
      <Plus className="w-3 h-3" /> Add special note
    </button>
  )
}
