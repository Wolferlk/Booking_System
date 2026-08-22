'use client'

/**
 * The pre-confirmation accuracy checklist.
 *
 * Blocking failures are shown first and cannot be dismissed — the Confirm
 * button stays disabled until the underlying data is fixed. Warnings each get a
 * reason box, and the reason is mandatory: the point is not to slow anyone
 * down, it is that six months later somebody can see *why* a stay was confirmed
 * 40% over budget, and who decided that.
 */

import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GateCheck, GateResult } from '@/lib/reservation-gate'

interface Props {
  gate: GateResult
  waivers: Record<string, string>
  onWaiverChange: (id: string, reason: string) => void
  /** Hide the reason boxes when the gate is only being previewed. */
  readOnly?: boolean
}

export default function GateChecklist({ gate, waivers, onWaiverChange, readOnly }: Props) {
  const passed = gate.checks.filter(c => c.passed)

  return (
    <div className="space-y-4">
      {gate.blockers.length > 0 && (
        <Section
          tone="block"
          icon={<ShieldAlert className="h-4 w-4" />}
          title={`${gate.blockers.length} blocking issue${gate.blockers.length === 1 ? '' : 's'}`}
          blurb="These must be corrected on the stay before it can be confirmed."
        >
          {gate.blockers.map(c => <CheckRow key={c.id} check={c} tone="block" />)}
        </Section>
      )}

      {gate.warnings.length > 0 && (
        <Section
          tone="warn"
          icon={<AlertTriangle className="h-4 w-4" />}
          title={`${gate.warnings.length} warning${gate.warnings.length === 1 ? '' : 's'}`}
          blurb={readOnly
            ? 'Each of these needs a written reason at the moment of confirmation.'
            : 'Confirming anyway is allowed, but each needs a reason. It is recorded against your name.'}
        >
          {gate.warnings.map(c => (
            <div key={c.id} className="space-y-1.5">
              <CheckRow check={c} tone="warn" />
              {!readOnly && (
                <input
                  type="text"
                  value={waivers[c.id] ?? ''}
                  onChange={e => onWaiverChange(c.id, e.target.value)}
                  placeholder="Reason for accepting this…"
                  className={cn(
                    'ml-6 w-[calc(100%-1.5rem)] rounded-md border px-2.5 py-1.5 text-xs',
                    'focus:outline-none focus:ring-2 focus:ring-amber-400',
                    waivers[c.id]?.trim() ? 'border-slate-300 bg-white' : 'border-amber-300 bg-amber-50/50',
                  )}
                />
              )}
            </div>
          ))}
        </Section>
      )}

      {passed.length > 0 && (
        <Section
          tone="ok"
          icon={<CheckCircle2 className="h-4 w-4" />}
          title={`${passed.length} check${passed.length === 1 ? '' : 's'} passed`}
        >
          {passed.map(c => <CheckRow key={c.id} check={c} tone="ok" />)}
        </Section>
      )}
    </div>
  )
}

const TONES = {
  block: { wrap: 'border-red-200 bg-red-50/60', head: 'text-red-800', dot: 'text-red-500' },
  warn:  { wrap: 'border-amber-200 bg-amber-50/60', head: 'text-amber-900', dot: 'text-amber-500' },
  ok:    { wrap: 'border-emerald-200 bg-emerald-50/50', head: 'text-emerald-800', dot: 'text-emerald-500' },
} as const

type Tone = keyof typeof TONES

function Section({
  tone, icon, title, blurb, children,
}: { tone: Tone; icon: React.ReactNode; title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-lg border p-3', TONES[tone].wrap)}>
      <div className={cn('mb-2 flex items-center gap-2 text-xs font-semibold', TONES[tone].head)}>
        {icon}
        {title}
      </div>
      {blurb && <p className="mb-2.5 text-[11px] leading-relaxed text-slate-600">{blurb}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function CheckRow({ check, tone }: { check: GateCheck; tone: Tone }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('mt-[3px] text-xs leading-none', TONES[tone].dot)}>
        {check.passed ? '✓' : '✗'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-800">{check.label}</div>
        {check.detail && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{check.detail}</div>
        )}
      </div>
    </div>
  )
}
