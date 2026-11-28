'use client'

/**
 * VN Driver Sync — the VN team's Movement Chart workbook (OneDrive, via Microsoft Graph) → each movement's driver.
 * Sweeps, every movement the sync has an opinion on (with Apply / Ignore / Undo),
 * sheet rows it could not place, the log and the settings.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, Car, FileSpreadsheet, ArrowRight, Undo2, Search, Settings2, Database, CheckCircle2, AlertTriangle,
  Clock, ShieldCheck, ChevronLeft, ChevronRight, ExternalLink, Sparkles, Ban, RotateCcw, Check, Phone, Eye,
  CalendarDays, PlaneLanding, SlidersHorizontal, X, Crown, Pin, Lock, Lightbulb, Shuffle, MousePointerClick, ArrowLeftRight, WandSparkles,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { guestDriver } from '@/lib/guest-driver'
import {
  EVENT_ACTION, LINK_STATUS, timeAgo,
  type DriverSyncConfig, type DriverSyncLinkInfo, type DriverSyncOverview, type DriverSyncRunInfo, type LinkStatus, type BookingSheetLine,
  type BookingMovement,
} from '@/lib/vn-driver-sync/shared'

const STATUSES: LinkStatus[] = ['APPLIED', 'IN_SYNC', 'SUGGESTED', 'KEPT_MANUAL', 'NO_NUMBER', 'STALE', 'IGNORED']
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'Failed')
  return json.data
}
/** Today in Vietnam, YYYY-MM-DD — the quick-day chips count from here. */
const vnDay = (offset = 0) => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(Date.parse(`${s}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}
const chipDay = (iso: string, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
  : new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }))

interface Filters {
  dateBy: 'movement' | 'arrival'
  from: string; to: string; q: string
  conf: '' | 'HIGH' | 'MEDIUM' | 'NONE'
  method: '' | 'RULES' | 'AI' | 'MANUAL'
  driver: '' | 'has' | 'none'
  phones: '' | 'yes' | 'no'
  minScore: number
  sort: 'date' | 'scoreDesc' | 'scoreAsc' | 'ref'
}
const NO_FILTERS: Filters = { dateBy: 'movement', from: '', to: '', q: '', conf: '', method: '', driver: '', phones: '', minScore: 0, sort: 'date' }
const FILTER_KEY = 'vn-driver-sync:filters'

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map(([v, label]) => (
        <button key={v || 'any'} type="button" onClick={() => onChange(v)}
          className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition', value === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>{label}</button>
      ))}
    </div>
  )
}

const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', weekday: 'short', timeZone: 'UTC' }) : '—')

function RunRow({ r, isAdmin, picked, onPick, onUndo }: { r: DriverSyncRunInfo; isAdmin: boolean; picked: boolean; onPick: () => void; onUndo: () => void }) {
  const tone = r.status === 'FAILED' ? 'bg-rose-500' : r.status === 'RUNNING' ? 'bg-sky-400 animate-pulse' : r.applied + r.updated > 0 ? 'bg-emerald-500' : 'bg-slate-300'
  return (
    <li className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs transition hover:bg-slate-50', picked && 'bg-indigo-50/60')}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', tone)} />
      <button type="button" onClick={onPick} className="min-w-[140px] text-left">
        <p className="font-semibold text-slate-800">{new Date(r.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        <p className="text-[10.5px] text-slate-400">
          {r.trigger === 'CRON' ? 'Every 15 min' : r.trigger === 'MANUAL' ? `Sync now · ${r.triggeredBy ?? ''}` : 'On open'}
          {r.scope !== 'ALL' && ` · ${r.scope}`}{r.durationMs !== null && ` · ${(r.durationMs / 1000).toFixed(1)} s`}
        </p>
      </button>
      <div className="flex flex-wrap gap-1.5">
        {r.applied > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">{r.applied} applied</span>}
        {r.updated > 0 && <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 ring-1 ring-sky-200">{r.updated} updated</span>}
        {r.suggested > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">{r.suggested} to review</span>}
        {r.keptManual > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-violet-200">{r.keptManual} kept</span>}
        {r.aiCalls > 0 && <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200"><Sparkles className="mr-0.5 inline h-3 w-3" />{r.aiCalls} AI</span>}
        {r.status !== 'FAILED' && <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200">{r.sheetRows} sheet rows · {r.bookings} bookings · {r.matched} matched</span>}
      </div>
      <p className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400" title={r.error ?? r.sheetNote ?? ''}>
        {r.status === 'FAILED' ? <span className="text-rose-600">{r.error}</span> : <><FileSpreadsheet className="mr-1 inline h-3 w-3 text-emerald-600" />{r.sheetNote}</>}
      </p>
      {r.undoneAt ? (
        <span className="text-[10.5px] text-rose-500">Undone {timeAgo(r.undoneAt)} by {r.undoneBy}</span>
      ) : isAdmin && (r.applied + r.updated > 0 || /filled [1-9]|, [1-9]\d* guest/.test(r.sheetNote ?? '')) && (
        <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50"><Undo2 className="h-3 w-3" /> Undo run</button>
      )}
    </li>
  )
}

/** Sheet "details" is "from → to ¶ description" (route first when the chart has From/To). */
function splitDetails(details: string | null): { route: string | null; desc: string } {
  const parts = (details ?? '').split(' ¶ ').map(s => s.trim()).filter(Boolean)
  if (parts.length && /→/.test(parts[0])) return { route: parts[0], desc: parts.slice(1).join(' ') }
  return { route: null, desc: parts.join(' ') }
}
const firstWords = (s: string, n = 4) => {
  const w = s.split(/\s+/).filter(Boolean)
  return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' ')
}
const dayDiff = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000) : null)
/** One-by-one apply rule; bulk apply takes only plain "To review" rows with a number. */
const canApply = (l: DriverSyncLinkInfo) => (l.status === 'SUGGESTED' || (l.status === 'KEPT_MANUAL' && !l.now.fromDirectory)) && Boolean(l.phones)
const canBulk = (l: DriverSyncLinkInfo) => l.status === 'SUGGESTED' && Boolean(l.phones)

const KIND_TONE = {
  PRIVATE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  SIC: 'bg-teal-50 text-teal-700 ring-teal-200',
  OTHER: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const

const fitTone = (f: number) => (f >= 0.72 ? 'bg-emerald-500 text-white' : f >= 0.5 ? 'bg-amber-400 text-slate-900' : f >= 0.3 ? 'bg-orange-200 text-orange-900' : 'bg-slate-200 text-slate-500')
const shortDay = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—')

/** Fit of a sheet line to a movement as a small pill (the same score the sync uses). */
function FitPill({ f, big }: { f: number | null | undefined; big?: boolean }) {
  if (f === null || f === undefined) return <span className={cn('rounded px-1 font-mono text-[9.5px] text-slate-300', big && 'text-[11px]')}>—</span>
  return <span className={cn('rounded px-1 font-mono font-bold tabular-nums', big ? 'text-[11px]' : 'text-[9.5px]', fitTone(f))}>{Math.round(f * 100)}%</span>
}

function SheetLineRow({ line, matched, movementDate, picking, picked, fit, best, onPick }: {
  line: BookingSheetLine; matched: boolean; movementDate: string | null
  /** Fix mode: lines are buttons, each with its fit to the chosen movement. */
  picking?: boolean; picked?: boolean; fit?: number | null; best?: boolean; onPick?: () => void
}) {
  const { route, desc } = splitDetails(line.details)
  const otherDay = line.date && movementDate && line.date !== movementDate
  const noNumber = !line.phones
  const body = (
    <>
      <div className="pt-px">
        <span className={cn('inline-block rounded px-1 font-mono text-[10px] font-semibold',
          picked ? 'bg-indigo-600 text-white' : matched ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>#{line.row ?? '—'}</span>
        {otherDay && <p className="mt-0.5 text-[9.5px] text-slate-400">{fmtDate(line.date).replace(/^\w+ /, '')}</p>}
        {picking && <p className="mt-0.5"><FitPill f={fit} /></p>}
      </div>
      <div className="min-w-0 text-left">
        <p className="truncate font-medium text-slate-800" title={route ?? desc}>
          {best && <Crown className="mr-1 inline h-3 w-3 text-amber-500" />}
          {route ? route : <span className="italic text-slate-400">no from / to</span>}
          {desc && <span className="font-normal text-slate-400"> · {firstWords(desc)}</span>}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-slate-500">
          <Car className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="truncate" title={line.text ?? ''}>{line.text || <span className="italic text-slate-300">no driver / vendor</span>}</span>
          <span className="text-slate-300">|</span>
          <Clock className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="shrink-0 font-semibold text-slate-700">{line.time || '—'}</span>
          {line.service && <span className="shrink-0 text-slate-400">· {line.service}</span>}
        </p>
        {picked ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700"><MousePointerClick className="h-3 w-3" />Your pick{matched ? ' (same as the sync)' : ''}</p>
        ) : matched ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
            {line.pinned ? <><Pin className="h-3 w-3" />Pinned to this movement</> : <><Check className="h-3 w-3" />{picking ? "The sync's guess" : 'Matched to this movement'}</>}
          </p>
        ) : line.placedOn ? (
          <p className="mt-0.5 truncate text-[10px] text-slate-400" title={line.placedOn}>
            {line.pinned && <Pin className="mr-0.5 inline h-2.5 w-2.5 text-indigo-400" />}On another movement: {line.placedOn.replace(/^\d{4}-\d{2}-\d{2} · /, '')}
          </p>
        ) : line.why ? (
          <p className="mt-0.5 truncate text-[10px] text-amber-600" title={line.why}>Not placed — {line.why}</p>
        ) : null}
        {picking && noNumber && <p className="mt-0.5 text-[10px] font-medium text-rose-500">No phone number — cannot be written</p>}
      </div>
    </>
  )
  const tone = picked ? 'bg-indigo-50 ring-2 ring-indigo-500 shadow-sm' : matched ? (picking ? 'bg-emerald-50/50 ring-1 ring-emerald-300' : 'bg-emerald-50 ring-2 ring-emerald-400') : 'hover:bg-slate-50'
  if (!picking) return <li className={cn('grid grid-cols-[52px_1fr] gap-2 rounded-lg px-2 py-1.5 text-[11px] transition', tone)}>{body}</li>
  return (
    <li>
      <button type="button" onClick={onPick} disabled={noNumber}
        className={cn('grid w-full grid-cols-[52px_1fr] gap-2 rounded-lg px-2 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-45',
          tone, !picked && !noNumber && 'hover:ring-1 hover:ring-indigo-300')}>
        {body}
      </button>
    </li>
  )
}

/** One system movement in the "which movement?" picker. */
function MovementOption({ m, day, current, picked, fit, best, onPick }: {
  m: BookingMovement; day: number | null; current: boolean; picked: boolean; fit: number | null | undefined; best: boolean; onPick: () => void
}) {
  const locked = m.fromDirectory
  const handTyped = Boolean(m.driverName) && !m.ours && !m.fromDirectory
  return (
    <li>
      <button type="button" onClick={onPick} disabled={locked}
        title={locked ? 'A driver from the directory is on it — change it in Assign Driver' : handTyped ? `Has "${m.driverName}" typed by hand — you will be asked before it is replaced` : ''}
        className={cn('grid w-full grid-cols-[44px_1fr_auto] items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40',
          picked ? 'bg-indigo-50 ring-2 ring-indigo-500 shadow-sm' : current ? 'bg-white ring-1 ring-slate-300' : 'hover:bg-white hover:ring-1 hover:ring-indigo-300')}>
        <span className="pt-px font-mono text-[10.5px] font-semibold text-slate-700">{m.time?.slice(0, 5) || '--:--'}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-slate-800">
            {best && <Crown className="mr-1 inline h-3 w-3 text-amber-500" />}
            {m.from ?? '—'} <ArrowRight className="mx-0.5 inline h-2.5 w-2.5 text-slate-400" /> {m.to ?? '—'}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className={cn('rounded-full px-1.5 text-[9.5px] font-bold ring-1', KIND_TONE[m.kind])}>{m.kind === 'PRIVATE' ? 'Private' : m.kind === 'SIC' ? 'SIC' : 'Other'}</span>
            {locked ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-600"><Lock className="h-2.5 w-2.5" />{m.driverName ?? 'directory'}</span>
            ) : handTyped ? (
              <span className="max-w-[180px] truncate text-[10px] text-violet-600">✎ {m.driverName}</span>
            ) : m.driverName ? (
              <span className="max-w-[180px] truncate text-[10px] text-amber-700">{m.pinned ? '📌 ' : ''}{m.driverName}</span>
            ) : m.noDriverNeeded ? (
              <span className="text-[10px] text-slate-400">no driver needed</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />free</span>
            )}
            {current && <span className="text-[10px] text-slate-400">· this card</span>}
            {day !== null && <span className="sr-only">Day {day}</span>}
          </span>
        </span>
        <FitPill f={fit} />
      </button>
    </li>
  )
}

function ReviewCard({ l, lines, movements, fits, canEdit, busy, selected, onSelect, onAct, onPick }: {
  l: DriverSyncLinkInfo; lines: BookingSheetLine[]; movements: BookingMovement[]; fits: Record<string, Record<string, number>>
  canEdit: boolean; busy: boolean
  selected: boolean; onSelect: (on: boolean) => void; onAct: (l: DriverSyncLinkInfo, action: string) => void
  onPick: (l: DriverSyncLinkInfo, lineKey: string, target: BookingMovement) => Promise<boolean>
}) {
  const [showAll, setShowAll] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [pickLine, setPickLine] = useState<string | null>(l.lineKey)
  const [pickItem, setPickItem] = useState<string | null>(l.agendaItemId)
  const [freeOnly, setFreeOnly] = useState(true)
  const s = LINK_STATUS[l.status]
  const guest = guestDriver(l.sheet.text, l.phones)
  const pct = l.score === null ? null : Math.round(l.score * 100)
  const day = dayDiff(l.movementDate, l.arrivalDate)
  const label = l.movementLabel?.replace(/^\d{4}-\d{2}-\d{2} · /, '') ?? ''
  // Fall back to the saved label when the agenda item cannot be read.
  const labelParts = label.split(' · ')
  const sys = l.system ?? {
    from: labelParts[labelParts.length - 1]?.split(' → ')[0] ?? null, to: labelParts[labelParts.length - 1]?.split(' → ')[1] ?? null,
    meetingTime: labelParts.find(p => /^\d{1,2}:\d{2}/.test(p)) ?? null, service: labelParts[0] ?? null,
    kind: /sic/i.test(labelParts[0] ?? '') ? 'SIC' as const : /private|pvt/i.test(labelParts[0] ?? '') ? 'PRIVATE' as const : 'OTHER' as const,
  }
  const timeDiffers = l.sheet.time && sys.meetingTime && l.sheet.time.slice(0, 5) !== sys.meetingTime.slice(0, 5)

  // The matched row may be missing from the booking list (older sweep) — show it from the link itself.
  const hasMatched = lines.some(x => x.linkId === l.id)
  const matchedLine: BookingSheetLine | null = !hasMatched && l.sheet.row
    ? { tab: l.sheet.tab, row: l.sheet.row, date: l.sheet.date, time: l.sheet.time, service: l.sheet.service, details: l.sheet.details, text: l.sheet.text, linkId: l.id, placedOn: null, why: null, key: l.lineKey, phones: l.phones, pinned: l.pinned }
    : null
  const allLines = matchedLine ? [matchedLine, ...lines] : lines
  // Lines on the movement's own day first; the matched line always shows.
  const sameDay = lines.filter(x => x.linkId === l.id || !x.date || x.date === l.movementDate)
  const shown = showAll ? lines : sameDay
  const hidden = lines.length - sameDay.length

  // ── Fit hints: is there a better line for this movement, or a better movement for this line?
  const fitOf = (key: string | null | undefined, item: string | null | undefined) => (key && item ? fits[key]?.[item] ?? 0 : 0)
  const canTake = (m: BookingMovement) => !m.fromDirectory && !m.noDriverNeeded
  const isFree = (m: BookingMovement) => canTake(m) && (!m.driverName || m.ours)
  const nowFit = (l.lineKey && l.agendaItemId ? fits[l.lineKey]?.[l.agendaItemId] : undefined) ?? l.score ?? 0
  const betterLine = l.agendaItemId
    ? allLines.filter(x => x.key && x.key !== l.lineKey && x.phones).map(x => ({ x, f: fitOf(x.key, l.agendaItemId) })).sort((a, b) => b.f - a.f)[0]
    : undefined
  const betterMove = l.lineKey
    ? movements.filter(m => m.id !== l.agendaItemId && isFree(m)).map(m => ({ m, f: fitOf(l.lineKey, m.id) })).sort((a, b) => b.f - a.f)[0]
    : undefined
  const hintLine = betterLine && betterLine.f >= 0.45 && betterLine.f - nowFit >= 0.1 ? betterLine : null
  const hintMove = betterMove && betterMove.f >= 0.45 && betterMove.f - nowFit >= 0.1 ? betterMove : null

  // ── Fix mode
  const curLine = allLines.find(x => x.key === pickLine) ?? null
  const curMove = movements.find(m => m.id === pickItem) ?? null
  const changed = pickLine !== l.lineKey || pickItem !== l.agendaItemId
  const rankedLines = [...allLines].filter((x, i, a) => x.key && a.findIndex(y => y.key === x.key) === i)
    .sort((a, b) => fitOf(b.key, pickItem) - fitOf(a.key, pickItem) || (a.date ?? '').localeCompare(b.date ?? '') || (a.row ?? 0) - (b.row ?? 0))
  const bestLineKey = rankedLines.find(x => x.phones)?.key ?? null
  const shownMoves = movements.filter(m => !freeOnly || isFree(m) || m.id === l.agendaItemId || m.id === pickItem)
  const bestMoveId = [...movements].filter(isFree).sort((a, b) => fitOf(pickLine, b.id) - fitOf(pickLine, a.id))[0]?.id ?? null
  const byDay = shownMoves.reduce<Record<string, BookingMovement[]>>((acc, m) => { (acc[m.date] ??= []).push(m); return acc }, {})

  const startFix = (patch?: { line?: string | null; item?: string | null }) => {
    setPickLine(patch?.line !== undefined ? patch.line : l.lineKey)
    setPickItem(patch?.item !== undefined ? patch.item : l.agendaItemId)
    setFixing(true)
  }
  const warnings: { tone: 'amber' | 'rose' | 'slate'; text: string }[] = []
  if (fixing && curLine && curMove) {
    const f = fitOf(curLine.key, curMove.id)
    if (curLine.date && curLine.date !== curMove.date) warnings.push({ tone: 'amber', text: `The sheet line is on ${shortDay(curLine.date)}, the movement on ${shortDay(curMove.date)}` })
    if (curLine.time && curMove.time && curLine.time.slice(0, 5) !== curMove.time.slice(0, 5)) warnings.push({ tone: 'slate', text: `Times differ: sheet ${curLine.time} · system ${curMove.time} (the system time stays)` })
    if (f < 0.3) warnings.push({ tone: 'amber', text: `Low fit (${Math.round(f * 100)}%) — make sure this is really the same service` })
    if (curMove.driverName && !curMove.ours && !curMove.fromDirectory) warnings.push({ tone: 'rose', text: `Replaces "${curMove.driverName}" typed by hand — you will be asked to confirm` })
    if (curLine.placedOn && curLine.linkId !== l.id && curLine.linkId) warnings.push({ tone: 'slate', text: `${curLine.pinned ? 'Pinned' : 'Suggested'} on ${curLine.placedOn.replace(/^\d{4}-\d{2}-\d{2} · /, '')} now — that suggestion is dropped` })
    if (curMove.id !== l.agendaItemId) warnings.push({ tone: 'slate', text: l.status === 'APPLIED' ? "This card's movement: the driver the sync wrote there is taken off" : "This card's movement goes back to the next sync to be matched again" })
  }
  const blocker = !curLine ? 'Pick a sheet line on the left' : !curLine.phones ? 'That line has no phone number' : !curMove ? 'Pick a system movement on the right' : curMove.fromDirectory ? 'That movement has a directory driver' : null
  const pickGuest = curLine ? guestDriver(curLine.text, curLine.phones) : null
  const save = async () => {
    if (!curLine?.key || !curMove || blocker) return
    if (await onPick(l, curLine.key, curMove)) setFixing(false)
  }

  return (
    <article className={cn('overflow-hidden rounded-2xl border bg-white shadow-sm transition',
      fixing ? 'border-indigo-400 ring-2 ring-indigo-200' : selected ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-300 hover:shadow')}>
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2">
        {canEdit && (
          <input type="checkbox" checked={selected} disabled={!canBulk(l) || busy || fixing} onChange={e => onSelect(e.target.checked)}
            title={canBulk(l) ? 'Select for bulk apply' : l.status === 'KEPT_MANUAL' ? 'Replacing a driver is one at a time' : 'Nothing to apply'}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-30" />
        )}
        <Link href={`/dashboard/bookings/${l.bookingRef}/agenda`} className="font-mono text-[13px] font-bold text-indigo-700 hover:underline">{l.bookingRef}</Link>
        <span className="text-[11.5px] font-medium text-slate-600">{fmtDate(l.movementDate)}</span>
        {l.arrivalDate && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
            l.arrivalDate === l.movementDate ? 'bg-sky-100 text-sky-700' : 'text-slate-400')}
            title={`Trip ${fmtDate(l.arrivalDate)} → ${fmtDate(l.departureDate)}`}>
            <PlaneLanding className="h-3 w-3" />{l.arrivalDate === l.movementDate ? 'Arrival day' : `Arr ${fmtDate(l.arrivalDate)}`}
          </span>
        )}
        {l.pinned && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200" title={l.reason ?? ''}><Pin className="h-3 w-3" />Picked by hand</span>}
        {fixing && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white"><WandSparkles className="h-3 w-3" />Fixing the match</span>}
        <div className="ml-auto flex items-center gap-2">
          {pct !== null && (
            <span className="flex items-center gap-1.5" title={l.reason ?? ''}>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                <span className={cn('block h-full rounded-full', l.confidence === 'HIGH' ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400')} style={{ width: `${pct}%` }} />
              </span>
              <span className={cn('text-[11px] font-bold tabular-nums', l.confidence === 'HIGH' ? 'text-emerald-700' : pct >= 50 ? 'text-amber-700' : 'text-rose-600')}>
                {l.method === 'AI' && <Sparkles className="mr-0.5 inline h-3 w-3" />}{l.method === 'MANUAL' && <Pin className="mr-0.5 inline h-3 w-3" />}{pct}%
              </span>
            </span>
          )}
          <span title={s.hint} className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', s.tone)}>{s.label}</span>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_auto_1fr]">
        {/* Left — the Movement Chart (Excel) */}
        <section className="min-w-0 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Movement Chart
            <span className="font-normal normal-case tracking-normal text-slate-400">
              {fixing ? '· click the right line — ranked by fit to the chosen movement' : `· ${lines.length || (l.sheet.row ? 1 : 0)} line${lines.length === 1 ? '' : 's'} for ${l.bookingRef}`}
            </span>
          </p>
          {fixing ? (
            rankedLines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] italic text-slate-400">No sheet lines known for this booking — sync it first</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {rankedLines.map(x => (
                  <SheetLineRow key={x.key} line={x} matched={x.key === l.lineKey} movementDate={curMove?.date ?? l.movementDate}
                    picking picked={x.key === pickLine} fit={pickItem && x.key ? fits[x.key]?.[pickItem] : null} best={x.key === bestLineKey && x.key !== pickLine}
                    onPick={() => setPickLine(x.key)} />
                ))}
              </ul>
            )
          ) : (
            <>
              {shown.length === 0 && !matchedLine ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] italic text-slate-400">No sheet line for this movement</p>
              ) : (
                <ul className={cn('space-y-1', showAll && 'max-h-72 overflow-y-auto pr-1')}>
                  {matchedLine && <SheetLineRow line={matchedLine} matched movementDate={l.movementDate} />}
                  {shown.map(x => <SheetLineRow key={`${x.tab}-${x.row}`} line={x} matched={x.linkId === l.id} movementDate={l.movementDate} />)}
                </ul>
              )}
              {hidden > 0 && (
                <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1.5 text-[10.5px] font-semibold text-indigo-600 hover:underline">
                  {showAll ? 'Only this day' : `Show all ${lines.length} lines of the booking (+${hidden})`}
                </button>
              )}
            </>
          )}
          {l.reason && !fixing && <p className="mt-2 text-[10px] leading-snug text-slate-400"><span className="font-semibold text-slate-500">Why: </span>{l.reason}</p>}
          {/* Smart hints: a better pairing the scores can see. */}
          {canEdit && !fixing && (hintLine || hintMove) && (
            <div className="mt-2 space-y-1">
              {hintLine && (
                <button type="button" onClick={() => startFix({ line: hintLine.x.key })}
                  className="flex w-full items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-left text-[10.5px] text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100">
                  <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate">Line <b>#{hintLine.x.row}</b> fits this movement better — {Math.round(hintLine.f * 100)}% vs {Math.round(nowFit * 100)}%</span>
                  <span className="shrink-0 font-semibold text-amber-700">Try it →</span>
                </button>
              )}
              {hintMove && (
                <button type="button" onClick={() => startFix({ item: hintMove.m.id })}
                  className="flex w-full items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-left text-[10.5px] text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100">
                  <Shuffle className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  <span className="min-w-0 flex-1 truncate">This line fits <b>{shortDay(hintMove.m.date)} · {hintMove.m.from} → {hintMove.m.to}</b> better ({Math.round(hintMove.f * 100)}%)</span>
                  <span className="shrink-0 font-semibold text-sky-700">Move it →</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* Bridge */}
        <div className="hidden items-center justify-center px-1 lg:flex">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full ring-1',
            fixing ? 'bg-indigo-600 text-white ring-indigo-600' : l.confidence === 'HIGH' ? 'bg-emerald-50 text-emerald-600 ring-emerald-200' : 'bg-amber-50 text-amber-600 ring-amber-200')}>
            {fixing ? <ArrowLeftRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </span>
        </div>

        {/* Right — the system agenda */}
        <section className="min-w-0 border-t border-slate-100 bg-gradient-to-br from-white to-indigo-50/40 p-3 lg:border-l lg:border-t-0">
          {fixing ? (
            <>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-indigo-700">
                <CalendarDays className="h-3.5 w-3.5" /> Which system movement?
                <span className="ml-auto normal-case tracking-normal">
                  <Seg value={freeOnly ? 'free' : 'all'} onChange={v => setFreeOnly(v === 'free')} options={[['free', 'No driver yet'], ['all', 'All']]} />
                </span>
              </div>
              {Object.keys(byDay).length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] italic text-slate-400">
                  {movements.length ? 'Every upcoming movement has a driver — switch to All' : 'No upcoming movements for this booking'}
                </p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {Object.entries(byDay).map(([date, ms]) => {
                    const d = dayDiff(date, l.arrivalDate)
                    return (
                      <div key={date}>
                        <p className="sticky top-0 z-10 mb-0.5 flex items-center gap-1.5 bg-gradient-to-r from-indigo-50 to-transparent px-1 py-0.5 text-[10px] font-semibold text-indigo-800">
                          {d !== null && d >= 0 && <span className="rounded bg-indigo-600 px-1 font-mono text-white">Day {d + 1}</span>}
                          {fmtDate(date)}
                          {curLine?.date === date && <span className="font-normal text-emerald-700">· sheet line&apos;s day</span>}
                        </p>
                        <ul className="space-y-0.5">
                          {ms.map(m => (
                            <MovementOption key={m.id} m={m} day={d} current={m.id === l.agendaItemId} picked={m.id === pickItem}
                              fit={pickLine ? fits[pickLine]?.[m.id] : null} best={m.id === bestMoveId && m.id !== pickItem} onPick={() => setPickItem(m.id)} />
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-indigo-700">
                <CalendarDays className="h-3.5 w-3.5" /> System agenda
                {day !== null && day >= 0 && <span className="rounded bg-indigo-600 px-1.5 py-px font-mono text-[10px] normal-case tracking-normal text-white">Day {day + 1}</span>}
              </p>
              <p className="text-[12.5px] font-semibold leading-snug text-slate-900">
                {sys.from || sys.to ? <>{sys.from ?? '—'} <ArrowRight className="mx-0.5 inline h-3 w-3 text-slate-400" /> {sys.to ?? '—'}</> : label}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', KIND_TONE[sys.kind])}>
                  {sys.kind === 'PRIVATE' ? 'Private' : sys.kind === 'SIC' ? 'SIC' : 'Other'}
                </span>
                {sys.service && <span className="text-[10.5px] text-slate-500">{sys.service}</span>}
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1',
                  timeDiffers ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-white text-slate-700 ring-slate-200')}
                  title={timeDiffers ? `Sheet says ${l.sheet.time}` : 'Meeting time'}>
                  <Clock className="h-3 w-3" />{sys.meetingTime || 'no time'}{timeDiffers && <span className="font-normal"> · sheet {l.sheet.time}</span>}
                </span>
              </div>
              {l.movementText && <p className="mt-1.5 line-clamp-2 text-[10.5px] text-slate-500" title={l.movementText}>{l.movementText}</p>}

              {/* Driver: now → will be */}
              <div className="mt-2.5 grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 rounded-xl bg-white/80 p-2 text-[11px] ring-1 ring-slate-200">
                <span className="text-slate-400">Now</span>
                <span className={cn(l.now.driverName ? 'font-medium text-violet-700' : 'italic text-slate-300')}>
                  {l.now.driverName ?? 'no driver'}{l.now.fromDirectory && <span className="ml-1 text-[10px] text-violet-500">(directory)</span>}
                </span>
                <span className="text-slate-400">Sheet</span>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{l.sheet.text || <span className="italic text-slate-300">empty</span>}</span>
                  {l.phones && <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-emerald-700"><Eye className="h-3 w-3" />Guests see <b>{guest.name}</b></span>}
                </span>
              </div>
              {l.note && <p className="mt-1 text-[10px] text-slate-400">{l.note}</p>}

              {/* Actions */}
              {canEdit && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {canApply(l) && (
                    <button type="button" disabled={busy} onClick={() => onAct(l, 'apply')}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {l.status === 'KEPT_MANUAL' ? 'Replace driver' : 'Apply driver'}
                    </button>
                  )}
                  {l.status === 'SUGGESTED' && !l.phones && (
                    <span className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-center text-[11px] text-slate-500">Add a phone number in the sheet to apply</span>
                  )}
                  {l.status !== 'IGNORED' && (
                    <button type="button" disabled={busy} onClick={() => startFix()} title="Pick the right sheet line, or the right system movement, by hand"
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-50">
                      <WandSparkles className="h-3.5 w-3.5" />Wrong match? Fix
                    </button>
                  )}
                  {l.status === 'APPLIED' && (
                    <button type="button" disabled={busy} onClick={() => onAct(l, 'undo')} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50">
                      <Undo2 className="h-3.5 w-3.5" />Undo
                    </button>
                  )}
                  {l.status === 'IGNORED' ? (
                    <button type="button" disabled={busy} onClick={() => onAct(l, 'restore')} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50">
                      <RotateCcw className="h-3.5 w-3.5" />Review again
                    </button>
                  ) : l.status !== 'APPLIED' && l.status !== 'IN_SYNC' && (
                    <button type="button" disabled={busy} onClick={() => onAct(l, 'ignore')} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50">
                      <Ban className="h-3.5 w-3.5" />Ignore
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Fix mode — what will be written, before it is */}
      {fixing && (
        <footer className="border-t border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 ring-1 ring-emerald-200">
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              {curLine ? <><b className="font-mono">#{curLine.row}</b><span className="max-w-[220px] truncate text-slate-600">{curLine.text}</span></> : <span className="italic text-slate-400">no line</span>}
            </span>
            <ArrowRight className="h-4 w-4 text-indigo-400" />
            <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 ring-1 ring-indigo-200">
              <CalendarDays className="h-3.5 w-3.5 text-indigo-600" />
              {curMove ? <><b>{shortDay(curMove.date)}</b><span className="font-mono text-slate-500">{curMove.time?.slice(0, 5) || ''}</span><span className="max-w-[240px] truncate text-slate-700">{curMove.from} → {curMove.to}</span></> : <span className="italic text-slate-400">no movement</span>}
            </span>
            {curLine?.key && curMove && <FitPill f={fits[curLine.key]?.[curMove.id] ?? 0} big />}
            {curMove && curLine?.phones && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-500">
                Driver <span className={cn(curMove.driverName ? 'text-violet-700 line-through decoration-rose-400' : 'italic text-slate-300')}>{curMove.driverName ?? 'none'}</span>
                <ArrowRight className="h-3 w-3" /><span className="font-semibold text-emerald-700">guests see {pickGuest?.name}</span>
              </span>
            )}
          </div>
          {warnings.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {warnings.map(w => (
                <li key={w.text} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] ring-1',
                  w.tone === 'rose' ? 'bg-rose-50 text-rose-700 ring-rose-200' : w.tone === 'amber' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-white text-slate-600 ring-slate-200')}>
                  {w.tone !== 'slate' && <AlertTriangle className="h-3 w-3" />}{w.text}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || Boolean(blocker)} onClick={save}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}Pin &amp; apply
            </button>
            <button type="button" disabled={busy} onClick={() => setFixing(false)} className="rounded-lg px-3 py-2 text-[12px] text-slate-500 hover:bg-white">Cancel</button>
            {changed && <button type="button" disabled={busy} onClick={() => startFix()} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] text-slate-500 hover:bg-white"><RotateCcw className="h-3 w-3" />Back to the sync&apos;s guess</button>}
            <span className="ml-auto text-[10.5px] text-slate-400">
              {blocker ?? 'Pinned pairs stay put: later syncs keep this line here, follow it if the sheet edits it, and match the rest of the booking around it.'}
            </span>
          </div>
        </footer>
      )}
    </article>
  )
}

export default function DriverSyncPage() {
  const [data, setData] = useState<DriverSyncOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState<LinkStatus | ''>('SUGGESTED')
  const [ref, setRef] = useState('')
  const [page, setPage] = useState(1)
  const [runId, setRunId] = useState<string | null>(null)
  const [cfg, setCfg] = useState<DriverSyncConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'movements' | 'unmatched' | 'log'>('movements')
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  // Keep only selections still on screen and still applicable after every reload.
  useEffect(() => {
    if (!data) return
    const ok = new Set(data.links.filter(canBulk).map(l => l.id))
    setSelected(cur => { const next = new Set(Array.from(cur).filter(id => ok.has(id))); return next.size === cur.size ? cur : next })
  }, [data])
  const toggle = (id: string, on: boolean) => setSelected(cur => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n })
  const setFilter = (patch: Partial<Filters>) => { setF(x => ({ ...x, ...patch })); setPage(1) }
  // Filters are remembered per viewer; never required.
  useEffect(() => {
    try { const raw = localStorage.getItem(FILTER_KEY); if (raw) setF({ ...NO_FILTERS, ...JSON.parse(raw), from: '', to: '' }) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { const { from: _f, to: _t, q: _q, ...keep } = f; localStorage.setItem(FILTER_KEY, JSON.stringify(keep)) } catch { /* ignore */ }
  }, [f])
  const activeExtra = [f.conf, f.method, f.driver, f.phones, f.minScore > 0 ? 'x' : '', f.sort !== 'date' ? 'x' : ''].filter(Boolean).length
  const anyFilter = activeExtra > 0 || f.from || f.to || f.q

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page) })
    if (status) sp.set('status', status)
    if (ref.trim()) sp.set('ref', ref.trim())
    if (runId) sp.set('runId', runId)
    sp.set('dateBy', f.dateBy)
    if (f.from) sp.set('from', f.from)
    if (f.to) sp.set('to', f.to)
    if (f.q.trim()) sp.set('q', f.q.trim())
    if (f.conf) sp.set('conf', f.conf)
    if (f.method) sp.set('method', f.method)
    if (f.driver) sp.set('driver', f.driver)
    if (f.phones) sp.set('phones', f.phones)
    if (f.minScore > 0) sp.set('minScore', String(f.minScore))
    if (f.sort !== 'date') sp.set('sort', f.sort)
    try {
      const res = await fetch(`/api/vn-driver-sync?${sp}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) { setData(json.data); setCfg(c => c ?? json.data.config) }
      else toast.error(json.error)
    } finally { setLoading(false) }
  }, [page, status, ref, runId, f])

  useEffect(() => { const t = setTimeout(() => { void load() }, ref || f.q ? 300 : 0); return () => clearTimeout(t) }, [load, ref, f.q])
  useEffect(() => { const t = setInterval(() => { void load() }, 60_000); return () => clearInterval(t) }, [load])

  async function runAll() {
    setRunning(true)
    const t = toast.loading('Reading the Movement Chart and matching every upcoming VN movement…')
    try {
      const { run } = await post('/api/vn-driver-sync/action', { action: 'runAll' }) as { run: DriverSyncRunInfo }
      toast.success(`${run.applied} applied · ${run.updated} updated · ${run.suggested} to review · ${run.keptManual} kept`, { id: t, description: run.sheetNote ?? undefined })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: t, duration: 12_000 })
      await load()
    } finally { setRunning(false) }
  }

  async function act(l: DriverSyncLinkInfo, action: string) {
    if (action === 'apply' && l.status === 'KEPT_MANUAL'
      && !window.confirm(`Replace "${l.now.driverName}" with the sheet's driver?\n\n${l.sheet.text}`)) return
    setBusyId(l.id)
    try {
      const { message } = await post('/api/vn-driver-sync/action', { action, linkId: l.id }) as { message: string }
      toast.success(message)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally { setBusyId(null) }
  }

  /** Fix a match by hand: this sheet line onto that movement, pinned. */
  async function pick(l: DriverSyncLinkInfo, lineKey: string, target: BookingMovement): Promise<boolean> {
    const handTyped = Boolean(target.driverName) && !target.ours && !target.fromDirectory
    if (handTyped && !window.confirm(`"${target.driverName}" was typed on that movement by hand.\n\nReplace it with the sheet line's driver?`)) return false
    setBusyId(l.id)
    try {
      const { message } = await post('/api/vn-driver-sync/action', { action: 'pick', linkId: l.id, lineKey, itemId: target.id, replace: handTyped }) as { message: string }
      toast.success(message, { duration: 8_000 })
      await load()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', { duration: 10_000 })
      await load()
      return false
    } finally { setBusyId(null) }
  }

  /** Apply / ignore the selected movements one after another — each is the same single-movement action. */
  async function runBulk(action: 'apply' | 'ignore') {
    const picked = (data?.links ?? []).filter(l => selected.has(l.id) && canBulk(l))
    if (!picked.length) return
    const verb = action === 'apply' ? 'Apply the sheet driver to' : 'Ignore'
    if (!window.confirm(`${verb} ${picked.length} movement${picked.length === 1 ? '' : 's'}?\n\n${picked.slice(0, 12).map(l => `• ${l.bookingRef} ${fmtDate(l.movementDate)} — ${l.sheet.text ?? ''}`.slice(0, 110)).join('\n')}${picked.length > 12 ? `\n… and ${picked.length - 12} more` : ''}`)) return
    const failed: string[] = []
    const errors: string[] = []
    setBulk({ done: 0, total: picked.length })
    for (let i = 0; i < picked.length; i++) {
      setBusyId(picked[i].id)
      try { await post('/api/vn-driver-sync/action', { action, linkId: picked[i].id }) } catch (err) {
        failed.push(picked[i].id)
        errors.push(`${picked[i].bookingRef}: ${err instanceof Error ? err.message : 'Failed'}`)
      }
      setBulk({ done: i + 1, total: picked.length })
    }
    setBusyId(null)
    setBulk(null)
    const ok = picked.length - failed.length
    if (ok) toast.success(`${ok} movement${ok === 1 ? '' : 's'} ${action === 'apply' ? 'applied' : 'ignored'}`)
    if (failed.length) toast.error(`${failed.length} could not be done`, { description: errors.slice(0, 5).join('\n'), duration: 12_000 })
    setSelected(new Set(failed))
    await load()
  }

  async function undoRun(r: DriverSyncRunInfo) {
    if (!window.confirm(`Undo every driver this run wrote (${r.applied + r.updated})? Movements changed by a person since are left alone.`)) return
    try {
      const { message } = await post('/api/vn-driver-sync/action', { action: 'undoRun', runId: r.id }) as { message: string }
      toast.success(message)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    await load()
  }

  async function saveCfg() {
    if (!cfg) return
    setSaving(true)
    try {
      setCfg(await post('/api/vn-driver-sync/settings', cfg))
      toast.success('Saved')
      await load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save') } finally { setSaving(false) }
  }

  const totals = data?.totals ?? {}
  const lastRun = data?.runs.find(r => r.scope === 'ALL')
  const lastGood = data?.runs.find(r => r.scope === 'ALL' && r.status === 'SUCCESS')
  const accessProblem = lastRun?.status === 'FAILED' && /private|shared|share|sign-in|graph|onedrive|folder|workbook|401|403|404/i.test(lastRun.error ?? '')
  const isMicrosoft = data?.access.kind !== 'GOOGLE'

  return (
    <>
      <Header title="VN Driver Sync" subtitle="Drivers on every Vietnam movement, from the VN team's Movement Chart workbook — every 15 minutes" />
      <div className="space-y-5 px-4 py-5 sm:px-8 sm:py-6">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-900 p-5 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-500/25 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><Car className="h-5 w-5 text-indigo-200" /></span>
            <div className="min-w-0">
              <p className="text-base font-semibold">Movement Chart <span className="text-white/50">Vendors</span> → movement Driver</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                <Clock className="h-3 w-3" /> Last sweep {timeAgo(lastRun?.startedAt)}
                {data?.sheet && <><span className="text-white/30">·</span>Sheet read {timeAgo(data.sheet.at)} ({data.sheet.rows} rows{data.sheet.title ? ` · ${data.sheet.title}` : ''})</>}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {data?.access.sheetUrl && (
                <a href={data.access.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium ring-1 ring-white/20 hover:bg-white/20">
                  <ExternalLink className="h-3.5 w-3.5" /> Open sheet
                </a>
              )}
              {data?.canEdit && data.installed && (
                <button type="button" onClick={runAll} disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-400 px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-indigo-300 disabled:opacity-60">
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync all now
                </button>
              )}
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {STATUSES.map(s => (
              <button key={s} type="button" onClick={() => { setStatus(cur => (cur === s ? '' : s)); setPage(1); setTab('movements') }} title={LINK_STATUS[s].hint}
                className={cn('rounded-xl px-3 py-2 text-left ring-1 transition', status === s ? 'bg-white/15 ring-white/40' : 'bg-white/[0.06] ring-white/10 hover:bg-white/10')}>
                <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-white/50"><span className={cn('h-1.5 w-1.5 rounded-full', LINK_STATUS[s].dot)} />{LINK_STATUS[s].label}</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums">{totals[s] ?? 0}</p>
              </button>
            ))}
          </div>
          <p className="relative mt-3 flex items-start gap-1.5 text-[11px] text-white/50">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-indigo-300" />
            Writes only the driver text and its numbers, only on today-onwards movements, only when the movement has no driver or still holds what the sync wrote.
            A driver from the directory or one typed by hand is never replaced, a sheet text without a phone number is never written, and the sheet is only read.
            Guests and agents see the numbers only — never the vendor name.
          </p>
        </div>

        {data && !data.installed && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            Not set up on this database yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-vn-driver-sync.sh</code> — it creates three new tables and changes nothing else.
          </div>
        )}

        {accessProblem && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />The Movement Chart cannot be read</p>
            <p className="mt-1 text-[12.5px]">{lastRun?.error}</p>
            {isMicrosoft ? (
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[12px] text-rose-700">
                <li>In OneDrive, open the Excel file → <b>Share</b> → <b>Copy link</b> (people in Aahaas with the link can view) and paste that link in Settings below.</li>
                <li>The link must point to the workbook itself, not to a folder, and sit in the aahaas.com Microsoft 365 — OPS reads it with its own Microsoft login, so nobody needs to be added.</li>
              </ol>
            ) : (
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[12px] text-rose-700">
                <li>Easiest: move the chart to OneDrive and paste its share link in Settings below.</li>
                <li>Or share the Google Sheet as Viewer with {data?.access.serviceAccount ? <b className="font-mono">{data.access.serviceAccount}</b> : <>a Google service account (set <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> on the server first)</>}.</li>
              </ol>
            )}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* Runs */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Sweeps</h2>
              {runId && <button type="button" onClick={() => setRunId(null)} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200">One sweep only ✕</button>}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
            ) : (data?.runs.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">No sweeps yet{data?.installed ? ' — press Sync all now.' : '.'}</p>
            ) : (
              <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
                {data!.runs.map(r => (
                  <RunRow key={r.id} r={r} isAdmin={data!.isAdmin} picked={runId === r.id}
                    onPick={() => { setRunId(cur => (cur === r.id ? null : r.id)); setStatus(''); setPage(1) }} onUndo={() => undoRun(r)} />
                ))}
              </ul>
            )}
          </section>

          {/* Settings */}
          <section className="h-fit rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Settings2 className="h-4 w-4 text-slate-400" />Settings</h2>
            {cfg && (
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <p className="mb-1 font-medium text-slate-600">Mode</p>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                    {(['AUTO', 'SUGGEST', 'OFF'] as const).map(m => (
                      <button key={m} type="button" disabled={!data?.isAdmin} onClick={() => setCfg({ ...cfg, mode: m })}
                        className={cn('rounded-md py-1.5 font-semibold transition', cfg.mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                        {m === 'AUTO' ? 'Auto' : m === 'SUGGEST' ? 'Suggest' : 'Off'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    {cfg.mode === 'AUTO' ? 'Sure matches are written; the rest wait for a person.' : cfg.mode === 'SUGGEST' ? 'Nothing is written — every match waits for a person.' : 'No sweeps. "Sync all now" still shows matches without writing.'}
                  </p>
                </div>
                <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                  <span><span className="flex items-center gap-1 font-medium text-slate-700"><Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />AI for close calls</span>
                    <span className="text-[10.5px] text-slate-400">OpenAI decides only what the rules cannot; cached per booking</span></span>
                  <input type="checkbox" disabled={!data?.isAdmin} checked={cfg.useAi} onChange={e => setCfg({ ...cfg, useAi: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                  <span><span className="flex items-center gap-1 font-medium text-slate-700"><Clock className="h-3.5 w-3.5 text-cyan-600" />Fill meeting time</span>
                    <span className="text-[10.5px] text-slate-400">Turned off — meeting times are set in OPS, never taken from the sheet</span></span>
                  <input type="checkbox" disabled checked={false} onChange={e => setCfg({ ...cfg, fillTime: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                  <span><span className="flex items-center gap-1 font-medium text-slate-700"><Phone className="h-3.5 w-3.5 text-pink-600" />Fill guest contact</span>
                    <span className="text-[10.5px] text-slate-400">Guest phone from &quot;Name of guests&quot; when the booking has no contact at all — that booking then gets the guest WhatsApps</span></span>
                  <input type="checkbox" disabled={!data?.isAdmin} checked={cfg.fillContact} onChange={e => setCfg({ ...cfg, fillContact: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-600">Workbook link (OneDrive / SharePoint)</span>
                  <input disabled={!data?.isAdmin} value={cfg.sheet} onChange={e => setCfg({ ...cfg, sheet: e.target.value })}
                    className="mt-1 w-full truncate rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-[10.5px]" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="font-medium text-slate-600">Every (min)</span>
                    <input type="number" min={5} max={240} disabled={!data?.isAdmin} value={cfg.intervalMin} onChange={e => setCfg({ ...cfg, intervalMin: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                  </label>
                  <label className="block">
                    <span className="font-medium text-slate-600">Look ahead (days)</span>
                    <input type="number" min={1} max={400} disabled={!data?.isAdmin} value={cfg.daysAhead} onChange={e => setCfg({ ...cfg, daysAhead: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" />
                  </label>
                </div>
                <p className="text-[10.5px] text-slate-400">
                  {isMicrosoft
                    ? <>Read with OPS&apos;s Microsoft login (Graph) — download only, the workbook is never opened for editing.</>
                    : <>Google Sheet — read via {data?.access.serviceAccount ? <>service account <span className="font-mono">{data.access.serviceAccount}</span></> : 'its shared link'}.</>}
                </p>
                {data?.isAdmin ? (
                  <button type="button" onClick={saveCfg} disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save
                  </button>
                ) : <p className="text-[10.5px] text-slate-400">Only admins can change these.</p>}
              </div>
            )}
          </section>
        </div>

        {/* Movements / unmatched / log */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            {([['movements', `Movements${data ? ` (${data.linkTotal})` : ''}`], ['unmatched', `Sheet rows not placed${data ? ` (${data.unmatched.length})` : ''}`], ['log', 'Log']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', tab === k ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>{label}</button>
            ))}
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={ref} onChange={e => { setRef(e.target.value); setPage(1) }} placeholder="Booking ref" className="w-36 rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs" />
            </div>
          </div>

          {tab === 'movements' && (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2">
                <button type="button" onClick={() => { setStatus(''); setPage(1) }} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', !status ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>All</button>
                {STATUSES.map(s => (
                  <button key={s} type="button" onClick={() => { setStatus(s); setPage(1) }}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', status === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                    {LINK_STATUS[s].label} <span className="opacity-60">{totals[s] ?? 0}</span>
                  </button>
                ))}
              </div>

              {/* Date + advanced filters */}
              <div className="space-y-2 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Seg value={f.dateBy} onChange={v => setFilter({ dateBy: v })}
                    options={[['movement', 'Movement day'], ['arrival', 'Arrival day']]} />
                  <div className="flex flex-wrap items-center gap-1">
                    <button type="button" onClick={() => setFilter({ from: '', to: '' })}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', !f.from && !f.to ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-white')}>
                      All upcoming
                    </button>
                    {(data?.dayCounts ?? []).map((d, i) => {
                      const on = f.from === d.date && f.to === d.date
                      return (
                        <button key={d.date} type="button" onClick={() => setFilter(on ? { from: '', to: '' } : { from: d.date, to: d.date })}
                          title={`${f.dateBy === 'arrival' ? 'Bookings arriving' : 'Movements on'} ${fmtDate(d.date)}`}
                          className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', on ? 'bg-sky-600 text-white' : d.count ? 'text-slate-600 hover:bg-white' : 'text-slate-300 hover:bg-white')}>
                          {chipDay(d.date, i)} <span className="opacity-60">{d.count}</span>
                        </button>
                      )
                    })}
                    <button type="button" onClick={() => setFilter({ from: vnDay(0), to: vnDay(6) })}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', f.from === vnDay(0) && f.to === vnDay(6) ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-white')}>
                      Next 7 days
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                    <input type="date" value={f.from} onChange={e => setFilter({ from: e.target.value, to: f.to && f.to < e.target.value ? e.target.value : f.to })}
                      className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]" aria-label="From" />
                    <span>→</span>
                    <input type="date" value={f.to} min={f.from || undefined} onChange={e => setFilter({ to: e.target.value })}
                      className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]" aria-label="To" />
                  </div>
                  <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input value={f.q} onChange={e => setFilter({ q: e.target.value })} placeholder="Hotel, place, driver, phone…"
                      className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs" />
                  </div>
                  <button type="button" onClick={() => setMoreOpen(o => !o)}
                    className={cn('inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold', moreOpen || activeExtra ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100')}>
                    <SlidersHorizontal className="h-3.5 w-3.5" /> More filters{activeExtra ? ` · ${activeExtra}` : ''}
                  </button>
                  {anyFilter && (
                    <button type="button" onClick={() => { setF({ ...NO_FILTERS, dateBy: f.dateBy }); setPage(1) }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50">
                      <X className="h-3.5 w-3.5" /> Clear
                    </button>
                  )}
                </div>
                {moreOpen && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                    <label className="flex items-center gap-1.5">Driver now
                      <Seg value={f.driver} onChange={v => setFilter({ driver: v })} options={[['', 'Any'], ['none', 'No driver'], ['has', 'Has driver']]} />
                    </label>
                    <label className="flex items-center gap-1.5">Confidence
                      <Seg value={f.conf} onChange={v => setFilter({ conf: v })} options={[['', 'Any'], ['HIGH', 'Sure'], ['MEDIUM', 'Likely'], ['NONE', 'No match']]} />
                    </label>
                    <label className="flex items-center gap-1.5">Matched by
                      <Seg value={f.method} onChange={v => setFilter({ method: v })} options={[['', 'Any'], ['RULES', 'Rules'], ['AI', 'AI'], ['MANUAL', 'By hand']]} />
                    </label>
                    <label className="flex items-center gap-1.5">Phone on sheet
                      <Seg value={f.phones} onChange={v => setFilter({ phones: v })} options={[['', 'Any'], ['yes', 'Yes'], ['no', 'No']]} />
                    </label>
                    <label className="flex items-center gap-1.5">Min match
                      <input type="range" min={0} max={100} step={5} value={f.minScore} onChange={e => setFilter({ minScore: Number(e.target.value) })} className="w-24" />
                      <span className="w-8 font-semibold text-slate-700">{f.minScore}%</span>
                    </label>
                    <label className="flex items-center gap-1.5">Sort
                      <select value={f.sort} onChange={e => setFilter({ sort: e.target.value as Filters['sort'] })} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px]">
                        <option value="date">Date (soonest first)</option>
                        <option value="scoreDesc">Match — highest first</option>
                        <option value="scoreAsc">Match — lowest first</option>
                        <option value="ref">Booking ref</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {(data?.links.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">{loading ? 'Loading…' : 'Nothing here for this filter.'}</p>
              ) : (
                <div className="space-y-3 bg-slate-50/60 p-3 sm:p-4">
                  {data!.canEdit && (() => {
                    const bulkable = data!.links.filter(canBulk)
                    const all = bulkable.length > 0 && bulkable.every(l => selected.has(l.id))
                    return (
                      <div className="flex flex-wrap items-center gap-3 px-1 text-[11.5px] text-slate-500">
                        <label className={cn('inline-flex items-center gap-2 font-medium', bulkable.length ? 'cursor-pointer text-slate-700' : 'opacity-40')}>
                          <input type="checkbox" checked={all} disabled={!bulkable.length || Boolean(bulk)}
                            onChange={e => setSelected(e.target.checked ? new Set(bulkable.map(l => l.id)) : new Set())}
                            className="h-4 w-4 rounded border-slate-300 accent-emerald-600" />
                          Select all ready to apply on this page ({bulkable.length})
                        </label>
                        <span className="hidden text-slate-400 sm:inline">· or tick cards one by one, then apply them together</span>
                      </div>
                    )
                  })()}
                  {data!.links.map(l => (
                    <ReviewCard key={l.id} l={l} lines={data!.bookingSheets?.[l.bookingRef] ?? []} canEdit={data!.canEdit}
                      movements={data!.bookingMovements?.[l.bookingRef] ?? []} fits={data!.fits?.[l.bookingRef] ?? {}}
                      busy={busyId === l.id || Boolean(bulk)} selected={selected.has(l.id)} onSelect={on => toggle(l.id, on)} onAct={act} onPick={pick} />
                  ))}
                </div>
              )}
              {(selected.size > 0 || bulk) && (
                <div className="sticky bottom-4 z-20 mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10 sm:mx-4">
                  <span className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-emerald-500 px-2 text-sm font-bold">{bulk ? bulk.done : selected.size}</span>
                  <div className="min-w-0 text-[12px]">
                    {bulk ? (
                      <>
                        <p className="font-semibold">Working… {bulk.done} of {bulk.total}</p>
                        <span className="mt-1 block h-1 w-48 overflow-hidden rounded-full bg-white/15"><span className="block h-full bg-emerald-400 transition-all" style={{ width: `${(bulk.done / bulk.total) * 100}%` }} /></span>
                      </>
                    ) : (
                      <><p className="font-semibold">{selected.size} movement{selected.size === 1 ? '' : 's'} selected</p><p className="text-white/50">Each one is written exactly like its own Apply button</p></>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" disabled={Boolean(bulk)} onClick={() => setSelected(new Set())} className="rounded-lg px-3 py-2 text-[12px] text-white/70 hover:bg-white/10 disabled:opacity-40">Clear</button>
                    <button type="button" disabled={Boolean(bulk)} onClick={() => runBulk('ignore')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-40">
                      <Ban className="h-3.5 w-3.5" />Ignore selected
                    </button>
                    <button type="button" disabled={Boolean(bulk)} onClick={() => runBulk('apply')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-[12px] font-bold text-white shadow hover:bg-emerald-400 disabled:opacity-60">
                      {bulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Apply {bulk ? bulk.total : selected.size} selected
                    </button>
                  </div>
                </div>
              )}
              {(data?.linkTotal ?? 0) > 50 && (
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  Page {page} of {Math.ceil((data?.linkTotal ?? 0) / 50)}
                  <button type="button" disabled={page * 50 >= (data?.linkTotal ?? 0)} onClick={() => setPage(p => p + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </>
          )}

          {tab === 'unmatched' && (
            (data?.unmatched.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">{lastGood ? 'Every sheet row with a phone number found its movement.' : 'No successful sweep yet.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <p className="px-4 pt-3 text-[11px] text-slate-400">Sheet rows that carry a phone number but match no upcoming movement in the system — usually a date or booking code that differs between the sheet and the chart.</p>
                <table className="mt-2 w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                    <tr><th className="px-4 py-2">Booking</th><th className="px-2 py-2">Sheet</th><th className="px-2 py-2">Details</th><th className="px-2 py-2">Vendors</th><th className="px-4 py-2">Why</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.unmatched.map(u => (
                      <tr key={`${u.tab}-${u.row}-${u.bookingRef}`} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2"><Link href={`/dashboard/bookings/${u.bookingRef}/agenda`} className="font-mono font-semibold text-indigo-700 hover:underline">{u.bookingRef}</Link><p className="text-[10.5px] text-slate-500">{fmtDate(u.date)}</p></td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-500">{u.tab} · row {u.row}<p className="text-[10.5px] text-slate-400">{[u.time, u.service].filter(Boolean).join(' · ')}</p></td>
                        <td className="max-w-[320px] px-2 py-2 text-slate-600">{u.details}</td>
                        <td className="max-w-[280px] px-2 py-2 font-medium text-slate-800">{u.text}</td>
                        <td className="px-4 py-2 text-[11px] text-amber-700">{u.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'log' && (
            (data?.events.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Nothing logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                    <tr><th className="px-4 py-2">When</th><th className="px-2 py-2">Booking</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Movement</th><th className="px-2 py-2">Driver</th><th className="px-2 py-2">Why</th><th className="px-4 py-2">By</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.events.map(e => (
                      <tr key={e.id} className="align-top hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500" title={new Date(e.createdAt).toLocaleString('en-GB')}>{timeAgo(e.createdAt)}</td>
                        <td className="px-2 py-2"><Link href={`/dashboard/bookings/${e.bookingRef}/agenda`} className="font-mono font-semibold text-indigo-700 hover:underline">{e.bookingRef}</Link></td>
                        <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', EVENT_ACTION[e.action]?.tone)}>{EVENT_ACTION[e.action]?.label ?? e.action}</span></td>
                        <td className="max-w-[240px] px-2 py-2 text-slate-700">{e.movementLabel}</td>
                        <td className="max-w-[320px] px-2 py-2">
                          <span className={cn('text-slate-400', !e.fromValue && 'italic')}>{e.fromValue ?? 'empty'}</span>
                          <ArrowRight className="mx-1 inline h-3 w-3 text-slate-300" />
                          <span className={cn('font-semibold text-slate-800', !e.toValue && 'font-normal italic text-slate-400')}>{e.toValue ?? 'empty'}</span>
                        </td>
                        <td className="max-w-[300px] px-2 py-2 text-[11px] text-slate-500">{e.detail}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">{e.actor ?? 'Auto sync'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>
      </div>
    </>
  )
}
