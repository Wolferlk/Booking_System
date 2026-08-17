'use client'

/**
 * The record popup — the payoff of the whole feature.
 *
 * Someone in Accounts drops "IS48541" into a message as a P&L, and an OPS user
 * opens it here, in place, without an Accounts login. The reverse works too: a
 * booking file or a tour agenda shared from OPS opens inside the Accounts app.
 *
 * ALWAYS A FRESH READ. Never the snapshot stored on the message — an invoice
 * popup showing last month's balance because that is what the bubble happened to
 * capture would be worse than no popup. The request goes out on every open and
 * the footer stamps when it was read.
 *
 * The document shape (hero + stats + sections) is neutral by design, so this one
 * component renders all four card types and a fifth would need no UI at all.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { AlertCircle, Bolt, X } from 'lucide-react'
import { chatApi } from './chat-store'
import { Aurora, Chip } from './bits'
import type { CardDocument } from './types'

export interface CardTarget { type: string; ref: string; conversationId?: number }

export function CardViewer({ target, onClose }: { target: CardTarget | null; onClose: () => void }) {
  const [doc, setDoc] = useState<CardDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) { setDoc(null); setError(null); return }

    let cancelled = false
    setDoc(null); setError(null)

    const qs = new URLSearchParams({ type: target.type, ref: target.ref })
    if (target.conversationId) qs.set('conversation_id', String(target.conversationId))

    chatApi<{ document: CardDocument }>(`/cards/open?${qs}`)
      .then(d => { if (!cancelled) setDoc(d.document) })
      .catch(err => { if (!cancelled) setError(err.message) })

    return () => { cancelled = true }
  }, [target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [target, onClose])

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-5 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl"
            initial={{ opacity: 0, y: 28, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            {/* ---- hero ---- */}
            <div
              className="relative overflow-hidden px-7 pb-5 pt-6 text-white"
              style={{ background: `linear-gradient(120deg, #0f172a 0%, #1e293b 46%, ${doc?.accent ?? '#6366f1'} 145%)` }}
            >
              <Aurora />
              <button
                onClick={onClose}
                className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl border border-white/25 bg-white/10 transition hover:rotate-90 hover:bg-white/25"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="relative z-[2]">
                <div className="flex items-center gap-2 text-[.6rem] font-extrabold uppercase tracking-[.16em] text-teal-200">
                  {doc ? <>{doc.type} <span className="opacity-60">·</span> LIVE</> : 'Reading the live record…'}
                </div>
                <h2 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight">
                  {doc?.title ?? target.ref}
                </h2>
                {doc?.subtitle && <p className="mt-1 text-sm text-slate-300">{doc.subtitle}</p>}
                {!!doc?.badges?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {doc.badges.map((b, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-white/25 bg-white/15 px-2.5 py-[3px] text-[.62rem] font-extrabold uppercase tracking-wide"
                        style={
                          b.tone === 'good' ? { background: 'rgba(16,185,129,.9)', borderColor: 'transparent' }
                            : b.tone === 'bad' ? { background: 'rgba(244,63,94,.9)', borderColor: 'transparent' }
                            : b.tone === 'warn' ? { background: 'rgba(245,158,11,.92)', borderColor: 'transparent', color: '#1f2937' }
                            : undefined
                        }
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ---- stat strip ---- */}
            {!!doc?.stats?.length && (
              <div className="grid gap-px border-b border-slate-200 bg-slate-200" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
                {doc.stats.map((s, i) => (
                  <motion.div
                    key={i}
                    className="bg-white px-3 py-3 text-center"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, type: 'spring', stiffness: 320, damping: 26 }}
                  >
                    <b className={
                      s.tone === 'good' ? 'block text-[1.04rem] font-extrabold tracking-tight text-emerald-700'
                        : s.tone === 'bad' ? 'block text-[1.04rem] font-extrabold tracking-tight text-rose-700'
                        : 'block text-[1.04rem] font-extrabold tracking-tight text-slate-900'
                    }>{s.value}</b>
                    <span className="mt-0.5 block text-[.57rem] font-extrabold uppercase tracking-[.09em] text-slate-400">{s.label}</span>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ---- body ---- */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {error && (
                <div className="py-14 text-center text-slate-400">
                  <AlertCircle className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {!doc && !error && (
                <div className="space-y-3">
                  {[90, 160, 120].map((h, i) => (
                    <div key={i} className="animate-pulse rounded-xl bg-slate-200/70" style={{ height: h }} />
                  ))}
                </div>
              )}

              {doc?.sections.map((sec, i) => (
                <motion.section
                  key={i}
                  className="mb-3.5 overflow-hidden rounded-2xl border border-slate-200 bg-white"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.055, 0.4) }}
                >
                  <header className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[.68rem] font-extrabold uppercase tracking-[.11em] text-slate-600">
                    {sec.title}
                  </header>

                  {sec.type === 'table' && (
                    // Wide tables scroll inside their own box; the page never
                    // scrolls sideways.
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[.78rem]">
                        <thead>
                          <tr>
                            {(sec.columns ?? []).map(c => (
                              <th key={c} className="whitespace-nowrap border-b border-slate-200 px-2.5 py-2 text-left text-[.58rem] font-extrabold uppercase tracking-[.09em] text-slate-400">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(sec.rows ?? []).map((row, r) => (
                            <tr key={r} className="hover:bg-slate-50">
                              {(row as Array<string | number | null>).map((cell, c) => (
                                <td key={c} className="border-b border-dashed border-slate-100 px-2.5 py-2 text-slate-700">{cell ?? '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sec.type === 'rows' && (
                    <div className="px-4 pb-3 pt-1">
                      {(sec.rows ?? []).map((row, r) => {
                        const [label, value] = row as unknown as [string, string]
                        return (
                          <div key={r} className="flex justify-between gap-5 border-b border-dashed border-slate-100 py-2 text-[.8rem] last:border-none">
                            <span className="font-semibold text-slate-500">{label}</span>
                            <b className="text-right font-bold text-slate-900">{String(value)}</b>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {sec.type === 'text' && (
                    <div className="whitespace-pre-wrap px-4 py-3 text-[.8rem] leading-relaxed text-slate-700">{sec.text}</div>
                  )}
                </motion.section>
              ))}
            </div>

            {doc && (
              <footer className="flex items-center gap-2.5 border-t border-slate-200 bg-white px-6 py-3 text-[.68rem] font-semibold text-slate-400">
                <Bolt className="h-3.5 w-3.5" style={{ color: doc.accent }} />
                <span>{doc.footnote} Read at {doc.read_at}.</span>
                <Chip label={doc.ref} tone="ghost" className="ml-auto" />
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
