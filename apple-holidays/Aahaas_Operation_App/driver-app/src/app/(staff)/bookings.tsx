/**
 * All bookings — the same list API and filters as ops.aahaas.com/dashboard/bookings:
 * country, live pulse buckets (from /bookings/quick-stats), quick or deep search,
 * status, source, arrival/created period or range, Hotel Only, Detailed P&L,
 * cancelled + test bookings, and sort. Filters are remembered on the phone.
 *
 * The country tabs only exist for people who see every country — the API
 * ignores `country` for everyone else and applies their own scope.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookingCard, type BookingLite } from '@/components/booking-card';
import { Sheet } from '@/components/sheet';
import { Button, ErrorBox, H1, Ionicons, Row, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { FLAG, STATUS_LABELS } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';
import { web } from '@/lib/web';

interface Page { bookings: BookingLite[]; total: number; page: number; limit: number; testHidden?: number }
type Bucket = { count: number; pax: number };

const COUNTRIES = [
  { key: 'ALL', label: 'All', flag: '🌏' },
  { key: 'VIETNAM', label: 'VN', flag: FLAG.VIETNAM },
  { key: 'SRILANKA', label: 'IS', flag: FLAG.SRILANKA },
  { key: 'MALAYSIA', label: 'MY', flag: FLAG.MALAYSIA },
  { key: 'SINGAPORE', label: 'SG', flag: FLAG.SINGAPORE },
] as const;
const COUNTRY_NAME: Record<string, string> = { VIETNAM: 'Vietnam', SRILANKA: 'Sri Lanka', MALAYSIA: 'Malaysia', SINGAPORE: 'Singapore', SINGAPORE_MALAYSIA: 'Singapore & Malaysia' };

/** Cards first (with live counts), then the filter-bar buckets the web keeps as buttons. */
const PULSE: { key: string; label: string; icon: IconName; color: string }[] = [
  { key: 'on_ground', label: 'On tour', icon: 'navigate', color: '#0E9F6E' },
  { key: 'arrivals_today', label: 'Arriving today', icon: 'airplane', color: '#2563EB' },
  { key: 'arrivals_tomorrow', label: 'Tomorrow', icon: 'sunny', color: '#7C3AED' },
  { key: 'arrivals_upcoming', label: 'Next 7 days', icon: 'calendar', color: '#0891B2' },
  { key: 'departures_today', label: 'Leaving today', icon: 'exit', color: '#D97706' },
  { key: 'departures_upcoming', label: 'Leaving soon', icon: 'time', color: '#DB2777' },
  { key: 'completed_yesterday', label: 'Ended yesterday', icon: 'flag', color: '#5A6478' },
];
const BAR: { key: string; label: string }[] = [
  { key: 'created_today', label: 'Created today' },
  { key: 'created_yesterday', label: 'Created yesterday' },
  { key: 'on_ground_yesterday', label: 'On ground yesterday' },
];
const QUICK_LABEL: Record<string, string> = Object.fromEntries([...PULSE, ...BAR].map(p => [p.key, p.label]));

const STATUS_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Booking', keys: ['DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED', 'AWAITING_PAYMENT_CONFIRM', 'AMENDED'] },
  { title: 'Operations', keys: ['OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS', 'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS', 'TICKETS_ISSUED', 'QC2_PASS', 'MSG_SENT_CUSTOMER'] },
  { title: 'After the trip', keys: ['TRIP_PENDING_REVIEW', 'TRIP_COMPLETED', 'FEEDBACK_DONE', 'COMPLETED'] },
  { title: 'Cancellation', keys: ['PENDING_CANCELLATION', 'CANCELLED'] },
];
const LABEL: Record<string, string> = { ...STATUS_LABELS, TRIP_PENDING_REVIEW: 'Trip done · review pending', TRIP_COMPLETED: 'Trip Completed' };

const SORTS = [
  { key: 'smart', label: 'Smart' }, { key: 'arrivalDate', label: 'Arrival' }, { key: 'departureDate', label: 'Departure' },
  { key: 'createdAt', label: 'Created' }, { key: 'updatedAt', label: 'Updated' },
] as const;

interface Filters {
  country: string
  quick: string
  statuses: string[]
  source: '' | 'B2B' | 'B2C'
  dateField: 'arrivalDate' | 'createdAt'
  period: '' | 'today' | 'this_week' | 'this_month'
  from: string
  to: string
  hotelOnly: boolean
  detailedPnl: boolean
  includeCancelled: boolean
  tests: 'exclude' | 'include' | 'only'
  sortBy: typeof SORTS[number]['key']
  sortDir: 'asc' | 'desc'
}
const DEFAULTS: Filters = {
  country: 'ALL', quick: '', statuses: [], source: '', dateField: 'arrivalDate', period: '', from: '', to: '',
  hotelOnly: false, detailedPnl: false, includeCancelled: false, tests: 'exclude', sortBy: 'smart', sortDir: 'desc',
};
const PREF = 'bookings.filters.v2';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

export default function Bookings() {
  const params = useLocalSearchParams<{ quick?: string; focus?: string }>();
  const { actor } = useAuth();
  const staff = actor?.kind === 'STAFF' ? actor : null;
  const allCountries = staff?.role === 'ULTRA_SUPER_ADMIN' || (staff?.role === 'SUPER_ADMIN' && staff.country === 'ALL');

  const [f, setF] = useState<Filters>({ ...DEFAULTS, quick: params.quick ?? '' });
  const [q, setQ] = useState('');
  const [deep, setDeep] = useState(false);
  const [rows, setRows] = useState<BookingLite[]>([]);
  const [total, setTotal] = useState(0);
  const [testHidden, setTestHidden] = useState(0);
  const [stats, setStats] = useState<Record<string, Bucket> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);

  const set = (patch: Partial<Filters>) => { Haptics.selectionAsync(); setF(p => ({ ...p, ...patch })); };

  useEffect(() => {
    AsyncStorage.getItem(PREF).then(raw => {
      if (raw) { const saved = JSON.parse(raw) as Partial<Filters>; setF(p => ({ ...DEFAULTS, ...saved, quick: params.quick ?? saved.quick ?? '' })); }
    }).catch(() => {}).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.quick !== undefined) setF(p => ({ ...p, quick: params.quick! })); }, [params.quick]);
  useEffect(() => { if (ready) AsyncStorage.setItem(PREF, JSON.stringify(f)).catch(() => {}); }, [f, ready]);

  const country = allCountries ? f.country : 'ALL';

  const query = useMemo(() => {
    const smartAsc = f.quick.startsWith('arrivals') || f.quick.startsWith('departures') || f.quick === 'on_ground';
    const qs = new URLSearchParams({
      limit: '30',
      sortBy: f.sortBy === 'smart' ? (f.quick.startsWith('departures') ? 'departureDate' : f.quick.startsWith('created') ? 'createdAt' : 'arrivalDate') : f.sortBy,
      sortDir: f.sortBy === 'smart' ? (smartAsc ? 'asc' : 'desc') : f.sortDir,
    });
    if (country !== 'ALL') qs.set('country', country);
    if (q.trim()) qs.set(deep ? 'contentSearch' : 'search', q.trim());
    if (f.quick) qs.set('quick', f.quick);
    if (f.statuses.length) qs.set('status', f.statuses.join(','));
    if (f.source) qs.set('source', f.source);
    if (f.period || f.from || f.to) qs.set('dateField', f.dateField);
    if (f.period) qs.set('dateFilter', f.period);
    if (YMD.test(f.from)) qs.set('dateFrom', f.from);
    if (YMD.test(f.to)) qs.set('dateTo', f.to);
    if (f.hotelOnly) qs.set('hotelOnly', '1');
    if (f.detailedPnl) qs.set('detailedPnl', '1');
    if (f.includeCancelled) qs.set('includeCancelled', '1');
    if (f.tests !== 'exclude') qs.set('tests', f.tests);
    return qs.toString();
  }, [f, q, deep, country]);

  const load = useCallback(async (p: number) => {
    const my = ++seq.current;
    p === 1 ? setLoading(true) : setMore(true);
    try {
      const r = await web<Page>(`bookings?page=${p}&${query}`);
      if (my !== seq.current) return;
      setRows(prev => (p === 1 ? r.bookings : [...prev, ...r.bookings]));
      setTotal(r.total); setTestHidden(r.testHidden ?? 0); setPage(p); setError(null);
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) { setLoading(false); setMore(false); }
    }
  }, [query]);

  const loadStats = useCallback(() => {
    web<{ stats: Record<string, Bucket> }>(`bookings/quick-stats${country !== 'ALL' ? `?country=${country}` : ''}${f.source ? `${country !== 'ALL' ? '&' : '?'}source=${f.source}` : ''}`)
      .then(r => setStats(r.stats)).catch(() => {});
  }, [country, f.source]);

  useEffect(() => { if (!ready) return; const t = setTimeout(() => load(1), q ? 350 : 0); return () => clearTimeout(t); }, [load, q, ready]);
  useEffect(() => { if (ready) loadStats(); }, [loadStats, ready]);

  // Removable summary of everything that isn't the default.
  const active: { key: string; label: string; clear: () => void }[] = [];
  if (f.quick) active.push({ key: 'quick', label: QUICK_LABEL[f.quick] ?? f.quick, clear: () => set({ quick: '' }) });
  f.statuses.forEach(s => active.push({ key: `s-${s}`, label: LABEL[s] ?? s, clear: () => set({ statuses: f.statuses.filter(x => x !== s) }) }));
  if (f.source) active.push({ key: 'src', label: f.source === 'B2C' ? 'B2C · Aahaas store' : 'B2B · agents', clear: () => set({ source: '' }) });
  if (f.period) active.push({ key: 'per', label: `${f.dateField === 'createdAt' ? 'Created' : 'Arrival'} ${f.period.replace('_', ' ')}`, clear: () => set({ period: '' }) });
  if (YMD.test(f.from) || YMD.test(f.to)) active.push({ key: 'rng', label: `${f.dateField === 'createdAt' ? 'Created' : 'Arrival'} ${f.from || '…'} → ${f.to || '…'}`, clear: () => set({ from: '', to: '' }) });
  if (f.hotelOnly) active.push({ key: 'hotel', label: 'Hotel only', clear: () => set({ hotelOnly: false }) });
  if (f.detailedPnl) active.push({ key: 'pnl', label: 'Has detailed P&L', clear: () => set({ detailedPnl: false }) });
  if (f.includeCancelled) active.push({ key: 'cx', label: 'Incl. cancelled', clear: () => set({ includeCancelled: false }) });
  if (f.tests !== 'exclude') active.push({ key: 'test', label: f.tests === 'only' ? 'Test bookings only' : 'Incl. tests', clear: () => set({ tests: 'exclude' }) });
  if (f.sortBy !== 'smart') active.push({ key: 'sort', label: `Sort: ${SORTS.find(s => s.key === f.sortBy)?.label} ${f.sortDir === 'asc' ? '↑' : '↓'}`, clear: () => set({ sortBy: 'smart' }) });
  const advancedCount = active.filter(a => a.key !== 'quick').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={b => b.bookingRef}
        contentContainerStyle={{ paddingBottom: 120, gap: S.md }}
        renderItem={({ item }) => <View style={{ paddingHorizontal: S.lg }}><BookingCard b={item} /></View>}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!loading && !more && rows.length < total) load(page + 1); }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={() => { load(1); loadStats(); }} tintColor={C.sub} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={{ gap: S.md, paddingTop: S.lg }}>
            {/* title + filter button */}
            <Row style={{ paddingHorizontal: S.lg, justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <H1>Bookings</H1>
                <Text style={{ color: C.sub, fontSize: 13 }}>
                  {allCountries ? (country === 'ALL' ? 'All countries' : COUNTRY_NAME[country]) : `${COUNTRY_NAME[staff?.country ?? ''] ?? 'Your'} desk`}
                  {stats ? ` · ${stats.on_ground.pax.toLocaleString()} guests on tour now` : ''}
                </Text>
              </View>
              <Pressable onPress={() => setSheet(true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: advancedCount ? C.ink : C.card, borderWidth: 1, borderColor: advancedCount ? C.ink : C.line, opacity: pressed ? 0.8 : 1 })}>
                <Ionicons name="options" size={18} color={advancedCount ? '#FFFFFF' : C.text} />
                <Text style={{ color: advancedCount ? '#FFFFFF' : C.text, fontWeight: '800' }}>Filters</Text>
                {advancedCount > 0 && <View style={{ backgroundColor: C.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{advancedCount}</Text></View>}
              </Pressable>
            </Row>

            {/* country */}
            {allCountries ? (
              <View style={{ flexDirection: 'row', marginHorizontal: S.lg, backgroundColor: C.cardHi, borderRadius: R.md, padding: 4 }}>
                {COUNTRIES.map(c => {
                  const on = country === c.key;
                  return (
                    <Pressable key={c.key} onPress={() => set({ country: c.key })} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingVertical: 9, borderRadius: R.sm + 2, backgroundColor: on ? C.card : 'transparent', ...(on ? shadow : null) }}>
                      <Text style={{ fontSize: 15 }}>{c.flag}</Text>
                      <Text style={{ color: on ? C.text : C.sub, fontWeight: on ? '900' : '700', fontSize: 13 }}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : staff ? (
              <Row gap={6} style={{ marginHorizontal: S.lg, alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ fontSize: 14 }}>{FLAG[staff.country] ?? '🌏'}</Text>
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>{COUNTRY_NAME[staff.country] ?? staff.country}</Text>
                <Ionicons name="lock-closed" size={12} color={C.dim} />
              </Row>
            ) : null}

            {/* search */}
            <View style={{ marginHorizontal: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: deep ? '#A78BFA' : C.line, paddingLeft: S.md, paddingRight: 6 }}>
              <Ionicons name={deep ? 'document-text' : 'search'} size={19} color={deep ? '#7C3AED' : C.sub} />
              <TextInput autoFocus={params.focus === '1'} value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize={deep ? 'none' : 'characters'}
                placeholder={deep ? 'Deep: hotel, flight, agenda, itinerary…' : 'Ref, VN/IS/SG/MY no., guest, agent…'} placeholderTextColor={C.dim}
                style={{ flex: 1, color: C.text, fontSize: 15, paddingVertical: 12 }} />
              {!!q && <Ionicons name="close-circle" size={19} color={C.dim} onPress={() => setQ('')} />}
              <Pressable onPress={() => { Haptics.selectionAsync(); setDeep(d => !d); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: deep ? '#EDE9FE' : C.cardHi }}>
                <Text style={{ color: deep ? '#6D28D9' : C.sub, fontSize: 12, fontWeight: '800' }}>{deep ? 'DEEP' : 'QUICK'}</Text>
              </Pressable>
            </View>

            {/* live pulse */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: S.lg, gap: S.sm }}>
              {PULSE.map(p => {
                const on = f.quick === p.key;
                const b = stats?.[p.key];
                return (
                  <Pressable key={p.key} onPress={() => set({ quick: on ? '' : p.key })}
                    style={({ pressed }) => ({ width: 112, padding: S.md, gap: 4, borderRadius: R.md, backgroundColor: on ? p.color : C.card, borderWidth: 1, borderColor: on ? p.color : C.line, opacity: pressed ? 0.85 : 1, ...shadow })}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: on ? '#FFFFFF33' : `${p.color}18`, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={p.icon} size={15} color={on ? '#FFFFFF' : p.color} />
                    </View>
                    <Text style={{ color: on ? '#FFFFFF' : C.text, fontSize: 22, fontWeight: '900' }}>{b ? b.count : '–'}</Text>
                    <Text style={{ color: on ? '#FFFFFF' : C.sub, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{p.label}</Text>
                    {b ? <Text style={{ color: on ? '#FFFFFFCC' : C.dim, fontSize: 11 }}>{b.pax} pax</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: S.lg, gap: S.sm }}>
              {BAR.map(b => {
                const on = f.quick === b.key;
                return (
                  <Pressable key={b.key} onPress={() => set({ quick: on ? '' : b.key })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: on ? C.red : C.card, borderWidth: 1, borderColor: on ? C.red : C.line }}>
                    <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 12 }}>{b.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* active filters */}
            {active.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: S.lg, gap: 6, alignItems: 'center' }}>
                {active.map(a => (
                  <Pressable key={a.key} onPress={a.clear} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.redSoft, borderRadius: 99, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 }}>
                    <Text style={{ color: C.redDeep, fontSize: 12, fontWeight: '700' }}>{a.label}</Text>
                    <Ionicons name="close" size={14} color={C.redDeep} />
                  </Pressable>
                ))}
                <Pressable onPress={() => set({ ...DEFAULTS, country: f.country })}><Text style={{ color: C.sub, fontSize: 12, fontWeight: '800', paddingHorizontal: 6 }}>Clear all</Text></Pressable>
              </ScrollView>
            )}

            <Row style={{ paddingHorizontal: S.lg, justifyContent: 'space-between' }}>
              <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>{loading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'booking' : 'bookings'}`}</Text>
              {testHidden > 0 && f.tests === 'exclude' ? <Text style={{ color: C.dim, fontSize: 12 }}>🧪 {testHidden} test hidden</Text> : null}
            </Row>
            {error && <View style={{ paddingHorizontal: S.lg }}><ErrorBox message={error} onRetry={() => load(1)} /></View>}
          </View>
        )}
        ListFooterComponent={more ? <ActivityIndicator color={C.red} /> : null}
        ListEmptyComponent={!loading ? (
          <View style={{ alignItems: 'center', padding: S.xxl, gap: S.sm }}>
            <Ionicons name="file-tray-outline" size={42} color={C.dim} />
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>No bookings match</Text>
            {active.length > 0 && <Pressable onPress={() => set({ ...DEFAULTS, country: f.country })}><Text style={{ color: C.red, fontWeight: '800' }}>Clear filters</Text></Pressable>}
          </View>
        ) : <ActivityIndicator color={C.red} style={{ marginTop: 40 }} />}
      />

      <FilterSheet open={sheet} onClose={() => setSheet(false)} f={f} onApply={next => setF(next)} total={total} />
    </SafeAreaView>
  );
}

/** The web filter bar, as one sheet. Edits a copy; Apply commits it. */
function FilterSheet({ open, onClose, f, onApply, total }: { open: boolean; onClose: () => void; f: Filters; onApply: (f: Filters) => void; total: number }) {
  const [d, setD] = useState(f);
  useEffect(() => { if (open) setD(f); }, [open, f]);
  const patch = (p: Partial<Filters>) => { Haptics.selectionAsync(); setD(x => ({ ...x, ...p })); };
  const toggle = (s: string) => patch({ statuses: d.statuses.includes(s) ? d.statuses.filter(x => x !== s) : [...d.statuses, s] });

  const seg = <T extends string>(opts: readonly { key: T; label: string }[], val: T, on: (v: T) => void) => (
    <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.sm + 2, padding: 3 }}>
      {opts.map(o => (
        <Pressable key={o.key} onPress={() => on(o.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: R.sm, backgroundColor: val === o.key ? C.card : 'transparent', ...(val === o.key ? shadow : null) }}>
          <Text style={{ color: val === o.key ? C.text : C.sub, fontWeight: val === o.key ? '800' : '600', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  const head = (t: string, right?: ReactNode) => (
    <Row style={{ justifyContent: 'space-between', marginTop: S.sm }}><Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>{t}</Text>{right}</Row>
  );
  const toggleRow = (icon: IconName, label: string, hint: string, val: boolean, on: (v: boolean) => void) => (
    <Row gap={S.md} style={{ paddingVertical: 4 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={17} color={C.sub} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '700' }}>{label}</Text><Text style={{ color: C.sub, fontSize: 12 }}>{hint}</Text></View>
      <Switch value={val} onValueChange={v => { Haptics.selectionAsync(); on(v); }} trackColor={{ true: C.red, false: C.line }} />
    </Row>
  );
  const dateInput = (val: string, on: (v: string) => void, ph: string) => (
    <TextInput value={val} onChangeText={on} placeholder={ph} placeholderTextColor={C.dim} keyboardType="numbers-and-punctuation" maxLength={10}
      style={{ flex: 1, color: C.text, fontSize: 15, backgroundColor: C.cardHi, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 10, borderWidth: 1, borderColor: val && !YMD.test(val) ? C.red : 'transparent' }} />
  );
  const preset = (label: string, from: string, to: string) => (
    <Pressable key={label} onPress={() => patch({ from, to, period: '' })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, borderWidth: 1, borderColor: d.from === from && d.to === to ? C.red : C.line, backgroundColor: d.from === from && d.to === to ? C.redSoft : C.card }}>
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Filter bookings">
      {head('STATUS', d.statuses.length ? <Pressable onPress={() => patch({ statuses: [] })}><Text style={{ color: C.red, fontWeight: '700', fontSize: 12 }}>Clear {d.statuses.length}</Text></Pressable> : undefined)}
      {STATUS_GROUPS.map(g => (
        <View key={g.title} style={{ gap: 6 }}>
          <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>{g.title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {g.keys.map(s => {
              const on = d.statuses.includes(s);
              return (
                <Pressable key={s} onPress={() => toggle(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: on ? C.ink : C.card, borderWidth: 1, borderColor: on ? C.ink : C.line }}>
                  {on && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                  <Text style={{ color: on ? '#FFFFFF' : C.text, fontSize: 12, fontWeight: '700' }}>{LABEL[s] ?? s}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {head('SOURCE')}
      {seg([{ key: '', label: 'All sources' }, { key: 'B2B', label: 'B2B · Agents' }, { key: 'B2C', label: 'B2C · Store' }] as const, d.source, v => patch({ source: v }))}

      {head('DATES')}
      {seg([{ key: 'arrivalDate', label: 'By arrival' }, { key: 'createdAt', label: 'By created' }] as const, d.dateField, v => patch({ dateField: v }))}
      {seg([{ key: '', label: 'Any time' }, { key: 'today', label: 'Today' }, { key: 'this_week', label: 'This week' }, { key: 'this_month', label: 'This month' }] as const, d.period, v => patch({ period: v, from: '', to: '' }))}
      <Row gap={S.sm}>{dateInput(d.from, v => setD(x => ({ ...x, from: v, period: '' })), 'From yyyy-mm-dd')}<Ionicons name="arrow-forward" size={16} color={C.dim} />{dateInput(d.to, v => setD(x => ({ ...x, to: v, period: '' })), 'To yyyy-mm-dd')}</Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {d.dateField === 'arrivalDate'
          ? [preset('Next 14 days', shift(0), shift(14)), preset('Next 30 days', shift(0), shift(30)), preset('Last 30 days', shift(-30), shift(0))]
          : [preset('Last 7 days', shift(-7), shift(0)), preset('Last 30 days', shift(-30), shift(0)), preset('Last 90 days', shift(-90), shift(0))]}
      </View>

      {head('ONLY SHOW')}
      {toggleRow('bed', 'Hotel only', 'Accommodation-only bookings', d.hotelOnly, v => patch({ hotelOnly: v }))}
      {toggleRow('document-text', 'Detailed P&L', 'Bookings with a costing sheet in Accounts', d.detailedPnl, v => patch({ detailedPnl: v }))}
      {toggleRow('close-circle', 'Include cancelled', 'Hidden from every list by default', d.includeCancelled, v => patch({ includeCancelled: v }))}
      {head('TEST BOOKINGS')}
      {seg([{ key: 'exclude', label: 'Hide' }, { key: 'include', label: 'Include' }, { key: 'only', label: 'Only tests' }] as const, d.tests, v => patch({ tests: v }))}

      {head('SORT')}
      {seg(SORTS, d.sortBy, v => patch({ sortBy: v }))}
      {d.sortBy !== 'smart' ? seg([{ key: 'desc', label: '↓ Newest / latest first' }, { key: 'asc', label: '↑ Oldest / soonest first' }] as const, d.sortDir, v => patch({ sortDir: v }))
        : <Text style={{ color: C.sub, fontSize: 12 }}>Smart: soonest first for arrivals, departures and on-tour; newest first otherwise.</Text>}

      <Row gap={S.sm} style={{ marginTop: S.md }}>
        <Button title="Reset" kind="secondary" style={{ flex: 1 }} onPress={() => setD({ ...DEFAULTS, country: d.country, quick: d.quick })} />
        <Button title="Apply" icon="checkmark" style={{ flex: 2 }} disabled={(!!d.from && !YMD.test(d.from)) || (!!d.to && !YMD.test(d.to))} onPress={() => { onApply(d); onClose(); }} />
      </Row>
      <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center' }}>Currently {total.toLocaleString()} bookings</Text>
    </Sheet>
  );
}
