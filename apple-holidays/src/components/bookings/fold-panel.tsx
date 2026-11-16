'use client'

/**
 * A booking-page section that starts minimised to a single bold header and
 * opens in place.
 *
 * The panel inside stays mounted while folded — only hidden — so it loads and
 * behaves exactly as it did before it was wrapped (its counts, its polling,
 * anything another part of the page reads from it). Open/closed is remembered
 * per user and per section.
 *
 * The wrapper carries `data-nav`, and the section nav opens it when someone
 * jumps to it (see `bk-fold:open` in section-nav.tsx).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, type LucideIcon } from 'lucide-react'

export type FoldTone = 'sky' | 'violet' | 'emerald' | 'amber' | 'rose'

interface FoldPanelProps {
  /** Stable key for remembering open/closed, e.g. "precheck". */
  id: string
  userId?: string | null
  title: string
  subtitle?: string
  icon: LucideIcon
  tone?: FoldTone
  /** Short tags shown on the header — what the panel covers. */
  chips?: string[]
  navLabel: string
  navIcon?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

const keyFor = (userId: string | null | undefined, id: string) => `ops.bookingFold.${userId || 'anon'}.${id}`

export default function FoldPanel({
  id, userId, title, subtitle, icon: Icon, tone = 'sky', chips, navLabel, navIcon, defaultOpen = false, children,
}: FoldPanelProps) {
  const [open, setOpenState] = useState(defaultOpen)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(keyFor(userId, id))
      if (saved === '1' || saved === '0') setOpenState(saved === '1')
    } catch { /* storage blocked — keep the default */ }
  }, [userId, id])

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    try { localStorage.setItem(keyFor(userId, id), next ? '1' : '0') } catch { /* ignore */ }
  }, [userId, id])

  // The section nav asks a folded section to open before scrolling to it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onOpen = () => setOpen(true)
    el.addEventListener('bk-fold:open', onOpen)
    return () => el.removeEventListener('bk-fold:open', onOpen)
  }, [setOpen])

  const bodyId = `fold-body-${id}`

  return (
    <section
      ref={ref}
      data-nav={navLabel}
      data-nav-icon={navIcon}
      data-fold={open ? 'open' : 'collapsed'}
      data-tone={tone}
      className="bk-fold"
    >
      <button
        type="button"
        className="bk-fold-head group"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="bk-fold-icon"><Icon className="w-5 h-5" /></span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="bk-fold-title">{title}</span>
            {chips?.map(c => <span key={c} className="bk-fold-chip">{c}</span>)}
          </span>
          {subtitle && <span className="bk-fold-sub mt-0.5 block truncate">{subtitle}</span>}
        </span>

        <span className="bk-fold-toggle" aria-hidden>
          <span className="hidden sm:inline">{open ? 'Minimise' : 'Expand'}</span>
          <span className="bk-fold-toggle-btn">
            {open ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </span>
        </span>
      </button>

      <div id={bodyId} className={open ? 'bk-fold-body' : 'hidden'}>
        {children}
      </div>
    </section>
  )
}
