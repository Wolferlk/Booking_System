/**
 * MC Report on the phone — every movement in a day / 3 days / week, who drives
 * it, and what still has nobody. Same data and the same write routes as
 * ops.aahaas.com → MC Report:
 *
 *   mark done / undo        PUT /api/mc-report/done          (Sri Lanka)
 *   desk figures            PUT /api/mc-report/details       (per country)
 *   Tickets Control note    PUT /api/mc-report/tickets-control (Vietnam)
 *
 * Driver allocation and the Accounts supplier stay on the web, where the
 * directory and the Suppliers Manage search live. Nothing shared from here
 * carries the driver rate — that figure is internal only.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, SectionList, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sheet } from '@/components/sheet';
import { Button, ErrorBox, IconButton, Ionicons, Row, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDay } from '@/lib/format';
import { FLAG, STATUS_LABELS } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';
import { web, webAction } from '@/lib/web';

interface McRow {
  id: string; date: string; vnCode: string; isNumber?: string | null; agentBookingId?: string | null
  location: string; paxAdults: number; paxChildren: number
  fromPoint: string | null; toPoint: string | null; details: string | null; meetingTime: string | null; mealPlan?: string | null; serviceType?: string
  isLeisure: boolean; isHotelOnly: boolean; isHotelOnlyBooking: boolean
  driverId: string | null; driverName: string | null; driverPhone?: string | null; vendorId: string | null; vendorName: string | null; vendor: string | null
  vehicleType?: string | null; vehiclePlate?: string | null; vehicleTypeHint?: { value: string; source: string } | null
  guideName?: string | null; guidePhone?: string | null; tourVendorName?: string | null; tourVendorPhone?: string | null
  operationCountry?: string | null; leadGuest?: string | null; agent: string | null; bookingStatus: string
  ticketsControl?: string | null
  mcDetails?: Record<string, number | string | null> | null
  done?: { at: string; by: string | null } | null
  supplier?: { name: string } | null
  checkOut?: string | null; nights?: number | null
  flights?: { flightNo?: string; depTime?: string; arrTime?: string; fromApt?: string; toApt?: string }[]
}

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };

const COUNTRIES = [
  { key: 'ALL', label: 'All', flag: '🌏' }, { key: 'VIETNAM', label: 'VN', flag: FLAG.VIETNAM }, { key: 'SRILANKA', label: 'IS', flag: FLAG.SRILANKA },
  { key: 'MALAYSIA', label: 'MY', flag: FLAG.MALAYSIA }, { key: 'SINGAPORE', label: 'SG', flag: FLAG.SINGAPORE },
] as const;
const SPANS = [{ n: 1, label: 'Day' }, { n: 3, label: '3 days' }, { n: 7, label: 'Week' }] as const;
const VIEWS: { key: string; label: string; icon: IconName }[] = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'needs', label: 'Needs driver', icon: 'alert-circle' },
  { key: 'airport', label: 'Airport', icon: 'airplane' },
  { key: 'allocated', label: 'Allocated', icon: 'car' },
  { key: 'guide', label: 'Guides', icon: 'person' },
  { key: 'open', label: 'Not done', icon: 'ellipse-outline' },
  { key: 'done', label: 'Done', icon: 'checkmark-done' },
];

/** Desk figures, by country — mirrors lib/mc-report-fields.ts. */
const FIELDS: { key: string; label: string; kind: 'money' | 'km' | 'text'; countries: string[] | null }[] = [
  { key: 'packageCost', label: 'Package cost', kind: 'money', countries: ['SRILANKA'] },
  { key: 'budgetKm', label: 'Budget KM', kind: 'km', countries: ['SRILANKA'] },
  { key: 'actualKm', label: 'Actual KM', kind: 'km', countries: ['SRILANKA'] },
  { key: 'budgetTransfer', label: 'Budget transfer', kind: 'money', countries: ['SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA'] },
  { key: 'specialRequest', label: 'Special request', kind: 'text', countries: null },
];
const fieldsFor = (c?: string | null) => FIELDS.filter(f => !f.countries || f.countries.includes(c ?? ''));

const noDriverNeeded = (r: McRow) => r.isLeisure || r.isHotelOnly || r.isHotelOnlyBooking;
const cancelled = (r: McRow) => r.bookingStatus === 'CANCELLED';
const needsDriver = (r: McRow) => !noDriverNeeded(r) && !r.driverId && !r.driverName && !r.vendorId && !r.vendorName && !cancelled(r);
const isAirport = (r: McRow) => /airport|\bCMB\b|\bBIA\b|\bSGN\b|\bHAN\b|\bDAD\b|\bSIN\b|\bKUL\b/i.test(`${r.fromPoint} ${r.toPoint} ${r.location}`);
const isSL = (r: McRow) => r.operationCountry === 'SRILANKA';
const pax = (r: McRow) => (r.paxAdults ?? 0) + (r.paxChildren ?? 0);
const vehicle = (r: McRow) => r.vehicleType || r.vehicleTypeHint?.value || null;
const digits = (p?: string | null) => (p ?? '').replace(/\D/g, '');

/** A movement as text for WhatsApp / notes — never includes the driver rate. */
function movementText(r: McRow) {
  return [
    `*${r.vnCode}*${r.isNumber ? ` (${r.isNumber})` : ''} · ${fmtDay(r.date)}${r.meetingTime ? ` · ${r.meetingTime}` : ''}`,
    `${r.leadGuest ?? 'Guest'} · ${pax(r)} pax`,
    `${r.fromPoint || r.location}${r.toPoint ? ` → ${r.toPoint}` : ''}`,
    r.details ? r.details : null,
    r.driverName ? `Driver: ${r.driverName}${r.driverPhone ? ` (${r.driverPhone})` : ''}${r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}` : null,
    r.guideName ? `Guide: ${r.guideName}${r.guidePhone ? ` (${r.guidePhone})` : ''}` : null,
  ].filter(Boolean).join('\n');
}

export default function McReport() {
  const { actor } = useAuth();
  const staff = actor?.kind === 'STAFF' ? actor : null;
  const allCountries = staff?.role === 'ULTRA_SUPER_ADMIN' || (staff?.role === 'SUPER_ADMIN' && staff.country === 'ALL');
  const [country, setCountry] = useState<string>('ALL');
  const [from, setFrom] = useState(ymd(new Date()));
  const [span, setSpan] = useState<1 | 3 | 7>(1);
  const [rows, setRows] = useState<McRow[]>([]);
  const [view, setView] = useState('all');
  const [hideLeisure, setHideLeisure] = useState(true);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<McRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const to = addDays(from, span - 1);
  const today = ymd(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await web<McRow[]>(`mc-report?dateFrom=${from}&dateTo=${to}${allCountries && country !== 'ALL' ? `&country=${country}` : ''}`));
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [from, to, country, allCountries]);
  useEffect(() => { load(); }, [load]);

  const live = rows.filter(r => !cancelled(r));
  const stats = {
    movements: live.filter(r => !noDriverNeeded(r)).length,
    needs: live.filter(needsDriver).length,
    airport: live.filter(isAirport).length,
    done: live.filter(r => r.done).length,
    // Guests counted once per file, not once per movement.
    pax: Array.from(new Map(live.map(r => [r.vnCode, pax(r)])).values()).reduce((a, b) => a + b, 0),
    files: new Set(live.map(r => r.vnCode)).size,
  };
  const coverage = stats.movements ? (stats.movements - stats.needs) / stats.movements : 1;

  const sections = useMemo(() => {
    const s = q.trim().toLowerCase();
    const shown = rows
      .filter(r => !hideLeisure || !r.isLeisure || view !== 'all')
      .filter(r => view === 'all' ? true
        : view === 'needs' ? needsDriver(r)
        : view === 'airport' ? isAirport(r)
        : view === 'allocated' ? !needsDriver(r) && !noDriverNeeded(r) && !cancelled(r)
        : view === 'guide' ? !!(r.guideName || r.tourVendorName)
        : view === 'done' ? !!r.done
        : !r.done && !noDriverNeeded(r) && !cancelled(r))
      .filter(r => !s || [r.vnCode, r.isNumber, r.agentBookingId, r.location, r.fromPoint, r.toPoint, r.driverName, r.vendor, r.guideName, r.agent, r.leadGuest, r.vehiclePlate, r.details]
        .some(v => v?.toLowerCase().includes(s)))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.meetingTime ?? '99').localeCompare(String(b.meetingTime ?? '99')) || a.vnCode.localeCompare(b.vnCode));
    const by = new Map<string, McRow[]>();
    shown.forEach(r => by.set(r.date, [...(by.get(r.date) ?? []), r]));
    return Array.from(by.entries()).map(([date, data]) => ({ date, data, needs: data.filter(needsDriver).length }));
  }, [rows, view, q, hideLeisure]);
  const shownCount = sections.reduce((n, s) => n + s.data.length, 0);

  const counts: Record<string, number> = {
    all: rows.length, needs: stats.needs, airport: stats.airport,
    allocated: live.filter(r => !needsDriver(r) && !noDriverNeeded(r)).length, guide: rows.filter(r => r.guideName || r.tourVendorName).length,
    open: live.filter(r => !r.done && !noDriverNeeded(r)).length, done: stats.done,
  };

  async function markDone(ids: string[], done: boolean) {
    setBusy(true);
    try {
      const msg = await webAction('mc-report/done', { agendaItemIds: ids, done }, 'PUT');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPicked(new Set()); setOpen(null);
      await load();
      if (ids.length > 1) Alert.alert('Done', msg);
    } catch (e) { Alert.alert('Not saved', (e as Error).message); }
    finally { setBusy(false); }
  }

  function shareDay() {
    const lines = sections.flatMap(s => [`\n📅 *${fmtDay(s.date, { weekday: 'long', day: 'numeric', month: 'short' })}* — ${s.data.length} movements${s.needs ? ` · ⚠️ ${s.needs} need a driver` : ''}`,
      ...s.data.filter(r => !r.isLeisure).map(r => `• ${r.meetingTime ?? '--:--'} ${r.vnCode} ${r.fromPoint || r.location}${r.toPoint ? ` → ${r.toPoint}` : ''} — ${r.driverName ?? r.vendor ?? (needsDriver(r) ? 'NO DRIVER' : '—')}`)]);
    Share.share({ message: `MC Report ${span === 1 ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`}${country !== 'ALL' ? ` · ${country}` : ''}${lines.join('\n')}` });
  }

  const selecting = picked.size > 0;
  const toggle = (r: McRow) => setPicked(p => { const n = new Set(p); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={r => r.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} tintColor={C.sub} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={{ padding: S.lg, gap: S.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <IconButton icon="chevron-back" onPress={() => router.back()} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>MC Report</Text>
                <Text style={{ color: C.sub, fontSize: 12 }}>{stats.files} files · {stats.pax} guests</Text>
              </View>
              <IconButton icon="share-outline" onPress={shareDay} />
            </Row>

            {allCountries && (
              <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.md, padding: 4 }}>
                {COUNTRIES.map(c => (
                  <Pressable key={c.key} onPress={() => { Haptics.selectionAsync(); setCountry(c.key); }} style={{ flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: R.sm + 2, backgroundColor: country === c.key ? C.card : 'transparent', ...(country === c.key ? shadow : null) }}>
                    <Text style={{ fontSize: 14 }}>{c.flag}</Text>
                    <Text style={{ color: country === c.key ? C.text : C.sub, fontWeight: country === c.key ? '900' : '700', fontSize: 13 }}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* date */}
            <View style={[{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.sm, gap: S.sm }, shadow]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <IconButton icon="chevron-back" onPress={() => setFrom(addDays(from, -span))} />
                <Pressable onPress={() => setFrom(today)} style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>{span === 1 ? fmtDay(from, { weekday: 'long', day: 'numeric', month: 'short' }) : `${fmtDay(from)} – ${fmtDay(to)}`}</Text>
                  <Text style={{ color: from === today ? C.green : C.red, fontSize: 12, fontWeight: '700' }}>{from === today ? 'Today' : from === addDays(today, 1) ? 'Tomorrow' : 'Tap for today'}</Text>
                </Pressable>
                <IconButton icon="chevron-forward" onPress={() => setFrom(addDays(from, span))} />
              </Row>
              <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.sm + 2, padding: 3 }}>
                {SPANS.map(s => (
                  <Pressable key={s.n} onPress={() => setSpan(s.n)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: R.sm, backgroundColor: span === s.n ? C.card : 'transparent' }}>
                    <Text style={{ color: span === s.n ? C.text : C.sub, fontWeight: span === s.n ? '800' : '600', fontSize: 13 }}>{s.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* pulse */}
            <View style={[{ backgroundColor: C.ink, borderRadius: R.lg, padding: S.lg, gap: S.md }, shadow]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: '#FFFFFF99', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>DRIVER COVERAGE</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '900' }}>{Math.round(coverage * 100)}%</Text>
                </View>
                <Pressable onPress={() => setView(view === 'needs' ? 'all' : 'needs')} style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: stats.needs ? '#FF6B78' : '#4ADE80', fontSize: 30, fontWeight: '900' }}>{stats.needs}</Text>
                  <Text style={{ color: '#FFFFFFB3', fontSize: 12, fontWeight: '700' }}>{stats.needs ? 'need a driver →' : 'all covered'}</Text>
                </Pressable>
              </Row>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: '#FFFFFF26', overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ width: `${coverage * 100}%`, backgroundColor: stats.needs ? '#FBBF24' : '#4ADE80' }} />
              </View>
              <Row style={{ justifyContent: 'space-between' }}>
                {[['Movements', stats.movements], ['Airport', stats.airport], ['Done', stats.done], ['Guests', stats.pax]].map(([k, v]) => (
                  <View key={String(k)}><Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900' }}>{v}</Text><Text style={{ color: '#FFFFFF99', fontSize: 11 }}>{k}</Text></View>
                ))}
              </Row>
            </View>

            {/* search + views */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md }}>
              <Ionicons name="search" size={18} color={C.sub} />
              <TextInput value={q} onChangeText={setQ} placeholder="Ref, IS no., place, driver, guest, plate…" placeholderTextColor={C.dim} autoCorrect={false} style={{ flex: 1, color: C.text, paddingVertical: 11, fontSize: 15 }} />
              {!!q && <Ionicons name="close-circle" size={18} color={C.dim} onPress={() => setQ('')} />}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingHorizontal: S.lg }} style={{ marginHorizontal: -S.lg }}>
              {VIEWS.map(v => {
                const on = view === v.key;
                return (
                  <Pressable key={v.key} onPress={() => { Haptics.selectionAsync(); setView(v.key); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: on ? (v.key === 'needs' ? C.red : C.ink) : C.card, borderWidth: 1, borderColor: on ? (v.key === 'needs' ? C.red : C.ink) : C.line }}>
                    <Ionicons name={v.icon} size={14} color={on ? '#FFFFFF' : v.key === 'needs' && counts.needs ? C.red : C.sub} />
                    <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 13 }}>{v.label}</Text>
                    <Text style={{ color: on ? '#FFFFFFAA' : C.dim, fontWeight: '700', fontSize: 12 }}>{counts[v.key]}</Text>
                  </Pressable>
                );
              })}
              <Pressable onPress={() => setHideLeisure(h => !h)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
                <Ionicons name={hideLeisure ? 'eye-off-outline' : 'eye-outline'} size={14} color={C.sub} />
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>{hideLeisure ? 'Leisure hidden' : 'Leisure shown'}</Text>
              </Pressable>
            </ScrollView>
            <Text style={{ color: C.dim, fontSize: 12 }}>{loading ? 'Loading…' : `${shownCount} of ${rows.length} rows · long-press to select`}</Text>
            {error && <ErrorBox message={error} onRetry={load} />}
          </View>
        )}
        renderSectionHeader={({ section: s }) => (
          <Row style={{ backgroundColor: C.bg, paddingHorizontal: S.lg, paddingVertical: 8, justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontWeight: '900' }}>{fmtDay(s.date, { weekday: 'long', day: 'numeric', month: 'short' })}{s.date === today ? '  · Today' : ''}</Text>
            <Text style={{ color: s.needs ? C.red : C.sub, fontSize: 12, fontWeight: '700' }}>{s.data.length} rows{s.needs ? ` · ${s.needs} need driver` : ''}</Text>
          </Row>
        )}
        renderItem={({ item: r }) => (
          <MovementCard r={r} picked={picked.has(r.id)} selecting={selecting}
            onPress={() => (selecting ? toggle(r) : setOpen(r))}
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); toggle(r); }} />
        )}
        ListEmptyComponent={!loading ? (
          <View style={{ alignItems: 'center', padding: S.xxl, gap: S.sm }}>
            <Ionicons name={view === 'needs' ? 'checkmark-circle' : 'calendar-clear-outline'} size={44} color={view === 'needs' ? C.green : C.dim} />
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{view === 'needs' ? 'Every movement has a driver' : 'Nothing here'}</Text>
            <Text style={{ color: C.sub, textAlign: 'center' }}>Try another day, view or country.</Text>
          </View>
        ) : null}
      />

      {/* bulk bar */}
      {selecting && (
        <View style={[{ position: 'absolute', left: S.lg, right: S.lg, bottom: 34, backgroundColor: C.ink, borderRadius: R.lg, padding: S.md, flexDirection: 'row', alignItems: 'center', gap: S.sm }, shadow]}>
          <Pressable onPress={() => setPicked(new Set())}><Ionicons name="close" size={22} color="#FFFFFF" /></Pressable>
          <Text style={{ color: '#FFFFFF', fontWeight: '800', flex: 1 }}>{picked.size} selected</Text>
          <Pressable onPress={() => { const t = rows.filter(r => picked.has(r.id)).map(movementText).join('\n\n'); Clipboard.setStringAsync(t); setPicked(new Set()); }} style={{ padding: 8 }}><Ionicons name="copy-outline" size={20} color="#FFFFFF" /></Pressable>
          {(() => {
            const sl = rows.filter(r => picked.has(r.id) && isSL(r));
            if (!sl.length) return null;
            const allDone = sl.every(r => r.done);
            return (
              <Pressable disabled={busy} onPress={() => markDone(sl.map(r => r.id), !allDone)} style={{ backgroundColor: allDone ? '#FFFFFF26' : C.green, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{busy ? 'Saving…' : allDone ? `Undo ${sl.length}` : `Mark ${sl.length} done`}</Text>
              </Pressable>
            );
          })()}
        </View>
      )}

      <MovementSheet r={open} onClose={() => setOpen(null)} busy={busy} onDone={markDone} onSaved={load} />
    </SafeAreaView>
  );
}

function MovementCard({ r, picked, selecting, onPress, onLongPress }: { r: McRow; picked: boolean; selecting: boolean; onPress: () => void; onLongPress: () => void }) {
  const need = needsDriver(r);
  const off = cancelled(r);
  const accent = off ? C.dim : need ? C.red : r.done ? C.green : noDriverNeeded(r) ? C.line : C.blue;
  if (r.isLeisure || r.isHotelOnlyBooking) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={{ marginHorizontal: S.lg, marginBottom: S.sm, padding: S.md, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Ionicons name={r.isLeisure ? 'sunny-outline' : 'bed-outline'} size={16} color={C.sub} />
        <Text style={{ color: C.sub, flex: 1 }} numberOfLines={1}><Text style={{ fontWeight: '800', color: C.text }}>{r.vnCode}</Text> · {r.isLeisure ? 'Leisure day' : `Hotel only${r.nights ? ` · ${r.nights}N` : ''}`} · {r.location}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={280}
      style={({ pressed }) => [{ marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: picked ? C.blueSoft : C.card, borderRadius: R.md, borderWidth: 1, borderColor: picked ? C.blue : C.line, borderLeftWidth: 4, borderLeftColor: accent, padding: S.md, gap: 6, opacity: off ? 0.55 : pressed ? 0.85 : 1 }, shadow]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flex: 1 }}>
          {selecting && <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={20} color={picked ? C.blue : C.dim} />}
          <View style={{ backgroundColor: C.cardHi, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 13 }}>{r.meetingTime || '--:--'}</Text></View>
          <Text style={{ fontSize: 13 }}>{FLAG[r.operationCountry ?? ''] ?? ''}</Text>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>{r.vnCode}</Text>
          {r.isNumber && r.isNumber !== r.vnCode ? <Text style={{ color: C.dim, fontSize: 12 }} numberOfLines={1}>{r.isNumber}</Text> : null}
        </Row>
        {off ? <Tag text="Cancelled" color={C.red} /> : r.bookingStatus === 'PENDING_CANCELLATION' ? <Tag text="Cancelling" color={C.red} /> : r.done ? <Tag text="Done" color={C.green} icon="checkmark" /> : isAirport(r) ? <Tag text="Airport" color={C.blue} icon="airplane" /> : null}
      </Row>
      <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }} numberOfLines={2}>{r.fromPoint || r.location}{r.toPoint ? <Text style={{ color: C.sub }}>  →  </Text> : null}{r.toPoint ?? ''}</Text>
      <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}>{r.leadGuest ?? 'Guest'} · {pax(r)} pax{r.agent ? ` · ${r.agent}` : ''}</Text>
      {r.details ? <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={2}>{r.details}</Text> : null}
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        {need ? <Tag text="No driver" color={C.red} icon="alert-circle" solid /> : r.driverName || r.vendor ? <Tag text={r.driverName ?? r.vendor ?? ''} color={C.green} icon="car" /> : null}
        {vehicle(r) ? <Tag text={`${vehicle(r)}${r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}`} color={C.sub} /> : null}
        {r.guideName ? <Tag text={`Guide ${r.guideName}`} color="#7C3AED" icon="person" /> : null}
        {r.tourVendorName ? <Tag text={r.tourVendorName} color="#7C3AED" /> : null}
        {r.supplier?.name ? <Tag text={r.supplier.name} color={C.gold} icon="business" /> : null}
        {(r.flights ?? []).slice(0, 2).map((f, i) => <Tag key={i} text={`${f.flightNo ?? ''} ${f.depTime ?? f.arrTime ?? ''}`.trim()} color="#0891B2" icon="airplane-outline" />)}
        {r.ticketsControl ? <Tag text="Tickets ✓" color={C.amber} icon="ticket" /> : null}
        {r.mcDetails?.specialRequest ? <Tag text="Special request" color={C.red} icon="star" /> : null}
      </Row>
    </Pressable>
  );
}

function Tag({ text, color, icon, solid }: { text: string; color: string; icon?: IconName; solid?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: solid ? color : `${color}14` }}>
      {icon && <Ionicons name={icon} size={11} color={solid ? '#FFFFFF' : color} />}
      <Text style={{ color: solid ? '#FFFFFF' : color, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** One movement: contacts, the desk figures for its country, Tickets Control and done. */
function MovementSheet({ r, onClose, busy, onDone, onSaved }: { r: McRow | null; onClose: () => void; busy: boolean; onDone: (ids: string[], done: boolean) => void; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tc, setTc] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    if (!r) return;
    setVals(Object.fromEntries(fieldsFor(r.operationCountry).map(f => [f.key, r.mcDetails?.[f.key] != null ? String(r.mcDetails[f.key]) : ''])));
    setTc(r.ticketsControl ?? '');
  }, [r]);
  if (!r) return null;

  async function save(field: string, value: string) {
    setSaving(field);
    try {
      if (field === '__tc') await webAction('mc-report/tickets-control', { agendaItemId: r!.id, value }, 'PUT');
      else await webAction('mc-report/details', { agendaItemId: r!.id, field, value }, 'PUT');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (e) { Alert.alert('Not saved', (e as Error).message); }
    finally { setSaving(null); }
  }

  const contact = (icon: IconName, who: string, name?: string | null, phone?: string | null) => name ? (
    <Row gap={S.md} style={{ paddingVertical: 6 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={18} color={C.sub} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '700' }}>{name}</Text><Text style={{ color: C.sub, fontSize: 12 }}>{who}{phone ? ` · ${phone}` : ''}</Text></View>
      {phone ? <Ionicons name="call" size={20} color={C.blue} onPress={() => Linking.openURL(`tel:${phone}`)} /> : null}
      {phone ? <Ionicons name="logo-whatsapp" size={22} color={C.green} style={{ marginLeft: S.md }} onPress={() => { onClose(); router.push({ pathname: '/wa/[phone]', params: { phone: digits(phone), name } }); }} /> : null}
    </Row>
  ) : null;

  const fields = fieldsFor(r.operationCountry);
  return (
    <Sheet open={!!r} onClose={onClose} title={`${r.vnCode} · ${r.meetingTime ?? fmtDay(r.date)}`}>
      <Text style={{ color: C.sub, marginTop: -S.sm }}>{fmtDay(r.date, { weekday: 'long', day: 'numeric', month: 'short' })} · {STATUS_LABELS[r.bookingStatus] ?? r.bookingStatus}</Text>
      <View style={{ backgroundColor: C.cardHi, borderRadius: R.md, padding: S.md, gap: 4 }}>
        <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{r.fromPoint || r.location}{r.toPoint ? ` → ${r.toPoint}` : ''}</Text>
        <Text style={{ color: C.sub }}>{r.leadGuest ?? 'Guest'} · {r.paxAdults}A {r.paxChildren}C{r.mealPlan ? ` · ${r.mealPlan}` : ''}</Text>
        {r.details ? <Text style={{ color: C.text, fontSize: 14 }}>{r.details}</Text> : null}
        {(r.flights ?? []).map((f, i) => <Text key={i} style={{ color: '#0891B2', fontWeight: '700', fontSize: 13 }}>✈ {f.flightNo} {f.fromApt} {f.depTime} → {f.toApt} {f.arrTime}</Text>)}
      </View>

      {needsDriver(r) && <View style={{ backgroundColor: C.redSoft, borderRadius: R.md, padding: S.md }}><Text style={{ color: C.redDeep, fontWeight: '700' }}>No driver or vendor yet. Allocate on ops.aahaas.com → MC Report.</Text></View>}
      {contact('car', `Driver${vehicle(r) ? ` · ${vehicle(r)}` : ''}${r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}`, r.driverName, r.driverPhone)}
      {!r.driverName && r.vendor ? contact('business', 'Transport vendor', r.vendor, null) : null}
      {contact('person', 'Guide', r.guideName, r.guidePhone)}
      {contact('flag', 'Tour vendor', r.tourVendorName, r.tourVendorPhone)}
      {r.supplier?.name ? <Text style={{ color: C.sub, fontSize: 13 }}>Accounts supplier: <Text style={{ color: C.text, fontWeight: '700' }}>{r.supplier.name}</Text></Text> : null}

      {fields.length > 0 && <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginTop: S.sm }}>DESK FIGURES</Text>}
      {fields.map(f => (
        <Row key={f.key} gap={S.sm} style={{ alignItems: f.kind === 'text' ? 'flex-start' : 'center' }}>
          <Text style={{ color: C.sub, width: 110, fontSize: 13, paddingTop: f.kind === 'text' ? 10 : 0 }}>{f.label}{f.kind === 'money' && r.mcDetails?.currency ? ` (${r.mcDetails.currency})` : ''}</Text>
          <TextInput value={vals[f.key] ?? ''} onChangeText={v => setVals(x => ({ ...x, [f.key]: v }))} multiline={f.kind === 'text'} keyboardType={f.kind === 'text' ? 'default' : 'decimal-pad'}
            placeholder={f.kind === 'km' ? 'km' : f.kind === 'money' ? '0.00' : 'Note'} placeholderTextColor={C.dim}
            style={{ flex: 1, color: C.text, fontSize: 15, backgroundColor: C.cardHi, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 9, minHeight: f.kind === 'text' ? 60 : undefined, textAlignVertical: 'top' }} />
          <Pressable disabled={saving === f.key || (vals[f.key] ?? '') === (r.mcDetails?.[f.key] != null ? String(r.mcDetails[f.key]) : '')} onPress={() => save(f.key, vals[f.key] ?? '')} style={{ padding: 6 }}>
            <Ionicons name={saving === f.key ? 'hourglass-outline' : 'checkmark-circle'} size={26} color={(vals[f.key] ?? '') === (r.mcDetails?.[f.key] != null ? String(r.mcDetails[f.key]) : '') ? C.line : C.green} />
          </Pressable>
        </Row>
      ))}
      {r.mcDetails?.updatedByName ? <Text style={{ color: C.dim, fontSize: 11 }}>Last saved by {r.mcDetails.updatedByName}</Text> : null}

      {r.operationCountry === 'VIETNAM' && (
        <>
          <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginTop: S.sm }}>TICKETS CONTROL</Text>
          <Row gap={S.sm} style={{ alignItems: 'flex-start' }}>
            <TextInput value={tc} onChangeText={setTc} multiline placeholder="Tickets bought, references, notes…" placeholderTextColor={C.dim}
              style={{ flex: 1, color: C.text, fontSize: 15, backgroundColor: C.cardHi, borderRadius: R.sm, padding: S.md, minHeight: 60, textAlignVertical: 'top' }} />
            <Pressable disabled={saving === '__tc' || tc === (r.ticketsControl ?? '')} onPress={() => save('__tc', tc)} style={{ padding: 6 }}>
              <Ionicons name="checkmark-circle" size={26} color={tc === (r.ticketsControl ?? '') ? C.line : C.green} />
            </Pressable>
          </Row>
        </>
      )}

      <Row gap={S.sm} style={{ marginTop: S.md }}>
        <Button title="Booking" icon="briefcase" kind="secondary" style={{ flex: 1 }} onPress={() => { onClose(); router.push({ pathname: '/booking/[ref]', params: { ref: r.vnCode } }); }} />
        <Button title="Copy" icon="copy" kind="secondary" style={{ flex: 1 }} onPress={() => { Clipboard.setStringAsync(movementText(r)); Haptics.selectionAsync(); }} />
      </Row>
      {isSL(r) && !noDriverNeeded(r) && (
        <Button title={r.done ? `Undo done (${r.done.by ?? 'marked'})` : 'Mark movement done'} icon={r.done ? 'arrow-undo' : 'checkmark-done'} kind={r.done ? 'secondary' : 'primary'} loading={busy}
          onPress={() => onDone([r.id], !r.done)} />
      )}
    </Sheet>
  );
}
