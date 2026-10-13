/**
 * Push notifications. Expo push tokens need a development/store build on
 * Android (Expo Go on Android has no push since SDK 53); local reminders and
 * the in-app bell still work everywhere.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let registeredToken: string | null = null;

export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trips', {
        name: 'Trips',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#E11D48',
      });
    }
    if (!Device.isDevice) return null;
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return null; // run `npx eas-cli init` once to get a projectId
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('/api/mobile/push-token', { body: { token, platform: Platform.OS } });
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

export async function unregisterPush() {
  if (!registeredToken) return;
  await api('/api/mobile/push-token', { method: 'DELETE', body: { token: registeredToken } }).catch(() => {});
  registeredToken = null;
}
