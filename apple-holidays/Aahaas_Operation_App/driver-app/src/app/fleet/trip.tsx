/**
 * One trip the vendor holds — every movement, who drives it, and the driver +
 * vehicle picker. Sri Lanka tours take one driver for the whole tour; other
 * countries are one movement. A same-day clash or too few seats asks first.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, ErrorBox, IconButton, Ionicons, Label, Loading, Row, Screen } from '@/components/ui';
import { Avatar, Chip, LiveDot, Plate, StatePill } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { fmtDay, fmtRange, routeOf } from '@/lib/format';
import { C, S } from '@/lib/theme';
import { APP_STATUS, vehicleLabel, type VendorDriver, type VendorJob, type VendorVehicle } from '@/lib/vendor';

export default function FleetTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const upcoming = useLoad<{ jobs: VendorJob[] }>('/api/mobile/vendor/trips?scope=upcoming');
  const past = useLoad<{ jobs: VendorJob[] }>('/api/mobile/vendor/trips?scope=past');
  const drivers = useLoad<VendorDriver[]>('/api/mobile/vendor/drivers');
  const vehicles = useLoad<{ vehicles: VendorVehicle[] }>('/api/mobile/vendor/vehicles');
  const job = upcoming.data?.jobs.find(j => j.id === id || j.legs.some(l => l.assignmentId === id))
    ?? past.data?.jobs.find(j => j.id === id || j.legs.some(l => l.assignmentId === id)) ?? null;

  const [driverId, setDriverId] = useState<string | null>(null);
  /** undefined = follow the driver's own vehicle */
  const [vehicleId, setVehicleId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeDrivers = useMemo(() => (drivers.data ?? []).filter(d => d.isActive), [drivers.data]);
  const activeVehicles = useMemo(() => (vehicles.data?.vehicles ?? []).filter(v => v.isActive), [vehicles.data]);

  useEffect(() => {
    if (!job) return;
    setDriverId(job.driver?.id ?? null);
    const v = job.vehicle ? activeVehicles.find(x => x.plateNo === job.vehicle!.plateNo) : null;
    setVehicleId(v ? v.id : undefined);
  }, [job?.key, activeVehicles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedDriver = activeDrivers.find(d => d.id === driverId) ?? null;
  const effectiveVehicle = vehicleId === undefined ? (pickedDriver?.vehicle?.isActive ? pickedDriver.vehicle : null) : activeVehicles.find(v => v.id === vehicleId) ?? null;
  const pax = job ? job.pax.adults + job.pax.children : 0;
  const changed = !!job && (driverId !== (job.driver?.id ?? null) || (effectiveVehicle?.plateNo ?? null) !== (job.vehicle?.plateNo ?? null));

  async function save(force = false) {
    if (!job) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/mobile/vendor/trips/${job.id}`, {
        method: 'PATCH',
        body: { driverId, vehicleId: vehicleId === undefined && !driverId ? null : vehicleId, force },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'confirm') {
        Alert.alert('Please check', err.message, [
          { text: 'Change', style: 'cancel' },
          { text: 'Assign anyway', onPress: () => save(true) },
        ]);
      } else setError(err.message);
    } finally { setBusy(false); }
  }

  const loading = (upcoming.loading && !upcoming.data) || (past.loading && !past.data && !job);
  if (!job) {
    return (
      <Screen>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        {loading ? <Loading /> : <Card tone="gold"><Text style={{ color: C.text }}>This trip is no longer with your fleet.</Text></Card>}
      </Screen>
    );
  }

  const done = job.state === 'DONE';
  const byDay = new Map<string, typeof job.legs>();
  for (const l of job.legs) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <StatePill state={job.state} />
      </Row>

      <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: 4 }}>
        <Text style={{ color: C.red, fontWeight: '900', letterSpacing: 1 }}>{job.wholeBooking ? 'WHOLE TOUR' : 'MOVEMENT'}</Text>
        <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>{job.fileNo}</Text>
        {job.title ? <Text style={{ color: C.sub, fontSize: 15 }}>{job.title}</Text> : null}
        <Row gap={14} style={{ marginTop: 6 }}>
          <Row gap={5}><Ionicons name="calendar" size={14} color={C.sub} /><Text style={styles.meta}>{fmtRange(job.startDate, job.endDate)}</Text></Row>
          <Row gap={5}><Ionicons name="people" size={14} color={C.sub} /><Text style={styles.meta}>{job.pax.adults} adults{job.pax.children ? ` · ${job.pax.children} children` : ''}</Text></Row>
        </Row>
      </Animated.View>

      {job.live && (
        <Card tone="blue" style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <LiveDot />
          <Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{job.driver?.name} is on the road · {job.live.km.toFixed(1)} km today</Text>
        </Card>
      )}

      {job.driver?.phone && (
        <Row gap={S.sm}>
          <Pressable style={styles.contact} onPress={() => Linking.openURL(`tel:${job.driver!.phone}`)}><Ionicons name="call" size={16} color={C.text} /><Text style={styles.contactText}>Call {job.driver.name.split(' ')[0]}</Text></Pressable>
          <Pressable style={styles.contact} onPress={() => Linking.openURL(`https://wa.me/${job.driver!.phone!.replace(/\D/g, '')}`)}><Ionicons name="logo-whatsapp" size={16} color={C.green} /><Text style={styles.contactText}>WhatsApp</Text></Pressable>
        </Row>
      )}

      <Label>Plan</Label>
      <View style={{ gap: 10 }}>
        {Array.from(byDay.entries()).map(([date, legs]) => (
          <View key={date} style={styles.day}>
            <Text style={styles.dayHead}>{fmtDay(date, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
            {legs.map(l => (
              <View key={l.assignmentId} style={[styles.leg, l.noDriverNeeded && { opacity: 0.5 }]}>
                <Text style={styles.time}>{l.time ?? '—'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{routeOf(l)}</Text>
                  <Text style={{ color: C.sub, fontSize: 12 }}>
                    {l.noDriverNeeded ? 'No driver needed' : [l.driverName ?? 'No driver', l.vehiclePlate].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
      {job.notes ? <Card><Text style={{ color: C.text }}>{job.notes}</Text></Card> : null}

      {!done && (
        <>
          <Label>{job.wholeBooking ? 'Driver for the whole tour' : 'Driver'}</Label>
          {drivers.loading && !drivers.data ? <Loading /> : activeDrivers.length === 0 ? (
            <Card tone="gold" style={{ gap: S.sm }}>
              <Text style={{ color: C.text }}>You have no drivers yet.</Text>
              <Button title="Add a driver" icon="person-add" kind="secondary" onPress={() => router.push('/fleet/driver')} />
            </Card>
          ) : (
            <View style={{ gap: 8 }}>
              {activeDrivers.map(d => {
                const on = d.id === driverId;
                const st = d.app ? APP_STATUS[d.app.status] : null;
                const small = d.vehicle && d.vehicle.capacity < pax;
                return (
                  <Pressable key={d.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDriverId(on ? null : d.id); setVehicleId(undefined); }}
                    style={[styles.pick, on && { borderColor: C.red, backgroundColor: C.redSoft }]}>
                    <Avatar name={d.name} photoUrl={d.photoUrl} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: C.text, fontWeight: '900' }}>{d.name}</Text>
                      <Text style={{ color: small ? C.amber : C.sub, fontSize: 12, fontWeight: '600' }}>
                        {d.vehicle ? `${d.vehicle.plateNo} · ${d.vehicle.capacity} seats` : 'No vehicle'}{st ? ` · ${st.label}` : ''}
                      </Text>
                    </View>
                    <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? C.red : C.dim} />
                  </Pressable>
                );
              })}
            </View>
          )}

          <Label>Vehicle</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {pickedDriver?.vehicle?.isActive && (
              <Chip on={vehicleId === undefined} onPress={() => setVehicleId(undefined)}>
                <Ionicons name="link" size={14} color={C.sub} /><Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{pickedDriver.name.split(' ')[0]}’s</Text>
              </Chip>
            )}
            {activeVehicles.map(v => (
              <Chip key={v.id} on={vehicleId === v.id} onPress={() => setVehicleId(v.id)}>
                <Plate plate={v.plateNo} small />
                <Text style={{ color: v.capacity < pax ? C.amber : C.sub, fontWeight: '700', fontSize: 12 }}>{vehicleLabel(v.type)} · {v.capacity}</Text>
              </Chip>
            ))}
            <Chip on={vehicleId === null} onPress={() => setVehicleId(null)}><Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>None</Text></Chip>
          </ScrollView>
          {effectiveVehicle && effectiveVehicle.capacity < pax && (
            <Text style={{ color: C.amber, fontWeight: '700', fontSize: 13 }}>{effectiveVehicle.plateNo} seats {effectiveVehicle.capacity} — this trip has {pax} guests.</Text>
          )}

          {error && <ErrorBox message={error} />}
          <Button title={driverId ? `Give to ${pickedDriver?.name.split(' ')[0] ?? 'driver'}` : job.driver ? 'Remove driver' : 'Save'}
            icon={driverId ? 'checkmark-circle' : 'person-remove'} kind={driverId ? 'primary' : 'secondary'}
            onPress={() => save()} loading={busy} disabled={!changed} />
          {job.wholeBooking && <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center' }}>Sri Lanka tours: one driver for all {job.legs.length} movements.</Text>}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { color: C.sub, fontWeight: '700', fontSize: 13 },
  contact: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 11 },
  contactText: { color: C.text, fontWeight: '800' },
  day: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 12, gap: 8 },
  dayHead: { color: C.text, fontWeight: '900' },
  leg: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  time: { color: C.red, fontWeight: '900', width: 52, fontVariant: ['tabular-nums'] },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: C.line, padding: 10 },
});
