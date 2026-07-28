'use client'

/**
 * SectionNav — floating scrollspy rail for long detail pages.
 *
 * Discovers every element in the document carrying a `data-nav="Label"`
 * attribute (optionally `data-nav-icon="key"`), in DOM order, and renders a
 * fixed glass rail on the right edge:
 *
 *  - a circular scroll-progress ring at the top
 *  - one dot per section; hovering the rail expands it into labeled pills
 *  - the section currently under the reading line is highlighted with an
 *    animated indicator; clicking any item smooth-scrolls to that section
 *  - a back-to-top button at the bottom
 *
 * Sections may appear/disappear as data loads (role-gated panels), so the rail
 * re-scans the DOM through a debounced MutationObserver rather than taking a
 * static list as props.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, ShieldCheck, Star, ClipboardCheck, PhoneCall, AudioLines,
  MessageCircle, Plane, Contact, Siren, Map, FileText, TrendingUp,
  Calculator, Car, History, ArrowUp, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Icon keys usable in `data-nav-icon`. Unknown keys fall back to a plain dot. */
const NAV_ICONS: Record<string, LucideIcon> = {
  overview: Activity,
  shield: ShieldCheck,
  star: Star,
  checklist: ClipboardCheck,
  phone: PhoneCall,
  transcript: AudioLines,
  whatsapp: MessageCircle,
  plane: Plane,
  contact: Contact,
  emergency: Siren,
  itinerary: Map,
  notes: FileText,
  pnl: TrendingUp,
  accounts: Calculator,
  driver: Car,
  history: History,
}

/** Pixel line below the sticky header used to decide which section is "current". */
const READING_LINE = 170
/** Where the top of a section lands after a click-scroll. */
const SCROLL_OFFSET = 110

type NavSection = { el: HTMLElement; label: string; icon?: string }

export default function SectionNav() {
  const [sections, setSections] = useState<NavSection[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const raf = useRef<number>(0)

  // ── Discover sections (and keep discovering as panels mount/unmount) ──
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const scan = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-nav]'))
        .map(el => ({ el, label: el.dataset.nav ?? '', icon: el.dataset.navIcon }))
        .filter(s => s.label)
      setSections(prev => {
        if (prev.length === found.length && prev.every((p, i) => p.el === found[i].el)) return prev
        return found
      })
    }
    scan()
    const mo = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(scan, 300)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect(); clearTimeout(timer) }
  }, [])

  // ── Scrollspy + progress (rAF-throttled window scroll) ──
  useEffect(() => {
    const update = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)

      if (sections.length === 0) return
      // Bottom of page → last section wins even if it never crosses the line.
      if (max > 0 && window.scrollY >= max - 4) { setActiveIdx(sections.length - 1); return }
      let idx = 0
      for (let i = 0; i < sections.length; i++) {
        if (sections[i].el.getBoundingClientRect().top <= READING_LINE) idx = i
        else break
      }
      setActiveIdx(idx)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf.current)
    }
  }, [sections])

  const goTo = useCallback((s: NavSection) => {
    const top = s.el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [])

  if (sections.length < 2) return null

  const ring = 2 * Math.PI * 9 // r=9 progress circle circumference

  return (
    <nav
      aria-label="Page sections"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className="hidden lg:flex fixed right-4 top-1/2 -translate-y-1/2 z-30 flex-col items-end print:hidden"
    >
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        className={cn(
          'flex flex-col rounded-2xl border border-slate-200/80 bg-white/85 backdrop-blur-xl',
          'shadow-[0_8px_30px_rgba(15,23,42,0.12)] overflow-hidden',
          expanded ? 'px-2 py-2 w-56' : 'px-1.5 py-2 items-center',
        )}
      >
        {/* Scroll-progress ring */}
        <div className={cn('flex items-center gap-2 pb-1.5 mb-1 border-b border-slate-100', expanded ? 'px-2 self-stretch' : 'justify-center')}>
          <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 flex-shrink-0">
            <circle cx="12" cy="12" r="9" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
            <circle
              cx="12" cy="12" r="9" fill="none"
              stroke="url(#sn-grad)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)}
            />
            <defs>
              <linearGradient id="sn-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>
          </svg>
          {expanded && (
            <span className="text-[10px] font-bold tabular-nums text-slate-500 tracking-wide">
              {Math.round(progress * 100)}% · {activeIdx + 1}/{sections.length}
            </span>
          )}
        </div>

        {/* Section items */}
        <div className={cn('flex flex-col', expanded ? 'gap-0.5 self-stretch max-h-[60vh] overflow-y-auto overscroll-contain pr-0.5' : 'gap-1 items-center')}>
          {sections.map((s, i) => {
            const Icon = s.icon ? NAV_ICONS[s.icon] : undefined
            const active = i === activeIdx
            return (
              <button
                key={`${s.label}-${i}`}
                onClick={() => goTo(s)}
                title={expanded ? undefined : s.label}
                className={cn(
                  'relative flex items-center rounded-lg transition-colors',
                  expanded ? 'gap-2.5 px-2 py-1.5 text-left w-full' : 'justify-center w-7 h-7',
                  active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100/70',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sn-active"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-amber-50 to-rose-50 border border-amber-200/70"
                  />
                )}
                <span className="relative flex-shrink-0 flex items-center justify-center">
                  {Icon ? (
                    <Icon className={cn('w-3.5 h-3.5', active && 'text-amber-600')} />
                  ) : (
                    <span className={cn('rounded-full', active ? 'w-2 h-2 bg-amber-500' : 'w-1.5 h-1.5 bg-slate-300')} />
                  )}
                </span>
                <AnimatePresence>
                  {expanded && (
                    <motion.span
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={{ duration: 0.15 }}
                      className={cn('relative text-xs truncate', active ? 'font-semibold' : 'font-medium')}
                    >
                      {s.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            )
          })}
        </div>

        {/* Back to top */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={cn(
            'mt-1 pt-1.5 border-t border-slate-100 flex items-center gap-2 text-slate-400 hover:text-slate-700 transition-colors',
            expanded ? 'px-2 py-1 self-stretch' : 'justify-center w-7 h-7',
          )}
          title="Back to top"
        >
          <ArrowUp className="w-3.5 h-3.5 flex-shrink-0" />
          {expanded && <span className="text-[11px] font-medium">Back to top</span>}
        </button>
      </motion.div>
    </nav>
  )
}
