import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Tab icon: the active one sits in a red bubble that springs in. */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const p = useSharedValue(focused ? 1 : 0);
  useEffect(() => { p.value = withSpring(focused ? 1 : 0, { damping: 14, stiffness: 180 }); }, [focused, p]);
  const bubble = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.6 + p.value * 0.4 }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ translateY: -p.value * 2 }, { scale: 1 + p.value * 0.08 }] }));
  return (
    <View style={{ width: 52, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 52, height: 36, borderRadius: 14, backgroundColor: C.redSoft }, bubble]} />
      <Animated.View style={icon}>
        <Ionicons name={focused ? name : (`${name}-outline` as IconName)} size={23} color={focused ? C.red : C.dim} />
      </Animated.View>
    </View>
  );
}

export default function DriverTabs() {
  const { actor } = useAuth();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (!actor) return <Redirect href="/welcome" />;
  if (actor.kind !== 'DRIVER') return <Redirect href="/home" />;
  const icon = (name: IconName) => function Icon({ focused }: { focused: boolean }) { return <TabIcon name={name} focused={focused} />; };
  return (
    <Tabs
      screenListeners={{ tabPress: () => { Haptics.selectionAsync().catch(() => {}); } }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.red,
        tabBarInactiveTintColor: C.dim,
        tabBarStyle: {
          position: 'absolute', bottom: Math.max(insets.bottom, 12),
          marginHorizontal: 14, height: 70, borderRadius: 26, borderTopWidth: 0, paddingTop: 8, paddingBottom: 8,
          backgroundColor: 'rgba(255,255,255,0.98)',
          shadowColor: '#0E1525', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
        },
        tabBarItemStyle: { paddingTop: Platform.OS === 'ios' ? 2 : 0 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginTop: 2 },
      }}>
      <Tabs.Screen name="today" options={{ title: t('today'), tabBarIcon: icon('sunny') }} />
      <Tabs.Screen name="trips" options={{ title: t('trips'), tabBarIcon: icon('map') }} />
      <Tabs.Screen name="get-trips" options={{ title: t('getTrips'), tabBarIcon: icon('add-circle') }} />
      <Tabs.Screen name="score" options={{ title: t('score'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="me" options={{ title: t('me'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
