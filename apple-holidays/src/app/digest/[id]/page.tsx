/**
 * Public web view of one sent Agent Daily Digest — the link in the WhatsApp
 * message. Shows the FROZEN snapshot taken at send time (never live data), and
 * only with the run's random token. No login: the agent is external.
 */
import crypto from 'crypto'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { normaliseConfig, renderEmailHtml, type DigestPayload } from '@/lib/agent-digest/shared'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Daily operations update', robots: { index: false, follow: false } }

function tokenOk(expected: string, given: string | undefined): boolean {
  if (!given || given.length !== expected.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given)) } catch { return false }
}

export default async function DigestPage({ params, searchParams }: { params: { id: string }; searchParams: { t?: string } }) {
  let html: string | null = null
  try {
    const run = await prisma.agentDigestRun.findUnique({ where: { id: params.id }, select: { token: true, payload: true } })
    if (run && tokenOk(run.token, searchParams.t)) {
      const stored = run.payload as unknown as DigestPayload & { config?: unknown }
      html = renderEmailHtml(stored, normaliseConfig(stored.config), '', null)
    }
  } catch { /* table missing or bad id → not found */ }

  if (!html) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f1f5f9', fontFamily: 'Segoe UI, Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#475569' }}>
          <div style={{ fontSize: 40 }}>🔒</div>
          <p style={{ marginTop: 8 }}>This update link is not valid.</p>
        </div>
      </main>
    )
  }
  // Every value inside was escaped by renderEmailHtml.
  const inner = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '')
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Segoe UI, Arial, sans-serif' }} dangerouslySetInnerHTML={{ __html: inner }} />
}
