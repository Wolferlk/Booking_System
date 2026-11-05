import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { C } from '@/lib/theme';

export type TabIconName = keyof typeof Ionicons.glyphMap;

/** Tab icon: the active one sits in a red bubble that springs in. */
export function TabIcon({ name, focused }: { name: TabIconName; focused: boolean }) {
  const p = useSharedValue(focused ? 1 : 0);
  useEffect(() => { p.value = withSpring(focused ? 1 : 0, { damping: 14, stiffness: 180 }); }, [focused, p]);
  const bubble = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.6 + p.value * 0.4 }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ translateY: -p.value * 2 }, { scale: 1 + p.value * 0.08 }] }));
  return (
    <View style={{ width: 52, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 52, height: 36, borderRadius: 14, backgroundColor: C.redSoft }, bubble]} />
      <Animated.View style={icon}>
        <Ionicons name={focused ? name : (`${name}-outline` as TabIconName)} size={23} color={focused ? C.red : C.dim} />
      </Animated.View>
    </View>
  );
}

/** The floating white tab bar the driver and vendor sides share. */
export function floatingTabBar(bottomInset: number) {
  return {
    headerShown: false,
    tabBarActiveTintColor: C.red,
    tabBarInactiveTintColor: C.dim,
    tabBarStyle: {
      position: 'absolute' as const, bottom: Math.max(bottomInset, 12),
      marginHorizontal: 14, height: 70, borderRadius: 26, borderTopWidth: 0, paddingTop: 8, paddingBottom: 8,
      backgroundColor: 'rgba(255,255,255,0.98)',
      shadowColor: '#0E1525', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
    },
    tabBarItemStyle: { paddingTop: Platform.OS === 'ios' ? 2 : 0 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '800' as const, marginTop: 2 },
  };
}
