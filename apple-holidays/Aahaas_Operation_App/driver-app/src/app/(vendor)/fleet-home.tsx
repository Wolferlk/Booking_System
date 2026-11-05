/**
 * Vendor home — the fleet at a glance: who is on the road now, what needs a
 * driver, today's and the next trips, and anything in the fleet to fix.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PageHeader, StatTile } from '@/components/fancy';
import { ErrorBox, IconButton, Ionicons, Label, Loading, Screen, type IconName } from '@/components/ui';
import { Avatar, JobCard, LiveDot, Plate } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { useAuth } from '@/lib/auth';
import { ago, greetingKey } from '@/lib/format';
import { C } from '@/lib/theme';
import type { VendorHome } from '@/lib/vendor';

const GREETING = { goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening' };

const ATTENTION: Record<string, { icon: IconName; go: () => void }> = {
  NO_DRIVERS: { icon: 'person-add', go: () => router.push('/fleet/driver') },
  NO_VEHICLES: { icon: 'car', go: () => router.push('/fleet/vehicle') },
  UNASSIGNED: { icon: 'git-compare', go: () => router.push({ pathname: '/fleet-trips', params: { view: 'todo' } }) },
  NOT_ON_APP: { icon: 'logo-whatsapp', go: () => router.push({ pathname: '/fleet', params: { tab: 'drivers' } }) },
  NO_VEHICLE: { icon: 'car-outline', go: () => router.push({ pathname: '/fleet', params: { tab: 'drivers' } }) },
  IDLE_VEHICLE: { icon: 'bus-outline', go: () => router.push({ pathname: '/fleet', params: { tab: 'vehicles' } }) },
};
const TONE = {
  red: { fg: C.red, bg: C.redSoft, line: '#FFC2C8' },
  gold: { fg: C.amber, bg: C.goldSoft, line: '#F7DFA4' },
  blue: { fg: C.blue, bg: C.blueSoft, line: '#BFD3FF' },
};

export default function FleetHome() {
  const { actor } = useAuth();
  const { data, error, loading, refreshing, reload } = useLoad<VendorHome>('/api/mobile/vendor/home');
  const name = actor?.kind === 'VENDOR' ? actor.name : '';

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <PageHeader title={name} sub={`${GREETING[greetingKey()]} · your fleet today`} icon="business" colors={['#0E1525', '#16213E', '#24345E']}
        right={<IconButton icon="notifications-outline" color="#fff" onPress={() => router.push('/notifications')} />}>
        {data && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StatTile value={data.counts.liveNow} label="On the road now" icon="navigate" colors={['#EBF1FF', '#D6E4FF']} accent={C.blue} />
              <StatTile value={data.counts.unassigned} label="Trips needing a driver" icon="person-add" colors={['#FFEDEF', '#FFD6DB']} accent={C.red} delay={60} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StatTile value={data.counts.drivers} label={`Drivers · ${data.counts.onApp} on the app`} icon="people" colors={['#E5F7F0', '#CDEFE2']} accent={C.green} delay={120} />
              <StatTile value={data.counts.vehicles} label="Vehicles" icon="car-sport" colors={['#FFF6DF', '#FDEBC0']} accent={C.gold} delay={180} />
            </View>
          </View>
        )}
      </PageHeader>

      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && data.live.length > 0 && (
        <View style={{ gap: 10 }}>
          <View style={styles.head}><LiveDot /><Label>On the road now</Label></View>
          {data.live.map((l, i) => (
            <Animated.View key={l.driverId} entering={FadeInDown.delay(i * 60).springify()}>
              <Pressable onPress={() => router.push({ pathname: '/fleet', params: { tab: 'drivers' } })} style={styles.live}>
                <Avatar name={l.name} photoUrl={l.photoUrl} size={44} ring={C.blue} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.liveName}>{l.name}</Text>
                  <Text style={styles.liveSub}>{l.bookingRef} · since {new Date(l.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{l.lastPingAt ? ` · seen ${ago(l.lastPingAt)}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.km}>{l.km.toFixed(1)}<Text style={{ fontSize: 12 }}> km</Text></Text>
                  {l.plateNo ? <Plate plate={l.plateNo} small /> : null}
                </View>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}

      {data && data.attention.length > 0 && (
        <View style={{ gap: 10 }}>
          <Label>Needs your attention</Label>
          {data.attention.map((a, i) => {
            const t = TONE[a.tone];
            const meta = ATTENTION[a.kind];
            return (
              <Animated.View key={a.kind} entering={FadeInDown.delay(i * 50).springify()}>
                <Pressable onPress={meta?.go} style={({ pressed }) => [styles.attn, { backgroundColor: t.bg, borderColor: t.line }, pressed && { opacity: 0.85 }]}>
                  <View style={[styles.attnIcon, { backgroundColor: '#fff' }]}><Ionicons name={meta?.icon ?? 'alert-circle'} size={20} color={t.fg} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>{a.title}</Text>
                    <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={2}>{a.body}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.fg} />
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      )}

      {data && data.pendingRequests > 0 && (
        <Pressable onPress={() => router.push('/fleet-market')} style={[styles.attn, { backgroundColor: C.blueSoft, borderColor: '#BFD3FF' }]}>
          <View style={[styles.attnIcon, { backgroundColor: '#fff' }]}><Ionicons name="hourglass" size={20} color={C.blue} /></View>
          <Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{data.pendingRequests} trip request{data.pendingRequests === 1 ? '' : 's'} waiting for operations</Text>
          <Ionicons name="chevron-forward" size={18} color={C.blue} />
        </Pressable>
      )}

      {data && (
        <View style={{ gap: 10 }}>
          <Label>Today</Label>
          {data.todayJobs.length
            ? data.todayJobs.map((j, i) => <JobCard key={j.key} job={j} i={i} />)
            : <Text style={{ color: C.sub }}>No trips for your fleet today.</Text>}
        </View>
      )}

      {data && data.next.length > 0 && (
        <View style={{ gap: 10 }}>
          <View style={[styles.head, { justifyContent: 'space-between' }]}>
            <Label>Coming up</Label>
            <Pressable onPress={() => router.push('/fleet-trips')}><Text style={{ color: C.red, fontWeight: '900' }}>All trips</Text></Pressable>
          </View>
          {data.next.map((j, i) => <JobCard key={j.key} job={j} i={i} />)}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#BFD3FF' },
  liveName: { color: C.text, fontWeight: '900', fontSize: 16 },
  liveSub: { color: C.sub, fontSize: 12, fontWeight: '600' },
  km: { color: C.blue, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] },
  attn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 12, borderWidth: 1 },
  attnIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
