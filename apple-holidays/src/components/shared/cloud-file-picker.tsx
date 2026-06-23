'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Folder, FileText, FileSpreadsheet, File,
  Image as ImageIcon, ChevronRight, ChevronLeft, ExternalLink,
  HardDrive, RefreshCw, X, CheckCircle2,
} from 'lucide-react'
import Modal from '@/components/ui/modal'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloudFile {
  id: string
  name: string
  isFolder: boolean
  size: number | null
  mimeType: string | null
  webUrl: string | null
  lastModified: string | null
}

interface BreadcrumbEntry {
  id: string
  name: string
}

interface CloudFilePickerProps {
  /**
   * One of two sources must be provided:
   *  - bookingRef: browse the booking's linked OneDrive folder
   *  - driveKey:   browse a full drive root by key (VN, SL, MY, SG)
   */
  bookingRef?: string
  driveKey?:   string
  driveLabel?: string   // shown in the header when using driveKey mode

  open: boolean
  onClose: () => void
  /** folderPath is the breadcrumb trail of the folder the file was picked from (e.g. "Reservation / Singapore Drive") */
  onSelect: (file: CloudFile, folderPath?: string) => void
  filterExtensions?: string[]
  title?: string
  selectLabel?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ext(name: string) {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function FileIcon({ name, isFolder }: { name: string; isFolder: boolean }) {
  if (isFolder) return <Folder className="w-5 h-5 text-amber-400 flex-shrink-0" />
  const e = ext(name)
  if (['xlsx', 'xls', 'csv', 'ods'].includes(e))
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500 flex-shrink-0" />
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(e))
    return <ImageIcon className="w-5 h-5 text-purple-500 flex-shrink-0" />
  if (['pdf'].includes(e))
    return <FileText className="w-5 h-5 text-red-500 flex-shrink-0" />
  if (['doc', 'docx', 'txt', 'rtf'].includes(e))
    return <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
  return <File className="w-5 h-5 text-slate-400 flex-shrink-0" />
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CloudFilePicker({
  bookingRef,
  driveKey,
  driveLabel,
  open,
  onClose,
  onSelect,
  filterExtensions,
  title = 'Select File from Drive',
  selectLabel = 'Select',
}: CloudFilePickerProps) {
  const [files,       setFiles]       = useState<CloudFile[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [folderUrl,   setFolderUrl]   = useState<string | null>(null)
  const [hasFolder,   setHasFolder]   = useState(true) // driveKey mode always has a drive
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([])
  const [selected,    setSelected]    = useState<CloudFile | null>(null)

  const currentFolderId = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].id : undefined

  const buildUrl = useCallback((folderId?: string) => {
    if (driveKey) {
      return `/api/drives/${driveKey}/browse${folderId ? `?folderId=${folderId}` : ''}`
    }
    return `/api/bookings/${bookingRef}/cloud-files${folderId ? `?folderId=${folderId}` : ''}`
  }, [bookingRef, driveKey])

  const load = useCallback(async (folderId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(buildUrl(folderId))
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to list folder')

      if (driveKey) {
        // Drive-root mode — always has a drive
        setHasFolder(true)
        setFolderUrl(null)
        setFiles(json.data.files ?? [])
      } else {
        // Booking-folder mode
        setHasFolder(json.data.hasFolder)
        setFolderUrl(json.data.folderUrl ?? null)
        setFiles(json.data.files ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [buildUrl, driveKey])

  useEffect(() => {
    if (open) {
      setSelected(null)
      setBreadcrumbs([])
      load()
    }
  }, [open, load])

  function enterFolder(folder: CloudFile) {
    setSelected(null)
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    load(folder.id)
  }

  function navigateTo(index: number) {
    setSelected(null)
    if (index < 0) {
      setBreadcrumbs([])
      load()
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs(prev => prev.slice(0, index + 1))
      load(crumb.id)
    }
  }

  function isSelectable(file: CloudFile) {
    if (file.isFolder) return false
    if (!filterExtensions || filterExtensions.length === 0) return true
    return filterExtensions.some(e => file.name.toLowerCase().endsWith(e))
  }

  // Determine display label
  const modeLabel = driveKey
    ? (driveLabel ?? driveKey)
    : (bookingRef ? `Booking ${bookingRef}` : 'OneDrive')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {folderUrl && (
              <a href={folderUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary btn-sm text-xs">
                <ExternalLink className="w-3.5 h-3.5" /> Open in OneDrive
              </a>
            )}
            <button onClick={() => load(currentFolderId)} disabled={loading}
              className="btn btn-secondary btn-sm">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => selected && onSelect(selected, breadcrumbs.map(b => b.name).join(' / '))}
              disabled={!selected}
              className="btn btn-primary"
            >
              <CheckCircle2 className="w-4 h-4" /> {selectLabel}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Header label */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <HardDrive className="w-3.5 h-3.5 text-brand-500" />
          <span className="font-medium text-slate-700">OneDrive — {modeLabel}</span>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap text-sm">
          <button
            onClick={() => navigateTo(-1)}
            className="text-brand-600 hover:underline font-medium"
          >
            Root
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              <button
                onClick={() => navigateTo(i)}
                className={i === breadcrumbs.length - 1
                  ? 'text-slate-700 font-medium'
                  : 'text-brand-600 hover:underline'}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Back button */}
        {breadcrumbs.length > 0 && (
          <button
            onClick={() => navigateTo(breadcrumbs.length - 2)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 w-fit"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}

        {/* File list */}
        <div className="border border-slate-200 rounded-xl overflow-hidden min-h-[260px] max-h-[380px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
              <X className="w-8 h-8 text-slate-300" />
              <p className="text-sm text-slate-500">{error}</p>
              <button onClick={() => load(currentFolderId)} className="btn btn-secondary btn-sm">
                Retry
              </button>
            </div>
          ) : !hasFolder ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
              <HardDrive className="w-8 h-8 text-slate-300" />
              <p className="text-sm text-slate-500">
                No OneDrive folder linked to this booking yet. The folder is automatically detected when the booking is scanned from OneDrive.
              </p>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
              <Folder className="w-8 h-8 text-slate-300" />
              <p className="text-sm text-slate-400">This folder is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {files.map(file => {
                const selectable = isSelectable(file)
                const isSelected = selected?.id === file.id
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      if (file.isFolder) { enterFolder(file) }
                      else if (selectable) { setSelected(isSelected ? null : file) }
                    }}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-brand-50 border-l-2 border-brand-500'
                        : file.isFolder
                          ? 'hover:bg-slate-50'
                          : selectable
                            ? 'hover:bg-slate-50'
                            : 'opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <FileIcon name={file.name} isFolder={file.isFolder} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isSelected ? 'font-semibold text-brand-700' : 'text-slate-800'}`}>
                        {file.name}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                        {fmtSize(file.size)}
                        {file.lastModified && <span>{fmtDate(file.lastModified)}</span>}
                        {!selectable && !file.isFolder && (
                          <span className="text-amber-500">not supported</span>
                        )}
                      </p>
                    </div>
                    {file.isFolder && <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {selected && (
          <div className="flex items-center gap-2 p-3 bg-brand-50 border border-brand-200 rounded-lg text-sm">
            <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" />
            <span className="text-brand-700 font-medium truncate">Selected: {selected.name}</span>
            <span className="text-brand-500 text-xs ml-auto">{fmtSize(selected.size)}</span>
          </div>
        )}

        {filterExtensions && filterExtensions.length > 0 && (
          <p className="text-[11px] text-slate-400">
            Accepted: {filterExtensions.join(', ')}
          </p>
        )}
      </div>
    </Modal>
  )
}
