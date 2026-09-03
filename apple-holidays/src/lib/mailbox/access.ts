import type { UserRole } from '@prisma/client'

/**
 * Mail Box access, deliberately expressed as two role lists rather than new
 * `Permission` entries.
 *
 * Adding a permission to `rbac.ts` means editing all ten `ROLE_PERMISSIONS`
 * arrays, and every one of those edits is a chance to widen an unrelated role by
 * accident. Mail Box grants nothing that existing permissions gate, so the
 * narrower change is the safer one.
 */

/** Compose and send from a booking, and read the correspondence. */
export const MAILBOX_SEND_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'AC_USER', 'RS_USER',
  'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/** Edit templates, the agent directory and the internal CC list. */
export const MAILBOX_MANAGE_ROLES: UserRole[] = [
  'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export const canUseMailbox    = (role: UserRole) => MAILBOX_SEND_ROLES.includes(role)
export const canManageMailbox = (role: UserRole) => MAILBOX_MANAGE_ROLES.includes(role)
