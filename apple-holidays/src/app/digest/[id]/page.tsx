/**
 * Public web view of one sent Agent Daily Digest — the link in the WhatsApp
 * message. Only with the run's random token. No login: the agent is external.
 *
 * A daily digest shows the bookings that were sent, with their CURRENT lines,
 * drivers and vendors (so the pending count matches today). A ticket pack
 * shows the same bookings with their CURRENT tickets, until the link expires.
 */
import type { Metadata } from 'next'
import { renderEmailHtml } from '@/lib/agent-digest/shared'
import { isPackExpired, refreshPack } from '@/lib/agent-digest/tickets-server'
import { refreshDailyPayload } from '@/lib/agent-digest/server'
import DownloadAll, { type PackGroup } from './download-all'
import { loadRun } from './run-access'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Daily operations update', robots: { index: false, follow: false } }

function Notice({ icon, text }: { icon: string; text: string }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f1f5f9', fontFamily: 'Segoe UI, Arial, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#475569' }}>
        <div style={{ fontSize: 40 }}>{icon}</div>
        <p style={{ marginTop: 8 }}>{text}</p>
      </div>
    </main>
  )
}

export default async function DigestPage({ params, searchParams }: { params: { id: string }; searchParams: { t?: string } }) {
  const run = await loadRun(params.id, searchParams.t)
  if (!run) return <Notice icon="🔒" text="This update link is not valid." />

  let html: string
  let groups: PackGroup[] = []
  if (run.payload.kind === 'TICKETS') {
    if (isPackExpired(run.payload, run.config)) return <Notice icon="⌛" text="This ticket link has expired. Please ask AppleHolidays Operations for a new one." />
    const live = await refreshPack(run.payload, run.config)
    const fileUrl = (id: string) => `/digest/${encodeURIComponent(params.id)}/file/${encodeURIComponent(id)}?t=${encodeURIComponent(searchParams.t ?? '')}`
    html = renderEmailHtml(live, run.config, '', null, { fileLink: fileUrl })
    groups = live.blocks.flatMap(blk => blk.bookings.map(b => ({
      label: b.ref,
      files: (b.tickets ?? []).flatMap(t => t.files.map(f => ({ url: fileUrl(f.id), name: f.name }))),
    })))
  } else {
    html = renderEmailHtml(await refreshDailyPayload(run.payload, run.config), run.config, '', null)
  }

  // Every value inside was escaped by renderEmailHtml.
  const inner = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '')
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Segoe UI, Arial, sans-serif' }}>
      <DownloadAll zipName={`Tickets-${run.payload.runDate}`} groups={groups} />
      <div dangerouslySetInnerHTML={{ __html: inner }} />
    </div>
  )
}
