import { API_URL } from './config';
import { getToken } from './storage';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

type Listener = () => void;
let onUnauthorized: Listener | null = null;
/** The auth provider registers this so an expired session signs the user out. */
export function setUnauthorizedHandler(fn: Listener | null) { onUnauthorized = fn; }

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const token = init.auth === false ? null : await getToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError('No internet connection. Please try again.', 0, 'offline');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && token && init.auth !== false) onUnauthorized?.();
    throw new ApiError(json?.error || `Server error (${res.status})`, res.status, json?.code);
  }
  return json.data as T;
}
