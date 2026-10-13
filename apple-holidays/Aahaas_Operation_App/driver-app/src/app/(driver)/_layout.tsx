import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';

export default function DriverTabs() {
  const { actor } = useAuth();
  const t = useT();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'DRIVER') return <Redirect href="/live" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size + 2} />;
  };
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: C.red,
      tabBarInactiveTintColor: C.dim,
      tabBarStyle: { backgroundColor: '#0B1120', borderTopColor: C.line, height: 88, paddingTop: 8 },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
    }}>
      <Tabs.Screen name="today" options={{ title: t('today'), tabBarIcon: icon('sunny') }} />
      <Tabs.Screen name="trips" options={{ title: t('trips'), tabBarIcon: icon('map') }} />
      <Tabs.Screen name="get-trips" options={{ title: t('getTrips'), tabBarIcon: icon('add-circle') }} />
      <Tabs.Screen name="score" options={{ title: t('score'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="me" options={{ title: t('me'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
