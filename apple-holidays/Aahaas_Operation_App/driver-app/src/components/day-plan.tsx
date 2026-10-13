import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { routeOf } from '@/lib/format';
import { C, R, S } from '@/lib/theme';
import type { DayPlan } from '@/lib/types';

export function openMaps(place: string) {
  const q = encodeURIComponent(place);
  const url = Platform.OS === 'ios' ? `maps://?daddr=${q}` : `google.navigation:q=${q}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

/** One day: a vertical timeline of the movements, then hotel + flights. */
export function DayPlanView({ day, compact }: { day: DayPlan; compact?: boolean }) {
  const t = useT();
  const moves = day.movements.filter(m => m.mine);
  return (
    <View style={{ gap: S.md }}>
      {moves.length === 0 && (
        <Text style={{ color: C.sub, fontSize: 15 }}>No movement on the chart for this day yet — operations will update it.</Text>
      )}
      {moves.map((m, i) => (
        <View key={m.id} style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ alignItems: 'center', width: 56 }}>
            <Text style={{ color: m.noDriverNeeded ? C.dim : C.gold, fontWeight: '800', fontSize: 16 }}>{m.time ?? '—'}</Text>
            {i < moves.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: C.line, marginTop: 4 }} />}
          </View>
          <View style={{ flex: 1, paddingBottom: S.md, gap: 4 }}>
            <Text style={{ color: m.noDriverNeeded ? C.sub : C.text, fontSize: 17, fontWeight: '700' }}>{routeOf(m)}</Text>
            {m.noDriverNeeded && <Text style={{ color: C.dim, fontSize: 13 }}>Free / hotel day — no driving</Text>}
            {!compact && m.details ? <Text style={{ color: C.sub, fontSize: 14 }} numberOfLines={4}>{m.details}</Text> : null}
            {!m.noDriverNeeded && (m.to || m.from || m.location) && (
              <Pressable onPress={() => openMaps(m.to || m.from || m.location)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: R.sm, backgroundColor: C.blueSoft }}>
                <Ionicons name="navigate" size={16} color={C.blue} />
                <Text style={{ color: C.blue, fontWeight: '700' }}>{t('navigate')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      {day.flights.map(f => (
        <View key={f.flightNo} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <Ionicons name="airplane" size={18} color={C.blue} />
          <Text style={{ color: C.text, fontSize: 15 }}>{t('flight')} {f.flightNo} · {f.from} {f.dep} → {f.to} {f.arr}</Text>
        </View>
      ))}
      {day.hotel && (
        <Pressable onPress={() => openMaps(`${day.hotel!.name} ${day.hotel!.city}`)} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <Ionicons name="bed" size={18} color={C.gold} />
          <Text style={{ color: C.text, fontSize: 15, flex: 1 }}>{t('hotelTonight')}: <Text style={{ fontWeight: '700' }}>{day.hotel.name}</Text>, {day.hotel.city}</Text>
          <Ionicons name="navigate-outline" size={18} color={C.blue} />
        </Pressable>
      )}
    </View>
  );
}
