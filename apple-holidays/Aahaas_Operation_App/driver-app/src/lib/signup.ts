/**
 * Self-registration (new independent driver / new vehicle vendor). After
 * registering, the person waits for the operations team to approve them; the
 * phone keeps the registration's `pendingToken` so the waiting screen can ask
 * for its status (`/api/mobile/auth/register/status`). The token is not a
 * session — once approved, they sign in with the password they chose.
 */
import * as SecureStore from 'expo-secure-store';

export type SignupKind = 'DRIVER' | 'VENDOR';
export type SignupStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'GONE';

export interface PendingSignup {
  kind: SignupKind
  token: string
  name: string
  /** What they sign in with once approved: the driver's phone, the vendor's e-mail. */
  identifier: string
  submittedAt: string
}

export const SIGNUP_COUNTRIES: { value: string; label: string; flag: string; dial: string }[] = [
  { value: 'SRILANKA', label: 'Sri Lanka', flag: '🇱🇰', dial: '+94' },
  { value: 'VIETNAM', label: 'Vietnam', flag: '🇻🇳', dial: '+84' },
  { value: 'SINGAPORE', label: 'Singapore', flag: '🇸🇬', dial: '+65' },
  { value: 'MALAYSIA', label: 'Malaysia', flag: '🇲🇾', dial: '+60' },
];

const KEY = 'aahaas.pendingSignup';

export async function getPendingSignup(): Promise<PendingSignup | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const p = raw ? (JSON.parse(raw) as PendingSignup) : null;
    return p?.token && (p.kind === 'DRIVER' || p.kind === 'VENDOR') ? p : null;
  } catch {
    return null;
  }
}

export async function setPendingSignup(p: PendingSignup | null): Promise<void> {
  try {
    if (p) await SecureStore.setItemAsync(KEY, JSON.stringify(p));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Storage unavailable: the person can still sign in once approved.
  }
}

/** Same rule as the server's set-password check. */
export function passwordProblem(pw: string, again: string): string | null {
  if (pw.length < 6) return 'Use at least 6 characters for your password.';
  if (/^(\d)\1+$/.test(pw) || pw === '123456') return 'That password is too easy to guess.';
  if (pw !== again) return 'The two passwords do not match.';
  return null;
}
