'use client'

import React, { useEffect, useState, useCallback } from 'react'
import {
  FolderOpen, ExternalLink, FileText, TrendingUp,
  Loader2, RefreshCw, AlertCircle, HardDrive, ChevronRight,
  Zap, CheckCircle, Clock,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { toast } from 'sonner'

interface OneDriveFileEvent {
  id:          string
  driveType:   string
  itemName:    string
  itemPath:    string
  webUrl?:     string | null
  eventType:   string
  status:      string
  processedAt?: string | null
  createdAt:   string
}

interface SyncResult {
  driveKey:        string
  label:           string
  scanned:         number
  bookingsCreated: number
  bookingsUpdated: number
  pnlsUpdated:     number
  errors:          number
}

interface Props {
  bookingRef: string
  canSync?:   boolean
}

const DRIVE_COLORS: Record<string, string> = {
  VN: 'bg-red-100 text-red-700',
  SL: 'bg-green-100 text-green-700',
  SG: 'bg-blue-100 text-blue-700',
  MY: 'bg-yellow-100 text-yellow-700',
}

function fileIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes('pnl'))                                    return <TrendingUp className="w-4 h-4 text-purple-500" />
  if (lower.startsWith('tc') || lower.includes('confirmation')) return <FileText className="w-4 h-4 text-green-500" />
  return <FileText className="w-4 h-4 text-slate-400" />
}

function relPath(path: string) {
  return path.split('/').slice(-3).join(' / ')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function OneDriveFiles({ bookingRef, canSync }: Props) {
  const [files, setFiles]         = useState<OneDriveFileEvent[]>([])
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [syncing, setSyncing]     = useState(false)
  const [lastSync, setLastSync]   = useState<SyncResult[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/onedrive/files/${bookingRef}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load files')
      setFiles(json.data.files ?? [])
      setFolderUrl(json.data.folderUrl ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load OneDrive files')
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    setLastSync(null)
    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Sync failed')

      const results: SyncResult[] = json.data?.results ?? []
      setLastSync(results)

      const found = results.some(r => r.bookingsCreated + r.bookingsUpdated + r.pnlsUpdated > 0)
      toast[found ? 'success' : 'warning'](
        found ? 'Booking data synced from OneDrive' : `No changes found in OneDrive for ${bookingRef}`,
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const fileEvents  = files.filter(f => f.eventType !== 'FOLDER_DETECTED' && f.eventType !== 'ERROR')
  const errorEvents = files.filter(f => f.eventType === 'ERROR')

  if (loading) {
    return (
      <Card>
        <CardBody className="py-6 flex items-center justify-center gap-2 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading OneDrive files…
        </CardBody>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardBody className="py-4 flex items-center gap-2 text-red-500 text-sm px-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{error}</span>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-2">
            {folderUrl && (
              <a
                href={folderUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open Folder
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {canSync && (
              <button
                onClick={syncNow}
                disabled={syncing}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                title="Find & process this booking's folder in OneDrive"
              >
                {syncing
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
                  : <><Zap className="w-3.5 h-3.5" /> Sync from Drive</>
                }
              </button>
            )}
            <button
              onClick={load}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        }
      >
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-slate-400" />
          OneDrive Files
          {fileEvents.length > 0 && (
            <span className="text-xs text-slate-400 font-normal">({fileEvents.length})</span>
          )}
        </h3>
      </CardHeader>

      <CardBody className="p-0">

        {/* Sync result banner */}
        {lastSync && lastSync.length > 0 && (
          <div className="px-4 py-2.5 border-b border-green-100 bg-green-50 flex items-center gap-2 flex-wrap text-xs text-green-700">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-semibold">Sync complete:</span>
            {lastSync.map(r => (
              <span key={r.driveKey} className="flex items-center gap-1">
                <span className={`font-bold px-1.5 py-0.5 rounded-full ${DRIVE_COLORS[r.driveKey] ?? 'bg-slate-100 text-slate-600'}`}>{r.driveKey}</span>
                {r.bookingsCreated > 0 && <span className="text-green-700 font-semibold">+{r.bookingsCreated} created</span>}
                {r.bookingsUpdated > 0 && <span className="text-blue-700 font-semibold">{r.bookingsUpdated} updated</span>}
                {r.pnlsUpdated     > 0 && <span className="text-purple-700 font-semibold">{r.pnlsUpdated} PNL</span>}
                {r.errors          > 0 && <span className="text-red-700 font-semibold">{r.errors} errors</span>}
                {r.bookingsCreated + r.bookingsUpdated + r.pnlsUpdated + r.errors === 0 && (
                  <span className="text-slate-400">no changes</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Files */}
        {fileEvents.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            <HardDrive className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p>No files processed yet for this booking.</p>
            {canSync ? (
              <button
                onClick={syncNow}
                disabled={syncing}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" /> Find &amp; Sync from OneDrive
              </button>
            ) : (
              <p className="text-xs mt-1 text-slate-400">Files appear here after a sync runs.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {fileEvents.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <span className="flex-shrink-0">{fileIcon(f.itemName)}</span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">{f.itemName}</p>
                  <p className="text-xs text-slate-400 truncate">
                    <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                    {fmtDate(f.processedAt ?? f.createdAt)}
                    <span className="mx-1">·</span>
                    {relPath(f.itemPath)}
                  </p>
                </div>

                <span className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ${DRIVE_COLORS[f.driveType] ?? 'bg-slate-100 text-slate-500'}`}>
                  {f.driveType}
                </span>

                {f.webUrl ? (
                  <a href={f.webUrl} target="_blank" rel="noreferrer"
                    className="flex-shrink-0 text-slate-400 hover:text-brand-600"
                    title="Open in OneDrive">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="w-3.5" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Processing errors */}
        {errorEvents.length > 0 && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 space-y-1">
            {errorEvents.map(e => (
              <div key={e.id} className="flex items-start gap-2 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="truncate">{e.itemName}</span>
              </div>
            ))}
          </div>
        )}

        {/* Folder link footer */}
        {folderUrl && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <a href={folderUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-brand-600 transition-colors">
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="truncate">{folderUrl}</span>
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            </a>
          </div>
        )}

      </CardBody>
    </Card>
  )
}
