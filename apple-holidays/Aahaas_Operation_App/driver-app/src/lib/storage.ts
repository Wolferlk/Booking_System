import * as SecureStore from 'expo-secure-store';

// AFTER_FIRST_UNLOCK so the background GPS task can read the token while the phone is locked.
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const TOKEN = 'aahaas.token';

export async function getToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(TOKEN, OPTS); } catch { return null; }
}
export async function setToken(t: string | null): Promise<void> {
  if (t) await SecureStore.setItemAsync(TOKEN, t, OPTS);
  else await SecureStore.deleteItemAsync(TOKEN, OPTS).catch(() => {});
}
