import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { homeFor, useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function CompanyTabs() {
  const { actor } = useAuth();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'STAFF') return <Redirect href={homeFor(actor)} />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size + 1} />;
  };
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: C.red, tabBarInactiveTintColor: C.dim,
      tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line, height: 88, paddingTop: 8 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('grid') }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: icon('briefcase') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('chatbubbles') }} />
      <Tabs.Screen name="drivers" options={{ title: 'Drivers', tabBarIcon: icon('car-sport') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('apps') }} />
      <Tabs.Screen name="live" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
    </Tabs>
  );
}
