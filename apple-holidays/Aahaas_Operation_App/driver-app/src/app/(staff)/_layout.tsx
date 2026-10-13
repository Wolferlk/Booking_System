import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function StaffTabs() {
  const { actor } = useAuth();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'STAFF') return <Redirect href="/today" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size + 2} />;
  };
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: C.gold, tabBarInactiveTintColor: C.dim,
      tabBarStyle: { backgroundColor: '#0B1120', borderTopColor: C.line, height: 88, paddingTop: 8 },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
    }}>
      <Tabs.Screen name="live" options={{ title: 'Live', tabBarIcon: icon('radio') }} />
      <Tabs.Screen name="inbox" options={{ title: 'Requests', tabBarIcon: icon('file-tray-full') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
