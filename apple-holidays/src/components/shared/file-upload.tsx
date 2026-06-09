'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, File, X, Loader2, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface FileUploadProps {
  accept?: string[]
  maxSize?: number
  onParsed: (data: Record<string, unknown>) => void
  uploadType?: 'booking' | 'pnl'
  label?: string
  description?: string
}

export default function FileUpload({
  accept = ['.docx', '.pdf', '.xlsx', '.csv'],
  maxSize = 10 * 1024 * 1024,
  onParsed,
  uploadType = 'booking',
  label = 'Upload Document',
  description = 'Drag & drop or click to upload',
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const f = accepted[0]
      if (!f) return
      setFile(f)
      setDone(false)
      setLoading(true)

      try {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('type', uploadType)

        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const json = await res.json()

        if (!json.success) throw new Error(json.error ?? 'Upload failed')

        setDone(true)
        onParsed(json.data?.parsedData ?? {})
        toast.success('Document parsed successfully by AI!')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        toast.error(msg)
      } finally {
        setLoading(false)
      }
    },
    [uploadType, onParsed],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize,
    accept: accept.reduce((acc, ext) => {
      const mimeMap: Record<string, string[]> = {
        '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        '.pdf': ['application/pdf'],
        '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        '.xls': ['application/vnd.ms-excel'],
        '.csv': ['text/csv'],
        '.txt': ['text/plain'],
      }
      const mimes = mimeMap[ext] ?? []
      mimes.forEach(m => { acc[m] = [ext] })
      return acc
    }, {} as Record<string, string[]>),
  })

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
          isDragActive
            ? 'border-brand-500 bg-brand-50'
            : done
            ? 'border-green-400 bg-green-50'
            : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/30',
        )}
      >
        <input {...getInputProps()} />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
            <p className="text-sm font-medium text-slate-600">AI is parsing your document…</p>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle className="w-10 h-10 text-green-500" />
            <p className="text-sm font-semibold text-green-700">Document parsed!</p>
            <p className="text-xs text-slate-500">{file?.name}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">{label}</p>
              <p className="text-xs text-slate-500 mt-1">{description}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {accept.join(', ')} · max {Math.round(maxSize / 1024 / 1024)}MB
              </p>
            </div>
          </div>
        )}
      </div>

      {file && !loading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg">
          <File className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <span className="text-xs text-slate-600 truncate flex-1">{file.name}</span>
          <button
            onClick={e => { e.stopPropagation(); setFile(null); setDone(false) }}
            className="text-slate-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
