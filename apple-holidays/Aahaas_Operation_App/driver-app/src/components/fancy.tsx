/**
 * Shared "friendly" building blocks for the driver tabs: gradient page header,
 * sliding segmented control, coloured icon bubbles and stat tiles.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { C } from '@/lib/theme';
import { CountUp } from './live-day';
import type { IconName } from './ui';

const WORDMARK_WHITE = require('../../assets/images/aahaas-wordmark-white.png');

export function PageHeader({ title, sub, icon, colors = ['#0A1640', '#122B78', '#1D3FA0'], right, children }: {
  title: string
  sub?: string
  icon: IconName
  colors?: [string, string, string] | [string, string]
  right?: ReactNode
  children?: ReactNode
}) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.circleA} />
        <View style={styles.circleB} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Image source={WORDMARK_WHITE} style={{ width: 74, height: 24, opacity: 0.9 }} contentFit="contain" alt="Aahaas" />
          {right}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.headerIcon}><Ionicons name={icon} size={24} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{title}</Text>
            {sub ? <Text style={styles.headerSub}>{sub}</Text> : null}
          </View>
        </View>
        {children}
      </LinearGradient>
    </Animated.View>
  );
}

/** Two or three options with a pill that slides to the chosen one. */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { id: T; label: string; count?: number }[]
  onChange: (v: T) => void
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex(o => o.id === value));
  const x = useSharedValue(0);
  const seg = w / options.length;
  useEffect(() => { x.value = withSpring(idx * seg, { damping: 18, stiffness: 200 }); }, [idx, seg, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.seg} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width - 8)}>
      {w > 0 && (
        <Animated.View style={[styles.segPill, { width: seg }, pill]}>
          <LinearGradient colors={['#FF4D5E', C.red]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      )}
      {options.map(o => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} style={styles.segBtn} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(o.id); }}>
            <Text style={[styles.segText, on && { color: '#fff' }]}>{o.label}</Text>
            {o.count != null && (
              <View style={[styles.segCount, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                <Text style={[styles.segCountText, on && { color: '#fff' }]}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconBubble({ icon, color, bg, size = 40 }: { icon: IconName; color: string; bg: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.34, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.5} color={color} />
    </View>
  );
}

/** Soft gradient tile with a number that counts up. */
export function StatTile({ value, label, icon, colors, accent, delay = 0, suffix }: {
  value: number | null
  label: string
  icon: IconName
  colors: [string, string]
  accent: string
  delay?: number
  suffix?: string
}) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(16)} style={{ flex: 1 }}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <View style={styles.tileIcon}><Ionicons name={icon} size={16} color={accent} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          {value == null ? <Text style={styles.tileValue}>—</Text> : <CountUp value={value} decimals={0} style={styles.tileValue} />}
          {suffix && value != null ? <Text style={[styles.tileValue, { fontSize: 16, marginBottom: 3 }]}>{suffix}</Text> : null}
        </View>
        <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { borderRadius: 28, padding: 16, gap: 14, overflow: 'hidden' },
  circleA: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.06)', right: -50, top: -60 },
  circleB: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.05)', right: 40, bottom: -70 },
  headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.4 },
  headerSub: { color: '#C7D2FE', fontSize: 13, fontWeight: '700' },
  seg: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 18, padding: 4, borderWidth: 1, borderColor: C.line },
  segPill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 14, overflow: 'hidden' },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
  segText: { color: C.sub, fontWeight: '900', fontSize: 14 },
  segCount: { minWidth: 22, height: 20, borderRadius: 10, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segCountText: { color: C.sub, fontWeight: '900', fontSize: 11 },
  tile: { borderRadius: 20, padding: 12, gap: 2, minHeight: 108 },
  tileIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileValue: { color: C.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tileLabel: { color: C.text, fontSize: 12, fontWeight: '700', opacity: 0.7 },
});
