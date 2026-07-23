'use client'

/**
 * A single upload surface that accepts a file three ways: click-to-browse,
 * drag-and-drop, and paste (Ctrl/⌘+V) — the last one lets staff drop a
 * screenshot straight off the clipboard without saving it to disk first.
 *
 * While mounted it listens for `paste` on the window, so mount it only inside
 * an open modal (one at a time) to avoid competing paste handlers.
 */

import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, ClipboardPaste } from 'lucide-react'

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

export default function PasteDropzone({
  onFile,
  accept = '.pdf,.jpg,.jpeg,.png,.webp,.gif',
  busy = false,
  busyLabel = 'Uploading…',
  hint,
}: {
  onFile: (file: File) => void
  accept?: string
  busy?: boolean
  busyLabel?: string
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Give a pasted blob a real filename + extension so the upload route can
  // derive a sane extension (clipboard images often arrive nameless).
  function normalize(file: File): File {
    if (file.name && file.name.includes('.')) return file
    const ext = EXT_FOR_MIME[file.type] ?? 'png'
    return new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type })
  }

  useEffect(() => {
    if (busy) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            onFile(normalize(file))
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        if (busy) return
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(normalize(file))
      }}
      className={`flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors text-center ${
        dragging
          ? 'border-brand-400 bg-brand-50'
          : 'border-slate-300 hover:border-brand-300 hover:bg-slate-50'
      } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      {busy ? (
        <>
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          <p className="text-sm text-slate-500">{busyLabel}</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-slate-400">
            <Upload className="w-5 h-5" />
            <span className="text-slate-300">·</span>
            <ClipboardPaste className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-600">
            Click to browse, drag a file, or paste a screenshot
          </p>
          <p className="text-xs text-slate-400 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">Ctrl/⌘ + V</kbd>
            to paste from clipboard
          </p>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </>
      )}
    </div>
  )
}
