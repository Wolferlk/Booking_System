import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { DayPlan } from '@/lib/types';

export function openMaps(place: string) {
  const q = encodeURIComponent(place);
  const url = Platform.OS === 'ios' ? `maps://?daddr=${q}` : `google.navigation:q=${q}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

function NavButton({ place }: { place: string }) {
  return (
    <Pressable onPress={() => openMaps(place)} hitSlop={6} style={({ pressed }) => [styles.nav, pressed && { transform: [{ scale: 0.92 }] }]}>
      <LinearGradient colors={['#3B82F6', '#1D4ED8']} style={StyleSheet.absoluteFill} />
      <Ionicons name="navigate" size={18} color="#fff" />
    </Pressable>
  );
}

/** One day as a little journey: stops on a dotted road, then flights and tonight's hotel. */
export function DayPlanView({ day, compact }: { day: DayPlan; compact?: boolean }) {
  const t = useT();
  const moves = day.movements.filter(m => m.mine);
  return (
    <View style={{ gap: 10 }}>
      {moves.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={20} color={C.sub} />
          <Text style={{ color: C.sub, flex: 1 }}>Nothing on the chart for this day yet — operations will update it.</Text>
        </View>
      )}
      {moves.map((m, i) => {
        const free = m.noDriverNeeded;
        const place = m.to || m.from || m.location;
        return (
          <Animated.View key={m.id} entering={FadeInDown.delay(i * 70).springify().damping(18)}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {/* time bubble + road */}
              <View style={{ alignItems: 'center', width: 58 }}>
                <LinearGradient colors={free ? [C.cardHi, C.cardHi] : ['#FFB547', '#F59E0B']} style={styles.time}>
                  <Text style={[styles.timeText, free && { color: C.dim }]}>{m.time ?? '—'}</Text>
                </LinearGradient>
                {i < moves.length - 1 && (
                  <View style={styles.road}>
                    <View style={styles.dash} /><View style={styles.dash} />
                    <View style={styles.car}><Ionicons name="car-sport" size={12} color="#fff" /></View>
                    <View style={styles.dash} /><View style={styles.dash} />
                  </View>
                )}
              </View>
              {/* the stop */}
              <View style={[styles.stop, free && { backgroundColor: C.cardHi }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  {m.from && m.to ? (
                    <>
                      <View style={styles.line}><View style={[styles.pin, { backgroundColor: '#22C55E' }]} /><Text style={styles.from} numberOfLines={1}>{m.from}</Text></View>
                      <View style={styles.line}><View style={[styles.pin, { backgroundColor: C.red }]} /><Text style={styles.to} numberOfLines={2}>{m.to}</Text></View>
                    </>
                  ) : (
                    <View style={styles.line}><Ionicons name="location" size={14} color={C.red} /><Text style={styles.to} numberOfLines={2}>{m.location}</Text></View>
                  )}
                  {free && <Text style={{ color: C.dim, fontSize: 13 }}>Free / hotel day — no driving</Text>}
                  {!compact && m.details ? <Text style={styles.details} numberOfLines={3}>{m.details}</Text> : null}
                </View>
                {!free && place ? <NavButton place={place} /> : null}
              </View>
            </View>
          </Animated.View>
        );
      })}

      {day.flights.map(f => (
        <View key={f.flightNo} style={styles.ticket}>
          <Ionicons name="airplane" size={18} color={C.blue} />
          <Text style={styles.ticketNo}>{f.flightNo}</Text>
          <Text style={styles.ticketRoute}>{f.from} <Text style={{ color: C.dim }}>{f.dep}</Text>  →  {f.to} <Text style={{ color: C.dim }}>{f.arr}</Text></Text>
        </View>
      ))}

      {day.hotel && (
        <Pressable onPress={() => openMaps(`${day.hotel!.name} ${day.hotel!.city}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
          <LinearGradient colors={['#F5F3FF', '#EDE9FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hotel}>
            <View style={styles.bed}><Ionicons name="bed" size={20} color="#6D28D9" /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#6D28D9', fontWeight: '900', fontSize: 11, letterSpacing: 1 }}>{t('hotelTonight').toUpperCase()}</Text>
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{day.hotel.name}</Text>
              <Text style={{ color: C.sub, fontSize: 13 }}>{day.hotel.city}</Text>
            </View>
            <Ionicons name="navigate-circle" size={30} color="#6D28D9" />
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: C.cardHi },
  time: { borderRadius: 14, paddingVertical: 8, width: 58, alignItems: 'center' },
  timeText: { color: '#fff', fontWeight: '900', fontSize: 15, fontVariant: ['tabular-nums'] },
  road: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 4, minHeight: 40 },
  dash: { width: 3, height: 6, borderRadius: 2, backgroundColor: '#FCD34D' },
  car: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  stop: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { width: 8, height: 8, borderRadius: 4 },
  from: { color: C.sub, fontSize: 13, flex: 1 },
  to: { color: C.text, fontSize: 16, fontWeight: '800', flex: 1 },
  details: { color: C.sub, fontSize: 13, marginTop: 2 },
  nav: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, backgroundColor: C.blueSoft, borderWidth: 1, borderStyle: 'dashed', borderColor: '#93C5FD' },
  ticketNo: { color: C.blue, fontWeight: '900' },
  ticketRoute: { color: C.text, fontWeight: '700', flex: 1 },
  hotel: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 },
  bed: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
