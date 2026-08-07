'use client'

/**
 * Configuration — everything about the monitor is editable here: which mailboxes
 * are swept, how senders map to sales people and agents, the schedule, and which
 * workbook/tab receives the rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, Copy, ExternalLink, FilterX, Loader2,
  Mail, Plug, Plus, RefreshCw, Save, Table2, Tags, Trash2, Users,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import { cn, formatDateTime } from '@/lib/utils'
import { Field, Toggle, inputCls } from './ui'
import type { QmBackupInfo, QmConfig, QmMailbox, QmRule, QmSheetInfo } from './types'

export default function ConfigTab({
  config, onConfigChange, onSheetChange,
}: {
  config: QmConfig | null
  onConfigChange: (config: QmConfig) => void
  onSheetChange: (info: QmSheetInfo | null) => void
}) {
  return (
    <div className="space-y-6">
      <ScheduleCard config={config} onConfigChange={onConfigChange} />
      <SheetCard config={config} onConfigChange={onConfigChange} onSheetChange={onSheetChange} />
      <ExclusionCard config={config} onConfigChange={onConfigChange} />
      <MailboxesCard />
      <SenderRulesCard />
    </div>
  )
}

function Card({
  icon, title, description, children, actions,
}: {
  icon: React.ReactNode; title: string; description?: string
  children: React.ReactNode; actions?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex-shrink-0">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────

function ScheduleCard({
  config, onConfigChange,
}: { config: QmConfig | null; onConfigChange: (c: QmConfig) => void }) {
  const [draft, setDraft] = useState<QmConfig | null>(config)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(config) }, [config])

  async function save(patch: Partial<QmConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/query-monitor/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      onConfigChange(d.data.config)
      setDraft(d.data.config)
      toast.success('Saved')
    } finally { setSaving(false) }
  }

  if (!draft) return <Card icon={<Plug className="w-4 h-4" />} title="Schedule"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></Card>

  return (
    <Card
      icon={<Plug className="w-4 h-4" />}
      title="Schedule & behaviour"
      description="How often the mailboxes are swept and what the sweep is allowed to do"
    >
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
        <Toggle
          checked={draft.enabled}
          onChange={v => save({ enabled: v })}
          label="Run automatically"
          description="When off, the monitor only sweeps when you press Run now."
        />
        <Toggle
          checked={draft.autoWrite}
          onChange={v => save({ autoWrite: v })}
          tone="amber"
          label="Write to the workbook automatically"
          description="Off = rows collect in review; you press Sync to sheet when you're happy."
        />
        <Toggle
          checked={draft.writeStatusColumn}
          onChange={v => save({ writeStatusColumn: v })}
          label="Fill the Status column"
          description="Writes Replied / Pending / Overdue into column B."
        />
        <Toggle
          checked={draft.captureUnmatched}
          onChange={v => save({ captureUnmatched: v })}
          label="Capture unknown senders"
          description={'Mail from a domain with no rule still gets a row, labelled "Others".'}
        />
        <Toggle
          checked={draft.aiEnabled}
          onChange={v => save({ aiEnabled: v })}
          label="AI fallback for destination & travel date"
          description="Only for mails the parser cannot read — costs a gpt-4o-mini call each."
        />
        <Toggle
          checked={draft.backupEnabled}
          onChange={v => save({ backupEnabled: v })}
          label="Mirror to the backup workbook"
          description="Every append and rewrite goes to the standby copy in the same sweep."
        />

        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <Field label="Sweep every (minutes)" hint="60 = hourly. Minimum 5.">
            <input
              type="number" min={5} className={inputCls}
              value={draft.intervalMinutes}
              onChange={e => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })}
              onBlur={() => save({ intervalMinutes: draft.intervalMinutes })}
            />
          </Field>
          <Field label="Look back (hours)" hint="Overlap the interval so nothing slips between sweeps.">
            <input
              type="number" min={1} className={inputCls}
              value={draft.lookbackHours}
              onChange={e => setDraft({ ...draft, lookbackHours: Number(e.target.value) })}
              onBlur={() => save({ lookbackHours: draft.lookbackHours })}
            />
          </Field>
          <Field label="Reply SLA (hours)" hint="Unanswered past this and the row turns Overdue.">
            <input
              type="number" min={1} className={inputCls}
              value={draft.slaHours}
              onChange={e => setDraft({ ...draft, slaHours: Number(e.target.value) })}
              onBlur={() => save({ slaHours: draft.slaHours })}
            />
          </Field>
          <Field label="Chase replies for (days)" hint="How long an open query keeps being re-checked.">
            <input
              type="number" min={1} className={inputCls}
              value={draft.replyChaseDays}
              onChange={e => setDraft({ ...draft, replyChaseDays: Number(e.target.value) })}
              onBlur={() => save({ replyChaseDays: draft.replyChaseDays })}
            />
          </Field>
        </div>
      </div>
      {saving && <p className="mt-3 text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</p>}
    </Card>
  )
}

// ── Sheet ────────────────────────────────────────────────────────────────────

function SheetCard({
  config, onConfigChange, onSheetChange,
}: {
  config: QmConfig | null
  onConfigChange: (c: QmConfig) => void
  onSheetChange: (info: QmSheetInfo | null) => void
}) {
  const [url, setUrl]           = useState('')
  const [backupUrl, setBackup]  = useState('')
  const [name, setName]         = useState('')
  const [startDate, setStart]   = useState('')
  const [info, setInfo] = useState<QmSheetInfo | null>(null)
  const [backupInfo, setBackupInfo] = useState<QmBackupInfo | null>(null)
  const [expected, setExpected] = useState<string[]>([])
  const [tail, setTail] = useState<string[][]>([])
  const [tailFirstRow, setTailFirstRow] = useState(0)
  const [worksheets, setWorksheets] = useState<{ name: string; visibility: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (!config) return
    setUrl(config.sheetUrl)
    setBackup(config.backupSheetUrl)
    setName(config.sheetName)
    setStart(config.startDate)
  }, [config])

  const check = useCallback(async (refresh = false) => {
    setChecking(true); setError(null)
    try {
      const res = await fetch(`/api/query-monitor/sheet?tail=6${refresh ? '&refresh=1' : ''}`)
      const d = await res.json()
      if (!d.success) { setError(d.error); setInfo(null); setBackupInfo(null); onSheetChange(null); return }
      setInfo(d.data.info)
      setBackupInfo(d.data.backup ?? null)
      setExpected(d.data.expectedColumns)
      setTail(d.data.tailRows)
      setTailFirstRow(d.data.tailFirstRow)
      setWorksheets(d.data.worksheets)
      onSheetChange(d.data.info)
    } finally { setChecking(false) }
  }, [onSheetChange])

  useEffect(() => { void check() }, [check])

  async function save() {
    const res = await fetch('/api/query-monitor/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl: url, sheetName: name, backupSheetUrl: backupUrl, startDate }),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    onConfigChange(d.data.config)
    toast.success('Workbook target saved')
    await check(true)
  }

  /**
   * After pointing the system at a different file, the entries still remember
   * the rows they own in the old one. This forgets those, so everything from the
   * start date is appended to the new workbook as if for the first time.
   */
  async function move() {
    if (!confirm(
      'Queue every query from the start date onwards for the workbook configured above?\n\n'
      + 'Rows already written to the previous file are left exactly where they are — '
      + 'nothing is deleted. Press "Sync to sheet" afterwards to write them.',
    )) return

    setMoving(true)
    try {
      const res = await fetch('/api/query-monitor/rebase', { method: 'POST' })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Queued for the new workbook')
      await check(true)
    } finally { setMoving(false) }
  }

  return (
    <Card
      icon={<Table2 className="w-4 h-4" />}
      title="Target workbook"
      description="The SharePoint file and tab that receives the rows"
      actions={
        info && (
          <a href={info.webUrl} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
            Open <ExternalLink className="w-3 h-3" />
          </a>
        )
      }
    >
      <div className="space-y-4">
        <Field label="Share link" hint="Any SharePoint/OneDrive share URL for the .xlsx — the app resolves it with Graph.">
          <input value={url} onChange={e => setUrl(e.target.value)} className={inputCls} />
        </Field>

        <Field
          label="Backup workbook"
          hint="Mirrored on every sweep: the same rows, the same rewrites, one sweep behind at most."
        >
          <input value={backupUrl} onChange={e => setBackup(e.target.value)} className={inputCls} />
        </Field>

        <Field
          label="Start from"
          hint="Mail received before this day is left in the previous sheet — it is never appended here. Blank means no cut-off."
        >
          <input type="date" value={startDate} onChange={e => setStart(e.target.value)} className={cn(inputCls, 'w-auto')} />
        </Field>

        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Worksheet tab">
            {worksheets.length > 0 ? (
              <select value={name} onChange={e => setName(e.target.value)} className={inputCls}>
                {worksheets.map(w => (
                  <option key={w.name} value={w.name}>
                    {w.name}{w.visibility !== 'Visible' ? ' (hidden)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            )}
          </Field>
          <div className="flex gap-2">
            <button onClick={() => check(true)} disabled={checking}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50">
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} Test
            </button>
            <button onClick={save}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {info && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800 break-all">{info.fileName}</p>
              <p>
                {info.dataRowCount.toLocaleString()} data rows on “{info.sheetName}” ·
                next append lands on row {info.nextAppendRow} ·
                last modified {formatDateTime(info.lastModified)}
              </p>
              <p className={cn('inline-flex items-center gap-1 font-semibold',
                info.headerMatches ? 'text-emerald-700' : 'text-rose-700')}>
                {info.headerMatches
                  ? <><CheckCircle2 className="w-3.5 h-3.5" /> Columns A–M match the expected layout</>
                  : <><AlertTriangle className="w-3.5 h-3.5" /> Header does not match: expected {expected.join(', ')}</>}
              </p>
              <p className="text-slate-400">
                Only columns A–N are ever written. File Handler (F) carries one name; TO List (G) carries everyone
                the mail reached.
              </p>
            </div>

            {/* The standby copy, and whether it has kept up. */}
            <div className={cn(
              'rounded-lg border p-3 text-xs space-y-1',
              !config?.backupEnabled ? 'border-slate-200 bg-slate-50 text-slate-500'
                : backupInfo?.ok     ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
                                     : 'border-amber-200 bg-amber-50 text-amber-900',
            )}>
              <p className="font-semibold inline-flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Backup workbook
              </p>
              {!config?.backupEnabled
                ? <p>Mirroring is off — only the workbook above is written.</p>
                : backupInfo?.ok
                  ? <p>
                      {backupInfo.info.fileName} · {backupInfo.info.dataRowCount.toLocaleString()} data rows ·
                      next append lands on row {backupInfo.info.nextAppendRow}
                    </p>
                  : <p>{backupInfo?.error ?? 'Not checked yet — press Test.'}</p>}
            </div>

            {/* Pointing at a new file is only half the move: the entries still
                remember the rows they own in the old one. */}
            <div className="rounded-lg border border-slate-200 p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700">Moved to a new workbook?</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Queues every query from {startDate || 'the beginning'} for the file above, as if it had never been
                  written. Rows in the previous file are left untouched.
                </p>
              </div>
              <button
                onClick={move} disabled={moving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
              >
                {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                Move rows here
              </button>
            </div>

            {tail.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5">
                  Last rows currently in the sheet (rows {tailFirstRow}–{tailFirstRow + tail.length - 1})
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>{expected.map(h => <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tail.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1.5 text-slate-600 max-w-[12rem] truncate" title={cell}>{cell || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

// ── Mail that is not a query ─────────────────────────────────────────────────

/**
 * The gate in front of the query sheet. Everything a pattern catches is still
 * collected and still visible under Queries → Other mail; it is simply written
 * to a second tab so the query sheet stays a measure of new business.
 */
function ExclusionCard({
  config, onConfigChange,
}: { config: QmConfig | null; onConfigChange: (c: QmConfig) => void }) {
  const [patterns, setPatterns] = useState('')
  const [tab, setTab]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [applying, setApplying] = useState(false)
  const [probe, setProbe]       = useState('')
  const [verdict, setVerdict]   = useState<{ kind: string; reason: string | null } | null>(null)

  useEffect(() => {
    if (!config) return
    setPatterns(config.excludePatterns)
    setTab(config.excludedSheetName)
  }, [config])

  async function save(patch: Partial<QmConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/query-monitor/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      onConfigChange(d.data.config)
      toast.success('Saved')
    } finally { setSaving(false) }
  }

  /** Bring the not-yet-written backlog in line with the patterns just saved. */
  async function apply() {
    setApplying(true)
    try {
      const res = await fetch('/api/query-monitor/reclassify', { method: 'POST' })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Re-checked')
    } finally { setApplying(false) }
  }

  async function test() {
    if (!probe.trim()) return
    const res = await fetch(`/api/query-monitor/reclassify?subject=${encodeURIComponent(probe)}`)
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    setVerdict({ kind: d.data.kind, reason: d.data.reason })
  }

  if (!config) {
    return <Card icon={<FilterX className="w-4 h-4" />} title="Mail that is not a query">
      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
    </Card>
  }

  return (
    <Card
      icon={<FilterX className="w-4 h-4" />}
      title="Mail that is not a query"
      description="Vouchers, on-ground issues, refund chases and avail checks go to their own tab instead of the query sheet — nothing is thrown away."
    >
      <div className="space-y-4">
        <Toggle
          checked={config.excludeEnabled}
          onChange={v => save({ excludeEnabled: v })}
          label="Sort this mail onto a second tab"
          description="Off = every mail goes to the query sheet, exactly as before."
        />

        <Field label="Tab for the excluded mail" hint="Created automatically on the first write if the workbook has no such tab.">
          <input
            value={tab} onChange={e => setTab(e.target.value)}
            onBlur={() => tab.trim() && tab !== config.excludedSheetName && save({ excludedSheetName: tab })}
            className={inputCls}
          />
        </Field>

        <Field
          label="Subject patterns"
          hint="One per line, matched against the subject only. # starts a comment, /…/ is a regular expression, anything else is a case-insensitive phrase."
        >
          <textarea
            value={patterns} onChange={e => setPatterns(e.target.value)}
            rows={14} spellCheck={false}
            className={cn(inputCls, 'font-mono text-xs leading-relaxed')}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => save({ excludePatterns: patterns })} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save patterns
          </button>
          <button
            onClick={apply} disabled={applying}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Re-check unwritten mail
          </button>
          <span className="text-xs text-slate-400">
            Mail already written to a sheet keeps its tab — moving it would leave an orphan row behind.
          </span>
        </div>

        {/* The team's own subjects are the only real test of a pattern list. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Try a subject</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={probe} onChange={e => { setProbe(e.target.value); setVerdict(null) }}
              onKeyDown={e => e.key === 'Enter' && test()}
              placeholder="RE: Hotel Voucher: Fairway Colombo/480604#"
              className={cn(inputCls, 'flex-1 min-w-[16rem] bg-white')}
            />
            <button onClick={test}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100">
              Test
            </button>
          </div>
          {verdict && (
            <p className={cn('text-xs font-semibold inline-flex items-center gap-1.5',
              verdict.kind === 'EXCLUDED' ? 'text-slate-700' : 'text-emerald-700')}>
              {verdict.kind === 'EXCLUDED'
                ? <><FilterX className="w-3.5 h-3.5" /> Goes to “{config.excludedSheetName}” — matched {verdict.reason}</>
                : <><CheckCircle2 className="w-3.5 h-3.5" /> Treated as a query — goes to “{config.sheetName}”</>}
            </p>
          )}
          <p className="text-[11px] text-slate-400">Tests against the patterns as last saved, not the unsaved text above.</p>
        </div>
      </div>
    </Card>
  )
}

// ── Mailboxes ────────────────────────────────────────────────────────────────

function MailboxesCard() {
  const [mailboxes, setMailboxes] = useState<QmMailbox[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ email: '', displayName: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/query-monitor/mailboxes')
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setMailboxes(d.data.mailboxes)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    try {
      const res = await fetch(`/api/query-monitor/mailboxes/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); await load(); return }
      toast.success(d.message ?? 'Updated')
      await load()
    } finally { setBusy(null) }
  }

  async function remove(mailbox: QmMailbox) {
    if (!confirm(`Stop monitoring ${mailbox.email}? Past queries stay in the system.`)) return
    setBusy(mailbox.id)
    try {
      const res = await fetch(`/api/query-monitor/mailboxes/${mailbox.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Removed')
      await load()
    } finally { setBusy(null) }
  }

  async function add() {
    const res = await fetch('/api/query-monitor/mailboxes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Mailbox added — press Test to verify Graph can reach it')
    setAdding(false); setForm({ email: '', displayName: '' })
    await load()
  }

  return (
    <Card
      icon={<Users className="w-4 h-4" />}
      title="File handler mailboxes"
      description="Every active inbox is swept each run. The display name is what appears in the sheet's File Handler column."
      actions={
        <button onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5" /> Add mailbox
        </button>
      }
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : (
        <div className="space-y-2">
          {mailboxes.map(mailbox => (
            <div key={mailbox.id} className={cn(
              'rounded-lg border p-3 flex flex-wrap items-center gap-3',
              mailbox.lastError ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200',
            )}>
              <Mail className={cn('w-4 h-4 flex-shrink-0', mailbox.isActive ? 'text-emerald-600' : 'text-slate-300')} />

              <input
                defaultValue={mailbox.displayName}
                onBlur={e => e.target.value !== mailbox.displayName && patch(mailbox.id, { displayName: e.target.value })}
                className="w-28 px-2 py-1 rounded border border-slate-200 text-sm font-semibold text-slate-800"
                title="Name written into the sheet"
              />
              <input
                defaultValue={mailbox.email}
                onBlur={e => e.target.value !== mailbox.email && patch(mailbox.id, { email: e.target.value })}
                className="flex-1 min-w-[14rem] px-2 py-1 rounded border border-slate-200 text-sm text-slate-600"
              />

              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {mailbox.lastCheckedAt ? `checked ${formatDateTime(mailbox.lastCheckedAt)}` : 'never checked'}
                {mailbox.totalSeen > 0 ? ` · ${mailbox.totalSeen.toLocaleString()} seen` : ''}
              </span>

              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => patch(mailbox.id, { test: true })} disabled={busy === mailbox.id}
                  className="px-2 py-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                  {busy === mailbox.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                </button>
                <button onClick={() => patch(mailbox.id, { isActive: !mailbox.isActive })} disabled={busy === mailbox.id}
                  className={cn('px-2 py-1 rounded text-[11px] font-semibold',
                    mailbox.isActive ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-500 bg-slate-100 hover:bg-slate-200')}>
                  {mailbox.isActive ? 'Active' : 'Paused'}
                </button>
                <button onClick={() => remove(mailbox)} disabled={busy === mailbox.id}
                  className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {mailbox.lastError && (
                <p className="w-full text-[11px] text-rose-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {mailbox.lastError}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a file handler mailbox" size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={add} className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">Add</button>
          </div>
        }>
        <div className="space-y-3">
          <Field label="Mailbox address">
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                   placeholder="name@aahaas.com" className={inputCls} />
          </Field>
          <Field label="Display name" hint="Short name, exactly as the team writes it in the sheet (e.g. Abdul)">
            <input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}

// ── Sender rules ─────────────────────────────────────────────────────────────

function SenderRulesCard() {
  const [rules, setRules] = useState<QmRule[]>([])
  const [unmatched, setUnmatched] = useState<{ domain: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ pattern: '', matchType: 'DOMAIN', salesPerson: '', agent: '', region: '', destination: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/query-monitor/rules')
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setRules(d.data.rules)
      setUnmatched(d.data.unmatchedDomains)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/query-monitor/rules/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); await load(); return }
    await load()
  }

  async function remove(rule: QmRule) {
    if (!confirm(`Delete the rule for ${rule.pattern}?`)) return
    const res = await fetch(`/api/query-monitor/rules/${rule.id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success(d.message ?? 'Deleted')
    await load()
  }

  async function add(prefill?: string) {
    const body = prefill ? { ...form, pattern: prefill } : form
    const res = await fetch('/api/query-monitor/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Rule added')
    setAdding(false)
    setForm({ pattern: '', matchType: 'DOMAIN', salesPerson: '', agent: '', region: '', destination: '' })
    await load()
  }

  return (
    <Card
      icon={<Tags className="w-4 h-4" />}
      title="Sender rules"
      description="Maps the sender's domain (or exact address) to the Sales Person and Agent columns. Exact addresses win over domains."
      actions={
        <button onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5" /> Add rule
        </button>
      }
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Match</th>
                  <th className="px-3 py-2 text-left font-semibold">Domain / address</th>
                  <th className="px-3 py-2 text-left font-semibold">Sales person</th>
                  <th className="px-3 py-2 text-left font-semibold">Agent</th>
                  <th className="px-3 py-2 text-left font-semibold">Default destination</th>
                  <th className="px-3 py-2 text-left font-semibold">Hits</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map(rule => (
                  <tr key={rule.id} className={cn(!rule.isActive && 'opacity-50')}>
                    <td className="px-3 py-2">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                        rule.matchType === 'EMAIL' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}>
                        {rule.matchType}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={rule.pattern}
                        onBlur={e => e.target.value !== rule.pattern && patch(rule.id, { pattern: e.target.value })}
                        className="w-44 px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 text-slate-700" />
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={rule.salesPerson}
                        onBlur={e => e.target.value !== rule.salesPerson && patch(rule.id, { salesPerson: e.target.value })}
                        className="w-36 px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 text-slate-700" />
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={rule.agent}
                        onBlur={e => e.target.value !== rule.agent && patch(rule.id, { agent: e.target.value })}
                        className="w-36 px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 text-slate-700" />
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={rule.destination ?? ''} placeholder="—"
                        onBlur={e => e.target.value !== (rule.destination ?? '') && patch(rule.id, { destination: e.target.value })}
                        className="w-28 px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 text-slate-700" />
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">
                      {rule.matchCount}
                      {rule.lastMatchedAt && <span className="text-slate-300"> · {formatDateTime(rule.lastMatchedAt)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => patch(rule.id, { isActive: !rule.isActive })}
                          className="px-2 py-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
                          {rule.isActive ? 'On' : 'Off'}
                        </button>
                        <button onClick={() => remove(rule)} className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unmatched.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">
                Domains seen with no rule — click one to start a rule for it
              </p>
              <div className="flex flex-wrap gap-2">
                {unmatched.map(u => (
                  <button key={u.domain}
                    onClick={() => { setForm({ ...form, pattern: u.domain, matchType: 'DOMAIN' }); setAdding(true) }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-200 bg-white text-xs hover:border-emerald-300 hover:bg-emerald-50">
                    <span className="font-medium text-slate-700">{u.domain}</span>
                    <span className="text-slate-400">{u.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a sender rule" size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={() => add()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">Add rule</button>
          </div>
        }>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Match on">
            <select value={form.matchType} onChange={e => setForm({ ...form, matchType: e.target.value })} className={inputCls}>
              <option value="DOMAIN">Domain</option>
              <option value="EMAIL">Exact address</option>
            </select>
          </Field>
          <Field label={form.matchType === 'EMAIL' ? 'Email address' : 'Domain'}
                 hint={form.matchType === 'EMAIL' ? 'kiran.kaushal@makemytrip.in' : 'makemytrip.in — subdomains match too'}>
            <input value={form.pattern} onChange={e => setForm({ ...form, pattern: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Sales person" hint="Goes in column G">
            <input value={form.salesPerson} onChange={e => setForm({ ...form, salesPerson: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Agent" hint="Goes in column I">
            <input value={form.agent} onChange={e => setForm({ ...form, agent: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Default destination" hint="Optional — used when the mail doesn't say">
            <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Default region" hint="Optional — column M">
            <input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}
