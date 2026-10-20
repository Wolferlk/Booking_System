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
import Svg, { Circle, Defs, LinearGradient as SvgLinear, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { C } from '@/lib/theme';
import { CountUp } from './live-day';
import type { IconName } from './ui';

const WORDMARK_WHITE = require('../../assets/images/aahaas-wordmark-white.png');

/**
 * The app-icon look behind a header: dark corners (top-right, bottom-left), a blue
 * glow top-left and a red glow bottom-right, and the logo's orbit arc with its two dots.
 */
function BrandBackdrop({ w, h }: { w: number; h: number }) {
  if (!w || !h) return null;
  const cx = w * 0.74, cy = h * 0.5, rx = w * 0.26, ry = h * 0.62;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  const blue = at(-150), red = at(35);
  const r = Math.max(w, h);
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="darkTR" cx={w} cy={0} rx={r * 0.55} ry={r * 0.55} fx={w} fy={0} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#020617" stopOpacity="0.75" />
          <Stop offset="1" stopColor="#020617" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="darkBL" cx={0} cy={h} rx={r * 0.5} ry={r * 0.5} fx={0} fy={h} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#020617" stopOpacity="0.7" />
          <Stop offset="1" stopColor="#020617" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="glowBlue" cx={0} cy={0} rx={r * 0.38} ry={r * 0.38} fx={0} fy={0} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#3B82F6" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="glowRed" cx={w} cy={h} rx={r * 0.42} ry={r * 0.42} fx={w} fy={h} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FF2D55" stopOpacity="0.6" />
          <Stop offset="0.45" stopColor="#A21CAF" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#A21CAF" stopOpacity="0" />
        </RadialGradient>
        <SvgLinear id="orbit" x1={blue.x} y1={blue.y} x2={red.x} y2={red.y} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#60A5FA" stopOpacity="0.9" />
          <Stop offset="0.5" stopColor="#818CF8" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#FF4D6D" stopOpacity="0.9" />
        </SvgLinear>
      </Defs>
      <Rect width={w} height={h} fill="url(#darkTR)" />
      <Rect width={w} height={h} fill="url(#darkBL)" />
      <Rect width={w} height={h} fill="url(#glowBlue)" />
      <Rect width={w} height={h} fill="url(#glowRed)" />
      <Path d={`M ${blue.x} ${blue.y} A ${rx} ${ry} 0 1 1 ${red.x} ${red.y}`} stroke="url(#orbit)" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Circle cx={blue.x} cy={blue.y} r={7} fill="#3B82F6" opacity={0.25} />
      <Circle cx={blue.x} cy={blue.y} r={3.6} fill="#7DB4FF" />
      <Circle cx={red.x} cy={red.y} r={7} fill="#FF2D55" opacity={0.25} />
      <Circle cx={red.x} cy={red.y} r={3.6} fill="#FF5A75" />
    </Svg>
  );
}

export function PageHeader({ title, sub, icon, colors = ['#0A1A5C', '#0D2A8A', '#0B1F6B'], right, children }: {
  title: string
  sub?: string
  icon: IconName
  colors?: [string, string, string] | [string, string]
  right?: ReactNode
  children?: ReactNode
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}
        onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <BrandBackdrop w={size.w} h={size.h} />
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
  header: { borderRadius: 28, padding: 16, gap: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(147,197,253,0.22)' },
  headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
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
