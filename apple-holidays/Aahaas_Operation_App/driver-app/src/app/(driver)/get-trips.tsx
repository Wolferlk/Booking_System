/** Open trips — the Driver-Auto board in the app. Request with one tap; ops approves. */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { PageHeader } from '@/components/fancy';
import { ErrorBox, Ionicons, Loading, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rememberTrips, type OpenTrip } from '@/lib/open-trips';
import { C } from '@/lib/theme';

interface Claim { id: string; tripKey: string; status: string; bookingRef: string; createdAt: string; snapshot?: { fileNo?: string; route?: string } | null }

function Hourglass() {
  const r = useSharedValue(0);
  useEffect(() => { r.value = withRepeat(withTiming(180, { duration: 1600, easing: Easing.inOut(Easing.cubic) }), -1, true); }, [r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={st}><Ionicons name="hourglass" size={20} color={C.blue} /></Animated.View>;
}

function Meta({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={C.sub} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function OpenTripCard({ trip, i, busy, onRequest }: { trip: OpenTrip; i: number; busy: boolean; onRequest: () => void }) {
  const t = useT();
  const soon = trip.daysAway <= 1;
  const when = trip.daysAway === 0 ? 'Today' : trip.daysAway === 1 ? 'Tomorrow' : `In ${trip.daysAway} days`;
  const cities = trip.cities.length ? trip.cities : trip.route.split(/\s*[→>-]+\s*/).filter(Boolean);
  return (
    <Animated.View entering={FadeInDown.delay(i * 80).springify().damping(17)}>
      <Pressable onPress={() => router.push({ pathname: '/open-trip', params: { key: trip.key } })} style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.99 }] }]}>
        <View style={styles.top}>
          <LinearGradient colors={soon ? ['#FF4D5E', C.red] : ['#E0E7FF', '#C7D2FE']} style={styles.when}>
            <Ionicons name={soon ? 'flash' : 'calendar'} size={12} color={soon ? '#fff' : '#3730A3'} />
            <Text style={[styles.whenText, { color: soon ? '#fff' : '#3730A3' }]}>{when}</Text>
          </LinearGradient>
          <Text style={styles.dates}>{fmtRange(trip.startDate, trip.endDate)}</Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>{trip.title}</Text>

        {cities.length > 0 && (
          <View style={styles.cities}>
            {cities.slice(0, 5).map((c, k) => (
              <View key={`${c}${k}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {k > 0 && <Ionicons name="arrow-forward" size={12} color={C.dim} />}
                <View style={[styles.city, k === 0 && { backgroundColor: C.greenSoft }, k === Math.min(cities.length, 5) - 1 && k > 0 && { backgroundColor: C.redSoft }]}>
                  <Text style={styles.cityText} numberOfLines={1}>{c}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Meta icon="people" text={`${trip.pax} ${t('pax')}`} />
          <Meta icon="sunny" text={`${trip.days} ${trip.days === 1 ? 'day' : 'days'}`} />
          {trip.vehicleType ? <Meta icon="car" text={trip.vehicleType} /> : null}
          <Meta icon="flag" text={trip.countryLabel} />
        </View>

        {trip.legs.filter(l => l.driven).slice(0, 2).map(l => (
          <View key={l.agendaItemId} style={styles.leg}>
            <LinearGradient colors={['#FFB547', '#F59E0B']} style={styles.legTime}><Text style={styles.legTimeText}>{l.time ?? '—'}</Text></LinearGradient>
            <Text style={styles.legText} numberOfLines={1}>{l.from || l.location}{l.to ? ` → ${l.to}` : ''}</Text>
          </View>
        ))}

        {(trip.busy || trip.fits === false) && (
          <View style={styles.warn}>
            <Ionicons name="warning" size={14} color={C.amber} />
            <Text style={styles.warnText}>{trip.busy ? 'You already have a trip on these dates' : 'More guests than your vehicle seats'}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <View style={styles.plan}><Text style={styles.planText}>Day-by-day plan</Text><Ionicons name="chevron-forward" size={14} color={C.red} /></View>
          <View style={{ flex: 1 }} />
          {trip.myRequestId ? (
            <View style={styles.requested}><Hourglass /><Text style={styles.requestedText}>{t('requested')}</Text></View>
          ) : (
            <Pressable onPress={onRequest} disabled={busy} style={({ pressed }) => [styles.reqWrap, pressed && { transform: [{ scale: 0.95 }] }]}>
              <LinearGradient colors={['#FF4D5E', C.red]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.req}>
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="hand-right" size={18} color="#fff" />}
                <Text style={styles.reqText}>{t('request')}</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function GetTrips() {
  const t = useT();
  const { data, error, loading, refreshing, reload, silent } = useLoad<{ enabled: boolean; trips: OpenTrip[]; claims: Claim[] }>('/api/mobile/open-trips');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data?.trips) rememberTrips(data.trips); }, [data]);

  async function request(trip: OpenTrip) {
    setBusy(trip.key);
    try {
      const r = await api<{ mode: string }>('/api/mobile/open-trips', { body: { action: 'request', tripKey: trip.key } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(r.mode === 'assigned' ? 'The trip is yours! 🎉' : 'Request sent', r.mode === 'assigned' ? 'It is now in My trips.' : 'Operations will confirm. You will get a notification.');
      silent();
    } catch (e) {
      Alert.alert('Not possible', (e as ApiError).message);
    } finally { setBusy(null); }
  }

  async function withdraw(id: string) {
    setBusy(id);
    try { await api('/api/mobile/open-trips', { body: { action: 'withdraw', claimId: id } }); silent(); }
    catch (e) { Alert.alert('Could not withdraw', (e as ApiError).message); }
    finally { setBusy(null); }
  }

  const pending = (data?.claims ?? []).filter(c => c.status === 'PENDING');
  const count = data?.trips.length ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <PageHeader title={t('getTrips')} icon="add-circle" colors={['#7F1D1D', '#C81E2E', '#FF4D5E']}
        sub={data ? (count ? `${count} open trip${count === 1 ? '' : 's'} need a driver` : 'No open trips right now') : 'Looking for open trips…'} />

      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && !data.enabled && (
        <View style={styles.info}><Ionicons name="information-circle" size={20} color={C.amber} /><Text style={{ color: C.text, flex: 1 }}>Trip requests are not switched on yet.</Text></View>
      )}

      {pending.length > 0 && (
        <Animated.View entering={FadeInDown.springify()} style={styles.pending}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Hourglass />
            <Text style={{ color: C.blue, fontWeight: '900', fontSize: 15 }}>Waiting for approval · {pending.length}</Text>
          </View>
          {pending.map(c => (
            <View key={c.id} style={styles.pendingRow}>
              <Text style={{ color: C.text, flex: 1, fontWeight: '700' }} numberOfLines={1}>{c.snapshot?.fileNo ?? c.bookingRef}{c.snapshot?.route ? ` · ${c.snapshot.route}` : ''}</Text>
              <Pressable onPress={() => withdraw(c.id)} disabled={busy === c.id} style={styles.withdraw}>
                {busy === c.id ? <ActivityIndicator size="small" color={C.sub} /> : <Text style={{ color: C.sub, fontWeight: '800', fontSize: 12 }}>{t('withdraw')}</Text>}
              </Pressable>
            </View>
          ))}
        </Animated.View>
      )}

      {data?.enabled && count === 0 && (
        <Animated.View entering={FadeInDown.springify()} style={styles.empty}>
          <Image source={require('../../../assets/images/illustrations/no-alerts.png')} alt="" style={{ width: 170, height: 130 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 19, fontWeight: '900' }}>All trips have drivers</Text>
          <Text style={{ color: C.sub, textAlign: 'center' }}>We will notify you as soon as a new one opens.</Text>
        </Animated.View>
      )}
      {data?.trips.map((trip, i) => (
        <OpenTripCard key={trip.key} trip={trip} i={i} busy={busy === trip.key} onRequest={() => request(trip)} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 10, borderWidth: 1, borderColor: C.line },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  when: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  whenText: { fontWeight: '900', fontSize: 12 },
  dates: { color: C.sub, fontWeight: '800', fontSize: 12 },
  title: { color: C.text, fontSize: 18, fontWeight: '900' },
  cities: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  city: { backgroundColor: C.cardHi, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 140 },
  cityText: { color: C.text, fontWeight: '800', fontSize: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.cardHi, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  metaText: { color: C.sub, fontWeight: '800', fontSize: 11 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legTime: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, minWidth: 52, alignItems: 'center' },
  legTimeText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  legText: { color: C.text, flex: 1, fontSize: 13, fontWeight: '600' },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.goldSoft, borderRadius: 12, padding: 8 },
  warnText: { color: '#92400E', fontWeight: '700', fontSize: 12, flex: 1 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  planText: { color: C.red, fontWeight: '900', fontSize: 13 },
  reqWrap: { borderRadius: 99, overflow: 'hidden', shadowColor: C.red, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  req: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 11 },
  reqText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  requested: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blueSoft, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 10 },
  requestedText: { color: C.blue, fontWeight: '900' },
  pending: { backgroundColor: C.blueSoft, borderRadius: 22, padding: 14, gap: 10, borderWidth: 1, borderColor: '#BFD3FF' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14, padding: 10 },
  withdraw: { borderRadius: 99, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 6 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.goldSoft, borderRadius: 16, padding: 12 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 20, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16 },
});
