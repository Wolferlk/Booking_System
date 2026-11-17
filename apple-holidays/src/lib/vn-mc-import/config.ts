/**
 * Excel → Agenda auto-update — settings (system_settings rows).
 *
 *   vn_mc_auto_mode          OFF | AUTO      (ships OFF — an admin switches it on)
 *   vn_mc_auto_interval_min  5 … 240         (default 15)
 *   vn_mc_auto_state         JSON McAutoRunState of the last run
 *   vn_mc_auto_lock          ISO time a run started (cleared when it ends)
 */
import { prisma } from '@/lib/prisma'
import type { McAutoRunState } from './shared'

export const MC_AUTO = {
  mode: 'vn_mc_auto_mode',
  intervalMin: 'vn_mc_auto_interval_min',
  state: 'vn_mc_auto_state',
  lock: 'vn_mc_auto_lock',
} as const

export const BASELINE_PREFIX = 'vn_mc_import:'
export const DEFAULT_AUTO_INTERVAL_MIN = 15

export interface McAutoConfig { mode: 'OFF' | 'AUTO'; intervalMin: number }

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export async function getMcAutoConfig(): Promise<McAutoConfig> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [MC_AUTO.mode, MC_AUTO.intervalMin] } } })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const interval = Number(map.get(MC_AUTO.intervalMin))
  return {
    mode: String(map.get(MC_AUTO.mode) ?? 'OFF').toUpperCase() === 'AUTO' ? 'AUTO' : 'OFF',
    intervalMin: Number.isFinite(interval) && interval >= 5 && interval <= 240 ? Math.round(interval) : DEFAULT_AUTO_INTERVAL_MIN,
  }
}

export async function saveMcAutoConfig(input: Partial<McAutoConfig>): Promise<McAutoConfig> {
  if (input.mode !== undefined) {
    if (input.mode !== 'OFF' && input.mode !== 'AUTO') throw new Error('Mode must be OFF or AUTO')
    await setSetting(MC_AUTO.mode, input.mode)
  }
  if (input.intervalMin !== undefined) {
    const v = Number(input.intervalMin)
    if (!Number.isFinite(v) || v < 5 || v > 240) throw new Error('The interval must be between 5 and 240 minutes')
    await setSetting(MC_AUTO.intervalMin, String(Math.round(v)))
  }
  return getMcAutoConfig()
}

export async function getMcAutoState(): Promise<McAutoRunState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: MC_AUTO.state } })
  try { return row?.value ? JSON.parse(row.value) as McAutoRunState : null } catch { return null }
}

export async function setMcAutoState(state: McAutoRunState): Promise<void> {
  await setSetting(MC_AUTO.state, JSON.stringify(state)).catch(() => undefined)
}

const STALE_LOCK_MS = 10 * 60_000

/** One run at a time across server processes. Returns false when another run holds it. */
export async function takeMcAutoLock(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: MC_AUTO.lock } })
  const held = row?.value ? Date.parse(row.value) : NaN
  if (Number.isFinite(held) && Date.now() - held < STALE_LOCK_MS) return false
  await setSetting(MC_AUTO.lock, new Date().toISOString())
  return true
}

export async function releaseMcAutoLock(): Promise<void> {
  await setSetting(MC_AUTO.lock, '').catch(() => undefined)
}

export function isMcAdmin(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ULTRA_SUPER_ADMIN'
}

/** The booking's Excel baseline, read without loading the sheet machinery (used by the chart save). */
export async function readMcBaseline(ref: string): Promise<{ autoAt?: string | null; paused?: boolean } | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: `${BASELINE_PREFIX}${ref.toUpperCase()}` } })
  if (!row?.value) return null
  try { return JSON.parse(row.value) as { autoAt?: string | null; paused?: boolean } } catch { return null }
}
