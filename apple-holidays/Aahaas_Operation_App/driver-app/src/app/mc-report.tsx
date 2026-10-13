/**
 * MC Report on the phone — every movement for a day (or a week), who drives it,
 * and what still has nobody. Same data as ops.aahaas.com → MC Report.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBox, IconButton, Ionicons, Pill, Row } from '@/components/ui';
import { fmtDay } from '@/lib/format';
import { C, R, S, shadow } from '@/lib/theme';
import { web } from '@/lib/web';

interface McRow {
  id: string; date: string; vnCode: string; location: string; paxAdults: number; paxChildren: number
  fromPoint: string | null; toPoint: string | null; details: string | null; meetingTime: string | null
  isLeisure: boolean; isHotelOnly: boolean; isHotelOnlyBooking: boolean
  driverId: string | null; driverName: string | null; vendorId: string | null; vendorName: string | null; vendor: string | null
  agent: string | null; bookingStatus: string; flights?: { flightNo?: string; depTime?: string; arrTime?: string; fromApt?: string; toApt?: string }[]
}

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };

const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'needs', label: 'Needs driver' },
  { key: 'airport', label: 'Airport' },
  { key: 'allocated', label: 'Allocated' },
] as const;

function needsDriver(r: McRow) {
  return !r.isLeisure && !r.isHotelOnly && !r.isHotelOnlyBooking && !r.driverId && !r.driverName && !r.vendorId && !r.vendorName && r.bookingStatus !== 'CANCELLED';
}
const isAirport = (r: McRow) => /airport|\bCMB\b|\bBIA\b|\bSGN\b|\bHAN\b|\bDAD\b|\bSIN\b|\bKUL\b/i.test(`${r.fromPoint} ${r.toPoint} ${r.location}`);

export default function McReport() {
  const [from, setFrom] = useState(ymd(new Date()));
  const [span, setSpan] = useState<1 | 7>(1);
  const [rows, setRows] = useState<McRow[]>([]);
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const to = addDays(from, span - 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await web<McRow[]>(`mc-report?dateFrom=${from}&dateTo=${to}`));
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(r => r.bookingStatus !== 'CANCELLED' || view === 'all')
      .filter(r => view === 'all' || (view === 'needs' ? needsDriver(r) : view === 'airport' ? isAirport(r) : !needsDriver(r) && !r.isLeisure))
      .filter(r => !s || [r.vnCode, r.location, r.fromPoint, r.toPoint, r.driverName, r.agent].some(v => v?.toLowerCase().includes(s)));
  }, [rows, view, q]);

  const counts = { total: rows.length, needs: rows.filter(needsDriver).length, airport: rows.filter(isAirport).length };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ padding: S.lg, gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>MC Report</Text>
          <IconButton icon="refresh" onPress={load} />
        </Row>
        <Row style={{ justifyContent: 'space-between', backgroundColor: C.card, borderRadius: R.md, padding: S.sm, borderWidth: 1, borderColor: C.line }}>
          <IconButton icon="chevron-back" onPress={() => setFrom(addDays(from, -span))} />
          <Pressable onPress={() => setSpan(span === 1 ? 7 : 1)} style={{ alignItems: 'center' }}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{span === 1 ? fmtDay(from, { weekday: 'long', day: 'numeric', month: 'short' }) : `${fmtDay(from)} – ${fmtDay(to)}`}</Text>
            <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>{span === 1 ? 'Tap for 7 days' : 'Tap for one day'}</Text>
          </Pressable>
          <IconButton icon="chevron-forward" onPress={() => setFrom(addDays(from, span))} />
        </Row>
        <Row gap={S.sm}>
          {[['Movements', counts.total, C.text], ['Need driver', counts.needs, counts.needs ? C.red : C.green], ['Airport', counts.airport, C.blue]].map(([k, v, col]) => (
            <View key={String(k)} style={[{ flex: 1, backgroundColor: C.card, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.line }, shadow]}>
              <Text style={{ color: col as string, fontSize: 22, fontWeight: '900' }}>{v as number}</Text>
              <Text style={{ color: C.sub, fontSize: 12 }}>{k as string}</Text>
            </View>
          ))}
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
          {VIEWS.map(v => (
            <Pressable key={v.key} onPress={() => setView(v.key)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: view === v.key ? C.red : C.card, borderWidth: 1, borderColor: view === v.key ? C.red : C.line }}>
              <Text style={{ color: view === v.key ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 13 }}>{v.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg }}>
          <Ionicons name="search" size={18} color={C.sub} />
          <TextInput value={q} onChangeText={setQ} placeholder="Booking, place, driver, agent" placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 11 }} />
        </View>
      </View>
      {error && <View style={{ paddingHorizontal: S.lg }}><ErrorBox message={error} onRetry={load} /></View>}
      <FlatList data={list} keyExtractor={r => r.id} contentContainerStyle={{ padding: S.lg, paddingTop: 0, gap: S.sm, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.sub} />}
        ListEmptyComponent={!loading ? <Text style={{ color: C.sub, textAlign: 'center', marginTop: 30 }}>No movements.</Text> : null}
        renderItem={({ item: r, index }) => {
          const showDay = span > 1 && (index === 0 || list[index - 1].date.slice(0, 10) !== r.date.slice(0, 10));
          const need = needsDriver(r);
          const fl = r.flights?.[0];
          return (
            <View style={{ gap: S.sm }}>
              {showDay && <Text style={{ color: C.red, fontWeight: '800', marginTop: S.sm }}>{fmtDay(r.date.slice(0, 10), { weekday: 'long', day: 'numeric', month: 'short' })}</Text>}
              <Pressable onPress={() => router.push({ pathname: '/booking/[ref]', params: { ref: r.vnCode } })}
                style={[{ backgroundColor: C.card, borderRadius: R.md, padding: S.md, gap: 4, borderWidth: 1, borderColor: need ? C.red : C.line, borderLeftWidth: 4, borderLeftColor: need ? C.red : r.isLeisure ? C.line : C.green }, shadow]}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={S.sm}>
                    <Text style={{ color: C.gold, fontWeight: '900', fontSize: 15 }}>{r.meetingTime || '—'}</Text>
                    <Text style={{ color: C.text, fontWeight: '900' }}>{r.vnCode}</Text>
                  </Row>
                  <Text style={{ color: C.sub, fontSize: 12 }}>{r.paxAdults + r.paxChildren} pax</Text>
                </Row>
                <Text style={{ color: C.text, fontWeight: '600' }} numberOfLines={2}>{r.fromPoint || r.location}{r.toPoint ? ` → ${r.toPoint}` : ''}</Text>
                {fl?.flightNo ? <Text style={{ color: C.blue, fontSize: 12 }}>✈ {fl.flightNo} {fl.fromApt ?? ''} {fl.depTime ?? ''} → {fl.toApt ?? ''} {fl.arrTime ?? ''}</Text> : null}
                <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
                  {r.isLeisure ? <Pill text="Leisure" /> : need ? <Pill text="Needs driver" tone="red" icon="alert-circle" /> : <Pill text={`🚗 ${r.driverName || r.vendorName || r.vendor}`} tone="green" />}
                  {r.agent ? <Text style={{ color: C.dim, fontSize: 12 }} numberOfLines={1}>{r.agent}</Text> : null}
                </Row>
              </Pressable>
            </View>
          );
        }} />
    </SafeAreaView>
  );
}
