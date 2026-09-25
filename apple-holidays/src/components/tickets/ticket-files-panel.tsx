'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Files, FileText, ImageIcon, Loader2, Pencil, Plus, Trash2, Check, X } from 'lucide-react'
import { normalizeUploadUrl } from '@/lib/upload-path'

export interface TicketExtraFile {
  id: string
  fileUrl: string
  fileName: string | null
  fileType: string | null
  label: string | null
}

interface Props {
  ticketId: string
  files: TicketExtraFile[]
  canEdit: boolean
  /** Reload the ticket list after a change. */
  onChanged: () => void
}

/**
 * Several files under one ticket — e.g. a group ticket bought for 10 guests
 * that comes back as one file per person. Sits beside the ticket's single
 * receipt (`Ticket.fileUrl`), which is left exactly as it was.
 */
export default function TicketFilesPanel({ ticketId, files, canEdit, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [busyId,    setBusyId]    = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft,     setDraft]     = useState('')

  if (!canEdit && files.length === 0) return null

  async function upload(list: FileList | null) {
    if (!list?.length) return
    setUploading(true)
    try {
      const fd = new FormData()
      Array.from(list).forEach(f => fd.append('files', f))
      const res  = await fetch(`/api/tickets/${ticketId}/files`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message || 'Files added')
      onChanged()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(fileId: string) {
    if (!confirm('Remove this file from the ticket?')) return
    setBusyId(fileId)
    try {
      const res  = await fetch(`/api/tickets/${ticketId}/files?fileId=${encodeURIComponent(fileId)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onChanged()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusyId(null)
    }
  }

  async function saveLabel(fileId: string) {
    setBusyId(fileId)
    try {
      const res  = await fetch(`/api/tickets/${ticketId}/files`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, label: draft }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setEditingId(null)
      onChanged()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1">
          <Files className="w-3 h-3" /> Ticket files {files.length > 0 && `(${files.length})`}
        </p>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => upload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn btn-ghost btn-sm text-xs"
              title="Add one file per guest — select several at once"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add ticket files
            </button>
          </>
        )}
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-slate-400 mt-0.5">
          None yet — add one file per guest (you can select several at once).
        </p>
      ) : (
        <ol className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {files.map((f, idx) => {
            const url  = normalizeUploadUrl(f.fileUrl) ?? f.fileUrl
            const name = f.label || f.fileName || `File ${idx + 1}`
            const Icon = f.fileType === 'image' ? ImageIcon : FileText
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                <span className="w-5 text-right text-slate-400 tabular-nums">{idx + 1}.</span>
                <Icon className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />
                {editingId === f.id ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveLabel(f.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      placeholder="Guest name"
                      className="form-input flex-1 min-w-0 py-0.5 text-xs"
                    />
                    <button type="button" onClick={() => saveLabel(f.id)} disabled={busyId === f.id}
                      className="text-emerald-600 hover:text-emerald-700" title="Save">
                      {busyId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate font-medium text-brand-700 hover:underline" title={f.fileName ?? name}>
                      {name}
                    </a>
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => { setEditingId(f.id); setDraft(f.label ?? '') }}
                          className="text-slate-400 hover:text-slate-600" title="Rename (e.g. the guest's name)">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => remove(f.id)} disabled={busyId === f.id}
                          className="text-slate-400 hover:text-red-600" title="Remove">
                          {busyId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
