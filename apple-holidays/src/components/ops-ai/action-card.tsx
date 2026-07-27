'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Search, FileSearch, ExternalLink, Navigation, PenLine, CalendarPlus, CalendarCog,
  BedDouble, Car, BellPlus, PhoneCall, ArrowRight, Check, Loader2, AlertTriangle, Sparkles,
  UserPlus, Plane, CalendarRange, ServerCog, DownloadCloud, Database, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OpsAction } from './types'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Search, FileSearch, ExternalLink, Navigation, PenLine, CalendarPlus,
  CalendarCog, BedDouble, Car, BellPlus, PhoneCall,
  UserPlus, Plane, CalendarRange, ServerCog, DownloadCloud, Database, FileText,
}

type RunState = 'idle' | 'running' | 'done' | 'failed'

interface Props {
  action:  OpsAction
  onRun:   (action: OpsAction) => Promise<{ ok: boolean; message: string }>
  /** Locks the card once the surrounding thread has moved on. */
  disabled?: boolean
}

export default function ActionCard({ action, onRun, disabled }: Props) {
  const [state, setState]     = useState<RunState>('idle')
  const [outcome, setOutcome] = useState<string>('')

  const Icon    = ICONS[action.icon] ?? Sparkles
  const isWrite = action.kind === 'WRITE'
  const spent   = state === 'done' || state === 'failed'

  async function run() {
    if (state === 'running' || state === 'done') return
    setState('running')
    const res = await onRun(action)
    setOutcome(res.message)
    setState(res.ok ? 'done' : 'failed')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={cn(
        'group relative overflow-hidden rounded-xl border backdrop-blur-sm transition-colors',
        state === 'done'   && 'border-emerald-400/40 bg-emerald-950/30',
        state === 'failed' && 'border-red-400/40 bg-red-950/30',
        state === 'idle' && isWrite   && 'border-brand-400/30 bg-slate-900/60 hover:border-brand-400/60',
        state === 'idle' && !isWrite  && 'border-navy-400/25 bg-slate-900/50 hover:border-navy-400/50',
        state === 'running' && 'border-brand-400/60 bg-slate-900/60',
      )}
    >
      {/* Write actions get a warm accent rail so a mutation never looks like a lookup. */}
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          state === 'done'   ? 'bg-emerald-400'
          : state === 'failed' ? 'bg-red-400'
          : isWrite ? 'bg-gradient-to-b from-brand-300 to-brand-500'
          : 'bg-gradient-to-b from-navy-300 to-navy-500',
        )}
      />

      <div className="flex items-start gap-3 px-3.5 py-3 pl-4">
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            state === 'done'   ? 'bg-emerald-400/15 text-emerald-300'
            : state === 'failed' ? 'bg-red-400/15 text-red-300'
            : isWrite ? 'bg-brand-400/15 text-brand-300'
            : 'bg-navy-400/15 text-navy-200',
          )}
        >
          {state === 'running'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : state === 'done'
              ? <Check className="h-4 w-4" />
              : state === 'failed'
                ? <AlertTriangle className="h-4 w-4" />
                : <Icon className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-slate-100">{action.label}</span>
            {isWrite && !spent && (
              <span className="rounded bg-brand-400/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-brand-300">
                needs approval
              </span>
            )}
          </div>

          {action.preview?.title && (
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{action.preview.title}</p>
          )}

          {action.preview?.lines?.length ? (
            <dl className="mt-2 space-y-1">
              {action.preview.lines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-[11.5px] leading-snug">
                  <dt className="w-[74px] shrink-0 truncate text-slate-500">{line.label}</dt>
                  <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {line.before !== undefined && (
                      <>
                        <span className="truncate text-slate-500 line-through decoration-slate-600">{line.before}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
                      </>
                    )}
                    <span className="min-w-0 break-words font-medium text-slate-100">{line.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {outcome && (
            <p className={cn('mt-2 text-[11.5px]', state === 'failed' ? 'text-red-300' : 'text-emerald-300')}>
              {outcome}
            </p>
          )}
        </div>

        {!spent && (
          <button
            onClick={run}
            disabled={disabled || state === 'running'}
            className={cn(
              'mt-0.5 shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all',
              'disabled:cursor-not-allowed disabled:opacity-40',
              isWrite
                ? 'bg-brand-400 text-slate-900 hover:bg-brand-300 hover:shadow-glow'
                : 'bg-navy-500/80 text-white hover:bg-navy-400',
            )}
          >
            {state === 'running' ? 'Working…' : isWrite ? 'Apply' : 'Go'}
          </button>
        )}
      </div>
    </motion.div>
  )
}
