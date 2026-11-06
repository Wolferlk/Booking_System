/**
 * Open trips — the Driver-Auto board in the app, as today's picks: the server
 * deals each driver or vendor a short list that suits their vehicles and
 * changes at midnight. Request with one tap; ops approves. Shown to freelance
 * drivers (Get trips) and to vehicle vendors (Get trips for the fleet); a
 * vendor's own drivers never see it.
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { PageHeader } from '@/components/fancy';
import { ErrorBox, Ionicons, Loading, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { openTripsPath, rememberTrips, type OpenTrip, type TripPicks } from '@/lib/open-trips';
import { C } from '@/lib/theme';

interface Claim { id: string; tripKey: string; status: string; bookingRef: string; createdAt: string; snapshot?: { fileNo?: string; route?: string } | null }

function Hourglass() {
  const r = useSharedValue(0);
  useEffect(() => { r.value = withRepeat(withTiming(180, { duration: 1600, easing: Easing.inOut(Easing.cubic) }), -1, true); }, [r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={st}><Ionicons name="hourglass" size={20} color={C.blue} /></Animated.View>;
}

/** The top pick's star, breathing gently. */
function Twinkle() {
  const v = useSharedValue(1);
  useEffect(() => { v.value = withRepeat(withTiming(1.3, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true); }, [v]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: v.value }] }));
  return <Animated.View style={st}><Ionicons name="star" size={12} color="#fff" /></Animated.View>;
}

/** "7h 41m" until the next deal; asks for the new list once when it arrives. */
function useNextPicks(nextAt: string | undefined, onArrive: () => void) {
  const [now, setNow] = useState(() => Date.now());
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!nextAt) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= new Date(nextAt).getTime() && fired.current !== nextAt) { fired.current = nextAt; arrive.current(); }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nextAt]);
  if (!nextAt) return null;
  const mins = Math.max(0, Math.ceil((new Date(nextAt).getTime() - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** What the party drives, in a few words. */
function vehicleLabel(vehicles: string[]) {
  return vehicles.length ? vehicles.join(' · ') : null;
}

/** Inside the header: one pip per place on today's list, the vehicle, the next deal. */
function PicksStrip({ picks, count, next }: { picks: TripPicks; count: number; next: string | null }) {
  const vehicles = vehicleLabel(picks.vehicles);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.pips}>
        {Array.from({ length: picks.limit }, (_, k) => (
          <Animated.View key={k} entering={FadeInDown.delay(200 + k * 70).springify()} style={[styles.pip, k < count && styles.pipOn]} />
        ))}
      </View>
      <View style={styles.stripRow}>
        {vehicles ? <View style={styles.stripChip}><Ionicons name="car-sport" size={13} color="#fff" /><Text style={styles.stripText}>{vehicles}</Text></View> : null}
        {next ? <View style={styles.stripChip}><Ionicons name="shuffle" size={13} color="#fff" /><Text style={styles.stripText}>New picks in {next}</Text></View> : null}
      </View>
    </View>
  );
}

/** Guests against seats: how full the vehicle will be on this trip. */
function SeatMeter({ trip }: { trip: OpenTrip }) {
  const seats = trip.matchSeats;
  if (!seats || trip.pax <= 0) return null;
  const slots = Math.min(seats, 15);
  const filled = Math.max(1, Math.round((trip.pax / seats) * slots));
  return (
    <View style={styles.seatBox}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="sparkles" size={14} color={C.green} />
        <Text style={styles.seatFit}>Perfect fit</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.seatCount}>{trip.pax} guest{trip.pax === 1 ? '' : 's'} · {trip.matchVehicle}</Text>
      </View>
      <View style={styles.seatBar}>
        {Array.from({ length: slots }, (_, k) => (
          <View key={k} style={[styles.seat, { backgroundColor: k < filled ? C.green : '#fff' }]} />
        ))}
      </View>
    </View>
  );
}

function Meta({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={C.sub} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function OpenTripCard({ trip, i, top, busy, onRequest, fleet }: { trip: OpenTrip; i: number; top: boolean; busy: boolean; onRequest: () => void; fleet: boolean }) {
  const t = useT();
  const soon = trip.daysAway <= 1;
  const when = trip.daysAway === 0 ? 'Today' : trip.daysAway === 1 ? 'Tomorrow' : `In ${trip.daysAway} days`;
  const cities = trip.cities.length ? trip.cities : trip.route.split(/\s*[→>-]+\s*/).filter(Boolean);
  const card = (
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

        <SeatMeter trip={trip} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {!trip.matchSeats ? <Meta icon="people" text={`${trip.pax} ${t('pax')}`} /> : null}
          <Meta icon="sunny" text={`${trip.days} ${trip.days === 1 ? 'day' : 'days'}`} />
          {trip.vehicleType ? <Meta icon="car" text={trip.vehicleType} /> : null}
          {fleet && trip.freeDrivers != null ? <Meta icon="people-circle" text={`${trip.freeDrivers} driver${trip.freeDrivers === 1 ? '' : 's'} free`} /> : null}
          <Meta icon="flag" text={trip.countryLabel} />
        </View>

        {trip.legs.filter(l => l.driven).slice(0, 2).map(l => (
          <View key={l.agendaItemId} style={styles.leg}>
            <LinearGradient colors={['#FFB547', '#F59E0B']} style={styles.legTime}><Text style={styles.legTimeText}>{l.time ?? '—'}</Text></LinearGradient>
            <Text style={styles.legText} numberOfLines={1}>{l.from || l.location}{l.to ? ` → ${l.to}` : ''}</Text>
          </View>
        ))}

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
  );
  return (
    <Animated.View entering={FadeInDown.delay(i * 90).springify().damping(17)}>
      {top ? (
        <LinearGradient colors={['#FFB547', '#FF4D5E', '#C81E2E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.topRing}>
          <View style={styles.topLabel}><Twinkle /><Text style={styles.topText}>{fleet ? 'TOP PICK FOR YOUR FLEET' : 'TOP PICK FOR YOU'}</Text></View>
          {card}
        </LinearGradient>
      ) : card}
    </Animated.View>
  );
}

/** Closes the list, so it reads as a hand dealt for today rather than a cut-off. */
function NextDrop({ next, more }: { next: string | null; more: boolean }) {
  return (
    <Animated.View entering={FadeInDown.delay(500).springify()} style={styles.drop}>
      <LinearGradient colors={['#FF4D5E', C.red]} style={styles.dropIcon}><Ionicons name="shuffle" size={20} color="#fff" /></LinearGradient>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.dropTitle}>{more ? 'More trips are waiting' : "That's every trip that suits you today"}</Text>
        <Text style={{ color: C.sub, fontSize: 13 }}>{next ? `Your new picks arrive in ${next}.` : 'Your new picks arrive at midnight.'}</Text>
      </View>
    </Animated.View>
  );
}

export function OpenTripsBoard() {
  const t = useT();
  const { actor } = useAuth();
  const fleet = actor?.kind === 'VENDOR';
  const path = openTripsPath(actor);
  const { data, error, loading, refreshing, reload, silent } = useLoad<{ enabled: boolean; vendorManaged?: boolean; vendorName?: string | null; picks?: TripPicks; trips: OpenTrip[]; claims: Claim[] }>(path);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data?.trips) rememberTrips(data.trips); }, [data]);

  async function request(trip: OpenTrip) {
    setBusy(trip.key);
    try {
      const r = await api<{ mode: string }>(path, { body: { action: 'request', tripKey: trip.key } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        r.mode === 'assigned' ? 'The trip is yours! 🎉' : 'Request sent',
        r.mode === 'assigned' ? (fleet ? 'It is in your Trips — choose a driver and vehicle for it.' : 'It is now in My trips.') : 'Operations will confirm. You will get a notification.',
      );
      silent();
    } catch (e) {
      Alert.alert('Not possible', (e as ApiError).message);
    } finally { setBusy(null); }
  }

  async function withdraw(id: string) {
    setBusy(id);
    try { await api(path, { body: { action: 'withdraw', claimId: id } }); silent(); }
    catch (e) { Alert.alert('Could not withdraw', (e as ApiError).message); }
    finally { setBusy(null); }
  }

  const pending = (data?.claims ?? []).filter(c => c.status === 'PENDING');
  const count = data?.trips.length ?? 0;
  const picks = data?.picks;
  const next = useNextPicks(picks?.nextAt, silent);
  const onlyVehicle = picks?.vehicles.length === 1 ? picks.vehicles[0].toLowerCase() : null;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <PageHeader title={fleet ? 'Get trips' : t('getTrips')} icon="add-circle" colors={['#7F1D1D', '#C81E2E', '#FF4D5E']}
        sub={data ? (count ? `${count} trip${count === 1 ? '' : 's'} picked for ${fleet ? 'your fleet' : 'you'} today` : 'No picks right now') : "Dealing today's trips…"}>
        {picks && data?.enabled ? <PicksStrip picks={picks} count={count} next={next} /> : null}
      </PageHeader>

      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.vendorManaged && (
        <View style={styles.info}><Ionicons name="business" size={20} color={C.amber} /><Text style={{ color: C.text, flex: 1 }}>You drive for {data.vendorName ?? 'a vehicle vendor'}. They give you your trips — they show up in My trips.</Text></View>
      )}
      {data && !data.enabled && !data.vendorManaged && (
        <View style={styles.info}><Ionicons name="information-circle" size={20} color={C.amber} /><Text style={{ color: C.text, flex: 1 }}>Trip requests are not switched on yet.</Text></View>
      )}

      {picks && picks.vehicles.length === 0 && (
        <Pressable onPress={fleet ? () => router.push('/fleet') : undefined} style={styles.info}>
          <Ionicons name="car-sport" size={20} color={C.amber} />
          <Text style={{ color: C.text, flex: 1 }}>{fleet ? 'Add your vehicles to get trips matched to them.' : 'No vehicle on your profile yet. Ask operations to add it to get trips matched to it.'}</Text>
        </Pressable>
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
          <Image source={require('@/assets/images/illustrations/no-alerts.png')} alt="" style={{ width: 170, height: 130 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 19, fontWeight: '900', textAlign: 'center' }}>{onlyVehicle ? `No trips for your ${onlyVehicle} today` : fleet ? 'No trips for your fleet today' : 'No trips for you today'}</Text>
          <Text style={{ color: C.sub, textAlign: 'center' }}>{next ? `Your new picks arrive in ${next}.` : 'Your new picks arrive at midnight.'}</Text>
        </Animated.View>
      )}
      {data?.trips.map((trip, i) => (
        <OpenTripCard key={trip.key} trip={trip} i={i} top={i === 0 && !!picks} busy={busy === trip.key} onRequest={() => request(trip)} fleet={fleet} />
      ))}
      {picks && count > 0 && <NextDrop next={next} more={picks.moreWaiting} />}
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
  pips: { flexDirection: 'row', gap: 5 },
  pip: { flex: 1, height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.25)' },
  pipOn: { backgroundColor: '#fff' },
  stripRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stripChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  stripText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  seatBox: { backgroundColor: C.greenSoft, borderRadius: 14, padding: 10, gap: 7 },
  seatFit: { color: C.green, fontWeight: '900', fontSize: 13 },
  seatCount: { color: C.sub, fontWeight: '800', fontSize: 12 },
  seatBar: { flexDirection: 'row', gap: 3 },
  seat: { flex: 1, height: 8, borderRadius: 3 },
  topRing: { borderRadius: 27, padding: 3 },
  topLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 5, paddingBottom: 7 },
  topText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
  drop: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 22, padding: 14, borderWidth: 1.5, borderColor: C.line, borderStyle: 'dashed' },
  dropIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dropTitle: { color: C.text, fontWeight: '900', fontSize: 15 },
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
