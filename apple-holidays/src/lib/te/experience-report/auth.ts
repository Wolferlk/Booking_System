/**
 * Who may work the Experience Report Centre.
 *
 * Reports are agent-facing mail about a client's experience, so the gate is the
 * Traveller Experience desk and the admins — the same set that already runs the
 * AI call bot and its reports.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { UserRole } from '@prisma/client'

const ALLOWED: UserRole[] = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export interface Actor {
  label: string
  role: UserRole
}

/** Returns the actor, or a reason string when access is refused. */
export async function requireTeUser(): Promise<{ actor: Actor } | { deny: 'unauthorized' | 'forbidden' }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { deny: 'unauthorized' }

  const role = session.user.role as UserRole
  if (!ALLOWED.includes(role)) return { deny: 'forbidden' }

  return {
    actor: {
      label: session.user.name ?? session.user.email ?? 'Unknown user',
      role,
    },
  }
}
