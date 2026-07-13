import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Public feed of OPEN traveller-experience alerts for the office "Live Screen"
 * (/view). No login and no token — same rationale as /api/public/view-dashboard:
 * a TV loads /view and it works forever. We call the TE service server-side with
 * the shared secret and return a whitelisted, read-only view of each alert so the
 * screen can raise a loud critical warning the moment a traveller reports a
 * problem on tour. Keep the /view link internal.
 */

const TE_BASE = (
  process.env.TE_BASE_URL ??
  'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')
const TE_SECRET = process.env.TE_WEBHOOK_SECRET ?? ''

interface RawAlert {
  id: number
  booking_ref?: string | null
  customer_name?: string | null
  call_kind?: string | null
  category?: string | null
  severity?: string | null
  title?: string | null
  details?: string | null
  customer_quote?: string | null
  status?: string | null
  at?: string | null
  created_at?: string | null
}

export async function GET() {
  const url = `${TE_BASE}/alerts?status=open`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TE_SECRET) headers['x-te-secret'] = TE_SECRET

  try {
    const res = await fetch(url, { headers, cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    const rows: RawAlert[] = j?.alerts ?? []
    // Whitelist fields — never pass the raw upstream payload straight through.
    const alerts = rows.map(a => ({
      id: a.id,
      booking_ref: a.booking_ref ?? null,
      customer_name: a.customer_name ?? null,
      call_kind: a.call_kind ?? null,
      category: a.category ?? null,
      severity: a.severity ?? null,
      title: a.title ?? null,
      details: a.details ?? null,
      customer_quote: a.customer_quote ?? null,
      at: a.at ?? a.created_at ?? null,
    }))
    return NextResponse.json({ alerts })
  } catch (err) {
    // Never break the live screen — return an empty feed on any upstream failure.
    return NextResponse.json({ alerts: [], error: String(err) })
  }
}
