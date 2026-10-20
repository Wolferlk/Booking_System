import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { NAVY, PulseDot } from '@/components/live-day';
import { ErrorBox, H1, IconButton, Ionicons, Loading, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { C, S } from '@/lib/theme';

interface N { id: string; kind: string; title: string; body: string; data: Record<string, string> | null; readAt: string | null; createdAt: string }
interface Pinned { key: string; kind: 'DAY_RUNNING' | 'DAY_DONE' | 'TODAY_PLAN'; title: string; body: string; bookingRef: string; live: boolean; km: number | null; startedAt: string | null }

const STYLE: Record<string, { icon: IconName; color: string; bg: string }> = {
  TRIP_ASSIGNED: { icon: 'car-sport', color: C.blue, bg: C.blueSoft },
  TRIP_TOMORROW: { icon: 'alarm', color: C.gold, bg: C.goldSoft },
  TODAY_PLAN: { icon: 'sunny', color: C.amber, bg: C.goldSoft },
  TRIP_STARTED: { icon: 'play-circle', color: C.green, bg: C.greenSoft },
  DAY_STARTED: { icon: 'navigate', color: C.green, bg: C.greenSoft },
  DAY_ENDED: { icon: 'moon', color: '#6D28D9', bg: '#F1EBFF' },
  TRIP_DONE: { icon: 'trophy', color: C.gold, bg: C.goldSoft },
  TRIP_COMPLETED: { icon: 'flag', color: C.green, bg: C.greenSoft },
  VEHICLE_CHECK_DUE: { icon: 'camera', color: C.gold, bg: C.goldSoft },
  VEHICLE_CHECK: { icon: 'camera', color: C.gold, bg: C.goldSoft },
  REQUEST_UPDATE: { icon: 'chatbox-ellipses', color: C.blue, bg: C.blueSoft },
  DRIVER_REQUEST: { icon: 'chatbox-ellipses', color: C.blue, bg: C.blueSoft },
  DRIVER_HELP: { icon: 'alert-circle', color: C.red, bg: C.redSoft },
};
const styleOf = (kind: string) => STYLE[kind] ?? { icon: 'notifications' as IconName, color: C.sub, bg: C.cardHi };

function clock(fromIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function group(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}

const openTrip = (ref: string) => router.push({ pathname: '/trip/[ref]', params: { ref } });

function PinnedCard({ p, i }: { p: Pinned; i: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!p.live) return;
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [p.live]);

  if (p.kind === 'DAY_RUNNING') {
    return (
      <Animated.View entering={FadeInDown.delay(i * 70).springify().damping(16)}>
        <Pressable onPress={() => openTrip(p.bookingRef)} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.live}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <PulseDot />
                <Text style={styles.liveTag}>LIVE NOW</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#93C5FD" />
            </View>
            <Text style={styles.liveTitle}>{p.title}</Text>
            <View style={{ flexDirection: 'row', gap: S.lg }}>
              <View>
                <Text style={styles.liveBig}>{(p.km ?? 0).toFixed(1)}</Text>
                <Text style={styles.liveSmall}>km so far</Text>
              </View>
              {p.startedAt && (
                <View>
                  <Text style={styles.liveBig}>{clock(p.startedAt)}</Text>
                  <Text style={styles.liveSmall}>on the road</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    );
  }

  const plan = p.kind === 'TODAY_PLAN';
  return (
    <Animated.View entering={FadeInDown.delay(i * 70).springify().damping(16)}>
      <Pressable onPress={() => openTrip(p.bookingRef)} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
        <LinearGradient colors={plan ? ['#FFF7E6', '#FFE9B8'] : ['#F3EEFF', '#E4D9FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pin}>
          <View style={[styles.bubble, { backgroundColor: plan ? '#FFFFFF' : '#FFFFFF', width: 48, height: 48, borderRadius: 16 }]}>
            <Ionicons name={plan ? 'sunny' : 'moon'} size={26} color={plan ? C.amber : '#6D28D9'} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.pinTag, { color: plan ? C.amber : '#6D28D9' }]}>{plan ? 'TODAY' : 'DAY DONE'}</Text>
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={plan ? C.amber : '#6D28D9'} />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export default function Notifications() {
  const { data, error, loading, refreshing, reload } = useLoad<{ items: N[]; pinned?: Pinned[] }>('/api/mobile/notifications');
  useEffect(() => { if (data?.items.some(i => !i.readAt)) api('/api/mobile/notifications', { body: {} }).catch(() => {}); }, [data]);

  // A running day: keep its km fresh.
  const live = data?.pinned?.some(p => p.live);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [live, reload]);

  function open(n: N) {
    const d = n.data ?? {};
    if (d.screen === 'vehicle' || n.kind.startsWith('VEHICLE')) router.push('/vehicle-check');
    else if (d.bookingRef && (d.screen === 'trip' || n.kind.startsWith('TRIP') || n.kind.startsWith('DAY'))) openTrip(d.bookingRef);
  }

  const pinned = data?.pinned ?? [];
  const items = data?.items ?? [];
  const groups: { name: string; rows: N[] }[] = [];
  for (const n of items) {
    const g = group(n.createdAt);
    const last = groups[groups.length - 1];
    if (last?.name === g) last.rows.push(n); else groups.push({ name: g, rows: [n] });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <H1 style={{ marginLeft: S.sm, flex: 1 }}>Notifications</H1>
      </View>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {pinned.length > 0 && (
        <View style={{ gap: S.md }}>
          <Text style={styles.section}>NOW</Text>
          {pinned.map((p, i) => <PinnedCard key={p.key} p={p} i={i} />)}
        </View>
      )}

      {data && !pinned.length && !items.length && (
        <Animated.View entering={FadeInDown.springify()} style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.sm }}>
          <Image source={require('../../assets/images/illustrations/no-alerts.png')} alt="" accessibilityIgnoresInvertColors style={{ width: 200, height: 150 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>All quiet</Text>
          <Text style={{ color: C.sub, textAlign: 'center' }}>New trips, reminders and updates from operations will show up here.</Text>
        </Animated.View>
      )}

      {groups.map(g => (
        <View key={g.name} style={{ gap: S.sm }}>
          <Text style={styles.section}>{g.name.toUpperCase()}</Text>
          {g.rows.map((n, i) => {
            const st = styleOf(n.kind);
            return (
              <Animated.View key={n.id} entering={FadeInDown.delay(Math.min(i, 8) * 45)}>
                <Pressable onPress={() => open(n)} style={({ pressed }) => [styles.row, !n.readAt && styles.unread, pressed && { opacity: 0.85 }]}>
                  <View style={[styles.bubble, { backgroundColor: st.bg }]}>
                    <Ionicons name={st.icon} size={20} color={st.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>{n.title}</Text>
                      <Text style={styles.time}>{ago(n.createdAt)}</Text>
                    </View>
                    <Text style={styles.body}>{n.body}</Text>
                  </View>
                  {!n.readAt && <View style={styles.dot} />}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: C.dim, fontWeight: '900', fontSize: 12, letterSpacing: 1.2, marginTop: S.sm },
  live: { borderRadius: 24, padding: 16, gap: 8 },
  liveTag: { color: '#fff', fontWeight: '900', letterSpacing: 1.2, fontSize: 12 },
  liveTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  liveBig: { color: '#fff', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  liveSmall: { color: '#93C5FD', fontWeight: '700', fontSize: 12 },
  pin: { borderRadius: 22, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pinTag: { fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.card, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: C.line },
  unread: { borderColor: '#BFD3FF', backgroundColor: '#F7FAFF' },
  bubble: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 15 },
  body: { color: C.sub, fontSize: 14 },
  time: { color: C.dim, fontSize: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.blue, marginTop: 6 },
});
