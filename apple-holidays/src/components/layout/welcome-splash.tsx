'use client'

/**
 * Animated first-load welcome card.
 *
 * Shows a branded splash the first time a user opens this version of the app
 * in a given browser. Gated by a localStorage key that includes the version,
 * so bumping APP_VERSION re-shows it once after each release.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, ArrowRight, Bot, Workflow, Globe2, ShieldCheck } from 'lucide-react'

const APP_VERSION = '1.0.0'
const STORAGE_KEY = `welcome_splash_seen_v${APP_VERSION}`

const FEATURES = [
  { icon: Bot, label: 'AI-Powered Intake' },
  { icon: Workflow, label: 'Multi-Team Workflow' },
  { icon: Globe2, label: '4-Country Operations' },
  { icon: ShieldCheck, label: 'Secure & Role-Based' },
]

// Deterministic sparkle positions so SSR/CSR markup matches.
const SPARKS = [
  { top: '12%', left: '10%', delay: 0.1, size: 10 },
  { top: '22%', left: '84%', delay: 0.5, size: 14 },
  { top: '68%', left: '8%', delay: 0.9, size: 12 },
  { top: '78%', left: '88%', delay: 0.3, size: 9 },
  { top: '44%', left: '94%', delay: 1.1, size: 8 },
  { top: '86%', left: '46%', delay: 0.7, size: 11 },
  { top: '8%', left: '52%', delay: 1.3, size: 9 },
  { top: '58%', left: '78%', delay: 0.2, size: 7 },
]

export default function WelcomeSplash() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem(STORAGE_KEY)) {
      setOpen(true)
    }
  }, [])

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, '1')
      // Lets the OPS_AI feature guide queue itself behind this splash instead
      // of stacking two modals on top of each other.
      window.dispatchEvent(new CustomEvent('welcome-splash:dismissed'))
    }
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.85, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl shadow-brand-500/20"
          >
            {/* Animated aurora glow */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[140%] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500/40 via-amber-400/30 to-brand-600/40 blur-3xl"
              animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.08, 1] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Floating sparkles */}
            {SPARKS.map((s, i) => (
              <motion.div
                key={i}
                aria-hidden
                className="pointer-events-none absolute text-brand-300/70"
                style={{ top: s.top, left: s.left }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 0.4, 1], scale: [0.6, 1.1, 0.8, 1], y: [0, -8, 0] }}
                transition={{ duration: 3, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles style={{ width: s.size, height: s.size }} />
              </motion.div>
            ))}

            {/* Top shimmer line */}
            <div className="relative h-1 w-full overflow-hidden bg-brand-500/10">
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-400 to-transparent"
                animate={{ x: ['-120%', '360%'] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <div className="relative px-8 pb-8 pt-10 text-center">
              {/* Logo */}
              <motion.div
                initial={{ scale: 0, rotate: -25 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.15 }}
                className="mx-auto mb-5 flex h-24 w-24 items-center justify-center"
              >
                <motion.div
                  className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-xl shadow-brand-500/40"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {/* Rotating ring */}
                  <motion.span
                    aria-hidden
                    className="absolute inset-[-6px] rounded-3xl border-2 border-dashed border-brand-400/60"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                  />
                  <Image
                    src="/png/apple-logo.png"
                    alt="Apple Holidays logo"
                    width={72}
                    height={72}
                    className="object-contain p-1"
                    priority
                  />
                </motion.div>
              </motion.div>

              {/* Version badge */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-300"
              >
                <Sparkles className="h-3 w-3" />
                Version {APP_VERSION} · Now Live
              </motion.div>

              {/* Title */}
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="bg-gradient-to-r from-white via-brand-100 to-brand-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
              >
                Apple Holidays
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.52 }}
                className="mt-0.5 text-sm font-medium uppercase tracking-[0.25em] text-slate-400"
              >
                Booking System
              </motion.p>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-slate-400"
              >
                Welcome to your end-to-end travel operations platform — from
                AI-powered booking intake through ground operations to a live
                customer portal, all in one place.
              </motion.p>

              {/* Feature chips */}
              <div className="mt-6 grid grid-cols-2 gap-2.5">
                {FEATURES.map((f, i) => (
                  <motion.div
                    key={f.label}
                    initial={{ opacity: 0, scale: 0.8, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: 0.7 + i * 0.08, type: 'spring', stiffness: 200, damping: 16 }}
                    className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-left"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
                      <f.icon className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-medium text-slate-200">{f.label}</span>
                  </motion.div>
                ))}
              </div>

              {/* CTA */}
              <motion.button
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.05 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={dismiss}
                className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3 text-sm font-bold text-slate-900 shadow-lg shadow-brand-500/30 transition-shadow hover:shadow-brand-500/50"
              >
                Get Started
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </motion.button>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.2 }}
                className="mt-3 text-[11px] text-slate-600"
              >
                © 2026 Apple Holidays MMT · General Availability Release
              </motion.p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
