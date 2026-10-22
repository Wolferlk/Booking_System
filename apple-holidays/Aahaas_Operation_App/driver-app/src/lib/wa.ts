/**
 * WhatsApp thread helpers — formatting, delivery ticks, the 24h window,
 * quick replies and drafts. Quick replies + drafts live on the phone
 * (AsyncStorage), the same way the web keeps them in localStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const WA_TEXT_LIMIT = 4096;
const WINDOW_MS = 24 * 3_600_000;

export interface QuickReply { id: string; shortcut: string; text: string; custom?: boolean }

/** Same four as ops.aahaas.com → WhatsApp, so the desk sees the same shortcuts. */
export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-hello', shortcut: 'hello', text: 'Hello {name}! Thank you for contacting Apple Holidays. How can we help you today?' },
  { id: 'qr-check', shortcut: 'check', text: 'Thank you — let me check this with the team and get back to you shortly.' },
  { id: 'qr-driver', shortcut: 'driver', text: 'Your driver details will be shared with you before the pickup time.' },
  { id: 'qr-thanks', shortcut: 'thanks', text: 'Thank you for travelling with Apple Holidays. Have a wonderful trip!' },
];

export const EMOJIS = ['😊', '🙏', '👍', '👌', '🙌', '❤️', '🎉', '✨', '✅', '⚠️', '📍', '🕐', '📅', '✈️', '🚗', '🏨', '🧳', '🌴', '📄', '📞'];

const QR_KEY = 'wa.quickReplies';
const draftKey = (phone: string) => `wa.draft.${phone}`;

export async function loadQuickReplies(): Promise<QuickReply[]> {
  try {
    const raw = await AsyncStorage.getItem(QR_KEY);
    const custom = raw ? (JSON.parse(raw) as QuickReply[]) : [];
    return [...custom.map(q => ({ ...q, custom: true })), ...DEFAULT_QUICK_REPLIES];
  } catch { return DEFAULT_QUICK_REPLIES; }
}

export async function saveCustomQuickReplies(all: QuickReply[]): Promise<void> {
  await AsyncStorage.setItem(QR_KEY, JSON.stringify(all.filter(q => q.custom).map(({ id, shortcut, text }) => ({ id, shortcut, text }))));
}

export async function loadDraft(phone: string): Promise<string> {
  try { return (await AsyncStorage.getItem(draftKey(phone))) ?? ''; } catch { return ''; }
}

export function saveDraft(phone: string, text: string) {
  (text ? AsyncStorage.setItem(draftKey(phone), text) : AsyncStorage.removeItem(draftKey(phone))).catch(() => {});
}

/** {name} {ref} {me} → the guest's first name, booking ref, your first name. */
export function expandTokens(text: string, ctx: { name?: string | null; ref?: string | null; me?: string | null }) {
  const first = (s?: string | null) => (s ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim().split(/\s+/)[0] ?? '';
  return text
    .replace(/\{name\}/gi, first(ctx.name) || 'there')
    .replace(/\{ref\}/gi, ctx.ref ?? '')
    .replace(/\{me\}/gi, first(ctx.me));
}

// ─── 24h customer-care window ───────────────────────────────────────────────

/** Ms left in the window, from the last inbound message; null when it has closed. */
export function windowLeft(lastInboundIso: string | null, now = Date.now()): number | null {
  if (!lastInboundIso) return null;
  const left = new Date(lastInboundIso).getTime() + WINDOW_MS - now;
  return left > 0 ? left : null;
}

export function fmtLeft(ms: number) {
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ─── Delivery ticks ─────────────────────────────────────────────────────────

export type Tick = { icon: 'time-outline' | 'checkmark' | 'checkmark-done' | 'alert-circle'; color: string; label: string };

export function tickFor(status: string | null | undefined): Tick {
  switch ((status ?? '').toLowerCase()) {
    case 'read': return { icon: 'checkmark-done', color: '#53BDEB', label: 'Seen' };
    case 'delivered': return { icon: 'checkmark-done', color: '#8696A0', label: 'Delivered' };
    case 'failed': return { icon: 'alert-circle', color: '#E5484D', label: 'Not delivered' };
    case 'pending': case 'sending': case 'held': case 'accepted': return { icon: 'time-outline', color: '#8696A0', label: 'Sending' };
    default: return { icon: 'checkmark', color: '#8696A0', label: 'Sent' };
  }
}

// ─── WhatsApp text formatting ───────────────────────────────────────────────

export type Seg = { t: string; b?: boolean; i?: boolean; s?: boolean; m?: boolean; url?: string };

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
const FMT_RE = /```([\s\S]+?)```|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

/** *bold* _italic_ ~strike~ `mono` + links, the way WhatsApp renders them. URLs are kept whole first so their underscores survive. */
export function parseWa(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) out.push(...parseFmt(text.slice(last, m.index)));
    const raw = m[0].replace(/[).,!?]+$/, '');
    out.push({ t: raw, url: raw.startsWith('http') ? raw : `https://${raw}` });
    last = m.index! + raw.length;
  }
  if (last < text.length) out.push(...parseFmt(text.slice(last)));
  return out;
}

function parseFmt(text: string, base: Omit<Seg, 't'> = {}): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(FMT_RE)) {
    if (m.index! > last) out.push({ ...base, t: text.slice(last, m.index) });
    const [, block, mono, bold, ital, strike] = m;
    if (block ?? mono) out.push({ ...base, t: (block ?? mono)!, m: true });
    else out.push(...parseFmt((bold ?? ital ?? strike)!, { ...base, b: base.b || bold !== undefined, i: base.i || ital !== undefined, s: base.s || strike !== undefined }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ ...base, t: text.slice(last) });
  return out;
}

/** A send the server hasn't confirmed yet — shown in the thread straight away. */
export interface Pending {
  tempId: string
  kind: 'text' | 'media' | 'template'
  text: string
  file?: { uri: string; name: string; type: string; isImage: boolean }
  template?: { name: string; lang: string; bodyParams: string[]; headerParams: string[] }
  at: string
  state: 'sending' | 'failed'
  error?: string
}

// ─── Templates ──────────────────────────────────────────────────────────────

export interface WaTemplate {
  name: string; language: string; status: string; category: string | null
  headerFormat: string | null; headerText: string; bodyText: string
  bodyVariableCount: number; headerVariableCount: number
}

export const fillTemplate = (text: string, vals: string[]) =>
  text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => vals[Number(n) - 1] || `{{${n}}}`);

/** Best guess for each {{n}} from the words just before it — "Dear {{1}}" is the guest, "Ref {{2}}" the booking. */
export function guessParams(text: string, count: number, ctx: { name?: string | null; ref?: string | null }): string[] {
  const vals = Array.from({ length: count }, () => '');
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const i = Number(m[1]) - 1;
    if (i < 0 || i >= count || vals[i]) continue;
    const before = text.slice(Math.max(0, m.index! - 24), m.index).toLowerCase();
    if (/(hi|hello|dear|hey)\W*$/.test(before) && ctx.name) vals[i] = ctx.name;
    else if (/(ref|booking|file)\W*(no\.?|number|#)?\W*$/.test(before) && ctx.ref) vals[i] = ctx.ref;
  }
  return vals;
}
