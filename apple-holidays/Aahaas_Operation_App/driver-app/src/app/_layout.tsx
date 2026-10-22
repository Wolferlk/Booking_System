import '@/lib/location'; // registers the background GPS task at startup
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready } = useAuth();
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);

  // Tapping a push opens the screen it is about.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(r => {
      const d = r.notification.request.content.data as { bookingRef?: string; screen?: string; requestId?: string } | undefined;
      if (d?.screen === 'vehicle') router.push('/vehicle-check');
      else if (d?.screen === 'vendor-trip') router.push('/fleet-trips');
      else if (d?.screen === 'vendor-market') router.push('/fleet-market');
      else if (d?.screen === 'get-trips') router.push('/get-trips');
      else if (d?.bookingRef && d.screen === 'trip') router.push({ pathname: '/trip/[ref]', params: { ref: d.bookingRef } });
      else router.push('/notifications');
    });
    return () => sub.remove();
  }, []);

  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(driver)" />
      <Stack.Screen name="(staff)" />
      <Stack.Screen name="(vendor)" />
      <Stack.Screen name="fleet/driver" options={{ presentation: 'modal' }} />
      <Stack.Screen name="fleet/vehicle" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trip/start" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="trip/finish" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="help" options={{ presentation: 'modal' }} />
      <Stack.Screen name="live-map" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom', gestureEnabled: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Root />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
