'use client'

/**
 * Small building blocks shared by the guide / tour-vendor directory modal and
 * the public registration form. Both screens ask for the same information but
 * lay it out very differently, so what is shared here is the field mechanics —
 * labelling, error display, photo upload — not the page structure.
 */

import { useRef, useState } from 'react'
import { Camera, Loader2, Upload, X } from 'lucide-react'

// ── Field wrapper ────────────────────────────────────────────────────────────

export function Field({
  label, required, error, hint, children, className,
}: {
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error
        ? <p className="text-[11px] text-red-500 mt-1">{error}</p>
        : hint ? <p className="text-[11px] text-slate-400 mt-1">{hint}</p> : null}
    </div>
  )
}

/** Consistent input styling, with the invalid state driven by `error`. */
export function inputClass(error?: string, extra = '') {
  return [
    'w-full rounded-xl border px-4 py-2.5 text-sm transition-colors',
    'focus:outline-none focus:ring-2 focus:border-transparent placeholder:text-slate-300',
    error
      ? 'border-red-300 bg-red-50/40 focus:ring-red-300'
      : 'border-slate-200 bg-white focus:ring-brand-400',
    extra,
  ].join(' ')
}

// ── Photo upload ─────────────────────────────────────────────────────────────

/**
 * Profile-photo picker. `endpoint` differs between the two callers: the public
 * form has no session, so it posts to the unauthenticated upload route.
 */
export function PhotoUpload({
  value, onChange, endpoint, onError, size = 'lg', label = 'Tap to upload photo',
}: {
  value: string
  onChange: (url: string) => void
  endpoint: string
  onError?: (message: string) => void
  size?: 'sm' | 'lg'
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const box = size === 'lg' ? 'w-24 h-24' : 'w-16 h-16'

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { onError?.('Choose an image file'); return }
    if (file.size > 8 * 1024 * 1024) { onError?.('Image must be under 8 MB'); return }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) onChange(data.data.url)
      else onError?.(data.message || data.error || 'Photo upload failed')
    } catch {
      onError?.('Photo upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
      />
      {value ? (
        <div className={`relative ${box} mx-auto`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Profile" className={`${box} rounded-xl object-cover border-2 border-slate-200`} />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow"
            aria-label="Remove photo"
          >
            <X className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute -bottom-2 -right-2 w-6 h-6 bg-slate-800 text-white rounded-full flex items-center justify-center shadow"
            aria-label="Replace photo"
          >
            <Camera className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center gap-2 text-slate-400 hover:border-brand-400 hover:text-brand-500 transition-colors"
        >
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
          <span className="text-xs">{uploading ? 'Uploading…' : label}</span>
        </button>
      )}
    </>
  )
}
