'use client'

/**
 * Header chip: Aahaas B2C bookings the store amended that nobody has checked.
 *
 * Only OLD bookings re-opened (first sold on an earlier day) count; it renders
 * nothing when there are none, and links to the B2C page's "Booking updates"
 * panel. Same-day corrections never show. Fails soft: a polling error keeps the
 * last known count rather than touching the header.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { GitBranch } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'

const POLL_MS = 120_000

interface Notice { bookingRef: string; orderId: number; appliedAt?: string | null }

export default function B2cAmendmentChip() {
  const { data: session } = useSession()
  const [notices, setNotices] = useState<Notice[]>([])

  useEffect(() => {
    if (!session?.user || session.user.role === 'CLIENT') return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/b2c/amendments')
        const json = await readApiResponse<{ notices: Notice[] }>(res)
        if (alive && json.success) setNotices(json.data?.notices ?? [])
      } catch {
        /* keep the last count */
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [session?.user])

  if (notices.length === 0) return null
  const refs = Array.from(new Set(notices.map((n) => n.bookingRef)))

  return (
    <Link
      href="/dashboard/b2c"
      title={`Updated bookings — attention please: ${refs.join(', ')} amended in the Aahaas store`}
      className="relative inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
    >
      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-amber-500" />
      <GitBranch className="h-3.5 w-3.5" />
      {refs.length} updated booking{refs.length === 1 ? '' : 's'}
    </Link>
  )
}
