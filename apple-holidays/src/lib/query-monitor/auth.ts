/**
 * Access guard for the Query Monitor API.
 *
 * The monitor exposes whole mailboxes and writes to a shared master workbook, so
 * it is admin-only — the same bar as Mail Inbox and OneDrive Access — plus the
 * Booking Team, who own the queries the sweep collects.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ALLOWED_ROLES = ['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export interface Guard {
  ok:    boolean
  email: string | null
  name:  string | null
  role:  string | null
}

export async function requireAdmin(): Promise<Guard> {
  const session = await getServerSession(authOptions)
  const role = session?.user?.role ?? null

  return {
    ok:    !!session && ALLOWED_ROLES.includes(role ?? ''),
    email: session?.user?.email ?? null,
    name:  session?.user?.name ?? null,
    role,
  }
}
