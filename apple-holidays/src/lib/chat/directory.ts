/**
 * The one address book — the OPS half.
 *
 * Reads `chat_directory`, the view that UNIONs `invoice_processor.users` and
 * `apple_booking_system.users`. No user data is copied anywhere for chat: a
 * person renamed, re-photographed or deactivated in either system is correct
 * here on the next query, because there is no second copy to go stale.
 *
 * The Accounts counterpart is app/Services/Chat/ChatDirectory.php and returns
 * the identical shape.
 */
import type { RowDataPacket } from 'mysql2'
import { chatQuery, opsSchema } from './db'
import { ONLINE_WINDOW_SECONDS, PEER_URL, SYSTEM, SYSTEMS, type ChatSystem } from './config'

export interface ChatPerson {
  key: string             // "system:user_ref" — the identity used everywhere
  system: ChatSystem
  user_ref: string
  name: string
  email: string | null
  avatar: string | null
  initials: string
  role_label: string
  system_label: string
  system_short: string
  accent: string
  is_online: boolean
  is_active: boolean
  last_seen_at: string | null
}

interface DirectoryRow extends RowDataPacket {
  system: string
  user_ref: string
  name: string
  email: string | null
  avatar_raw: string | null
  role_label: string | null
  is_active: number
  is_online: number
  last_seen_at: string | null
}

/* ── source ────────────────────────────────────────────────────────────────── */

let viewChecked = false
let viewExists = true

/**
 * The FROM clause. The view when it exists; otherwise the same UNION inlined, so
 * chat still works on a deploy where the grant to create a view was missing.
 */
async function source(): Promise<string> {
  if (!viewChecked) {
    viewChecked = true
    try {
      await chatQuery('SELECT 1 FROM `chat_directory` LIMIT 1')
      viewExists = true
    } catch {
      viewExists = false
    }
  }

  if (viewExists) return '`chat_directory`'

  const ops = opsSchema()
  return `(
    SELECT 'accounts' AS \`system\`, CAST(u.\`id\` AS CHAR(64)) AS \`user_ref\`, u.\`name\`, u.\`email\`,
           u.\`avatar_path\` AS \`avatar_raw\`,
           COALESCE(r.\`name\`, u.\`designation\`, 'Accounts') AS \`role_label\`,
           CASE WHEN u.\`status\` = 'approved' THEN 1 ELSE 0 END AS \`is_active\`
    FROM \`users\` u LEFT JOIN \`roles\` r ON r.\`id\` = u.\`role_id\`
    UNION ALL
    SELECT 'ops', o.\`id\`, o.\`name\`, o.\`email\`, o.\`avatar\`,
           COALESCE(NULLIF(REPLACE(o.\`role\`, '_', ' '), ''), 'Operations'),
           CASE WHEN o.\`isActive\` = 1 THEN 1 ELSE 0 END
    FROM \`${ops}\`.\`users\` o
  ) AS \`chat_directory\``
}

/* ── shaping ───────────────────────────────────────────────────────────────── */

function initials(name: string, email: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? (email ?? '?')[0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * Each system stores avatars its own way and serves them from its own host:
 * OPS keeps an app URL, Accounts keeps a storage path. Our own rows resolve
 * locally; the other system's are prefixed with CHAT_ACCOUNTS_URL. Without that
 * we return null and the UI draws initials — plainer, but never a broken image.
 */
function avatarUrl(system: string, raw: string | null): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value

  if (system === SYSTEM) return value.startsWith('/') ? value : `/${value}`

  // The Accounts app serves user photos out of its public storage link.
  return PEER_URL ? `${PEER_URL}/storage/${value.replace(/^\/+/, '')}` : null
}

function shape(r: DirectoryRow): ChatPerson {
  const system = r.system as ChatSystem
  const meta = SYSTEMS[system] ?? { label: system, short: system.toUpperCase(), accent: '#64748b' }

  return {
    key: `${system}:${r.user_ref}`,
    system,
    user_ref: String(r.user_ref),
    name: r.name,
    email: r.email,
    avatar: avatarUrl(system, r.avatar_raw),
    initials: initials(r.name, r.email),
    role_label: r.role_label ?? '',
    system_label: meta.label,
    system_short: meta.short,
    accent: meta.accent,
    is_online: Boolean(r.is_online),
    is_active: Boolean(r.is_active),
    last_seen_at: r.last_seen_at,
  }
}

/** A person the directory can no longer resolve, so old messages still render. */
export function unknownPerson(system: string, ref: string): ChatPerson {
  const s = system as ChatSystem
  const meta = SYSTEMS[s] ?? { label: system, short: system.toUpperCase(), accent: '#64748b' }
  return {
    key: `${system}:${ref}`,
    system: s,
    user_ref: String(ref),
    name: 'Former user',
    email: null,
    avatar: null,
    initials: '–',
    role_label: meta.label,
    system_label: meta.label,
    system_short: meta.short,
    accent: meta.accent,
    is_online: false,
    is_active: false,
    last_seen_at: null,
  }
}

/* ── queries ───────────────────────────────────────────────────────────────── */

/** Everyone messageable, with live presence. */
export async function listPeople(opts: {
  search?: string | null
  system?: string | null
  exclude?: [string, string] | null
  limit?: number
} = {}): Promise<ChatPerson[]> {
  const where: string[] = ['d.`is_active` = 1']
  const params: unknown[] = [ONLINE_WINDOW_SECONDS]

  if (opts.system) { where.push('d.`system` = ?'); params.push(opts.system) }
  if (opts.search?.trim()) {
    where.push('(d.`name` LIKE ? OR d.`email` LIKE ?)')
    const like = `%${opts.search.trim()}%`
    params.push(like, like)
  }
  if (opts.exclude) {
    where.push('NOT (d.`system` = ? AND d.`user_ref` = ?)')
    params.push(opts.exclude[0], String(opts.exclude[1]))
  }

  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 200)), 1000)

  const rows = await chatQuery<DirectoryRow>(
    `SELECT d.*, p.\`last_seen_at\`,
            CASE WHEN p.\`last_seen_at\` IS NOT NULL AND p.\`last_seen_at\` > (NOW() - INTERVAL ? SECOND)
                 THEN 1 ELSE 0 END AS \`is_online\`
     FROM ${await source()} d
     LEFT JOIN \`chat_presence\` p ON p.\`system\` = d.\`system\` AND p.\`user_ref\` = d.\`user_ref\`
     WHERE ${where.join(' AND ')}
     ORDER BY \`is_online\` DESC, d.\`name\` ASC
     LIMIT ${limit}`,
    params,
  )

  return rows.map(shape)
}

/**
 * Resolve a set of identities in ONE query — a twenty-person group header must
 * not cost twenty round trips.
 */
export async function resolvePeople(identities: Array<[string, string]>): Promise<Map<string, ChatPerson>> {
  const out = new Map<string, ChatPerson>()
  if (!identities.length) return out

  const params: unknown[] = [ONLINE_WINDOW_SECONDS]
  const tuples = identities.map(([system, ref]) => {
    params.push(system, String(ref))
    return '(d.`system` = ? AND d.`user_ref` = ?)'
  })

  const rows = await chatQuery<DirectoryRow>(
    `SELECT d.*, p.\`last_seen_at\`,
            CASE WHEN p.\`last_seen_at\` IS NOT NULL AND p.\`last_seen_at\` > (NOW() - INTERVAL ? SECOND)
                 THEN 1 ELSE 0 END AS \`is_online\`
     FROM ${await source()} d
     LEFT JOIN \`chat_presence\` p ON p.\`system\` = d.\`system\` AND p.\`user_ref\` = d.\`user_ref\`
     WHERE ${tuples.join(' OR ')}`,
    params,
  )

  rows.forEach(r => { const p = shape(r); out.set(p.key, p) })
  return out
}

export async function findPerson(system: string, ref: string): Promise<ChatPerson | null> {
  const map = await resolvePeople([[system, ref]])
  return map.get(`${system}:${ref}`) ?? null
}
