/**
 * The vendor's fleet — drivers (with whether they are on the app, a one-tap
 * WhatsApp sign-in code, and who is driving now) and vehicles (with who drives
 * each one). Add / edit open as sheets: /fleet/driver, /fleet/vehicle.
 */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PageHeader, Segmented } from '@/components/fancy';
import { ErrorBox, Input, Ionicons, Loading, Screen } from '@/components/ui';
import { Avatar, LiveDot, Plate, VehicleThumb } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, fmtDay } from '@/lib/format';
import { C } from '@/lib/theme';
import { APP_STATUS, shareInvite, vehicleLabel, type VendorDriver, type VendorVehicle } from '@/lib/vendor';

type Tab = 'drivers' | 'vehicles';

function DriverCard({ d, i, vendorName, onCode, sending }: { d: VendorDriver; i: number; vendorName: string; onCode: () => void; sending: boolean }) {
  const st = d.app ? APP_STATUS[d.app.status] : null;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 50).springify().damping(18)}>
      <Pressable onPress={() => router.push({ pathname: '/fleet/driver', params: { id: d.id } })}
        style={({ pressed }) => [styles.card, !d.isActive && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.99 }] }]}>
        <View style={styles.row}>
          <Avatar name={d.name} photoUrl={d.photoUrl} size={50} ring={d.live ? C.blue : undefined} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
              {!d.isActive && <Text style={styles.off}>OFF</Text>}
            </View>
            <View style={[styles.row, { gap: 5 }]}>
              <Ionicons name="logo-whatsapp" size={13} color={C.green} />
              <Text style={styles.sub}>{d.whatsapp}</Text>
            </View>
          </View>
          {d.vehicle ? <Plate plate={d.vehicle.plateNo} small off={!d.vehicle.isActive} /> : <Text style={[styles.sub, { color: C.amber }]}>No vehicle</Text>}
        </View>

        {d.live ? (
          <View style={[styles.strip, { backgroundColor: C.blueSoft }]}>
            <LiveDot />
            <Text style={[styles.stripText, { color: C.blue }]}>Driving {d.live.bookingRef} · {d.live.km.toFixed(1)} km{d.live.lastPingAt ? ` · ${ago(d.live.lastPingAt)}` : ''}</Text>
          </View>
        ) : d.nextTrip ? (
          <View style={[styles.strip, { backgroundColor: C.cardHi }]}>
            <Ionicons name="calendar" size={13} color={C.sub} />
            <Text style={styles.stripText} numberOfLines={1}>Next: {fmtDay(d.nextTrip.date)} · {d.nextTrip.fileNo}{d.nextTrip.route ? ` · ${d.nextTrip.route}` : ''}</Text>
          </View>
        ) : null}

        {d.isActive && (
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            {st ? (
              <View style={[styles.status, { backgroundColor: st.bg }]}>
                <Ionicons name={st.icon} size={13} color={st.color} />
                <Text style={[styles.statusText, { color: st.color }]}>
                  {st.label}{d.app?.status === 'ON_APP' && d.app.lastSeenAt ? ` · ${ago(d.app.lastSeenAt)}` : d.app?.status === 'CODE_SENT' && d.app.codeSentAt ? ` · ${ago(d.app.codeSentAt)}` : ''}
                </Text>
              </View>
            ) : <View />}
            {d.app?.status !== 'ON_APP' && (
              <View style={[styles.row, { gap: 6 }]}>
                <Pressable onPress={() => shareInvite(d, vendorName)} hitSlop={6} style={styles.ghost}>
                  <Ionicons name="share-outline" size={15} color={C.text} />
                </Pressable>
                <Pressable onPress={onCode} disabled={sending} style={styles.wa}>
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="logo-whatsapp" size={15} color="#fff" />}
                  <Text style={styles.waText}>{d.app?.status === 'CODE_SENT' ? 'Resend code' : 'Send code'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function VehicleCard({ v, i }: { v: VendorVehicle; i: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 50).springify().damping(18)}>
      <Pressable onPress={() => router.push({ pathname: '/fleet/vehicle', params: { id: v.id } })}
        style={({ pressed }) => [styles.card, !v.isActive && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.99 }] }]}>
        <View style={styles.row}>
          <VehicleThumb uri={v.photoOutside} type={v.type} size={62} />
          <View style={{ flex: 1, gap: 5 }}>
            <View style={styles.row}>
              <Plate plate={v.plateNo} />
              {!v.isActive && <Text style={styles.off}>OFF</Text>}
            </View>
            <Text style={styles.sub} numberOfLines={1}>{[vehicleLabel(v.type), v.brand, v.model].filter(Boolean).join(' · ')} · {v.capacity} seats</Text>
          </View>
        </View>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          {v.driver ? (
            <View style={[styles.row, { gap: 8, flex: 1 }]}>
              <Avatar name={v.driver.name} photoUrl={v.driver.photoUrl} size={26} />
              <Text style={[styles.sub, { color: C.text, fontWeight: '800' }]} numberOfLines={1}>{v.driver.name}</Text>
            </View>
          ) : <Text style={[styles.sub, { color: C.amber, flex: 1 }]}>No driver paired</Text>}
          {v.upcomingTrips > 0 && <Text style={styles.sub}>{v.upcomingTrips} upcoming trip{v.upcomingTrips === 1 ? '' : 's'}</Text>}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function Fleet() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const { actor } = useAuth();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'drivers');
  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const drivers = useLoad<VendorDriver[]>('/api/mobile/vendor/drivers');
  const vehicles = useLoad<{ vehicles: VendorVehicle[] }>('/api/mobile/vendor/vehicles');
  const vendorName = actor?.kind === 'VENDOR' ? actor.name : 'Your vendor';

  const needle = q.trim().toLowerCase();
  const dList = (drivers.data ?? []).filter(d => !needle || `${d.name} ${d.whatsapp} ${d.vehicle?.plateNo ?? ''}`.toLowerCase().includes(needle));
  const vList = (vehicles.data?.vehicles ?? []).filter(v => !needle || `${v.plateNo} ${v.brand ?? ''} ${v.model ?? ''} ${v.driver?.name ?? ''}`.toLowerCase().includes(needle));
  const active = (drivers.data ?? []).filter(d => d.isActive);
  const onApp = active.filter(d => d.app?.status === 'ON_APP').length;

  async function sendCode(d: VendorDriver) {
    setSending(d.id);
    try {
      const r = await api<{ to: string }>(`/api/mobile/vendor/drivers/${d.id}`, { body: { action: 'send-code' } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Code sent on WhatsApp ✅', `${d.name.split(' ')[0]} got a 6-digit code at ${r.to}. In the app: Driver → "New driver? Verify your phone" → "I already have a code".`, [
        { text: 'Share steps', onPress: () => shareInvite(d, vendorName) },
        { text: 'OK' },
      ]);
      drivers.silent();
    } catch (e) {
      Alert.alert('Could not send the code', (e as ApiError).message, [
        { text: 'Share steps instead', onPress: () => shareInvite(d, vendorName) },
        { text: 'OK' },
      ]);
    } finally { setSending(null); }
  }

  const current = tab === 'drivers' ? drivers : vehicles;
  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={current.refreshing} onRefresh={() => { drivers.reload(); vehicles.reload(); }}>
        <PageHeader title="Fleet" icon="people" colors={['#0E1525', '#16213E', '#24345E']}
          sub={drivers.data && vehicles.data ? `${active.length} drivers · ${onApp} on the app · ${(vehicles.data.vehicles).filter(v => v.isActive).length} vehicles` : 'Loading…'} />
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { id: 'drivers', label: 'Drivers', count: drivers.data?.length },
          { id: 'vehicles', label: 'Vehicles', count: vehicles.data?.vehicles.length },
        ]} />
        {((tab === 'drivers' ? drivers.data?.length : vehicles.data?.vehicles.length) ?? 0) > 5 && (
          <Input icon="search" placeholder={tab === 'drivers' ? 'Name, number or plate' : 'Plate, model or driver'} value={q} onChangeText={setQ} autoCorrect={false} />
        )}
        {current.loading && !current.data && <Loading />}
        {current.error && <ErrorBox message={current.error} onRetry={current.reload} />}

        {tab === 'drivers' && drivers.data && (dList.length ? dList.map((d, i) => (
          <DriverCard key={d.id} d={d} i={i} vendorName={vendorName} sending={sending === d.id} onCode={() => sendCode(d)} />
        )) : <Empty icon="person-add" title="No drivers yet" body="Add a driver with their WhatsApp number — we send them a sign-in code there." />)}

        {tab === 'vehicles' && vehicles.data && (vList.length ? vList.map((v, i) => <VehicleCard key={v.id} v={v} i={i} />)
          : <Empty icon="car-sport" title="No vehicles yet" body="Add a vehicle with its plate, seats and photos, then pair it with a driver." />)}
      </Screen>

      <Pressable onPress={() => router.push(tab === 'drivers' ? '/fleet/driver' : '/fleet/vehicle')} style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.95 }] }]}>
        <LinearGradient colors={['#FF4D5E', C.red]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{tab === 'drivers' ? 'Add driver' : 'Add vehicle'}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function Empty({ icon, title, body }: { icon: 'person-add' | 'car-sport'; title: string; body: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 28, gap: 8, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.line }}>
      <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={C.red} />
      </View>
      <Text style={{ color: C.text, fontWeight: '900', fontSize: 18 }}>{title}</Text>
      <Text style={{ color: C.sub, textAlign: 'center' }}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 22, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: C.text, fontWeight: '900', fontSize: 17, flexShrink: 1 },
  sub: { color: C.sub, fontSize: 13, fontWeight: '600' },
  off: { color: C.sub, fontSize: 10, fontWeight: '900', backgroundColor: C.cardHi, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 8 },
  stripText: { color: C.sub, fontWeight: '700', fontSize: 12, flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontWeight: '800', fontSize: 12 },
  ghost: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  wa: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1FAF5A', borderRadius: 99, paddingHorizontal: 12, height: 34 },
  waText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  fab: { position: 'absolute', right: 18, bottom: 112, borderRadius: 99, overflow: 'hidden', shadowColor: C.red, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  fabInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 14 },
});
