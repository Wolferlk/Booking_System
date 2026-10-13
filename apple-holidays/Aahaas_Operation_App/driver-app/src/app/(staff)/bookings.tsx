/** All bookings — search, quick views, infinite scroll. Same list API as the web. */
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookingCard, type BookingLite } from '@/components/booking-card';
import { ErrorBox, H1, Ionicons } from '@/components/ui';
import { web } from '@/lib/web';
import { C, R, S } from '@/lib/theme';

const VIEWS = [
  { key: '', label: 'All' },
  { key: 'on_ground', label: 'On tour' },
  { key: 'arrivals_today', label: 'Arriving today' },
  { key: 'arrivals_tomorrow', label: 'Tomorrow' },
  { key: 'arrivals_upcoming', label: 'Upcoming' },
  { key: 'departures_today', label: 'Leaving today' },
  { key: 'created_today', label: 'New today' },
];

interface Page { bookings: BookingLite[]; total: number; page: number; limit: number }

export default function Bookings() {
  const params = useLocalSearchParams<{ quick?: string; focus?: string }>();
  const [view, setView] = useState(params.quick ?? '');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<BookingLite[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { if (params.quick !== undefined) setView(params.quick); }, [params.quick]);

  const load = useCallback(async (p: number) => {
    const my = ++seq.current;
    p === 1 ? setLoading(true) : setMore(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '30', sortBy: 'arrivalDate', sortDir: view.startsWith('arrivals') || view === 'on_ground' ? 'asc' : 'desc' });
      if (q.trim()) qs.set('search', q.trim());
      if (view) qs.set('quick', view);
      const r = await web<Page>(`bookings?${qs}`);
      if (my !== seq.current) return;
      setRows(prev => (p === 1 ? r.bookings : [...prev, ...r.bookings]));
      setTotal(r.total); setPage(p); setError(null);
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) { setLoading(false); setMore(false); }
    }
  }, [q, view]);

  useEffect(() => { const t = setTimeout(() => load(1), q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ padding: S.lg, gap: S.md }}>
        <H1>Bookings</H1>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg }}>
          <Ionicons name="search" size={20} color={C.sub} />
          <TextInput autoFocus={params.focus === '1'} value={q} onChangeText={setQ} placeholder="Ref, IS no., guest, agent…" placeholderTextColor={C.dim}
            autoCapitalize="characters" autoCorrect={false} style={{ flex: 1, color: C.text, fontSize: 16, paddingVertical: 13 }} />
          {!!q && <Ionicons name="close-circle" size={20} color={C.dim} onPress={() => setQ('')} />}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
          {VIEWS.map(v => (
            <Pressable key={v.key} onPress={() => setView(v.key)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: view === v.key ? C.red : C.card, borderWidth: 1, borderColor: view === v.key ? C.red : C.line }}>
              <Text style={{ color: view === v.key ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 13 }}>{v.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={{ color: C.dim, fontSize: 12 }}>{loading ? 'Loading…' : `${total.toLocaleString()} bookings`}</Text>
      </View>
      {error && <View style={{ paddingHorizontal: S.lg }}><ErrorBox message={error} onRetry={() => load(1)} /></View>}
      <FlatList
        data={rows}
        keyExtractor={b => b.bookingRef}
        contentContainerStyle={{ padding: S.lg, paddingTop: 0, gap: S.md, paddingBottom: 120 }}
        renderItem={({ item }) => <BookingCard b={item} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!loading && !more && rows.length < total) load(page + 1); }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={() => load(1)} tintColor={C.sub} />}
        ListFooterComponent={more ? <ActivityIndicator color={C.red} /> : null}
        ListEmptyComponent={!loading ? <Text style={{ color: C.sub, textAlign: 'center', marginTop: 40 }}>No bookings found.</Text> : <ActivityIndicator color={C.red} style={{ marginTop: 40 }} />}
      />
    </SafeAreaView>
  );
}
