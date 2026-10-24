import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; opsPhone?: string; appStage?: string };

/**
 * The ops server the app talks to. Override for a test server with
 * EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start
 * (never point it at a local server whose .env reaches the LIVE database
 * unless that is what you mean to test).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'https://ops.aahaas.com').replace(/\/$/, '');
export const OPS_PHONE = extra.opsPhone || '+94707224229';
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/**
 * Release stage shown next to the version ("Test" = beta build on the live server).
 * Set `extra.appStage` in app.json; leave it empty for a full release.
 */
export const APP_STAGE = extra.appStage?.trim() || '';
export const IS_BETA = APP_STAGE !== '';
export const APP_NAME = 'Aahaas Core App';
/** e.g. "Test 1.0.3v · Beta", or "1.0.3v" once released. */
export const APP_VERSION_LABEL = IS_BETA ? `${APP_STAGE} ${APP_VERSION}v · Beta` : `${APP_VERSION}v`;
