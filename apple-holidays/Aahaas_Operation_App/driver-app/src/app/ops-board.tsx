/**
 * Ops Board — ops.aahaas.com → Accounts → Reports on the phone. For a day (or
 * a short window): who is on the ground, and is each tour actually ready?
 * Ready = reconfirmed (client confirm or pre-tour call), drivers allocated,
 * tickets issued, QC1 / QC2 signed off. One fetch of /api/accounts/report/ops;
 * the tabs and chase filters are slices of it, so counts never disagree.
 *
 * No money here by design, same as the web board.
 * Roles: AC_USER, GT_VN_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN (the API decides).
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Sheet } from '@/components/sheet';
import { Button, ErrorBox, IconButton, Ionicons, Row, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDay } from '@/lib/format';
import { FLAG } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';
import { web } from '@/lib/web';

type State = 'DONE' | 'PARTIAL' | 'PENDING' | 'NA';
interface Check { state: State; short: string; detail: string; done: number; required: number }
interface Row_ {
  bookingRef: string; agent: string | null; fileHandler: string | null; leadPassenger: string | null
  country: string; countryLabel: string; destination: string | null; status: string; statusLabel: string
  arrivalDate: string; departureDate: string; pax: number; dayNo: number; totalDays: number
  isArrival: boolean; isDeparture: boolean
  driver: Check; tickets: Check; qc: Check & { stage: 'NONE' | 'QC1' | 'QC2' }
  hotelOnly: boolean; cancelled: boolean; cancelPending: boolean; testFile: { field: string; snippet: string } | null
  cancellation: { requestedBy: string | null; reason: string | null; waitingDays: number | null } | null
  clientConfirmed: boolean
  preTourCall: { at: string; outcome: string; summary: string } | null
  call: { approval: 'approved' | 'pending' | 'not_requested' | 'unknown'; scheduledAt: string | null; scheduleStatus: string | null; attempts: number; completed: boolean }
  reconfirmStanding: { state: string; dueAt: string; daysToDue: number }
  reconfirmDelay: { reasonLabel: string; note: string | null; stale: boolean } | null
  reconfirmBreached: boolean
  ready: boolean
  outstanding: string[]
}
interface Board {
  from: string; to: string; days: number; label: string; isToday: boolean; truncated: boolean
  callDataAvailable: boolean; approvalDataAvailable: boolean
  summary: {
    onGround: number; arrivals: number; departures: number; paxOnGround: number; paxArriving: number; paxDeparting: number; ready: number
    checks: { key: string; label: string; done: number; partial: number; pending: number; na: number }[]
    reconfirm: { clientConfirmed: number; preTourCalled: number; neither: number }
    reconfirmDelay: { breached: number; explained: number; unexplained: number; stale: number }
    hotelOnly: number; cancelled: number; cancelPending: number
    callApproval: Record<string, number>
    byCountry: { country: string; label: string; bookings: number; pax: number }[]
  }
  rows: Row_[]
  hidden: { cancelled: number; test: number }
}

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };

const COUNTRIES = [
  { key: 'ALL', label: 'All', flag: '🌏' }, { key: 'VIETNAM', label: 'VN', flag: FLAG.VIETNAM }, { key: 'SRILANKA', label: 'IS', flag: FLAG.SRILANKA },
  { key: 'MALAYSIA', label: 'MY', flag: FLAG.MALAYSIA }, { key: 'SINGAPORE', label: 'SG', flag: FLAG.SINGAPORE },
] as const;
const TONE: Record<State, { fg: string; bg: string; label: string }> = {
  DONE: { fg: '#0E9F6E', bg: '#E5F7F0', label: 'Done' },
  PARTIAL: { fg: '#D97706', bg: '#FFF4E0', label: 'Partly' },
  PENDING: { fg: '#E11D48', bg: '#FFE8EC', label: 'Pending' },
  NA: { fg: '#98A2B5', bg: '#F0F2F7', label: 'n/a' },
};
const CHECK_ICON: Record<string, IconName> = { reconfirm: 'call', driver: 'car', tickets: 'ticket', qc: 'shield-checkmark', calls: 'chatbubble-ellipses' };

type Tab = 'onground' | 'arrivals' | 'departures';
type Chase = 'all' | 'notready' | 'driver' | 'tickets' | 'qc' | 'reconfirm' | 'late' | 'cancel';
const CHASES: { key: Chase; label: string; icon: IconName }[] = [
  { key: 'all', label: 'Everyone', icon: 'people' },
  { key: 'notready', label: 'Not ready', icon: 'alert-circle' },
  { key: 'reconfirm', label: 'Not reconfirmed', icon: 'call' },
  { key: 'late', label: 'D-10 breached', icon: 'alarm' },
  { key: 'driver', label: 'Driver missing', icon: 'car' },
  { key: 'tickets', label: 'Tickets open', icon: 'ticket' },
  { key: 'qc', label: 'QC open', icon: 'shield-checkmark' },
  { key: 'cancel', label: 'Cancel pending', icon: 'close-circle' },
];

const reconState = (r: Row_): State => (r.hotelOnly || r.cancelled ? 'NA' : r.clientConfirmed && r.preTourCall ? 'DONE' : r.clientConfirmed || r.preTourCall ? 'PARTIAL' : 'PENDING');
const open = (c: Check) => c.state === 'PENDING' || c.state === 'PARTIAL';
function chase(r: Row_, k: Chase) {
  switch (k) {
    case 'notready': return !r.ready && !r.cancelled && !r.hotelOnly;
    case 'reconfirm': return reconState(r) === 'PENDING';
    case 'late': return r.reconfirmBreached;
    case 'driver': return open(r.driver);
    case 'tickets': return open(r.tickets);
    case 'qc': return open(r.qc);
    case 'cancel': return r.cancelPending;
    default: return true;
  }
}

function Ring({ value, size = 96, stroke = 10, color }: { value: number; size?: number; stroke?: number; color: string }) {
  const rad = (size - stroke) / 2;
  const len = 2 * Math.PI * rad;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={rad} stroke="#FFFFFF26" strokeWidth={stroke} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={rad} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${len * Math.max(0, Math.min(1, value))} ${len}`} />
    </Svg>
  );
}

export default function OpsBoard() {
  const { actor } = useAuth();
  const staff = actor?.kind === 'STAFF' ? actor : null;
  const allCountries = staff?.role === 'ULTRA_SUPER_ADMIN' || (staff?.role === 'SUPER_ADMIN' && staff.country === 'ALL');
  const today = ymd(new Date());
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState(1);
  const [country, setCountry] = useState('ALL');
  const [cancelled, setCancelled] = useState(true);
  const [tests, setTests] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('onground');
  const [focus, setFocus] = useState<Chase>('all');
  const [q, setQ] = useState('');
  const [openRow, setOpenRow] = useState<Row_ | null>(null);
  const [settings, setSettings] = useState(false);
  const to = addDays(from, days - 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(days === 1 ? { date: from } : { from, to });
      if (allCountries && country !== 'ALL') qs.set('country', country);
      if (!cancelled) qs.set('cancelled', 'exclude');
      if (!tests) qs.set('test', 'exclude');
      setBoard(await web<Board>(`accounts/report/ops?${qs}`));
      setError(null);
    } catch (e) {
      const m = (e as Error).message;
      setError(/forbidden/i.test(m) ? 'The Ops Board is open to Accounts, the Vietnam ground desk and admins.' : /not available in the app/i.test(m) ? 'The server has not enabled the Ops Board for the app yet. It needs the latest ops.aahaas.com release.' : m);
    } finally { setLoading(false); }
  }, [from, to, days, country, allCountries, cancelled, tests]);
  useEffect(() => { load(); }, [load]);

  const s = board?.summary;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (board?.rows ?? [])
      .filter(r => tab === 'onground' || (tab === 'arrivals' ? r.isArrival : r.isDeparture))
      .filter(r => chase(r, focus))
      .filter(r => !needle || [r.bookingRef, r.leadPassenger, r.agent, r.fileHandler, r.destination].some(v => v?.toLowerCase().includes(needle)))
      .sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || Number(a.ready) - Number(b.ready) || a.arrivalDate.localeCompare(b.arrivalDate));
  }, [board, tab, focus, q]);
  const chaseCount = (k: Chase) => (board?.rows ?? []).filter(r => (tab === 'onground' || (tab === 'arrivals' ? r.isArrival : r.isDeparture)) && chase(r, k)).length;
  const readyPct = s && s.onGround ? s.ready / s.onGround : 0;

  function share() {
    if (!board || !s) return;
    const lines = rows.filter(r => !r.ready && !r.cancelled).map(r => `• ${r.bookingRef} ${r.leadPassenger ?? ''} (D${r.dayNo}/${r.totalDays}) — ${r.outstanding.join(', ') || 'check'}`);
    Share.share({ message: `Ops Board · ${board.label}\nOn ground ${s.onGround} (${s.paxOnGround} pax) · ✈︎ ${s.arrivals} in · ${s.departures} out\nReady ${s.ready}/${s.onGround}${s.reconfirmDelay.unexplained ? ` · ⚠️ ${s.reconfirmDelay.unexplained} D-10 breaches unexplained` : ''}\n\n${lines.length ? `Still to chase:\n${lines.join('\n')}` : 'Every tour is ready ✅'}` });
  }

  const header = (
    <View style={{ padding: S.lg, gap: S.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>Ops Board</Text>
          <Text style={{ color: C.sub, fontSize: 12 }}>{board?.label ?? 'Readiness of every tour'}</Text>
        </View>
        <Row gap={S.sm}>
          <IconButton icon="options" onPress={() => setSettings(true)} />
          <IconButton icon="share-outline" onPress={share} />
        </Row>
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

      <View style={[{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.sm, gap: S.sm }, shadow]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" onPress={() => setFrom(addDays(from, -days))} />
          <Pressable onPress={() => { setFrom(today); setDays(1); }} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>{days === 1 ? fmtDay(from, { weekday: 'long', day: 'numeric', month: 'short' }) : `${fmtDay(from)} – ${fmtDay(to)}`}</Text>
            <Text style={{ color: from === today ? C.green : C.red, fontSize: 12, fontWeight: '700' }}>{from === today && days === 1 ? 'Today' : 'Tap for today'}</Text>
          </Pressable>
          <IconButton icon="chevron-forward" onPress={() => setFrom(addDays(from, days))} />
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[['Today', today, 1], ['Tomorrow', addDays(today, 1), 1], ['Next 3 days', today, 3], ['Next 7 days', today, 7], ['Next 14 days', today, 14], ['Next 30 days', today, 30]].map(([label, f, n]) => {
            const on = from === f && days === n;
            return (
              <Pressable key={String(label)} onPress={() => { setFrom(String(f)); setDays(Number(n)); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: on ? C.ink : C.cardHi }}>
                <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error && <ErrorBox message={error} onRetry={load} />}

      {s && (
        <>
          {/* readiness hero */}
          <View style={[{ backgroundColor: C.ink, borderRadius: R.lg, padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.lg }, shadow]}>
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Ring value={readyPct} color={readyPct >= 0.9 ? '#4ADE80' : readyPct >= 0.6 ? '#FBBF24' : '#FF6B78'} />
              <View style={{ position: 'absolute', alignItems: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '900' }}>{Math.round(readyPct * 100)}%</Text>
                <Text style={{ color: '#FFFFFF99', fontSize: 10, fontWeight: '700' }}>READY</Text>
              </View>
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>{s.ready} of {s.onGround} tours fully ready</Text>
              {([['people', 'On ground', s.onGround, s.paxOnGround], ['airplane', 'Arriving', s.arrivals, s.paxArriving], ['exit', 'Departing', s.departures, s.paxDeparting]] as [IconName, string, number, number][]).map(([icon, k, n, p]) => (
                <Row key={k} gap={6}>
                  <Ionicons name={icon} size={14} color="#FFFFFFB3" />
                  <Text style={{ color: '#FFFFFFCC', fontSize: 13, flex: 1 }}>{k}</Text>
                  <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>{n}</Text>
                  <Text style={{ color: '#FFFFFF80', fontSize: 12, width: 52, textAlign: 'right' }}>{p} pax</Text>
                </Row>
              ))}
            </View>
          </View>

          {/* alerts */}
          {(s.reconfirmDelay.unexplained > 0 || s.cancelPending > 0 || !board!.callDataAvailable || board!.truncated) && (
            <View style={{ gap: 6 }}>
              {s.reconfirmDelay.unexplained > 0 && <Alert_ icon="alarm" color={C.red} text={`${s.reconfirmDelay.unexplained} past D-10 with no reason recorded${s.reconfirmDelay.stale ? ` · ${s.reconfirmDelay.stale} reasons gone stale` : ''}`} onPress={() => setFocus('late')} />}
              {s.cancelPending > 0 && <Alert_ icon="close-circle" color={C.amber} text={`${s.cancelPending} cancellation${s.cancelPending === 1 ? '' : 's'} waiting on Accounts. The work may be called off.`} onPress={() => setFocus('cancel')} />}
              {!board!.callDataAvailable && <Alert_ icon="cloud-offline" color={C.sub} text="Pre-tour call data is unavailable right now. Call signals may be under-counted." />}
              {board!.truncated && <Alert_ icon="warning" color={C.sub} text="The window is too large. Showing a partial board, so narrow the dates." />}
            </View>
          )}

          {/* checks rollup */}
          <View style={[{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg, gap: S.md }, shadow]}>
            <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>READINESS CHECKS</Text>
            {s.checks.map(c => {
              const total = c.done + c.partial + c.pending + c.na || 1;
              return (
                <Pressable key={c.key} onPress={() => setFocus(c.key === 'driver' ? 'driver' : c.key === 'tickets' ? 'tickets' : c.key === 'qc' ? 'qc' : c.key === 'reconfirm' ? 'reconfirm' : 'all')} style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={6}><Ionicons name={CHECK_ICON[c.key] ?? 'checkmark-circle'} size={15} color={C.sub} /><Text style={{ color: C.text, fontWeight: '700' }}>{c.label}</Text></Row>
                    <Text style={{ color: c.pending ? TONE.PENDING.fg : C.green, fontWeight: '800', fontSize: 13 }}>{c.done}/{c.done + c.partial + c.pending}{c.pending ? ` · ${c.pending} open` : ' ✓'}</Text>
                  </Row>
                  <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: C.cardHi }}>
                    {(['done', 'partial', 'pending', 'na'] as const).map(k => (c[k] ? <View key={k} style={{ width: `${(c[k] / total) * 100}%`, backgroundColor: TONE[k.toUpperCase() as State].fg, opacity: k === 'na' ? 0.35 : 1 }} /> : null))}
                  </View>
                </Pressable>
              );
            })}
            <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md }}>
              <Mini n={s.reconfirm.clientConfirmed} label="Client confirmed" color={C.green} />
              <Mini n={s.reconfirm.preTourCalled} label="Pre-tour called" color={C.blue} />
              <Mini n={s.reconfirm.neither} label="Neither" color={s.reconfirm.neither ? C.red : C.dim} />
              <Mini n={s.callApproval.approved ?? 0} label="Call OK'd" color="#7C3AED" />
            </Row>
            {s.byCountry.length > 1 && (
              <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
                {s.byCountry.map(c => <Text key={c.country} style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>{FLAG[c.country] ?? '🌏'} {c.bookings} · {c.pax} pax</Text>)}
              </Row>
            )}
          </View>

          {/* tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.md, padding: 4 }}>
            {([['onground', 'On ground', s.onGround], ['arrivals', 'Arrivals', s.arrivals], ['departures', 'Departures', s.departures]] as [Tab, string, number][]).map(([k, label, n]) => (
              <Pressable key={k} onPress={() => { Haptics.selectionAsync(); setTab(k); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: R.sm + 2, backgroundColor: tab === k ? C.card : 'transparent', ...(tab === k ? shadow : null) }}>
                <Text style={{ color: tab === k ? C.text : C.sub, fontWeight: '800', fontSize: 13 }}>{label} <Text style={{ color: C.dim }}>{n}</Text></Text>
              </Pressable>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingHorizontal: S.lg }} style={{ marginHorizontal: -S.lg }}>
            {CHASES.map(c => {
              const on = focus === c.key;
              const n = chaseCount(c.key);
              if (c.key !== 'all' && !n && !on) return null;
              return (
                <Pressable key={c.key} onPress={() => { Haptics.selectionAsync(); setFocus(c.key); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: on ? C.ink : C.card, borderWidth: 1, borderColor: on ? C.ink : C.line }}>
                  <Ionicons name={c.icon} size={14} color={on ? '#FFFFFF' : c.key === 'all' ? C.sub : C.red} />
                  <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 13 }}>{c.label}</Text>
                  <Text style={{ color: on ? '#FFFFFFAA' : C.dim, fontWeight: '700', fontSize: 12 }}>{n}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md }}>
            <Ionicons name="search" size={18} color={C.sub} />
            <TextInput value={q} onChangeText={setQ} placeholder="Ref, guest, agent, handler…" placeholderTextColor={C.dim} autoCorrect={false} style={{ flex: 1, color: C.text, paddingVertical: 11, fontSize: 15 }} />
            {!!q && <Ionicons name="close-circle" size={18} color={C.dim} onPress={() => setQ('')} />}
          </View>
          <Text style={{ color: C.dim, fontSize: 12 }}>{rows.length} tours{board!.hidden.cancelled || board!.hidden.test ? ` · hidden: ${board!.hidden.cancelled} cancelled, ${board!.hidden.test} test` : ''}</Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={r => r.bookingRef}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && !!board} onRefresh={load} tintColor={C.sub} />}
        renderItem={({ item: r }) => <TourCard r={r} onPress={() => setOpenRow(r)} />}
        ListEmptyComponent={board && !loading ? (
          <View style={{ alignItems: 'center', padding: S.xxl, gap: S.sm }}>
            <Ionicons name={focus === 'all' ? 'calendar-clear-outline' : 'checkmark-circle'} size={44} color={focus === 'all' ? C.dim : C.green} />
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{focus === 'all' ? 'Nobody on the ground' : 'Nothing left to chase'}</Text>
          </View>
        ) : null}
      />

      <Sheet open={!!openRow} onClose={() => setOpenRow(null)} title={openRow ? `${openRow.bookingRef} · ${openRow.leadPassenger ?? ''}` : ''}>
        {openRow && (
          <>
            <Text style={{ color: C.sub, marginTop: -S.sm }}>{openRow.countryLabel} · {openRow.statusLabel} · Day {openRow.dayNo} of {openRow.totalDays} · {openRow.pax} pax</Text>
            <Text style={{ color: C.sub, fontSize: 13 }}>{fmtDay(openRow.arrivalDate.slice(0, 10))} → {fmtDay(openRow.departureDate.slice(0, 10))}{openRow.agent ? ` · ${openRow.agent}` : ''}{openRow.fileHandler ? ` · ${openRow.fileHandler}` : ''}</Text>
            {openRow.outstanding.length > 0 && (
              <View style={{ backgroundColor: C.redSoft, borderRadius: R.md, padding: S.md, gap: 4 }}>
                <Text style={{ color: C.redDeep, fontWeight: '800' }}>Still to do</Text>
                {openRow.outstanding.map(o => <Text key={o} style={{ color: C.text }}>• {o}</Text>)}
              </View>
            )}
            <DetailRow icon="call" title="Reconfirmation" state={reconState(openRow)}
              text={[openRow.clientConfirmed ? 'Client confirmed' : 'Client not confirmed', openRow.preTourCall ? `Pre-tour call ${openRow.preTourCall.outcome || 'logged'} (${openRow.preTourCall.at})` : 'No pre-tour call',
                `D-10 ${openRow.reconfirmStanding.dueAt}${openRow.reconfirmBreached ? ' · BREACHED' : ''}`, openRow.reconfirmDelay ? `Reason: ${openRow.reconfirmDelay.reasonLabel}${openRow.reconfirmDelay.note ? `, ${openRow.reconfirmDelay.note}` : ''}` : openRow.reconfirmBreached ? 'No reason recorded' : null].filter(Boolean).join('\n')} />
            {openRow.preTourCall?.summary ? <Text style={{ color: C.sub, fontSize: 13, fontStyle: 'italic' }}>“{openRow.preTourCall.summary}”</Text> : null}
            <DetailRow icon="chatbubble-ellipses" title="Call permission" state={openRow.call.approval === 'approved' ? 'DONE' : openRow.call.approval === 'pending' ? 'PARTIAL' : openRow.call.approval === 'unknown' ? 'NA' : 'PENDING'}
              text={`${{ approved: 'Guest accepted the call', pending: 'Asked, waiting for the guest', not_requested: 'Not requested yet', unknown: 'Unknown right now' }[openRow.call.approval]}${openRow.call.scheduledAt ? ` · call ${openRow.call.scheduleStatus ?? ''} ${openRow.call.scheduledAt.slice(0, 16).replace('T', ' ')}` : ''}${openRow.call.attempts ? ` · ${openRow.call.attempts} attempts` : ''}`} />
            <DetailRow icon="car" title="Drivers" state={openRow.driver.state} text={openRow.driver.detail} />
            <DetailRow icon="ticket" title="Tickets" state={openRow.tickets.state} text={openRow.tickets.detail} />
            <DetailRow icon="shield-checkmark" title={`QC · ${openRow.qc.stage === 'NONE' ? 'not started' : openRow.qc.stage}`} state={openRow.qc.state} text={openRow.qc.detail} />
            {openRow.cancellation && <DetailRow icon="close-circle" title="Cancellation" state="PENDING" text={`${openRow.cancellation.requestedBy ?? 'Someone'} asked${openRow.cancellation.waitingDays != null ? ` ${openRow.cancellation.waitingDays}d ago` : ''}${openRow.cancellation.reason ? `: ${openRow.cancellation.reason}` : ''}`} />}
            {openRow.testFile && <Text style={{ color: C.dim, fontSize: 12 }}>🧪 Looks like a test (in {openRow.testFile.field}: “{openRow.testFile.snippet}”)</Text>}
            <Button title="Open booking" icon="briefcase" onPress={() => { const ref = openRow.bookingRef; setOpenRow(null); router.push({ pathname: '/booking/[ref]', params: { ref } }); }} />
          </>
        )}
      </Sheet>

      <Sheet open={settings} onClose={() => setSettings(false)} title="Board options">
        <Row gap={S.md}><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '700' }}>Show cancelled files</Text><Text style={{ color: C.sub, fontSize: 12 }}>Listed but never counted</Text></View><Switch value={cancelled} onValueChange={setCancelled} trackColor={{ true: C.red, false: C.line }} /></Row>
        <Row gap={S.md}><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '700' }}>Show test files</Text><Text style={{ color: C.sub, fontSize: 12 }}>Bookings marked “test” in notes or names</Text></View><Switch value={tests} onValueChange={setTests} trackColor={{ true: C.red, false: C.line }} /></Row>
        <Button title="Done" onPress={() => setSettings(false)} />
      </Sheet>
    </SafeAreaView>
  );
}

function TourCard({ r, onPress }: { r: Row_; onPress: () => void }) {
  const accent = r.cancelled ? C.dim : r.ready ? C.green : r.reconfirmBreached ? C.red : C.amber;
  const checks: [IconName, State][] = [['call', reconState(r)], ['car', r.driver.state], ['ticket', r.tickets.state], ['shield-checkmark', r.qc.state]];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, borderLeftWidth: 4, borderLeftColor: accent, padding: S.md, gap: 6, opacity: r.cancelled ? 0.55 : pressed ? 0.85 : 1 }, shadow]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flex: 1 }}>
          <Text style={{ fontSize: 14 }}>{FLAG[r.country] ?? '🌏'}</Text>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>{r.bookingRef}</Text>
          {r.isArrival && <Ionicons name="airplane" size={13} color={C.blue} />}
          {r.isDeparture && <Ionicons name="exit-outline" size={14} color={C.amber} />}
        </Row>
        {r.cancelled ? <Badge text="Cancelled" color={C.red} /> : r.ready ? <Badge text="Ready" color={C.green} icon="checkmark-circle" /> : <Badge text={`${r.outstanding.length} to do`} color={C.amber} />}
      </Row>
      <Text style={{ color: C.text, fontWeight: '700' }} numberOfLines={1}>{r.leadPassenger ?? 'Guest'} <Text style={{ color: C.sub, fontWeight: '500' }}>· {r.pax} pax · Day {r.dayNo}/{r.totalDays}</Text></Text>
      <Text style={{ color: C.sub, fontSize: 12 }} numberOfLines={1}>{r.statusLabel}{r.agent ? ` · ${r.agent}` : ''}{r.fileHandler ? ` · ${r.fileHandler}` : ''}</Text>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        {r.hotelOnly ? <Badge text="Hotel only" color={C.sub} icon="bed" /> : checks.map(([icon, st], i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: TONE[st].bg }}>
            <Ionicons name={icon} size={12} color={TONE[st].fg} />
            <Ionicons name={st === 'DONE' ? 'checkmark' : st === 'NA' ? 'remove' : st === 'PARTIAL' ? 'ellipsis-horizontal' : 'close'} size={11} color={TONE[st].fg} />
          </View>
        ))}
        {r.reconfirmBreached && <Badge text={r.reconfirmDelay ? `D-10 · ${r.reconfirmDelay.reasonLabel}` : 'D-10 breached'} color={C.red} icon="alarm" solid={!r.reconfirmDelay} />}
        {r.cancelPending && <Badge text="Cancel pending" color={C.red} icon="close-circle" />}
        {r.testFile && <Badge text="Test" color={C.sub} icon="flask" />}
      </Row>
    </Pressable>
  );
}

function Badge({ text, color, icon, solid }: { text: string; color: string; icon?: IconName; solid?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: solid ? color : `${color}14` }}>
      {icon && <Ionicons name={icon} size={11} color={solid ? '#FFFFFF' : color} />}
      <Text style={{ color: solid ? '#FFFFFF' : color, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function Mini({ n, label, color }: { n: number; label: string; color: string }) {
  return <View style={{ alignItems: 'center', flex: 1 }}><Text style={{ color, fontSize: 18, fontWeight: '900' }}>{n}</Text><Text style={{ color: C.sub, fontSize: 10, textAlign: 'center' }}>{label}</Text></View>;
}

function Alert_({ icon, color, text, onPress }: { icon: IconName; color: string; text: string; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: `${color}14`, borderRadius: R.md, padding: S.md }}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={{ color: C.text, fontSize: 13, flex: 1, fontWeight: '600' }}>{text}</Text>
      {onPress && <Ionicons name="chevron-forward" size={16} color={color} />}
    </Pressable>
  );
}

function DetailRow({ icon, title, state, text }: { icon: IconName; title: string; state: State; text: string }) {
  return (
    <Row gap={S.md} style={{ alignItems: 'flex-start', paddingVertical: 4 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: TONE[state].bg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={17} color={TONE[state].fg} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }}><Text style={{ color: C.text, fontWeight: '800' }}>{title}</Text><Text style={{ color: TONE[state].fg, fontWeight: '800', fontSize: 12 }}>{TONE[state].label}</Text></Row>
        <Text style={{ color: C.sub, fontSize: 13 }}>{text}</Text>
      </View>
    </Row>
  );
}
