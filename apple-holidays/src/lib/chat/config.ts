/**
 * Internal chat — the constants both systems have to agree on.
 *
 * This file is the OPS half of a matched pair. The Accounts half is
 * `config/chat.php` in the Laravel app, and the two describe the SAME tables in
 * the SAME database, so a value that appears in both must be changed in both.
 * Where that is true the comment says so.
 */

/** Which system this app is. Stamped on every row it writes. */
export const SYSTEM = 'ops' as const

export type ChatSystem = 'accounts' | 'ops'

/** MUST match config/chat.php → systems. */
export const SYSTEMS: Record<ChatSystem, { label: string; short: string; accent: string }> = {
  accounts: { label: 'Accounts',   short: 'ACC', accent: '#0d9488' },
  ops:      { label: 'Operations', short: 'OPS', accent: '#6366f1' },
}

/**
 * Where the Accounts app lives, used only to turn its stored avatar paths into
 * URLs this browser can load (an Accounts avatar is "avatars/x.jpg", which
 * resolves to /storage/avatars/x.jpg on THAT host). Unset = fall back to
 * initials, which is plainer but never broken.
 */
export const PEER_URL = (process.env.CHAT_ACCOUNTS_URL ?? '').replace(/\/+$/, '')

/* ── Media ────────────────────────────────────────────────────────────────── */

/**
 * The shared bucket. Both systems put to and get from the same bucket under the
 * same prefix — a file uploaded in Accounts is served here by reading the
 * identical object, never by copying it.
 *
 * MUST match config/chat.php → bucket / key_prefix / region.
 */
export const CHAT_BUCKET = process.env.CHAT_S3_BUCKET || process.env.S3_BUCKET || 'ops.aahaas'
export const CHAT_REGION = process.env.CHAT_S3_REGION || process.env.S3_REGION || 'ap-southeast-1'
export const CHAT_PREFIX = (process.env.CHAT_S3_PREFIX || 'chat').replace(/^\/+|\/+$/g, '')

/**
 * The 10-day rule. Every upload gets expires_at = now + this many days, and the
 * Accounts scheduler's `chat:purge-media` deletes the object once it passes.
 * One sweep covers both systems because there is one bucket and one table.
 *
 * MUST match config/chat.php → media_ttl_days.
 */
export const MEDIA_TTL_DAYS = Number(process.env.CHAT_MEDIA_TTL_DAYS ?? 10)

export const MAX_UPLOAD_MB = Number(process.env.CHAT_MAX_UPLOAD_MB ?? 25)

/**
 * Refused outright. An allow-list would be wrong — the brief asks for any file
 * type — so this is only the things that execute rather than open.
 *
 * MUST match config/chat.php → blocked_extensions.
 */
export const BLOCKED_EXTENSIONS = [
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl',
  'jar', 'app', 'dmg', 'sh', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'hta',
]

/* ── Live updates ─────────────────────────────────────────────────────────── */

/**
 * Cursor polling intervals, in milliseconds. Neither app has a socket server and
 * this is a shared production database, so the client asks "anything after id
 * N?" on a cadence that follows what the user is doing. The query behind it is
 * one indexed range read on chat_msg_stream.
 *
 * MUST match config/chat.php → poll.
 */
export const POLL = {
  active: Number(process.env.CHAT_POLL_ACTIVE_MS ?? 1500),
  idle: Number(process.env.CHAT_POLL_IDLE_MS ?? 5000),
  background: Number(process.env.CHAT_POLL_BACKGROUND_MS ?? 20000),
}

export const ONLINE_WINDOW_SECONDS = Number(process.env.CHAT_ONLINE_WINDOW ?? 45)
export const TYPING_LEASE_SECONDS = 6
export const PAGE_SIZE = 40

/* ── Openable record cards ────────────────────────────────────────────────── */

export type CardType = 'invoice' | 'pnl' | 'booking' | 'agenda'

/**
 * `owner` is the system that holds the data; both systems can OPEN all four.
 * That is the point of the feature — an OPS user reads a P&L without an Accounts
 * login, and an Accounts user reads a tour agenda without an OPS one.
 *
 * MUST match config/chat.php → cards.
 */
export const CARDS: Record<CardType, { label: string; icon: string; owner: ChatSystem; accent: string }> = {
  invoice: { label: 'Invoice', icon: 'receipt',   owner: 'accounts', accent: '#0d9488' },
  pnl:     { label: 'P&L',     icon: 'pie',       owner: 'accounts', accent: '#7c3aed' },
  booking: { label: 'Booking', icon: 'suitcase',  owner: 'ops',      accent: '#2563eb' },
  agenda:  { label: 'Agenda',  icon: 'route',     owner: 'ops',      accent: '#ea580c' },
}

/** The reference normalisation both systems use: "IS 48541" → "IS48541". */
export function normaliseRef(ref: string): string {
  return (ref || '').trim().replace(/\s+/g, '').toUpperCase()
}
