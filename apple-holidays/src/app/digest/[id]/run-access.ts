/** The public link's check: a run is only readable with its own random token. */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { normaliseConfig, type DigestConfig, type DigestPayload } from '@/lib/agent-digest/shared'

function tokenOk(expected: string, given: string | null | undefined): boolean {
  if (!given || given.length !== expected.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given)) } catch { return false }
}

export async function loadRun(id: string, token: string | null | undefined): Promise<{ payload: DigestPayload; config: DigestConfig } | null> {
  try {
    const run = await prisma.agentDigestRun.findUnique({ where: { id }, select: { token: true, payload: true } })
    if (!run || !tokenOk(run.token, token)) return null
    const stored = run.payload as unknown as DigestPayload & { config?: unknown }
    return { payload: stored, config: normaliseConfig(stored.config) }
  } catch {
    return null // table missing or bad id: treated as not found
  }
}
