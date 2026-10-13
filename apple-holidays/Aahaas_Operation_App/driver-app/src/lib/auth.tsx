import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { getToken, setToken } from './storage';
import { registerForPush, unregisterPush } from './push';
import { stopTracking } from './location';
import { LangContext, type Lang } from './i18n';

export interface DriverActor {
  kind: 'DRIVER'
  id: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  photoUrl: string | null
  country: string | null
  language: Lang
  vendor: string | null
  vehicle: { id: string; type: string; plateNo: string; brand: string | null; model: string | null; capacity: number; photoInside: string | null; photoOutside: string | null } | null
  bank: { bankName: string | null; branch: string | null; holder: string | null; accountNo: string | null } | null
  vehicleCheck: { due: boolean; daysLeft: number; dueAt: string | null; lastAt: string | null; rejectedNote: string | null } | null
  pendingProfileChanges?: number
}
export interface StaffActor {
  kind: 'STAFF'
  id: string
  name: string
  email: string
  role: string
  country: string
  avatar: string | null
}
export type Actor = DriverActor | StaffActor

interface AuthState {
  ready: boolean
  actor: Actor | null
  signIn: (token: string, actor: Actor) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setLanguage: (l: Lang) => Promise<void>
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [actor, setActor] = useState<Actor | null>(null);

  const signOut = useCallback(async () => {
    await stopTracking().catch(() => {});
    await unregisterPush();
    await setToken(null);
    setActor(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<Actor>('/api/mobile/me');
    setActor(me);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setActor(null); });
    (async () => {
      if (await getToken()) {
        try {
          await refresh();
          registerForPush();
        } catch {
          // offline at launch: keep the token, the screens will retry
        }
      }
      setReady(true);
    })();
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const signIn = useCallback(async (token: string, a: Actor) => {
    await setToken(token);
    setActor(a);
    registerForPush();
  }, []);

  const setLanguage = useCallback(async (l: Lang) => {
    await api('/api/mobile/me', { method: 'PATCH', body: { language: l } });
    setActor(a => (a && a.kind === 'DRIVER' ? { ...a, language: l } : a));
  }, []);

  const value = useMemo(() => ({ ready, actor, signIn, signOut, refresh, setLanguage }), [ready, actor, signIn, signOut, refresh, setLanguage]);
  const lang: Lang = actor?.kind === 'DRIVER' ? actor.language : 'en';
  return (
    <Ctx.Provider value={value}>
      <LangContext.Provider value={lang}>{children}</LangContext.Provider>
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
