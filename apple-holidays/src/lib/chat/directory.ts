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
import { createHash } from 'crypto'
import { ONLINE_WINDOW_SECONDS, SYSTEMS, type ChatSystem } from './config'

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
 * The one collation both halves of the UNION are forced into.
 *
 * Not tidiness — the fix for a real failure. `CAST(u.id AS CHAR(64))` returns a
 * string in the connection charset with that charset's DEFAULT collation
 * (utf8mb4_general_ci), while the other branch supplies a utf8mb4_unicode_ci
 * column, and MariaDB refuses to UNION them:
 *
 *     SQLSTATE[HY000] 1271 Illegal mix of collations for operation 'UNION'
 *
 * Must match App\Support\ChatDirectorySql::collation() in the Accounts app.
 */
const COLLATION = (() => {
  const value = process.env.CHAT_COLLATION || 'utf8mb4_unicode_ci'
  // Interpolated into SQL, so refuse anything that is not a plain identifier.
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe chat collation [${value}]`)
  return value
})()

const CHARSET = COLLATION.split('_')[0]

/**
 * The FROM clause, WITHOUT an alias — every caller appends its own `d`.
 *
 * The derived-table form used to carry `AS chat_directory` of its own, which
 * produced `FROM ( ... ) AS chat_directory d`: two aliases, and a syntax error
 * on every query that took the fallback path.
 *
 * The view is used when it is there AND actually runs. Existing is not the same
 * as working — the first version of it parsed fine and then failed at SELECT
 * time on the collation mismatch above — so we probe it once and treat a failure
 * exactly like an absence.
 *
 * Mirrors App\Support\ChatDirectorySql in the Accounts app; change both.
 */
async function source(): Promise<string> {
  if (!viewChecked) {
    try {
      await chatQuery('SELECT 1 FROM `chat_directory` LIMIT 1')
      viewChecked = true
      viewExists = true
    } catch (err) {
      // Only a verdict ABOUT THE VIEW is remembered. A dropped connection or a
      // timeout says nothing about whether the view works, and caching that as
      // "unusable" pinned the whole process to the slower cross-schema UNION
      // for its entire life over one network blip — so a transient failure
      // leaves the probe unanswered and is asked again next time.
      const code = (err as { code?: string })?.code ?? ''
      const definitive = ['ER_NO_SUCH_TABLE', 'ER_VIEW_INVALID', 'ER_CANT_AGGREGATE_2COLLATIONS',
        'ER_CANT_AGGREGATE_NCOLLATIONS', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_VIEW_NO_EXPLAIN'].includes(code)

      console.warn(`[chat] chat_directory probe failed (${code || 'unknown'}); using the inline UNION${definitive ? '' : ' for this query only'}.`, err)
      viewExists = false
      if (definitive) viewChecked = true
    }
  }

  if (viewExists) return '`chat_directory`'

  const ops = opsSchema()
  return `(
    SELECT
      CONVERT('accounts' USING ${CHARSET}) COLLATE ${COLLATION}               AS \`system\`,
      CONVERT(CAST(u.\`id\` AS CHAR(64)) USING ${CHARSET}) COLLATE ${COLLATION} AS \`user_ref\`,
      CONVERT(u.\`name\` USING ${CHARSET}) COLLATE ${COLLATION}               AS \`name\`,
      CONVERT(u.\`email\` USING ${CHARSET}) COLLATE ${COLLATION}              AS \`email\`,
      CONVERT(u.\`avatar_path\` USING ${CHARSET}) COLLATE ${COLLATION}        AS \`avatar_raw\`,
      CONVERT(COALESCE(r.\`name\`, u.\`designation\`, 'Accounts') USING ${CHARSET})
        COLLATE ${COLLATION}                                                  AS \`role_label\`,
      CASE WHEN u.\`status\` = 'approved' THEN 1 ELSE 0 END                   AS \`is_active\`,
      u.\`created_at\`                                                        AS \`member_since\`
    FROM \`users\` u
    LEFT JOIN \`roles\` r ON r.\`id\` = u.\`role_id\`

    UNION ALL

    SELECT
      CONVERT('ops' USING ${CHARSET}) COLLATE ${COLLATION},
      CONVERT(CAST(o.\`id\` AS CHAR(64)) USING ${CHARSET}) COLLATE ${COLLATION},
      CONVERT(o.\`name\` USING ${CHARSET}) COLLATE ${COLLATION},
      CONVERT(o.\`email\` USING ${CHARSET}) COLLATE ${COLLATION},
      CONVERT(o.\`avatar\` USING ${CHARSET}) COLLATE ${COLLATION},
      CONVERT(COALESCE(NULLIF(REPLACE(o.\`role\`, '_', ' '), ''), 'Operations') USING ${CHARSET})
        COLLATE ${COLLATION},
      CASE WHEN o.\`isActive\` = 1 THEN 1 ELSE 0 END,
      o.\`createdAt\`
    FROM \`${ops}\`.\`users\` o
  )`
}

/* ── shaping ───────────────────────────────────────────────────────────────── */

function initials(name: string, email: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? (email ?? '?')[0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * The photo, addressed by WHO it belongs to rather than where it is stored.
 *
 * Every avatar — ours and the Accounts ones — is served by this app's own
 * /api/chat/avatar route out of the shared bucket. That is what finally makes a
 * face cross the boundary: the browser never has to reach the Accounts host,
 * and nothing depends on that host's public/storage symlink existing.
 *
 * `?v=` is a short digest of the stored path, so replacing a photo replaces the
 * URL and the browser cannot serve the old face from cache.
 *
 * Mirrors ChatDirectory::avatarUrl() in the Accounts app.
 */
function avatarUrl(system: string, ref: string, raw: string | null): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value

  return `/api/chat/avatar/${encodeURIComponent(system)}/${encodeURIComponent(ref)}?v=${digest(value)}`
}

/** Short, stable cache token for a stored path. Not security — cache busting. */
function digest(value: string): string {
  return createHash('md5').update(value).digest('hex').slice(0, 10)
}

/**
 * The value the owning system's users table actually holds, for the avatar
 * route to turn into bytes. Read live, like everything else here.
 */
export async function rawAvatar(system: string, ref: string): Promise<string | null> {
  const rows = await chatQuery<RowDataPacket & { avatar_raw: string | null }>(
    `SELECT d.\`avatar_raw\` FROM ${await source()} d
      WHERE d.\`system\` = ? AND d.\`user_ref\` = ? LIMIT 1`,
    [system, String(ref)],
  )

  const raw = (rows[0]?.avatar_raw ?? '').trim()
  return raw || null
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
    avatar: avatarUrl(system, String(r.user_ref), r.avatar_raw),
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
