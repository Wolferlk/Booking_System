import * as Haptics from 'expo-haptics';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBar, TabIcon, type TabIconName } from '@/components/tab-icon';
import { homeFor, useAuth } from '@/lib/auth';

/** Vehicle-vendor tabs: fleet home, trips to staff, open trips, fleet, account. */
export default function VendorTabs() {
  const { actor } = useAuth();
  const insets = useSafeAreaInsets();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'VENDOR') return <Redirect href={homeFor(actor)} />;
  const icon = (name: TabIconName) => function Icon({ focused }: { focused: boolean }) { return <TabIcon name={name} focused={focused} />; };
  return (
    <Tabs
      screenListeners={{ tabPress: () => { Haptics.selectionAsync().catch(() => {}); } }}
      screenOptions={floatingTabBar(insets.bottom)}>
      <Tabs.Screen name="fleet-home" options={{ title: 'Home', tabBarIcon: icon('grid') }} />
      <Tabs.Screen name="fleet-trips" options={{ title: 'Trips', tabBarIcon: icon('map') }} />
      <Tabs.Screen name="fleet-market" options={{ title: 'Get trips', tabBarIcon: icon('add-circle') }} />
      <Tabs.Screen name="fleet" options={{ title: 'Fleet', tabBarIcon: icon('people') }} />
      <Tabs.Screen name="fleet-account" options={{ title: 'Me', tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
