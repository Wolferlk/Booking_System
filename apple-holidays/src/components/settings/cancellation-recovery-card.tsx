'use client'

/**
 * Cancellation Recovery & Full Cancel.
 *
 * A cancellation used to be one thing and it was final. This card splits it in
 * two and sets the terms for both: how long an ordinary cancellation stays
 * reversible and who may reverse it, and whether the sealed, never-coming-back
 * cancellation is offered at all.
 *
 * The card is deliberately shaped like the thing it describes — the timeline
 * across the top is the actual life of a cancelled booking under the current
 * settings, so the effect of moving the window is visible before anything is
 * saved.
 */

import { useState } from 'react'
import { RotateCcw, ShieldX, Users, Clock, MessageSquareWarning, BellRing, Lock, Info } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  CANCEL_POLICY_KEYS, DEFAULT_CANCEL_POLICY, RECOVERY_WINDOW_STEPS,
  AUDIENCE_LABELS, AUDIENCE_ROLES, windowLabel, parseCancellationPolicy,
  type CancelAudience, type CancellationSettingsSlice,
} from '@/lib/cancellation-policy'

interface Props {
  /** The slice of the `system_settings` map this card owns. */
  settings: CancellationSettingsSlice
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

/* ── Small shared controls ──────────────────────────────────────────────── */

function Switch({ on, tone = 'brand' }: { on: boolean; tone?: 'brand' | 'danger' }) {
  const bg = on ? (tone === 'danger' ? 'bg-red-600' : 'bg-brand-500') : 'bg-slate-300'
  return (
    <span className={`relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors ${bg}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </span>
  )
}

function ToggleRow({
  k, on, saving, onSave, icon, title, blurb, tone = 'brand', disabled,
}: {
  k: string; on: boolean; saving: string | null
  onSave: (key: string, value: string) => Promise<void>
  icon: React.ReactNode; title: string; blurb: string
  tone?: 'brand' | 'danger'; disabled?: boolean
}) {
  return (
    <button
      onClick={() => void onSave(k, on ? 'false' : 'true')}
      disabled={saving === k || disabled}
      className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
        <span className="block text-[11.5px] leading-snug text-slate-500">{blurb}</span>
      </span>
      <Switch on={on} tone={tone} />
    </button>
  )
}

/** Who may act — one choice, widest last, so the audiences can never conflict. */
function AudiencePicker({
  settingKey, value, saving, onSave, tone,
}: {
  settingKey: string; value: CancelAudience; saving: string | null
  onSave: (key: string, value: string) => Promise<void>
  tone: 'brand' | 'danger'
}) {
  const order: CancelAudience[] = ['admins', 'accounts', 'ops']
  const active = tone === 'danger'
    ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-brand-300 bg-brand-50 text-brand-800'

  return (
    <div className="grid gap-1.5 sm:grid-cols-3">
      {order.map(a => {
        const on = value === a
        return (
          <button
            key={a}
            onClick={() => void onSave(settingKey, a)}
            disabled={saving === settingKey}
            className={`rounded-xl border p-2.5 text-left transition-colors disabled:opacity-60 ${
              on ? active : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="block text-[12px] font-bold">{AUDIENCE_LABELS[a].title}</span>
            <span className="mt-0.5 block text-[10.5px] leading-snug opacity-80">{AUDIENCE_LABELS[a].blurb}</span>
            <span className="mt-1.5 block text-[9.5px] font-mono uppercase tracking-wide opacity-60">
              {AUDIENCE_ROLES[a].length} role{AUDIENCE_ROLES[a].length === 1 ? '' : 's'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── The card ───────────────────────────────────────────────────────────── */

export default function CancellationRecoveryCard({ settings, saving, onSave }: Props) {
  const p = parseCancellationPolicy(settings)
  const [sealAck, setSealAck] = useState(false)

  // "A booking cancelled right now stays recoverable until…" — the window in
  // real dates, because 14 vs 30 days means nothing until you see the date it
  // lands on.
  const until = p.recoveryWindowDays > 0
    ? new Date(Date.now() + p.recoveryWindowDays * 86_400_000)
    : null

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <RotateCcw className="h-4 w-4 text-slate-400" /> Cancellation Recovery &amp; Full Cancel
        </h3>
        <p className="mt-1 text-[11.5px] text-slate-500">
          A cancellation raised by mistake used to be permanent — the file had to be rebuilt by hand.
          Now every cancellation is reversible for a while, and a second, sealed kind of cancellation
          exists for the files that are genuinely never coming back.
        </p>
      </CardHeader>

      <CardBody className="space-y-6">

        {/* What actually happens to a cancelled booking, under these settings. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="flex-1 rounded-lg border border-red-200 bg-white px-3 py-2">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-red-500">Cancelled</p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-slate-800">Accounts approved it</p>
              <p className="text-[10.5px] leading-snug text-slate-500">Off every active list. Nothing deleted.</p>
            </div>

            <div className="hidden items-center px-1 text-slate-300 sm:flex">→</div>

            <div className={`flex-1 rounded-lg border px-3 py-2 ${
              p.recoveryEnabled ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-slate-100'
            }`}>
              <p className={`text-[9.5px] font-bold uppercase tracking-wider ${p.recoveryEnabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                {p.recoveryEnabled ? 'Recoverable' : 'Recovery off'}
              </p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-slate-800">
                {p.recoveryEnabled ? windowLabel(p.recoveryWindowDays) : 'No way back'}
              </p>
              <p className="text-[10.5px] leading-snug text-slate-500">
                {p.recoveryEnabled
                  ? until
                    ? `Cancel today → back until ${until.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : 'Can be pulled back at any time, forever'
                  : 'Every cancellation is final the moment it is approved'}
              </p>
            </div>

            <div className="hidden items-center px-1 text-slate-300 sm:flex">→</div>

            <div className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Closed</p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-slate-800">
                {p.recoveryEnabled && !until ? 'Only when sealed' : 'Window shuts'}
              </p>
              <p className="text-[10.5px] leading-snug text-slate-500">
                Stays fully readable — it just cannot come back.
              </p>
            </div>
          </div>
        </div>

        {/* ── Recovery ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold text-slate-800">Recover a cancelled booking</p>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              p.recoveryEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {p.recoveryEnabled ? 'On' : 'Off'}
            </span>
          </div>

          <ToggleRow
            k={CANCEL_POLICY_KEYS.recoveryEnabled}
            on={p.recoveryEnabled}
            saving={saving}
            onSave={onSave}
            icon={<RotateCcw className="h-4 w-4" />}
            title="Allow recovery"
            blurb="A cancelled booking can be put back at the exact status it held before the cancellation was requested — same itinerary, same passengers, same reference."
          />

          <div className={p.recoveryEnabled ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-45'}>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <Clock className="h-3.5 w-3.5" /> How long the door stays open
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RECOVERY_WINDOW_STEPS.map(d => (
                  <button
                    key={d}
                    onClick={() => void onSave(CANCEL_POLICY_KEYS.recoveryWindowDays, String(d))}
                    disabled={saving === CANCEL_POLICY_KEYS.recoveryWindowDays}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
                      p.recoveryWindowDays === d
                        ? d === 0 ? 'bg-amber-500 text-white' : 'bg-brand-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {windowLabel(d)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Counted from the moment accounts approved the cancellation.{' '}
                {p.recoveryWindowDays === 0
                  ? <span className="text-amber-700">No limit means a booking settled and invoiced months ago can still be revived — leave this on only if somebody watches the cancelled list.</span>
                  : <>{windowLabel(DEFAULT_CANCEL_POLICY.recoveryWindowDays)} is the shipped default: the mistakes this exists for surface within hours, not seasons.</>}
              </p>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <Users className="h-3.5 w-3.5" /> Who may recover
              </p>
              <AudiencePicker
                settingKey={CANCEL_POLICY_KEYS.recoveryAudience}
                value={p.recoveryAudience}
                saving={saving}
                onSave={onSave}
                tone="brand"
              />
            </div>

            <ToggleRow
              k={CANCEL_POLICY_KEYS.recoveryReason}
              on={p.recoveryRequireReason}
              saving={saving}
              onSave={onSave}
              icon={<MessageSquareWarning className="h-4 w-4" />}
              title="Ask why it is coming back"
              blurb="The reason is written into the booking's status trail next to the cancellation it reverses."
            />

            <ToggleRow
              k={CANCEL_POLICY_KEYS.recoveryNotify}
              on={p.recoveryNotify}
              saving={saving}
              onSave={onSave}
              icon={<BellRing className="h-4 w-4" />}
              title="Tell accounts and the original requester"
              blurb="A booking quietly returning to the live pipeline is how a cancelled file gets operated by accident."
            />
          </div>
        </div>

        {/* ── Full cancel ──────────────────────────────────────────────── */}
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-3.5">
          <div className="flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold text-red-900">Full cancel — sealed, never recoverable</p>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              p.fullEnabled ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600'
            }`}>
              {p.fullEnabled ? 'Offered' : 'Hidden'}
            </span>
          </div>

          <p className="text-[11.5px] leading-relaxed text-red-800/80">
            Closes the file for good. A sealed cancellation ignores the recovery window and the
            audience above — no role, and no later change to these settings, can bring the booking
            back. Everything stays on screen and in every report; only the way back is removed.
          </p>

          <p className="rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-red-800">
            <strong>It skips the accounts queue.</strong> Run on a live booking, a full cancel
            cancels it outright instead of holding it at <em>Pending Approval</em> — the only path
            in the system that does. The cancellation notice still goes out and the whole trail is
            still written; what is missing is the second pair of eyes. Run on a booking that is
            already cancelled, it changes no status at all and only closes the recovery window.
          </p>

          {!p.fullEnabled && (
            <label className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-white px-3 py-2.5">
              <input
                type="checkbox"
                checked={sealAck}
                onChange={e => setSealAck(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-red-600"
              />
              <span className="text-[11.5px] leading-snug text-slate-700">
                I understand a full cancel cannot be undone by anyone, including an admin.
              </span>
            </label>
          )}

          <ToggleRow
            k={CANCEL_POLICY_KEYS.fullEnabled}
            on={p.fullEnabled}
            saving={saving}
            onSave={onSave}
            icon={<ShieldX className="h-4 w-4" />}
            title="Offer full cancel on the booking page"
            blurb={p.fullEnabled
              ? 'The sealed option sits beside the ordinary cancellation, marked as final.'
              : 'Tick the box above to switch this on.'}
            tone="danger"
            disabled={!p.fullEnabled && !sealAck}
          />

          <div className={p.fullEnabled ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-45'}>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-400">
                <Users className="h-3.5 w-3.5" /> Who may seal a booking
              </p>
              <AudiencePicker
                settingKey={CANCEL_POLICY_KEYS.fullAudience}
                value={p.fullAudience}
                saving={saving}
                onSave={onSave}
                tone="danger"
              />
            </div>

            <ToggleRow
              k={CANCEL_POLICY_KEYS.fullConfirmRef}
              on={p.fullConfirmRef}
              saving={saving}
              onSave={onSave}
              icon={<Lock className="h-4 w-4" />}
              title="Type the booking reference to confirm"
              blurb="The reference has to be typed out before the seal is accepted — an irreversible action should not be one misplaced click."
              tone="danger"
            />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          <Info className="mt-px h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
          <span>
            Neither action deletes anything. A recovery moves the status back and files the whole
            cancellation record — who, why, the fees, the approval — into the booking&apos;s status
            trail, so a booking that has been round the loop still reads its own history. A full
            cancel adds a sealing entry to that same trail and changes nothing else.
          </span>
        </p>
      </CardBody>
    </Card>
  )
}
