/**
 * The wire shapes.
 *
 * These mirror what BOTH systems' APIs return — app/Http/Controllers/Chat in the
 * Accounts app and src/app/api/chat here — because the two describe the same
 * rows. If a field changes shape in one, it changes in the other.
 */

export interface ChatPerson {
  key: string                 // "system:user_ref", the identity used everywhere
  system: 'accounts' | 'ops'
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

export interface ChatAttachment {
  id: number
  name: string
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'sheet' | 'doc' | 'archive' | 'other'
  mime: string | null
  size: number
  size_label: string
  width: number | null
  height: number | null
  duration_ms: number | null
  waveform: number[] | null
  url: string | null
  thumb_url: string | null
  /** True once the 10-day retention has passed and the object has been deleted. */
  expired: boolean
  days_left: number
}

export interface ChatCardPreview {
  title?: string
  subtitle?: string | null
  meta?: Array<{ label: string; value: string }>
  status?: string
  status_tone?: 'good' | 'bad' | 'warn' | 'neutral'
}

export interface ChatMessage {
  id: number | null            // null only for an optimistic bubble
  conversation_id: number
  kind: 'text' | 'media' | 'voice' | 'card' | 'system'
  body: string | null
  sender: ChatPerson
  client_uuid: string | null
  created_at: string | null
  edited_at: string | null
  deleted: boolean
  card: null | {
    type: string
    ref: string
    label: string
    accent: string
    /** The snapshot taken at send time. Opening the card re-reads the live record. */
    preview: ChatCardPreview
  }
  reply_to: null | { id: number; sender: string; preview: string }
  attachments: ChatAttachment[]
  reactions: Array<{ emoji: string; count: number; people: string[]; keys: string[] }>
}

export interface ChatConversation {
  id: number
  type: 'direct' | 'group'
  title: string
  topic: string | null
  emoji: string | null
  accent: string
  peer: ChatPerson | null
  members: Array<ChatPerson & { member_role: string }>
  member_count: number
  /** True when the thread spans Accounts and Operations — the UI marks these. */
  cross_system: boolean
  last_message: { id: number | null; preview: string | null; at: string | null }
  unread: number
  is_pinned: boolean
  is_muted: boolean
  my_role: string
  last_read_id: number | null
}

export interface ChatConfig {
  poll: { active: number; idle: number; background: number }
  systems: Record<string, { label: string; short: string; accent: string }>
  cards: Record<string, { label: string; icon: string; owner: string; accent: string }>
  media_ttl_days: number
  max_upload_mb: number
  page_size: number
}

export interface ChatSettings {
  sound_enabled: boolean
  desktop_notifications: boolean
  enter_to_send: boolean
  theme: string
  dock_state: Array<{ conversation_id: number; minimized: boolean }>
}

export interface CardSection {
  title: string
  type: 'table' | 'rows' | 'text'
  columns?: string[]
  rows?: Array<Array<string | number | null>>
  text?: string
}

export interface CardDocument {
  type: string
  ref: string
  title: string
  subtitle: string | null
  accent: string
  badges: Array<{ label: string; tone: string }>
  stats: Array<{ label: string; value: string; tone?: string }>
  sections: CardSection[]
  footnote: string
  read_at: string
}

/** Staged in the composer — chosen, previewed, not yet sent. */
export interface StagedCard { type: string; ref: string }

/** In the composer's tray: either uploading, or uploaded and awaiting send. */
export type PendingAttachment =
  | { uploading: true; name: string; progress: number; localId: string }
  | (ChatAttachment & { uploading?: false })
