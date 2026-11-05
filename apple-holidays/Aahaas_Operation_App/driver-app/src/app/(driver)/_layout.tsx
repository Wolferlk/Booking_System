import * as Haptics from 'expo-haptics';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBar, TabIcon, type TabIconName as IconName } from '@/components/tab-icon';
import { homeFor, useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function DriverTabs() {
  const { actor } = useAuth();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'DRIVER') return <Redirect href={homeFor(actor)} />;
  const icon = (name: IconName) => function Icon({ focused }: { focused: boolean }) { return <TabIcon name={name} focused={focused} />; };
  return (
    <Tabs
      screenListeners={{ tabPress: () => { Haptics.selectionAsync().catch(() => {}); } }}
      screenOptions={floatingTabBar(insets.bottom)}>
      <Tabs.Screen name="today" options={{ title: t('today'), tabBarIcon: icon('sunny') }} />
      <Tabs.Screen name="trips" options={{ title: t('trips'), tabBarIcon: icon('map') }} />
      {/* A vendor's drivers get their trips from the vendor, not from the open board. */}
      <Tabs.Screen name="get-trips" options={{ title: t('getTrips'), tabBarIcon: icon('add-circle'), href: actor.vendor ? null : undefined }} />
      <Tabs.Screen name="score" options={{ title: t('score'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="me" options={{ title: t('me'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
