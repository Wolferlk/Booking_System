/**
 * The driving-day visuals: the live card while a day runs (map, km counter,
 * timer, speed, next stop) and the "ready to roll" card before it starts.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { routeOf } from '@/lib/format';
import { loadPath, onPoint, type PathPoint } from '@/lib/location';
import { C } from '@/lib/theme';
import type { DayPlan, Movement } from '@/lib/types';
import { openMaps } from './day-plan';
import { RouteMap } from './route-map';
import type { IconName } from './ui';

export const NAVY: [string, string, string] = ['#0A1640', '#122B78', '#1D3FA0'];

export function PulseDot({ color = '#22C55E', size = 10 }: { color?: string; size?: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false); }, [p]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + p.value * 1.8 }], opacity: 0.6 * (1 - p.value) }));
  return (
    <View style={{ width: size * 2.6, height: size * 2.6, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color }, ring]} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Counts smoothly from the old value to the new one. */
export function CountUp({ value, decimals = 1, style }: { value: number; decimals?: number; style?: object }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current, b = value, t0 = Date.now(), dur = 900;
    if (a === b) return;
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value]);
  return <Text style={style}>{shown.toFixed(decimals)}</Text>;
}

function clock(fromIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function Glass({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

function Tile({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <Glass style={{ flex: 1, gap: 2 }}>
      <Ionicons name={icon} size={16} color="#93C5FD" />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Glass>
  );
}

/** First movement not yet past (by its HH:MM), else the last one. */
export function nextMovement(day: DayPlan | null | undefined): Movement | null {
  const moves = (day?.movements ?? []).filter(m => m.mine && !m.noDriverNeeded);
  if (!moves.length) return null;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return moves.find(m => (m.time ?? '99:99') >= hhmm) ?? moves[moves.length - 1];
}

export interface TripHeading { guest: string; sub: string; onOpen: () => void }

export function LiveDayCard({ dayNo, startedAt, km, tripKm, background, todayPlan, title, heading }: {
  dayNo?: number | null
  startedAt: string
  km: number
  tripKm: number
  background: boolean | null
  todayPlan?: DayPlan | null
  /** shown on the full-screen map */
  title?: string
  /** Today screen: the trip itself, so it needs no separate card */
  heading?: TripHeading
}) {
  const [path, setPath] = useState<PathPoint[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadPath().then(p => { if (alive) setPath(p); });
    const unsub = onPoint(p => {
      if (p.accuracy != null && p.accuracy > 65) return;
      setPath(prev => [...prev, { lat: p.lat, lng: p.lng, t: p.t, speed: p.speed }].slice(-4000));
    });
    const timer = setInterval(() => tick(x => x + 1), 1000);
    return () => { alive = false; unsub(); clearInterval(timer); };
  }, []);

  const hours = Math.max(1 / 60, (Date.now() - new Date(startedAt).getTime()) / 3_600_000);
  const avg = km / hours;
  const last = path[path.length - 1];
  const speedNow = last && last.speed != null && Date.now() - last.t < 90_000 ? Math.round(last.speed * 3.6) : null;
  const next = nextMovement(todayPlan);

  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.liveWrap}>
      <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.live}>
        <View style={styles.liveHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PulseDot />
            <Text style={styles.liveTag}>LIVE{dayNo ? ` · DAY ${dayNo}` : ''}</Text>
          </View>
          <View style={[styles.gps, { backgroundColor: background ? 'rgba(34,197,94,0.18)' : 'rgba(251,191,36,0.18)' }]}>
            <Ionicons name={background ? 'shield-checkmark' : 'phone-portrait'} size={13} color={background ? '#4ADE80' : '#FBBF24'} />
            <Text style={{ color: background ? '#4ADE80' : '#FBBF24', fontWeight: '800', fontSize: 12 }}>
              {background ? 'GPS · screen-off OK' : 'GPS · keep app open'}
            </Text>
          </View>
        </View>
        {heading && (
          <Pressable onPress={heading.onOpen} style={({ pressed }) => [styles.heading, pressed && { opacity: 0.8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headingGuest} numberOfLines={1}>{heading.guest}</Text>
              <Text style={styles.headingSub} numberOfLines={1}>{heading.sub}</Text>
            </View>
            <View style={styles.openBtn}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Open trip</Text><Ionicons name="chevron-forward" size={14} color="#fff" /></View>
          </Pressable>
        )}

        <RouteMap path={path} onExpand={() => router.push({
          pathname: '/live-map',
          params: {
            startedAt, dayNo: dayNo ? String(dayNo) : '', km: String(km), tripKm: String(tripKm),
            bg: background ? '1' : '0', next: next ? JSON.stringify(next) : '', title: title ?? '',
          },
        })} />

        <View style={styles.kmRow}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <CountUp value={km} style={styles.km} />
              <Text style={styles.kmUnit}>km</Text>
            </View>
            <Text style={styles.kmLabel}>driven today</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.clock}>{clock(startedAt)}</Text>
            <Text style={styles.kmLabel}>on the road</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tile icon="speedometer" value={speedNow != null ? `${speedNow}` : '—'} label="km/h now" />
          <Tile icon="analytics" value={avg >= 0.5 ? avg.toFixed(0) : '—'} label="avg km/h" />
          <Tile icon="trail-sign" value={`${Math.round(tripKm)}`} label="km this trip" />
        </View>

        {next && (
          <Glass style={styles.next}>
            <View style={styles.nextIcon}><Ionicons name="flag" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileLabel}>NEXT{next.time ? ` · ${next.time}` : ''}</Text>
              <Text style={styles.nextText} numberOfLines={2}>{routeOf(next)}</Text>
            </View>
            <Pressable onPress={() => openMaps(next.to || next.from || next.location)} style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="navigate" size={18} color={C.blue} />
            </Pressable>
          </Glass>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

/** Before the day starts: what today looks like, with a gently bobbing car. */
export function ReadyCard({ dayNo, todayPlan, title }: { dayNo?: number | null; todayPlan?: DayPlan | null; title: string }) {
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(withSequence(withTiming(-5, { duration: 700 }), withTiming(0, { duration: 700 })), -1, false);
  }, [bob]);
  const carStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const first = nextMovement(todayPlan);
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.liveWrap}>
      <LinearGradient colors={['#064E3B', '#047857', '#10B981']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.live, { gap: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Animated.View style={[styles.carBubble, carStyle]}>
            <Ionicons name="car-sport" size={30} color="#047857" />
          </Animated.View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tileLabel, { color: '#A7F3D0' }]}>{dayNo ? `DAY ${dayNo}` : 'TODAY'}</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{title}</Text>
          </View>
        </View>
        {first && (
          <Glass style={styles.next}>
            <View style={[styles.nextIcon, { backgroundColor: 'rgba(255,255,255,0.22)' }]}><Ionicons name="time" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tileLabel, { color: '#A7F3D0' }]}>FIRST PICK-UP{first.time ? ` · ${first.time}` : ''}</Text>
              <Text style={styles.nextText} numberOfLines={2}>{routeOf(first)}</Text>
            </View>
          </Glass>
        )}
        {todayPlan?.hotel && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="bed" size={16} color="#A7F3D0" />
            <Text style={{ color: '#D1FAE5', flex: 1 }} numberOfLines={1}>Tonight: {todayPlan.hotel.name}, {todayPlan.hotel.city}</Text>
          </View>
        )}
        <Text style={{ color: '#D1FAE5', fontSize: 13 }}>Slide below when you leave — kilometres count automatically.</Text>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  liveWrap: { borderRadius: 28, shadowColor: '#0A1640', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  live: { borderRadius: 28, padding: 14, gap: 12, overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  headingGuest: { color: '#fff', fontSize: 20, fontWeight: '900' },
  headingSub: { color: '#93C5FD', fontSize: 12, fontWeight: '700' },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.red, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  liveHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveTag: { color: '#fff', fontWeight: '900', letterSpacing: 1.2, fontSize: 13 },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  kmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 4 },
  km: { color: '#fff', fontSize: 58, fontWeight: '900', lineHeight: 62, fontVariant: ['tabular-nums'] },
  kmUnit: { color: '#93C5FD', fontSize: 20, fontWeight: '800', marginBottom: 9 },
  kmLabel: { color: '#93C5FD', fontWeight: '700', fontSize: 13 },
  clock: { color: '#fff', fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  glass: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  tileValue: { color: '#fff', fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tileLabel: { color: '#93C5FD', fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  nextText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  mistake: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)' },
  carBubble: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

function Star({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  const o = useSharedValue(0.2);
  useEffect(() => {
    const t = setTimeout(() => { o.value = withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0.2, { duration: 900 })), -1, false); }, delay);
    return () => clearTimeout(t);
  }, [o, delay]);
  const st = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: 0.7 + o.value * 0.5 }] }));
  return <Animated.View style={[{ position: 'absolute', left: `${x}%`, top: `${y}%` }, st]}><Ionicons name="sparkles" size={size} color="#FDE68A" /></Animated.View>;
}

/** Day over: a calm dusk card. Re-opening the day is a small, confirmed link — not a second big swipe. */
export function DayDoneCard({ km, dayNo, lastDay, onContinue, busy }: {
  km: number
  dayNo?: number | null
  lastDay: boolean
  onContinue?: () => void
  busy?: boolean
}) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.liveWrap}>
      <LinearGradient colors={lastDay ? ['#78350F', '#B45309', '#F59E0B'] : ['#1E1B4B', '#4C1D95', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.live, { gap: 10 }]}>
        <Star x={70} y={10} size={14} delay={0} />
        <Star x={84} y={30} size={10} delay={400} />
        <Star x={60} y={34} size={8} delay={800} />
        <Star x={90} y={8} size={9} delay={1200} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.carBubble, { width: 48, height: 48, borderRadius: 16 }]}>
            <Ionicons name={lastDay ? 'flag' : 'moon'} size={24} color={lastDay ? '#B45309' : '#6D28D9'} />
          </View>
          <Text style={[styles.tileLabel, { color: lastDay ? '#FDE68A' : '#DDD6FE', fontSize: 13 }]}>{dayNo ? `DAY ${dayNo} DONE` : 'DAY DONE'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <CountUp value={km} style={[styles.km, { fontSize: 50, lineHeight: 54 }]} />
          <Text style={[styles.kmUnit, { color: lastDay ? '#FDE68A' : '#C4B5FD' }]}>km today</Text>
        </View>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
          {lastDay ? 'Last day done! Show the guest the feedback QR to finish the trip.' : 'Great driving! Rest well — see you tomorrow 🌙'}
        </Text>
        {onContinue && (
          <Pressable onPress={onContinue} disabled={busy} hitSlop={8} style={({ pressed }) => [styles.mistake, pressed && { opacity: 0.7 }]}>
            <Ionicons name="refresh" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{busy ? 'Opening…' : 'Ended by mistake? Continue today'}</Text>
          </Pressable>
        )}
      </LinearGradient>
    </Animated.View>
  );
}
