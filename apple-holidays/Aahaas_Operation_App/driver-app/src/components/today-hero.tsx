/**
 * The top of "Today": a painted scene that follows the time of day (sunrise,
 * afternoon, dusk), the driver's photo and a friendly greeting. The scene
 * drifts slowly so the screen feels alive without being busy.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { API_URL } from '@/lib/config';
import { C } from '@/lib/theme';
import type { IconName } from './ui';

const WORDMARK_WHITE = require('../../assets/images/aahaas-wordmark-white.png');
const WORDMARK_RED = require('../../assets/images/aahaas-wordmark-red.png');

const SCENES = {
  morning: require('../../assets/images/illustrations/banner-morning.jpg'),
  afternoon: require('../../assets/images/illustrations/banner-afternoon.jpg'),
  evening: require('../../assets/images/illustrations/banner-evening.jpg'),
};

export function partOfDay(): keyof typeof SCENES {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function GlassButton({ icon, onPress, badge, tint = '#fff' }: { icon: IconName; onPress: () => void; badge?: number; tint?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.glassBtn, pressed && { transform: [{ scale: 0.92 }] }]}>
      <Ionicons name={icon} size={22} color={tint} />
      {!!badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
    </Pressable>
  );
}

export function TodayHero({ greeting, name, photoUrl, unread, onBell, onHelp }: {
  greeting: string
  name: string
  photoUrl?: string | null
  unread?: number
  onBell: () => void
  onHelp: () => void
}) {
  const part = partOfDay();
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withSequence(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [drift]);
  const sceneStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1.08 }, { translateX: -8 + drift.value * 16 }] }));

  const photo = photoUrl ? (photoUrl.startsWith('http') ? photoUrl : `${API_URL}${photoUrl}`) : null;
  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const dark = part === 'evening';
  const ink = dark ? '#fff' : '#0E1525';
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Animated.View entering={FadeIn.duration(500)} style={styles.wrap}>
      <Animated.View style={[StyleSheet.absoluteFill, sceneStyle]}>
        <Image source={SCENES[part]} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ right: 0, bottom: 0 }} alt="" />
      </Animated.View>
      <LinearGradient
        colors={dark ? ['rgba(10,22,64,0.85)', 'rgba(10,22,64,0.35)', 'rgba(10,22,64,0)'] : ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }} end={{ x: 0.85, y: 0.5 }} style={StyleSheet.absoluteFill} />

      <View style={styles.top}>
        <View style={styles.brand}>
          <Image source={dark ? WORDMARK_WHITE : WORDMARK_RED} style={{ width: 96, height: 31 }} contentFit="contain" alt="Aahaas" />
          <View style={[styles.core, { backgroundColor: dark ? 'rgba(255,255,255,0.16)' : C.red }]}>
            <Text style={styles.coreText}>CORE</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GlassButton icon="notifications" onPress={onBell} badge={unread} tint={dark ? '#fff' : '#0E1525'} />
          <GlassButton icon="alert-circle" onPress={onHelp} tint={C.red} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.avatar}>
          {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" alt="" /> : <Text style={styles.initials}>{initials || '🙂'}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greet, { color: dark ? '#C7D2FE' : '#475569' }]}>{greeting},</Text>
          <Text style={[styles.name, { color: ink }]} numberOfLines={1}>{name} 👋</Text>
          <Text style={[styles.date, { color: dark ? '#A5B4FC' : '#64748B' }]}>{date}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 196, borderRadius: 28, overflow: 'hidden', padding: 16, justifyContent: 'space-between', backgroundColor: '#DCE7FF' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  core: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginTop: -8 },
  coreText: { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 1.5 },
  avatar: { width: 54, height: 54, borderRadius: 18, overflow: 'hidden', backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  initials: { color: '#fff', fontWeight: '900', fontSize: 18 },
  glassBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  greet: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  date: { fontSize: 13, fontWeight: '700' },
});
