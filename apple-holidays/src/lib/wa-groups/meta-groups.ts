/**
 * Meta's Groups API: real WhatsApp groups.
 *
 * Only an Official Business Account may use it. A group holds 8 people, people
 * join by invite link only, and there is no way to add someone directly. Meta's
 * refusal is passed to the desk, and the group carries on as an inbox group.
 *
 * Never run against a real account yet. Unconfirmed in Meta's docs, so handled
 * defensively: the create response shape (the group may only be findable
 * afterwards) and whether a document is an allowed "media" type in a group.
 */
import { uploadMetaMedia } from '@/lib/whatsapp'

const VERSION = process.env.WHATSAPP_GROUPS_API_VERSION?.trim() || 'v27.0'

function creds() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!token || !phoneId) throw new Error('WhatsApp is not configured on this server.')
  return { token, phoneId }
}

async function graph<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const { token } = creds()
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; code?: number } }
  if (!res.ok) throw new Error(`Meta said: ${json.error?.message ?? res.status}${json.error?.code ? ` (${json.error.code})` : ''}`)
  return json as T
}

export async function createRealGroup(subject: string): Promise<{ groupId: string | null }> {
  const { phoneId } = creds()
  const r = await graph<{ id?: string; group_id?: string }>(`${phoneId}/groups`, 'POST', {
    messaging_product: 'whatsapp', subject: subject.slice(0, 128), join_approval_mode: 'auto_approve',
  })
  return { groupId: r.group_id ?? r.id ?? null }
}

/** Find a just-created group by its name, for when create did not return an id. */
export async function findRealGroupBySubject(subject: string): Promise<string | null> {
  const { phoneId } = creds()
  const r = await graph<{ data?: { groups?: { id: string; subject: string }[] } }>(`${phoneId}/groups?limit=1024`, 'GET')
  return r.data?.groups?.find(g => g.subject === subject.slice(0, 128))?.id ?? null
}

export async function getInviteLink(groupId: string): Promise<string | null> {
  const r = await graph<{ invite_link?: string }>(`${groupId}/invite_link`, 'GET')
  return r.invite_link ?? null
}

function messageId(r: { messages?: { id?: string }[] }) {
  return r.messages?.[0]?.id ?? null
}

export async function sendRealGroupText(groupId: string, body: string): Promise<string | null> {
  const { phoneId } = creds()
  return messageId(await graph(`${phoneId}/messages`, 'POST', {
    messaging_product: 'whatsapp', recipient_type: 'group', to: groupId, type: 'text', text: { body },
  }))
}

export async function sendRealGroupDocument(groupId: string, doc: { buffer: Buffer; filename: string }, caption: string): Promise<string | null> {
  const { phoneId } = creds()
  const id = await uploadMetaMedia(doc.buffer, doc.filename)
  return messageId(await graph(`${phoneId}/messages`, 'POST', {
    messaging_product: 'whatsapp', recipient_type: 'group', to: groupId, type: 'document',
    document: { id, filename: doc.filename, caption },
  }))
}

export async function removeRealParticipant(groupId: string, phone: string): Promise<void> {
  await graph(`${groupId}/participants`, 'DELETE', { messaging_product: 'whatsapp', participants: [{ user: phone }] })
}
