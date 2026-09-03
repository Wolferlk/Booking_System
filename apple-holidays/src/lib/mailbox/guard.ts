import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import { canManageMailbox, canUseMailbox } from './access'

export interface MailboxActor {
  name: string
  email: string
  role: UserRole
}

/**
 * One guard for every Mail Box route, returning either the actor or the
 * `Response` to hand straight back. Routes stay two lines of preamble instead of
 * eight, and — more to the point — the send and manage boundaries are defined
 * once rather than re-typed at a dozen call sites where one of them would
 * eventually be typed wrong.
 */
export async function requireMailbox(
  level: 'use' | 'manage' = 'use',
): Promise<{ actor: MailboxActor } | { error: Response }> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  const ok = level === 'manage' ? canManageMailbox(role) : canUseMailbox(role)
  if (!ok) return { error: buildApiError('Forbidden', 403) }

  return {
    actor: {
      name:  session.user.name  ?? 'Apple Holidays',
      email: session.user.email ?? '',
      role,
    },
  }
}

/** JSON array of trimmed, non-empty strings — the shape `ccEmails` / `matchKeys` store. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
  return []
}
