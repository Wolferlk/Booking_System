/**
 * Full-screen live map for a running day: ¾ map with the car following the
 * road, ¼ panel with speed, km, time and the next stop.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { openMaps } from '@/components/day-plan';
import { CountUp, NAVY, PulseDot } from '@/components/live-day';
import { RouteMap } from '@/components/route-map';
import { routeOf } from '@/lib/format';
import { flushPoints, loadPath, onDayKm, onPoint, type PathPoint } from '@/lib/location';
import { C } from '@/lib/theme';
import type { Movement } from '@/lib/types';

function clock(fromIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Half-circle speedometer, 0–120 km/h. */
function SpeedGauge({ kmh }: { kmh: number | null }) {
  const size = 118, r = 48, cx = size / 2, cy = 62;
  const v = Math.max(0, Math.min(120, kmh ?? 0)) / 120;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 + from), a1 = Math.PI * (1 + to);
    const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(a0)} A${r},${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${p(a1)}`;
  };
  return (
    <View style={{ width: size, height: 82, alignItems: 'center' }}>
      <Svg width={size} height={74}>
        <Defs>
          <SvgGradient id="g" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#22C55E" /><Stop offset="0.6" stopColor="#F59E0B" /><Stop offset="1" stopColor={C.red} />
          </SvgGradient>
        </Defs>
        <Path d={arc(0, 1)} stroke="rgba(255,255,255,0.12)" strokeWidth={10} fill="none" strokeLinecap="round" />
        {v > 0.005 && <Path d={arc(0, v)} stroke="url(#g)" strokeWidth={10} fill="none" strokeLinecap="round" />}
      </Svg>
      <View style={{ position: 'absolute', top: 30, alignItems: 'center' }}>
        <Text style={styles.gaugeNo}>{kmh != null ? kmh : '—'}</Text>
        <Text style={styles.gaugeUnit}>km/h</Text>
      </View>
    </View>
  );
}

export default function LiveMap() {
  const p = useLocalSearchParams<{ startedAt: string; dayNo?: string; km?: string; tripKm?: string; bg?: string; next?: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const panel = Math.round(height * 0.27) + insets.bottom;
  const [path, setPath] = useState<PathPoint[]>([]);
  const [km, setKm] = useState(Number(p.km ?? 0));
  const [follow, setFollow] = useState(true);
  const [, tick] = useState(0);
  const startKm = Number(p.km ?? 0);
  const tripKm = Number(p.tripKm ?? 0) - startKm + km;
  const next: Movement | null = (() => { try { return p.next ? JSON.parse(p.next) : null; } catch { return null; } })();

  useEffect(() => {
    let alive = true;
    loadPath().then(x => { if (alive) setPath(x); });
    const unPoint = onPoint(pt => {
      if (pt.accuracy != null && pt.accuracy > 65) return;
      setPath(prev => [...prev, { lat: pt.lat, lng: pt.lng, t: pt.t, speed: pt.speed }].slice(-4000));
    });
    const unKm = onDayKm(setKm);
    const timer = setInterval(() => tick(x => x + 1), 1000);
    const send = setInterval(() => { flushPoints(); }, 30_000);
    return () => { alive = false; unPoint(); unKm(); clearInterval(timer); clearInterval(send); };
  }, []);

  const last = path[path.length - 1];
  const speedNow = last && last.speed != null && Date.now() - last.t < 90_000 ? Math.round(last.speed * 3.6) : null;
  const bg = p.bg === '1';

  function toggle(v: boolean) { Haptics.selectionAsync().catch(() => {}); setFollow(v); }

  return (
    <View style={{ flex: 1, backgroundColor: '#0B1739' }}>
      <RouteMap path={path} full follow={follow} bottomInset={panel - 24} />

      {/* top bar */}
      <Animated.View entering={FadeInDown.duration(350)} style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.glass} hitSlop={8}><Ionicons name="chevron-down" size={22} color="#0E1525" /></Pressable>
        <View style={styles.liveChip}>
          <PulseDot size={8} />
          <Text style={styles.liveText}>LIVE{p.dayNo ? ` · DAY ${p.dayNo}` : ''}</Text>
          <View style={[styles.gpsDot, { backgroundColor: bg ? '#22C55E' : '#F59E0B' }]} />
        </View>
        <Pressable onPress={() => toggle(!follow)} style={styles.glass} hitSlop={8}>
          <Ionicons name={follow ? 'navigate' : 'git-commit'} size={20} color={follow ? C.blue : '#0E1525'} />
        </Pressable>
      </Animated.View>

      <View style={[styles.modeRow, { top: insets.top + 64 }]} pointerEvents="box-none">
        <View style={styles.segment}>
          {([['Follow car', true], ['Whole route', false]] as const).map(([label, v]) => (
            <Pressable key={label} onPress={() => toggle(v)} style={[styles.segBtn, follow === v && styles.segOn]}>
              <Text style={[styles.segText, follow === v && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* bottom panel */}
      <Animated.View entering={FadeInUp.springify().damping(18)} style={[styles.panelWrap, { height: panel }]}>
        <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.handle} />
          {p.title ? <Text style={styles.panelTitle} numberOfLines={1}>{p.title}</Text> : null}
          <View style={styles.statsRow}>
            <SpeedGauge kmh={speedNow} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                <CountUp value={km} style={styles.km} />
                <Text style={styles.kmUnit}>km</Text>
              </View>
              <Text style={styles.small}>today · {Math.round(tripKm)} km trip</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.clock}>{p.startedAt ? clock(p.startedAt) : '—'}</Text>
              <Text style={styles.small}>on the road</Text>
            </View>
          </View>
          {next && (
            <View style={styles.next}>
              <View style={styles.flag}><Ionicons name="flag" size={16} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nextTag}>NEXT{next.time ? ` · ${next.time}` : ''}</Text>
                <Text style={styles.nextText} numberOfLines={1}>{routeOf(next)}</Text>
              </View>
              <Pressable onPress={() => openMaps(next.to || next.from || next.location)} style={({ pressed }) => [styles.go, pressed && { opacity: 0.8 }]}>
                <Ionicons name="navigate" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '900' }}>Go</Text>
              </Pressable>
            </View>
          )}
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glass: { width: 46, height: 46, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(10,22,64,0.92)', borderRadius: 99, paddingLeft: 6, paddingRight: 12, height: 40 },
  liveText: { color: '#fff', fontWeight: '900', letterSpacing: 1.1, fontSize: 13 },
  gpsDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 6 },
  modeRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 99, padding: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 },
  segOn: { backgroundColor: C.blue },
  segText: { color: '#0E1525', fontWeight: '800', fontSize: 13 },
  panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, elevation: 16 },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  panelTitle: { color: '#BFDBFE', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gaugeNo: { color: '#fff', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  gaugeUnit: { color: '#93C5FD', fontSize: 11, fontWeight: '800', marginTop: -2 },
  km: { color: '#fff', fontSize: 44, fontWeight: '900', lineHeight: 48, fontVariant: ['tabular-nums'] },
  kmUnit: { color: '#93C5FD', fontSize: 16, fontWeight: '800', marginBottom: 7 },
  small: { color: '#93C5FD', fontSize: 12, fontWeight: '700' },
  clock: { color: '#fff', fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 10 },
  flag: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  nextTag: { color: '#93C5FD', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  nextText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  go: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.blue, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
});
