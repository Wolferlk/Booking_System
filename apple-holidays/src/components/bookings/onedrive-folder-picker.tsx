'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight, Folder, FolderOpen, Loader2, Search, CheckCircle2,
  AlertCircle, ArrowLeft, RefreshCw, Sparkles, X, HardDrive,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriveItem {
  id:         string
  name:       string
  webUrl:     string
  isFolder:   boolean
  childCount: number
}

interface FolderMatch {
  name:     string
  webUrl:   string
  driveKey: string
  path:     string
  score:    number
}

interface AutoResult {
  match:         FolderMatch | null
  candidates:    FolderMatch[]
  navigatedPath: string | null
  driveKey:      string | null
}

interface BreadcrumbEntry {
  label:    string
  driveKey: string
  path:     string
}

interface Props {
  open:          boolean
  onClose:       () => void
  onSelect:      (folderUrl: string, folderName: string) => void
  bookingRef:    string
  isNumber?:     string | null
  agentBookingId?: string | null
  arrivalDate?:  string | null
  currentUrl?:   string | null
}

// ─── Drive config (client-safe subset — mirrors DRIVE_CONFIGS in onedrive-monitor) ──

const DRIVES = [
  { key: 'VN', label: 'Vietnam (VN OPERATION)',     country: 'VIETNAM'             },
  { key: 'SL', label: 'Sri Lanka (SL Share Drive)', country: 'SRILANKA'            },
  { key: 'MY', label: 'Malaysia',                   country: 'SINGAPORE_MALAYSIA'  },
  { key: 'SG', label: 'Singapore',                  country: 'SINGAPORE_MALAYSIA'  },
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLabel(score: number) {
  if (score >= 3) return { label: 'Exact match', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
  if (score >= 2) return { label: 'Strong match', color: 'text-blue-700 bg-blue-50 border-blue-200' }
  return { label: 'Partial match', color: 'text-amber-700 bg-amber-50 border-amber-200' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OneDriveFolderPicker({
  open, onClose, onSelect,
  bookingRef, isNumber, agentBookingId, arrivalDate, currentUrl,
}: Props) {
  // Auto-detect state
  const [autoResult,     setAutoResult]     = useState<AutoResult | null>(null)
  const [autoLoading,    setAutoLoading]    = useState(false)
  const [autoRan,        setAutoRan]        = useState(false)

  // Manual browse state
  const [browseMode,     setBrowseMode]     = useState(false)
  const [selectedDrive,  setSelectedDrive]  = useState<string | null>(null)
  const [breadcrumbs,    setBreadcrumbs]    = useState<BreadcrumbEntry[]>([])
  const [items,          setItems]          = useState<DriveItem[]>([])
  const [browseLoading,  setBrowseLoading]  = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<{ name: string; webUrl: string } | null>(null)

  // Manual URL fallback
  const [manualUrl,      setManualUrl]      = useState(currentUrl ?? '')
  const [showManualUrl,  setShowManualUrl]  = useState(false)

  // ── Auto-detect ─────────────────────────────────────────────────────────────
  const runAutoDetect = useCallback(async () => {
    if (!arrivalDate) return
    setAutoLoading(true)
    setAutoResult(null)
    try {
      const params = new URLSearchParams({ arrivalDate })
      if (isNumber)       params.set('isNumber',      isNumber)
      if (bookingRef)     params.set('bookingRef',    bookingRef)
      if (agentBookingId) params.set('agentBookingId', agentBookingId)

      const res  = await fetch(`/api/onedrive/find-folder?${params}`)
      const json = await res.json()
      if (json.success) setAutoResult(json.data)
      else toast.error(json.error ?? 'Auto-detect failed')
    } catch {
      toast.error('Could not reach OneDrive — check server connection')
    } finally {
      setAutoLoading(false)
      setAutoRan(true)
    }
  }, [arrivalDate, isNumber, bookingRef, agentBookingId])

  useEffect(() => {
    if (open && !autoRan) runAutoDetect()
  }, [open, autoRan, runAutoDetect])

  useEffect(() => {
    if (!open) {
      setAutoRan(false)
      setAutoResult(null)
      setBrowseMode(false)
      setSelectedDrive(null)
      setBreadcrumbs([])
      setItems([])
      setSelectedFolder(null)
      setShowManualUrl(false)
      setManualUrl(currentUrl ?? '')
    }
  }, [open, currentUrl])

  // ── Browse ──────────────────────────────────────────────────────────────────
  async function browseAt(driveKey: string, path: string, label: string) {
    setBrowseLoading(true)
    setSelectedFolder(null)
    try {
      const params = new URLSearchParams({ driveKey })
      if (path) params.set('path', path)
      const res  = await fetch(`/api/onedrive/browse?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setItems(json.data.items)
      setBreadcrumbs(prev => {
        const idx = prev.findIndex(b => b.path === path && b.driveKey === driveKey)
        if (idx >= 0) return prev.slice(0, idx + 1)
        return [...prev, { label, driveKey, path }]
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Folder load failed')
    } finally {
      setBrowseLoading(false)
    }
  }

  async function openDrive(driveKey: string) {
    setSelectedDrive(driveKey)
    setBreadcrumbs([{ label: DRIVES.find(d => d.key === driveKey)?.label ?? driveKey, driveKey, path: '' }])
    await browseAt(driveKey, '', driveKey)
  }

  async function openFolder(item: DriveItem) {
    if (!selectedDrive) return
    const currentPath = breadcrumbs[breadcrumbs.length - 1]?.path ?? ''
    const newPath = currentPath ? `${currentPath}/${item.name}` : item.name
    await browseAt(selectedDrive, newPath, item.name)
  }

  function goToBreadcrumb(entry: BreadcrumbEntry) {
    setBreadcrumbs(prev => {
      const idx = prev.findIndex(b => b.path === entry.path && b.driveKey === entry.driveKey)
      return idx >= 0 ? prev.slice(0, idx + 1) : prev
    })
    browseAt(entry.driveKey, entry.path, entry.label)
  }

  function handleSelectFolder(name: string, webUrl: string) {
    setSelectedFolder({ name, webUrl })
  }

  function confirmBrowseSelection() {
    if (!selectedFolder) return
    onSelect(selectedFolder.webUrl, selectedFolder.name)
    onClose()
    toast.success(`Folder assigned: ${selectedFolder.name}`)
  }

  function confirmAutoMatch(match: FolderMatch) {
    onSelect(match.webUrl, match.name)
    onClose()
    toast.success(`Folder assigned: ${match.name}`)
  }

  function confirmManualUrl() {
    const url = manualUrl.trim()
    if (!url) return
    onSelect(url, 'OneDrive Folder')
    onClose()
    toast.success('Folder URL saved')
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign OneDrive Booking Folder"
      size="xl"
    >
      <div className="space-y-5">

        {/* Current assignment */}
        {currentUrl && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate flex-1">Currently: {currentUrl}</span>
            <a href={currentUrl} target="_blank" rel="noreferrer" className="underline flex-shrink-0">Open</a>
          </div>
        )}

        {/* ── Auto-detect panel ─────────────────────────────────────────────── */}
        {!browseMode && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-slate-800">Auto-detect Folder</span>
              </div>
              <button
                onClick={runAutoDetect}
                disabled={autoLoading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40"
              >
                {autoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Re-scan
              </button>
            </div>

            <div className="p-4">
              {/* Loading */}
              {autoLoading && (
                <div className="flex items-center gap-3 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Searching OneDrive…</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Checking {[isNumber, bookingRef, agentBookingId].filter(Boolean).join(', ')} in booking date folders
                    </p>
                  </div>
                </div>
              )}

              {/* Match found */}
              {!autoLoading && autoResult?.match && (() => {
                const { label: matchLabel, color } = scoreLabel(autoResult.match.score)
                return (
                  <div className="space-y-3">
                    <div className={`flex items-start gap-3 p-3 rounded-lg border ${color}`}>
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold truncate">{autoResult.match.name}</p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${color}`}>
                            {matchLabel}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5 opacity-70 truncate">
                          {autoResult.navigatedPath}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => confirmAutoMatch(autoResult.match!)}>
                        Use This Folder
                      </Button>
                    </div>

                    {/* Other candidates */}
                    {autoResult.candidates.length > 1 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-500">Other matches in same location:</p>
                        {autoResult.candidates.slice(1).map(c => {
                          const sl = scoreLabel(c.score)
                          return (
                            <div key={c.webUrl} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                              <div className="flex items-center gap-2 min-w-0">
                                <Folder className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-slate-700 truncate">{c.name}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${sl.color}`}>
                                  {sl.label}
                                </span>
                              </div>
                              <button
                                onClick={() => confirmAutoMatch(c)}
                                className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 flex-shrink-0"
                              >
                                Use
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* No match */}
              {!autoLoading && autoRan && !autoResult?.match && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">No folder found automatically</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Searched for {[isNumber, bookingRef, agentBookingId].filter(Boolean).join(', ')}{' '}
                      {arrivalDate ? `around ${arrivalDate}` : ''}.
                      Browse manually below.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Manual browse ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-slate-800">Browse Folders</span>
            </div>
            {browseMode && (
              <button
                onClick={() => { setBrowseMode(false); setSelectedDrive(null); setBreadcrumbs([]); setItems([]) }}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Close
              </button>
            )}
          </div>

          {/* Drive selection */}
          {!browseMode && (
            <div className="p-4">
              <p className="text-xs text-slate-500 mb-3">Select which OneDrive to browse:</p>
              <div className="grid grid-cols-2 gap-2">
                {DRIVES.map(d => (
                  <button
                    key={d.key}
                    onClick={() => { setBrowseMode(true); openDrive(d.key) }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50 text-left transition-colors"
                  >
                    <HardDrive className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{d.key}</p>
                      <p className="text-[10px] text-slate-500 leading-tight">{d.label}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Browse view */}
          {browseMode && (
            <div className="p-4 space-y-3">
              {/* Breadcrumbs */}
              <div className="flex items-center gap-1 flex-wrap min-h-[24px]">
                {breadcrumbs.map((b, i) => (
                  <span key={`${b.driveKey}:${b.path}`} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                    <button
                      onClick={() => goToBreadcrumb(b)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline max-w-[120px] truncate"
                    >
                      {b.label}
                    </button>
                  </span>
                ))}
                {browseLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-400 ml-1" />}
              </div>

              {/* Items list */}
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {browseLoading && items.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-3 text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                )}

                {!browseLoading && items.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-400">No items in this folder</div>
                )}

                {items.map(item => {
                  const isSelected = selectedFolder?.webUrl === item.webUrl
                  return (
                    <div
                      key={item.id}
                      onClick={() => item.isFolder && handleSelectFolder(item.name, item.webUrl)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer select-none transition-colors ${
                        isSelected
                          ? 'bg-brand-50 border-l-2 border-brand-500'
                          : item.isFolder
                            ? 'hover:bg-slate-50'
                            : 'opacity-50 cursor-default'
                      }`}
                    >
                      {item.isFolder
                        ? <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-brand-500' : 'text-amber-400'}`} />
                        : <div className="w-4 h-4 flex-shrink-0 rounded border border-slate-300 bg-slate-100 text-[7px] flex items-center justify-center font-bold text-slate-500">F</div>
                      }
                      <span className={`flex-1 min-w-0 truncate text-xs ${isSelected ? 'font-semibold text-brand-700' : 'text-slate-700'}`}>
                        {item.name}
                      </span>
                      {item.isFolder && item.childCount > 0 && (
                        <span className="text-[10px] text-slate-400 flex-shrink-0">{item.childCount}</span>
                      )}
                      {item.isFolder && (
                        <button
                          onClick={e => { e.stopPropagation(); openFolder(item) }}
                          className="text-[10px] font-semibold text-slate-400 hover:text-brand-600 flex items-center gap-0.5 flex-shrink-0"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                    </div>
                  )
                })}
              </div>

              {/* Selected folder action */}
              {selectedFolder && (
                <div className="flex items-center justify-between gap-3 p-3 bg-brand-50 border border-brand-200 rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />
                    <span className="text-xs font-semibold text-brand-800 truncate">{selectedFolder.name}</span>
                  </div>
                  <Button size="sm" onClick={confirmBrowseSelection}>
                    Assign This Folder
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Manual URL fallback ────────────────────────────────────────────── */}
        <div>
          <button
            onClick={() => setShowManualUrl(v => !v)}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <Search className="w-3.5 h-3.5" />
            {showManualUrl ? 'Hide' : 'Or paste a folder URL manually'}
          </button>
          {showManualUrl && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="url"
                value={manualUrl}
                onChange={e => setManualUrl(e.target.value)}
                placeholder="https://aahaas.sharepoint.com/..."
                className="form-input flex-1 text-xs"
              />
              <Button size="sm" onClick={confirmManualUrl} disabled={!manualUrl.trim()}>
                Save URL
              </Button>
              {currentUrl && (
                <button
                  onClick={() => { onSelect('', ''); onClose(); toast.success('Folder link removed') }}
                  className="text-xs text-red-600 hover:text-red-700 font-semibold whitespace-nowrap"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </Modal>
  )
}
