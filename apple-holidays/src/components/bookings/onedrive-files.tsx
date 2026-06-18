'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  FolderOpen, ExternalLink, FileText, TrendingUp,
  Loader2, RefreshCw, AlertCircle, HardDrive, ChevronRight,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

interface OneDriveFileEvent {
  id:        string
  driveType: string
  itemName:  string
  itemPath:  string
  webUrl?:   string | null
  eventType: string
  status:    string
  processedAt?: string | null
  createdAt: string
}

interface Props {
  bookingRef: string
}

const DRIVE_COLORS: Record<string, string> = {
  VN: 'bg-red-100 text-red-700',
  SL: 'bg-green-100 text-green-700',
  SG: 'bg-blue-100 text-blue-700',
  MY: 'bg-yellow-100 text-yellow-700',
}

const FILE_ICON = (name: string) => {
  const lower = name.toLowerCase()
  if (lower.includes('pnl'))                                      return <TrendingUp className="w-4 h-4 text-purple-500" />
  if (lower.startsWith('tc') || lower.includes('confirmation'))   return <FileText className="w-4 h-4 text-green-500" />
  if (lower.includes('agenda'))                                   return <FileText className="w-4 h-4 text-blue-500" />
  return <FileText className="w-4 h-4 text-slate-400" />
}

export default function OneDriveFiles({ bookingRef }: Props) {
  const [files, setFiles]       = useState<OneDriveFileEvent[]>([])
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const normalizedRef = bookingRef.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/onedrive/files/${encodeURIComponent(normalizedRef)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load files')
      setFiles(json.data.files ?? [])
      setFolderUrl(json.data.folderUrl ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load OneDrive files')
    } finally {
      setLoading(false)
    }
  }, [normalizedRef])

  useEffect(() => { load() }, [normalizedRef, load])

  // Only show files that are actual files (not folder detection events)
  const fileEvents = files.filter(f => f.eventType !== 'FOLDER_DETECTED')

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
                Open Drive Folder
                <ExternalLink className="w-3 h-3" />
              </a>
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
            <span className="text-xs text-slate-400 font-normal">({fileEvents.length} file{fileEvents.length !== 1 ? 's' : ''})</span>
          )}
        </h3>
      </CardHeader>
      <CardBody className="p-0">
        {fileEvents.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            <HardDrive className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p>No files found in OneDrive for this booking.</p>
            <p className="text-xs mt-1">Files will appear here once a sync runs.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {fileEvents.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <span className="flex-shrink-0">{FILE_ICON(f.itemName)}</span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">{f.itemName}</p>
                  <p className="text-xs text-slate-400 truncate">{f.itemPath.split('/').slice(-3).join(' / ')}</p>
                </div>

                <span className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ${DRIVE_COLORS[f.driveType] ?? 'bg-slate-100 text-slate-500'}`}>
                  {f.driveType}
                </span>

                {f.webUrl ? (
                  <a
                    href={f.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                    title="Open file in OneDrive"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="w-3.5" />
                )}
              </div>
            ))}
          </div>
        )}

        {folderUrl && (
          <div className="border-t border-slate-100 px-4 py-3">
            <a
              href={folderUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-slate-500 hover:text-brand-600 transition-colors"
            >
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
