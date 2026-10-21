/**
 * Company side: call any allowed ops.aahaas.com API through the bridge
 * (/api/mobile/web/*), as the signed-in staff member. Responses come back in
 * the web's own shapes — `{ success, data }` for most routes, plain JSON for
 * chat — so both are unwrapped here.
 */
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ApiError } from './api';
import { API_URL } from './config';
import { getToken } from './storage';

export async function web<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/mobile/web/${path.replace(/^\/?(api\/)?/, '')}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('No internet connection. Please try again.', 0, 'offline');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new ApiError(json?.error || json?.message || `Server error (${res.status})`, res.status, json?.code);
  }
  return (json && typeof json === 'object' && 'success' in json ? json.data : json) as T;
}

/** Message the web route sent back alongside the data (e.g. "Sent to 9477…"). */
export async function webAction(path: string, body: unknown = {}, method = 'POST'): Promise<string> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/api/mobile/web/${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).catch(() => { throw new ApiError('No internet connection. Please try again.', 0, 'offline'); });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new ApiError(json?.error || json?.message || `Server error (${res.status})`, res.status, json?.code);
  return json?.message ?? 'Done';
}

/** Multipart POST through the bridge (file uploads such as whatsapp/send-media). */
export async function webForm(path: string, form: FormData): Promise<string> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/api/mobile/web/${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  }).catch(() => { throw new ApiError('No internet connection. Please try again.', 0, 'offline'); });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new ApiError(json?.error || json?.message || `Server error (${res.status})`, res.status, json?.code);
  return json?.message ?? 'Done';
}

/** Download a file from a web API path (PDF, Word) and open the share / preview sheet. */
export async function openWebFile(path: string, filename: string): Promise<void> {
  const token = await getToken();
  const dir = new Directory(Paths.cache, 'aahaas');
  dir.create({ idempotent: true, intermediates: true });
  const target = new File(dir, filename);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(`${API_URL}/api/mobile/web/${path}`, target, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: filename.endsWith('.pdf') ? 'application/pdf' : undefined, UTI: filename.endsWith('.pdf') ? 'com.adobe.pdf' : undefined, dialogTitle: filename });
}

/** expo-image source for a protected web file (chat media, WhatsApp media) via the bridge. */
export async function webImageSource(path: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await getToken();
  return { uri: `${API_URL}/api/mobile/web/${path.replace(/^\/?(api\/)?/, '')}`, headers: token ? { Authorization: `Bearer ${token}` } : {} };
}

/** Absolute URL for a public upload path (/api/uploads/...). */
export const imgUrl = (u: string | null | undefined) => (u ? (u.startsWith('http') ? u : `${API_URL}${u}`) : null);
