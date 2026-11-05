import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PageHeader, Segmented } from '@/components/fancy';
import { PulseDot } from '@/components/live-day';
import { ErrorBox, Ionicons, Loading, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';

interface TripRow {
  bookingRef: string; fileNo: string; leadGuest: string | null; pax: { adults: number; children: number }
  startDate: string; endDate: string; mode: string; dayCount: number; firstStop: string | null
  phase: 'DONE' | 'RUNNING' | 'MISSED' | 'READY' | 'UPCOMING'; km: number
}

const PHASE: Record<TripRow['phase'], { label: string; colors: [string, string]; ink: string; icon: IconName }> = {
  RUNNING: { label: 'Running', colors: ['#FF4D5E', '#D9142A'], ink: '#fff', icon: 'navigate' },
  READY: { label: 'Ready', colors: ['#34D399', '#059669'], ink: '#fff', icon: 'play' },
  UPCOMING: { label: 'Upcoming', colors: ['#60A5FA', '#2563EB'], ink: '#fff', icon: 'time' },
  DONE: { label: 'Finished', colors: ['#E5E7EB', '#CBD5E1'], ink: '#334155', icon: 'checkmark-done' },
  MISSED: { label: 'Not driven', colors: ['#F1F5F9', '#E2E8F0'], ink: '#64748B', icon: 'remove-circle' },
};

function inDays(ymd: string) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${ymd}T00:00:00`).getTime() - a.getTime()) / 86_400_000);
}

function Chip({ icon, text, light }: { icon: IconName; text: string; light?: boolean }) {
  return (
    <View style={[styles.chip, light && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
      <Ionicons name={icon} size={12} color={light ? '#BFDBFE' : C.sub} />
      <Text style={[styles.chipText, light && { color: '#fff' }]}>{text}</Text>
    </View>
  );
}

function TripTicket({ r, i, today }: { r: TripRow; i: number; today: string }) {
  const t = useT();
  const ph = PHASE[r.phase];
  const d = new Date(`${r.startDate}T00:00:00`);
  const running = r.phase === 'RUNNING';
  const away = inDays(r.startDate);
  const elapsed = running ? Math.min(r.dayCount, Math.max(1, Math.round((new Date(`${today}T00:00:00`).getTime() - d.getTime()) / 86_400_000) + 1)) : 0;
  const open = () => router.push({ pathname: '/trip/[ref]', params: { ref: r.bookingRef } });

  const body = (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <LinearGradient colors={ph.colors} style={styles.date}>
        <Text style={[styles.dateMon, { color: ph.ink }]}>{d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text>
        <Text style={[styles.dateDay, { color: ph.ink }]}>{d.getDate()}</Text>
        <Text style={[styles.dateWk, { color: ph.ink }]}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
      </LinearGradient>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.guest, running && { color: '#fff' }]} numberOfLines={1}>{r.leadGuest ?? 'Guest'}</Text>
        </View>
        <Text style={[styles.ref, running && { color: '#93C5FD' }]} numberOfLines={1}>{r.fileNo}</Text>
        {r.firstStop && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location" size={13} color={running ? '#FCA5A5' : C.red} />
            <Text style={[styles.from, running && { color: '#DBEAFE' }]} numberOfLines={1}>{r.firstStop}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          <Chip icon="calendar" text={fmtRange(r.startDate, r.endDate)} light={running} />
          <Chip icon="sunny" text={`${r.dayCount} ${r.dayCount === 1 ? 'day' : 'days'}`} light={running} />
          <Chip icon="people" text={`${r.pax.adults + r.pax.children} ${t('pax')}`} light={running} />
          {r.km > 0 && <Chip icon="speedometer" text={`${Math.round(r.km)} km`} light={running} />}
        </View>
      </View>
    </View>
  );

  return (
    <Animated.View entering={FadeInDown.delay(i * 70).springify().damping(17)} layout={LinearTransition.springify()}>
      <Pressable onPress={open} style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}>
        {running ? (
          <LinearGradient colors={['#0A1640', '#122B78', '#1D3FA0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, { borderWidth: 0 }]}>
            <View style={styles.statusRow}>
              <View style={styles.liveBadge}><PulseDot size={7} /><Text style={styles.liveText}>RUNNING · DAY {elapsed} OF {r.dayCount}</Text></View>
              <Ionicons name="chevron-forward" size={18} color="#93C5FD" />
            </View>
            {body}
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {Array.from({ length: r.dayCount }, (_, k) => (
                <View key={k} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: k < elapsed - 1 ? '#22C55E' : k === elapsed - 1 ? C.red : 'rgba(255,255,255,0.18)' }} />
              ))}
            </View>
          </LinearGradient>
        ) : (
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.status, { backgroundColor: r.phase === 'DONE' ? C.greenSoft : r.phase === 'READY' ? C.greenSoft : C.blueSoft }]}>
                <Ionicons name={ph.icon} size={12} color={r.phase === 'UPCOMING' ? C.blue : C.green} />
                <Text style={[styles.statusText, { color: r.phase === 'UPCOMING' ? C.blue : C.green }]}>
                  {r.phase === 'UPCOMING' ? (away === 1 ? 'Tomorrow' : `In ${away} days`) : ph.label}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.dim} />
            </View>
            {body}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function Trips() {
  const t = useT();
  const { data, error, loading, refreshing, reload } = useLoad<{ today: string; trips: TripRow[] }>('/api/mobile/trips');
  const [tab, setTab] = useState<'now' | 'past'>('now');
  const rows = useMemo(() => data?.trips ?? [], [data]);
  const now = rows.filter(r => r.phase === 'RUNNING' || r.phase === 'READY' || r.phase === 'UPCOMING');
  const past = rows.filter(r => r.phase === 'DONE' || r.phase === 'MISSED').reverse();
  const list = tab === 'now' ? now : past;
  const kmDone = past.reduce((a, r) => a + r.km, 0);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <PageHeader title={t('trips')} icon="map"
        sub={data ? `${now.length} coming up · ${past.length} finished${kmDone ? ` · ${Math.round(kmDone)} km driven` : ''}` : 'Loading your trips…'} />
      <Segmented value={tab} onChange={setTab} options={[
        { id: 'now', label: t('upcoming'), count: now.length },
        { id: 'past', label: t('completed'), count: past.length },
      ]} />
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && list.length === 0 && (
        <Animated.View entering={FadeInDown.springify()} style={styles.empty}>
          <Image source={require('../../../assets/images/illustrations/rest-day.png')} alt="" style={{ width: 170, height: 170 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 19, fontWeight: '900' }}>{tab === 'now' ? 'No trips yet' : 'Nothing finished yet'}</Text>
          <Text style={{ color: C.sub, textAlign: 'center' }}>{tab === 'now' ? 'Check “Get trips” for open ones near you.' : 'Finished trips from the last 30 days show here.'}</Text>
        </Animated.View>
      )}
      {list.map((r, i) => <TripTicket key={r.bookingRef} r={r} i={i} today={data?.today ?? ''} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontWeight: '900', fontSize: 12 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, paddingRight: 10 },
  liveText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
  date: { width: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  dateMon: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  dateDay: { fontSize: 28, fontWeight: '900', lineHeight: 32 },
  dateWk: { fontSize: 11, fontWeight: '700', opacity: 0.85 },
  guest: { color: C.text, fontSize: 18, fontWeight: '900', flex: 1 },
  ref: { color: C.dim, fontSize: 12, fontWeight: '700' },
  from: { color: C.sub, fontSize: 13, flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.cardHi, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { color: C.sub, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 20, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16 },
});
