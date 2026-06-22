'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown, ChevronRight, HardDrive, RefreshCw, Search,
  Loader2, AlertCircle, FileText, TrendingUp, Zap, Eye,
  CheckCircle, Clock, ExternalLink, FolderOpen, Folder,
  X, RotateCcw, BookOpen, CalendarDays, Trash2,
} from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DriveEvent {
  id: string
  driveType: string
  itemName: string
  itemPath: string
  webUrl?: string | null
  eventType: string
  bookingRef?: string | null
  status: string
  errorMessage?: string | null
  processedAt?: string | null
  createdAt: string
}

interface BookingNode {
  ref: string
  folderName: string
  driveType: string
  status: 'processed' | 'pending' | 'error' | 'partial'
  hasTC: boolean
  hasPNL: boolean
  hasSkipped: boolean
  fileCount: number
  errorCount: number
  webUrl?: string | null
  processedAt?: string | null
  monthIdx: number
}

interface MonthNode {
  month: string
  monthIdx: number
  bookings: BookingNode[]
}

interface YearNode {
  year: string
  months: MonthNode[]
  totalBookings: number
}

interface DriveNode {
  key: string
  label: string
  flag: string
  years: YearNode[]
  totalBookings: number
  processedCount: number
  pendingCount: number
  errorCount: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DRIVE_META: Record<string, {
  label: string; flag: string
  border: string; badge: string; text: string
  headerBg: string; headerBorder: string
}> = {
  VN: {
    label: 'Vietnam',   flag: '🇻🇳',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700 border border-red-200',
    text: 'text-red-700',
    headerBg: 'bg-gradient-to-r from-red-50 to-red-50/30',
    headerBorder: 'border-red-100',
  },
  SL: {
    label: 'Sri Lanka', flag: '🇱🇰',
    border: 'border-green-200',
    badge: 'bg-green-100 text-green-700 border border-green-200',
    text: 'text-green-700',
    headerBg: 'bg-gradient-to-r from-green-50 to-green-50/30',
    headerBorder: 'border-green-100',
  },
  SG: {
    label: 'Singapore', flag: '🇸🇬',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700 border border-blue-200',
    text: 'text-blue-700',
    headerBg: 'bg-gradient-to-r from-blue-50 to-blue-50/30',
    headerBorder: 'border-blue-100',
  },
  MY: {
    label: 'Malaysia',  flag: '🇲🇾',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700 border border-amber-200',
    text: 'text-amber-700',
    headerBg: 'bg-gradient-to-r from-amber-50 to-amber-50/30',
    headerBorder: 'border-amber-100',
  },
}

const MONTHS = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
]
const MONTH_IDX: Record<string, number> = Object.fromEntries(MONTHS.map((m, i) => [m, i]))
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DRIVE_ORDER = ['VN','SL','SG','MY']

const FALLBACK_META = {
  label: '', flag: '🌍',
  border: 'border-slate-200',
  badge: 'bg-slate-100 text-slate-600 border border-slate-200',
  text: 'text-slate-600',
  headerBg: 'bg-slate-50',
  headerBorder: 'border-slate-100',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseYearMonth(
  itemPath: string,
  createdAt: string,
): { year: string; month: string; monthIdx: number } {
  const parts = itemPath.replace(/\\/g, '/').split('/').map((p: string) => p.trim())

  let year = ''
  let month = ''
  let monthIdx = -1

  for (const part of parts) {
    if (/^20\d{2}$/.test(part)) year = part
    const idx = MONTH_IDX[part.toLowerCase()]
    if (idx !== undefined) { month = part; monthIdx = idx }
  }

  if (!year || !month) {
    const d = new Date(createdAt)
    if (!year)  year  = d.getFullYear().toString()
    if (!month) { monthIdx = d.getMonth(); month = MONTHS[monthIdx] }
  }

  return { year, month, monthIdx }
}

function extractFolderName(events: DriveEvent[], bookingRef: string): string {
  const folderEvent = events.find((e: DriveEvent) => e.eventType === 'FOLDER_DETECTED')
  if (folderEvent?.itemName) return folderEvent.itemName

  for (const ev of events) {
    const parts = ev.itemPath.replace(/\\/g, '/').split('/')
    const match = parts.find((p: string) => p.trim().toUpperCase().startsWith(bookingRef))
    if (match) return match.trim()
  }

  return bookingRef
}

function buildTree(events: DriveEvent[]): DriveNode[] {
  // Group by driveType → bookingRef using plain objects to avoid Map iteration issues
  const driveRefMap: Record<string, Record<string, DriveEvent[]>> = {}

  for (const ev of events) {
    if (!ev.bookingRef) continue
    if (!driveRefMap[ev.driveType]) driveRefMap[ev.driveType] = {}
    if (!driveRefMap[ev.driveType][ev.bookingRef]) driveRefMap[ev.driveType][ev.bookingRef] = []
    driveRefMap[ev.driveType][ev.bookingRef].push(ev)
  }

  const drives: DriveNode[] = []

  for (const driveKey of Object.keys(driveRefMap)) {
    const refMap = driveRefMap[driveKey]
    const yearMap: Record<string, Record<string, BookingNode[]>> = {}

    for (const ref of Object.keys(refMap)) {
      const evts = refMap[ref]
      const firstEvt = evts.find((e: DriveEvent) => e.eventType === 'FOLDER_DETECTED') ?? evts[0]
      const { year, month, monthIdx } = parseYearMonth(firstEvt.itemPath, firstEvt.createdAt)

      if (!yearMap[year]) yearMap[year] = {}
      if (!yearMap[year][month]) yearMap[year][month] = []

      const hasTC      = evts.some((e: DriveEvent) => e.eventType === 'TC_PROCESSED'  && e.status === 'PROCESSED')
      const hasPNL     = evts.some((e: DriveEvent) => e.eventType === 'PNL_PROCESSED' && e.status === 'PROCESSED')
      const hasError   = evts.some((e: DriveEvent) => e.status === 'ERROR')
      const hasSkipped = evts.some((e: DriveEvent) => e.eventType === 'SKIPPED'       && e.status === 'SKIPPED')
      const fileEvents = evts.filter((e: DriveEvent) => e.eventType !== 'FOLDER_DETECTED' && e.status === 'PROCESSED')

      const status: BookingNode['status'] = hasTC
        ? (hasError ? 'partial' : 'processed')
        : (hasError ? 'error' : 'pending')

      const folderEvent = evts.find((e: DriveEvent) => e.eventType === 'FOLDER_DETECTED')
      const webUrl = folderEvent?.webUrl ?? evts.find((e: DriveEvent) => e.webUrl)?.webUrl

      const sortedByDate = evts
        .filter((e: DriveEvent) => e.processedAt)
        .sort((a: DriveEvent, b: DriveEvent) =>
          new Date(b.processedAt!).getTime() - new Date(a.processedAt!).getTime()
        )
      const processedAt = sortedByDate[0]?.processedAt

      yearMap[year][month].push({
        ref,
        folderName: extractFolderName(evts, ref),
        driveType: driveKey,
        status,
        hasTC,
        hasPNL,
        hasSkipped,
        fileCount: fileEvents.length,
        errorCount: evts.filter((e: DriveEvent) => e.status === 'ERROR').length,
        webUrl,
        processedAt,
        monthIdx,
      })
    }

    // Build sorted year/month structure
    const years: YearNode[] = Object.keys(yearMap)
      .sort((a, b) => b.localeCompare(a))
      .map(year => {
        const months: MonthNode[] = Object.keys(yearMap[year])
          .map(month => ({
            month,
            monthIdx: yearMap[year][month][0]?.monthIdx ?? -1,
            bookings: yearMap[year][month].slice().sort((a, b) => a.ref.localeCompare(b.ref)),
          }))
          .sort((a, b) => b.monthIdx - a.monthIdx)

        return {
          year,
          months,
          totalBookings: months.reduce((s, m) => s + m.bookings.length, 0),
        }
      })

    const allBookings = years.flatMap(y => y.months.flatMap(m => m.bookings))
    const meta = DRIVE_META[driveKey] ?? FALLBACK_META

    drives.push({
      key: driveKey,
      label: meta.label || driveKey,
      flag: meta.flag,
      years,
      totalBookings:  allBookings.length,
      processedCount: allBookings.filter(b => b.status === 'processed').length,
      pendingCount:   allBookings.filter(b => b.status === 'pending').length,
      errorCount:     allBookings.filter(b => b.status === 'error' || b.status === 'partial').length,
    })
  }

  drives.sort((a, b) => {
    const ai = DRIVE_ORDER.indexOf(a.key)
    const bi = DRIVE_ORDER.indexOf(b.key)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return drives
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: BookingNode['status'] }) {
  const map: Record<BookingNode['status'], { cls: string; label: string; Icon: React.ElementType }> = {
    processed: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Created',  Icon: CheckCircle },
    pending:   { cls: 'bg-amber-100  text-amber-700  border-amber-200',  label: 'Pending',  Icon: Clock },
    error:     { cls: 'bg-red-100    text-red-700    border-red-200',    label: 'Error',    Icon: AlertCircle },
    partial:   { cls: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Partial',  Icon: AlertCircle },
  }
  const { cls, label, Icon } = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border', cls)}>
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      {label}
    </span>
  )
}

// ── Booking row ────────────────────────────────────────────────────────────────

function BookingRow({
  booking, processing, onProcess, onView, onRecreate, onDelete,
}: {
  booking: BookingNode
  processing: boolean
  onProcess: (ref: string) => void
  onView: (ref: string) => void
  onRecreate: (ref: string) => void
  onDelete: (ref: string, deleteBooking: boolean) => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const borderColor = {
    processed: 'border-l-emerald-400',
    pending:   'border-l-amber-400',
    error:     'border-l-red-400',
    partial:   'border-l-orange-400',
  }[booking.status]

  const iconBg = {
    processed: 'bg-emerald-100',
    pending:   'bg-amber-100',
    error:     'bg-red-100',
    partial:   'bg-orange-100',
  }[booking.status]

  const iconColor = {
    processed: 'text-emerald-600',
    pending:   'text-amber-600',
    error:     'text-red-600',
    partial:   'text-orange-600',
  }[booking.status]

  const displayName = booking.folderName !== booking.ref
    ? booking.folderName.replace(booking.ref, '').trim().replace(/^[-\s]+/, '')
    : ''

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 group transition-colors border-l-2 ml-12',
      'hover:bg-slate-50/80',
      borderColor,
    )}>
      {/* Folder icon */}
      <div className={cn('flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center', iconBg)}>
        <FolderOpen className={cn('w-3.5 h-3.5', iconColor)} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800">{booking.ref}</span>
          {displayName && (
            <span className="text-xs text-slate-400 truncate max-w-[200px]">{displayName}</span>
          )}
          <StatusPill status={booking.status} />
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {booking.hasTC && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
              <FileText className="w-2.5 h-2.5" /> TC
            </span>
          )}
          {booking.hasSkipped && (
            <span className="flex items-center gap-1 text-[10px] text-violet-500 font-medium">
              <AlertCircle className="w-2.5 h-2.5" /> TC skipped
            </span>
          )}
          {booking.hasPNL && (
            <span className="flex items-center gap-1 text-[10px] text-purple-600 font-medium">
              <TrendingUp className="w-2.5 h-2.5" /> P&L
            </span>
          )}
          {booking.errorCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-500 font-medium">
              <AlertCircle className="w-2.5 h-2.5" /> {booking.errorCount} error{booking.errorCount > 1 ? 's' : ''}
            </span>
          )}
          {booking.processedAt && (
            <span className="text-[10px] text-slate-400">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />
              {fmtDate(booking.processedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {booking.webUrl && (
          <a
            href={booking.webUrl}
            target="_blank"
            rel="noreferrer"
            title="Open folder in OneDrive"
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        {(booking.status === 'processed' || booking.status === 'partial') && (
          <button
            onClick={() => onView(booking.ref)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <Eye className="w-3 h-3" />
            View Booking
          </button>
        )}

        {booking.status === 'pending' && !booking.hasSkipped && (
          <button
            onClick={() => onProcess(booking.ref)}
            disabled={processing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            {processing
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Processing…</>
              : <><Zap className="w-3 h-3" /> Process File</>}
          </button>
        )}

        {booking.hasSkipped && (
          <button
            onClick={() => onRecreate(booking.ref)}
            disabled={processing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
          >
            {processing
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Recreating…</>
              : <><RotateCcw className="w-3 h-3" /> Recreate Booking</>}
          </button>
        )}

        {(booking.status === 'error') && (
          <button
            onClick={() => onProcess(booking.ref)}
            disabled={processing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {processing
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Retrying…</>
              : <><RotateCcw className="w-3 h-3" /> Retry</>}
          </button>
        )}

        {/* Delete — inline confirm to avoid accidental removal */}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={processing}
            title="Remove from Drive Bookings"
            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
            <span className="text-[10px] text-red-600 font-semibold whitespace-nowrap">Remove?</span>
            {booking.status === 'processed' || booking.status === 'partial' ? (
              <>
                <button
                  onClick={() => { setConfirmDelete(false); onDelete(booking.ref, false) }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-semibold transition-colors"
                  title="Remove drive entry only — keep the booking"
                >
                  Entry only
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); onDelete(booking.ref, true) }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 font-semibold transition-colors"
                  title="Delete booking and remove drive entry"
                >
                  + Booking
                </button>
              </>
            ) : (
              <button
                onClick={() => { setConfirmDelete(false); onDelete(booking.ref, false) }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 font-semibold transition-colors"
              >
                Yes, remove
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(false)}
              className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Month section ──────────────────────────────────────────────────────────────

function MonthSection({
  month, open, onToggle, bookings, processing, onProcess, onView, onRecreate, onDelete, search,
}: {
  month: MonthNode
  open: boolean
  onToggle: () => void
  bookings: BookingNode[]
  processing: Set<string>
  onProcess: (ref: string) => void
  onView: (ref: string) => void
  onRecreate: (ref: string) => void
  onDelete: (ref: string, deleteBooking: boolean) => void
  search: string
}) {
  const createdCnt = bookings.filter(b => b.status === 'processed').length
  const pendingCnt = bookings.filter(b => b.status === 'pending').length
  const errorCnt   = bookings.filter(b => b.status === 'error' || b.status === 'partial').length
  const shortLabel = month.monthIdx >= 0 ? MONTH_LABELS[month.monthIdx] : month.month

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 transition-colors ml-6"
      >
        {open
          ? <ChevronDown  className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
        <CalendarDays className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-700 capitalize">{month.month}</span>
        <span className="text-xs text-slate-400 font-normal">({shortLabel})</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-slate-400">{bookings.length}</span>
          {createdCnt > 0 && (
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">{createdCnt} ✓</span>
          )}
          {pendingCnt > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">{pendingCnt} ⚡</span>
          )}
          {errorCnt > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">{errorCnt} !</span>
          )}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-slate-50/80">
          {bookings.map(booking => (
            <BookingRow
              key={booking.ref}
              booking={booking}
              processing={processing.has(booking.ref)}
              onProcess={onProcess}
              onView={onView}
              onRecreate={onRecreate}
              onDelete={onDelete}
            />
          ))}
          {bookings.length === 0 && search && (
            <p className="py-3 text-center text-xs text-slate-400 ml-12">
              No bookings match &ldquo;{search}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Year section ───────────────────────────────────────────────────────────────

function YearSection({
  year, driveKey, open, openMonths, onToggleYear, onToggleMonth,
  processing, onProcess, onView, onRecreate, onDelete, search,
}: {
  year: YearNode
  driveKey: string
  open: boolean
  openMonths: Set<string>
  onToggleYear: () => void
  onToggleMonth: (key: string) => void
  processing: Set<string>
  onProcess: (ref: string) => void
  onView: (ref: string) => void
  onRecreate: (ref: string) => void
  onDelete: (ref: string, deleteBooking: boolean) => void
  search: string
}) {
  const allBookings = year.months.flatMap(m => m.bookings)
  const createdCnt  = allBookings.filter(b => b.status === 'processed').length
  const pendingCnt  = allBookings.filter(b => b.status === 'pending').length
  const errorCnt    = allBookings.filter(b => b.status === 'error' || b.status === 'partial').length

  return (
    <div>
      <button
        onClick={onToggleYear}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/80 transition-colors border-b border-slate-50"
      >
        {open
          ? <ChevronDown  className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
        {open
          ? <FolderOpen className="w-4 h-4 text-brand-500 flex-shrink-0" />
          : <Folder     className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        <span className="text-sm font-bold text-slate-800">{year.year}</span>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-400">{year.totalBookings} bookings</span>
          {createdCnt > 0 && (
            <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">{createdCnt} created</span>
          )}
          {pendingCnt > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-bold">{pendingCnt} pending</span>
          )}
          {errorCnt > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-bold">{errorCnt} errors</span>
          )}
        </div>
      </button>

      {open && (
        <div>
          {year.months.map(month => {
            const monthKey = `${driveKey}-${year.year}-${month.month}`
            return (
              <MonthSection
                key={monthKey}
                month={month}
                open={openMonths.has(monthKey)}
                onToggle={() => onToggleMonth(monthKey)}
                bookings={month.bookings}
                processing={processing}
                onProcess={onProcess}
                onView={onView}
                onRecreate={onRecreate}
                onDelete={onDelete}
                search={search}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Drive card ─────────────────────────────────────────────────────────────────

function DriveCard({
  drive, open, openYears, openMonths, onToggle, onToggleYear, onToggleMonth,
  processing, onProcess, onView, onRecreate, onDelete, search,
}: {
  drive: DriveNode
  open: boolean
  openYears: Set<string>
  openMonths: Set<string>
  onToggle: () => void
  onToggleYear: (key: string) => void
  onToggleMonth: (key: string) => void
  processing: Set<string>
  onProcess: (ref: string) => void
  onView: (ref: string) => void
  onRecreate: (ref: string) => void
  onDelete: (ref: string, deleteBooking: boolean) => void
  search: string
}) {
  const meta = DRIVE_META[drive.key] ?? FALLBACK_META

  return (
    <div className={cn('rounded-xl border overflow-hidden shadow-sm', meta.border)}>
      {/* Drive header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-4 transition-colors',
          meta.headerBg,
          'border-b',
          meta.headerBorder,
          'hover:brightness-[0.97]',
        )}
      >
        <span className="text-2xl leading-none flex-shrink-0">{drive.flag}</span>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-800">{drive.label}</span>
            <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-full', meta.badge)}>
              {drive.key}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-slate-500">{drive.totalBookings} total</span>
            {drive.processedCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <CheckCircle className="w-3 h-3" /> {drive.processedCount} created
              </span>
            )}
            {drive.pendingCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
                <Clock className="w-3 h-3" /> {drive.pendingCount} pending
              </span>
            )}
            {drive.errorCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-red-600 font-semibold">
                <AlertCircle className="w-3 h-3" /> {drive.errorCount} errors
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {drive.totalBookings > 0 && (
          <div className="flex-shrink-0 w-24 hidden sm:block">
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.round((drive.processedCount / drive.totalBookings) * 100)}%` }}
              />
            </div>
            <p className="text-[9px] text-slate-400 text-right mt-0.5">
              {Math.round((drive.processedCount / drive.totalBookings) * 100)}% created
            </p>
          </div>
        )}

        {open
          ? <ChevronDown  className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />
          : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />}
      </button>

      {/* Folder tree */}
      {open && (
        <div className="bg-white divide-y divide-slate-50">
          {drive.years.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-20" />
              No booking folders found in this drive.
            </div>
          ) : (
            drive.years.map(year => {
              const yearKey = `${drive.key}-${year.year}`
              return (
                <YearSection
                  key={yearKey}
                  year={year}
                  driveKey={drive.key}
                  open={openYears.has(yearKey)}
                  openMonths={openMonths}
                  onToggleYear={() => onToggleYear(yearKey)}
                  onToggleMonth={onToggleMonth}
                  processing={processing}
                  onProcess={onProcess}
                  onView={onView}
                  onRecreate={onRecreate}
                  onDelete={onDelete}
                  search={search}
                />
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── Summary stat card ──────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, color,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: 'slate' | 'emerald' | 'amber' | 'red'
}) {
  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    slate:   { bg: 'bg-slate-50',   text: 'text-slate-600',   icon: 'bg-slate-100'   },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'bg-emerald-100' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: 'bg-amber-100'   },
    red:     { bg: 'bg-red-50',     text: 'text-red-700',     icon: 'bg-red-100'     },
  }
  const c = colorMap[color]
  return (
    <div className={cn('rounded-xl border border-slate-200 p-4 flex items-center gap-3', c.bg)}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', c.icon, c.text)}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-black text-slate-900">{value}</p>
        <p className="text-xs text-slate-500 leading-tight">{label}</p>
      </div>
    </div>
  )
}

// ── Main Export ────────────────────────────────────────────────────────────────

export default function OneDriveBookingsExplorer() {
  const router = useRouter()

  const { countryFilter } = useCountryFilter()

  // Map country filter values → which drive keys to show
  const visibleDrives = useMemo<Set<string>>(() => {
    if (countryFilter === 'ALL' || !countryFilter)          return new Set(['VN','SL','SG','MY'])
    if (countryFilter === 'VIETNAM')                        return new Set(['VN'])
    if (countryFilter === 'SRILANKA')                       return new Set(['SL'])
    if (countryFilter === 'SINGAPORE_MALAYSIA')             return new Set(['SG','MY'])
    if (countryFilter === 'SINGAPORE')                      return new Set(['SG'])
    if (countryFilter === 'MALAYSIA')                       return new Set(['MY'])
    return new Set(['VN','SL','SG','MY'])
  }, [countryFilter])

  const [events,     setEvents]     = useState<DriveEvent[]>([])
  const [loading,    setLoading]    = useState(true)
  const [processing, setProcessing] = useState<Set<string>>(new Set<string>())
  const [search,     setSearch]     = useState('')

  const [openDrives, setOpenDrives] = useState<Set<string>>(new Set<string>(['VN']))
  const [openYears,  setOpenYears]  = useState<Set<string>>(new Set<string>())
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set<string>())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/onedrive/events?limit=500')
      const json = await res.json() as { success: boolean; error?: string; data?: { events: DriveEvent[] } }
      if (!json.success) throw new Error(json.error ?? 'Failed to load events')
      setEvents(json.data?.events ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load OneDrive events')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Auto-expand current year for all drives on first load
  useEffect(() => {
    if (events.length === 0) return
    const yr = new Date().getFullYear().toString()
    setOpenYears(prev => {
      const next = new Set<string>(Array.from(prev))
      DRIVE_ORDER.forEach(dk => next.add(`${dk}-${yr}`))
      return next
    })
  }, [events])

  const tree = useMemo(() => buildTree(events), [events])

  const filteredTree = useMemo<DriveNode[]>(() => {
    const byDrive = tree.filter(d => visibleDrives.has(d.key))
    if (!search.trim()) return byDrive
    const q = search.toLowerCase()
    return byDrive
      .map(drive => ({
        ...drive,
        years: drive.years
          .map(year => ({
            ...year,
            months: year.months
              .map(month => ({
                ...month,
                bookings: month.bookings.filter(b =>
                  b.ref.toLowerCase().includes(q) ||
                  b.folderName.toLowerCase().includes(q)
                ),
              }))
              .filter(m => m.bookings.length > 0),
          }))
          .filter(y => y.months.length > 0),
      }))
      .filter(d => d.years.length > 0)
  }, [tree, search])

  // Auto-expand all matched nodes when searching
  useEffect(() => {
    if (!search.trim()) return
    const drives  = new Set<string>()
    const years   = new Set<string>()
    const months  = new Set<string>()
    for (const drive of filteredTree) {
      drives.add(drive.key)
      for (const year of drive.years) {
        years.add(`${drive.key}-${year.year}`)
        for (const month of year.months) {
          months.add(`${drive.key}-${year.year}-${month.month}`)
        }
      }
    }
    setOpenDrives(drives)
    setOpenYears(years)
    setOpenMonths(months)
  }, [search, filteredTree])

  async function processBooking(ref: string) {
    if (processing.has(ref)) return
    setProcessing(prev => new Set<string>(Array.from(prev).concat(ref)))
    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef: ref }),
      })
      const json = await res.json() as {
        success: boolean; error?: string
        data?: { results?: { bookingsCreated: number; bookingsUpdated: number }[] }
        message?: string
      }
      if (!json.success) throw new Error(json.error ?? 'Processing failed')

      const results = json.data?.results ?? []
      const created = results.some(r => r.bookingsCreated + r.bookingsUpdated > 0)

      toast[created ? 'success' : 'warning'](
        created
          ? `Booking ${ref} created — click "View Booking" to open it`
          : `No TC file found for ${ref} — folder may be empty`,
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to process ${ref}`)
    } finally {
      setProcessing(prev => {
        const next = new Set<string>(Array.from(prev))
        next.delete(ref)
        return next
      })
    }
  }

  function viewBooking(ref: string) {
    router.push(`/dashboard/bookings/${ref}`)
  }

  async function recreateBooking(ref: string) {
    if (processing.has(ref)) return
    setProcessing(prev => new Set<string>(Array.from(prev).concat(ref)))
    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef: ref }),
      })
      const json = await res.json() as {
        success: boolean; error?: string
        data?: { results?: { bookingsCreated: number; bookingsUpdated: number }[] }
      }
      if (!json.success) throw new Error(json.error ?? 'Recreate failed')

      const results = json.data?.results ?? []
      const created = results.some(r => r.bookingsCreated > 0)

      if (created) {
        toast.success(`Booking ${ref} recreated — click "View Booking" to open it`)
      } else {
        toast.warning(`Could not recreate ${ref} — make sure a .docx TC file is in the OneDrive folder, then try again`)
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to recreate ${ref}`)
    } finally {
      setProcessing(prev => {
        const next = new Set<string>(Array.from(prev))
        next.delete(ref)
        return next
      })
    }
  }

  async function deleteEntry(ref: string, deleteBooking: boolean) {
    if (processing.has(ref)) return
    setProcessing(prev => new Set<string>(Array.from(prev).concat(ref)))
    try {
      const params = new URLSearchParams({ ref, deleteBooking: String(deleteBooking) })
      const res  = await fetch(`/api/onedrive/remove?${params}`, { method: 'DELETE' })
      const json = await res.json() as { success: boolean; error?: string; message?: string }
      if (!json.success) throw new Error(json.error ?? 'Remove failed')
      toast.success(json.message ?? `${ref} removed`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to remove ${ref}`)
    } finally {
      setProcessing(prev => {
        const next = new Set<string>(Array.from(prev))
        next.delete(ref)
        return next
      })
    }
  }

  function toggleSet<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) {
    setter(prev => {
      const next = new Set<T>(Array.from(prev))
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function expandAll() {
    const drives  = new Set<string>()
    const years   = new Set<string>()
    const months  = new Set<string>()
    for (const d of tree) {
      drives.add(d.key)
      for (const y of d.years) {
        years.add(`${d.key}-${y.year}`)
        for (const m of y.months) months.add(`${d.key}-${y.year}-${m.month}`)
      }
    }
    setOpenDrives(drives)
    setOpenYears(years)
    setOpenMonths(months)
  }

  function collapseAll() {
    setOpenDrives(new Set<string>())
    setOpenYears(new Set<string>())
    setOpenMonths(new Set<string>())
  }

  const visibleTree    = tree.filter(d => visibleDrives.has(d.key))
  const totalBookings  = visibleTree.reduce((s, d) => s + d.totalBookings,  0)
  const totalProcessed = visibleTree.reduce((s, d) => s + d.processedCount, 0)
  const totalPending   = visibleTree.reduce((s, d) => s + d.pendingCount,   0)
  const totalErrors    = visibleTree.reduce((s, d) => s + d.errorCount,     0)

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      {!loading && totalBookings > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Total Folders"    value={totalBookings}  icon={<HardDrive   className="w-4 h-4" />} color="slate"   />
          <SummaryCard label="Bookings Created" value={totalProcessed} icon={<CheckCircle className="w-4 h-4" />} color="emerald" />
          <SummaryCard label="Pending Process"  value={totalPending}   icon={<Zap         className="w-4 h-4" />} color="amber"   />
          <SummaryCard label="Errors"           value={totalErrors}    icon={<AlertCircle className="w-4 h-4" />} color="red"     />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search bookings or folder names…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={expandAll}
          className="px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
        >
          Collapse
        </button>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
          <p className="text-sm">Loading OneDrive folder structure…</p>
        </div>
      ) : filteredTree.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <BookOpen className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">
            {search
              ? `No folders matching "${search}"`
              : 'No booking folders found — run a sync first'}
          </p>
          {!search && (
            <Button size="sm" variant="secondary" onClick={() => void load()} icon={<RefreshCw className="w-3.5 h-3.5" />}>
              Refresh
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTree.map(drive => (
            <DriveCard
              key={drive.key}
              drive={drive}
              open={openDrives.has(drive.key)}
              openYears={openYears}
              openMonths={openMonths}
              onToggle={() => toggleSet(setOpenDrives, drive.key)}
              onToggleYear={key => toggleSet(setOpenYears, key)}
              onToggleMonth={key => toggleSet(setOpenMonths, key)}
              processing={processing}
              onProcess={processBooking}
              onView={viewBooking}
              onRecreate={recreateBooking}
              onDelete={deleteEntry}
              search={search}
            />
          ))}
        </div>
      )}
    </div>
  )
}
