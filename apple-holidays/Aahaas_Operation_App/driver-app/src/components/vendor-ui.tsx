/** Building blocks for the vehicle-vendor screens. */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { Ionicons } from '@/components/ui';
import { fmtDay, fmtRange, routeOf } from '@/lib/format';
import { C } from '@/lib/theme';
import { imgUrl } from '@/lib/web';
import { initials, JOB_STATE, vehicleLabel, type VendorJob } from '@/lib/vendor';

export function Avatar({ name, photoUrl, size = 44, ring }: { name: string; photoUrl?: string | null; size?: number; ring?: string }) {
  const uri = imgUrl(photoUrl);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 2.5 : 0, borderColor: ring, padding: ring ? 2 : 0 }}>
      {uri
        ? <Image source={{ uri }} alt={name} style={{ flex: 1, borderRadius: size }} contentFit="cover" />
        : (
          <View style={{ flex: 1, borderRadius: size, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.red, fontWeight: '900', fontSize: size * 0.36 }}>{initials(name)}</Text>
          </View>
        )}
    </View>
  );
}

/** A number plate, drawn like one. */
export function Plate({ plate, small, off }: { plate: string; small?: boolean; off?: boolean }) {
  return (
    <View style={[styles.plate, small && { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }, off && { opacity: 0.5 }]}>
      <Text style={[styles.plateText, small && { fontSize: 12, letterSpacing: 1 }]}>{plate}</Text>
    </View>
  );
}

/** A soft pulsing dot for "on the road now". */
export function LiveDot({ color = C.blue }: { color?: string }) {
  const s = useSharedValue(1);
  useEffect(() => { s.value = withRepeat(withTiming(2.2, { duration: 1100 }), -1, false); }, [s]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2.2 - s.value }));
  return (
    <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: color }, ring]} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

export function StatePill({ state }: { state: VendorJob['state'] }) {
  const m = JOB_STATE[state];
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      {state === 'LIVE' ? <LiveDot /> : <Ionicons name={m.icon} size={12} color={m.color} />}
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

export function JobCard({ job, i = 0 }: { job: VendorJob; i?: number }) {
  const driven = job.legs.filter(l => !l.noDriverNeeded);
  const first = driven[0] ?? job.legs[0];
  const pax = job.pax.adults + job.pax.children;
  const urgent = job.state === 'NEEDS_DRIVER' || job.state === 'NEEDS_VEHICLE';
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 60).springify().damping(18)}>
      <Pressable onPress={() => router.push({ pathname: '/fleet/trip', params: { id: job.id } })}
        style={({ pressed }) => [styles.card, urgent && { borderColor: '#FFC2C8' }, pressed && { transform: [{ scale: 0.99 }] }]}>
        <View style={styles.row}>
          <View style={styles.date}>
            <Text style={styles.dateDay}>{fmtDay(job.startDate, { day: 'numeric' })}</Text>
            <Text style={styles.dateMon}>{fmtDay(job.startDate, { month: 'short' }).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.row}>
              <Text style={styles.file}>{job.fileNo}</Text>
              <Text style={styles.meta}>· {pax} pax{job.wholeBooking ? ` · ${job.legs.length} movements` : ''}</Text>
            </View>
            <Text style={styles.route} numberOfLines={1}>{first ? `${first.time ? `${first.time} · ` : ''}${routeOf(first)}` : job.title ?? 'Trip'}</Text>
            {job.startDate !== job.endDate && <Text style={styles.meta}>{fmtRange(job.startDate, job.endDate)}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.dim} />
        </View>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={[styles.row, { flex: 1, gap: 8 }]}>
            {job.driver ? (
              <>
                <Avatar name={job.driver.name} photoUrl={job.driver.photoUrl} size={26} />
                <Text style={styles.who} numberOfLines={1}>{job.driver.name}{job.mixed ? ' +' : ''}</Text>
              </>
            ) : <Text style={[styles.who, { color: C.red }]}>No driver yet</Text>}
            {job.vehicle ? <Plate plate={job.vehicle.plateNo} small /> : null}
          </View>
          <StatePill state={job.state} />
        </View>
        {job.live && (
          <View style={styles.live}>
            <Ionicons name="speedometer" size={14} color={C.blue} />
            <Text style={{ color: C.blue, fontWeight: '800', fontSize: 12 }}>{job.live.km.toFixed(1)} km today</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function VehicleThumb({ uri, type, size = 56 }: { uri: string | null; type: string; size?: number }) {
  const src = imgUrl(uri);
  return src
    ? <Image source={{ uri: src }} alt={vehicleLabel(type)} style={{ width: size, height: size, borderRadius: 16 }} contentFit="cover" />
    : (
      <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={type === 'car' ? 'car-sport' : type === 'motorbike' ? 'bicycle' : 'bus'} size={size * 0.48} color={C.blue} />
      </View>
    );
}

/** Ask camera or library (iOS sheet / Android alert). */
export function pickSource(title: string): Promise<'camera' | 'library' | null> {
  return new Promise(resolve => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title, options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
        i => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null));
    } else {
      Alert.alert(title, undefined, [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from library', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

export function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={[styles.chip, on && { borderColor: C.red, backgroundColor: C.redSoft }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 12, paddingVertical: 10 },
  plate: { backgroundColor: '#FFD43B', borderRadius: 8, borderWidth: 1.5, borderColor: '#0E1525', paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  plateText: { color: '#0E1525', fontWeight: '900', fontSize: 15, letterSpacing: 1.6, fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontWeight: '900', fontSize: 11 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  date: { width: 50, height: 54, borderRadius: 16, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  dateDay: { color: C.text, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  dateMon: { color: C.red, fontSize: 11, fontWeight: '900' },
  file: { color: C.text, fontSize: 16, fontWeight: '900' },
  meta: { color: C.sub, fontSize: 12, fontWeight: '700' },
  route: { color: C.text, fontSize: 14, fontWeight: '600' },
  who: { color: C.text, fontWeight: '800', fontSize: 13, flexShrink: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blueSoft, borderRadius: 12, padding: 8 },
});
