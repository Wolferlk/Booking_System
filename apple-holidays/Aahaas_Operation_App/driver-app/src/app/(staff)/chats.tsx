/**
 * Chats — the WhatsApp inbox (guests, agents, drivers) and the internal team chat.
 *
 * The WhatsApp list is fetched whole and filtered on the phone, so search
 * (name, number, IS number or booking ref), the country tabs and the Unread /
 * Needs reply filters are instant. A moment after typing stops, the server
 * search (lib/whatsapp-inbox-search on the web) takes over: it also finds chats
 * by guest name and message text, says why each one matched, and lists matching
 * files nobody has messaged yet so a chat can be started from them.
 * Countries group the way the web inbox does: Singapore and Malaysia are one desk.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBox, H1, Ionicons, Row, type IconName } from '@/components/ui';
import { ago } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/status';
import { C, R, S } from '@/lib/theme';
import { tickFor } from '@/lib/wa';
import { web } from '@/lib/web';

type MatchField = 'isNumber' | 'bookingRef' | 'cntl' | 'guest' | 'deal' | 'name' | 'phone' | 'message';
interface Match { field: MatchField; text: string }
interface WaConv { phone: string; displayName: string | null; snippet: string; direction: string; status?: string; updatedAt: string; unreadCount: number; booking: { bookingRef: string; isNumber?: string | null; leadName?: string | null; status: string; operationCountry?: string | null } | null; match?: Match | null }
interface FileHit { bookingRef: string; isNumber: string | null; leadName: string | null; status: string; operationCountry: string | null; match: Match; numbers: { phone: string; label: string; hasChat: boolean }[] }
interface TeamConv { id: number; title: string; type: string; emoji: string | null; accent: string; unread: number; is_pinned: boolean; last_message: { preview: string | null; at: string | null }; peer: { name: string; initials: string; is_online: boolean } | null; member_count: number }

type Country = 'ALL' | 'VIETNAM' | 'SRILANKA' | 'SINGAPORE_MALAYSIA' | 'NONE';
type Quick = 'all' | 'unread' | 'reply';

const COUNTRIES: { key: Country; label: string; flag: string }[] = [
  { key: 'ALL', label: 'All', flag: '🌏' },
  { key: 'VIETNAM', label: 'Vietnam', flag: '🇻🇳' },
  { key: 'SRILANKA', label: 'Sri Lanka', flag: '🇱🇰' },
  { key: 'SINGAPORE_MALAYSIA', label: 'SG / MY', flag: '🇸🇬' },
  { key: 'NONE', label: 'No booking', flag: '🔗' },
];
const FLAG: Record<string, string> = { VIETNAM: '🇻🇳', SRILANKA: '🇱🇰', SINGAPORE_MALAYSIA: '🇸🇬', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾' };
/** File-number prefixes offered as one-tap searches. */
const PREFIXES = [['VN', '🇻🇳'], ['IS', '🇱🇰'], ['SG', '🇸🇬'], ['MY', '🇲🇾']] as const;
const MATCH: Record<MatchField, { label: string; icon: IconName; fg: string; bg: string }> = {
  isNumber: { label: 'IS no.', icon: 'pricetag', fg: '#047857', bg: '#D1FAE5' },
  bookingRef: { label: 'Ref', icon: 'document-text', fg: C.blue, bg: C.blueSoft },
  cntl: { label: 'CNTL', icon: 'document-text', fg: C.blue, bg: C.blueSoft },
  guest: { label: 'Guest', icon: 'person', fg: '#6D28D9', bg: '#EDE9FE' },
  deal: { label: 'Deal', icon: 'briefcase', fg: C.amber, bg: C.goldSoft },
  name: { label: 'Name', icon: 'person', fg: C.sub, bg: C.cardHi },
  phone: { label: 'Number', icon: 'call', fg: C.sub, bg: C.cardHi },
  message: { label: 'Message', icon: 'chatbubble-ellipses', fg: C.gold, bg: C.goldSoft },
};
const PREF = 'chats.waFilter';
const WA_GREEN = '#00A884';
const AVATARS = ['#00A884', '#2563EB', '#7C3AED', '#E11D48', '#D97706', '#0891B2', '#DB2777', '#4F46E5'];

/** Same grouping as the web inbox (lib/country-detection): SG + MY are one desk. */
function countryOf(c: WaConv): Country {
  const oc = c.booking?.operationCountry;
  if (!c.booking) return 'NONE';
  if (oc === 'VIETNAM' || oc === 'SRILANKA') return oc;
  if (oc === 'SINGAPORE' || oc === 'MALAYSIA' || oc === 'SINGAPORE_MALAYSIA') return 'SINGAPORE_MALAYSIA';
  return 'NONE';
}

const color = (seed: string) => AVATARS[[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % AVATARS.length];
const initials = (name: string | null, phone: string) => {
  const n = (name ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
  return n ? n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : phone.slice(-2);
};
/** "*AppleHolidays* — _hi_" → "AppleHolidays — hi" for a one-line preview. */
const plain = (s: string) => s.replace(/([*_~])([^*_~\n]+)\1/g, '$2').replace(/\s+/g, ' ').trim();

/** "VN 12345" and "vn12345" are the same file number. */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** [from, to) of the query inside text — exact first, then ignoring spaces and dashes. */
function findLoose(text: string, query: string): [number, number] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const at = text.toLowerCase().indexOf(q);
  if (at >= 0) return [at, at + q.length];
  const cq = compact(q);
  if (!cq) return null;
  let flat = '';
  const index: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) { flat += ch; index.push(i); }
  }
  const k = flat.indexOf(cq);
  return k < 0 ? null : [index[k], index[k + cq.length - 1] + 1];
}

/** Text with the searched part marked yellow — nest inside a <Text>. */
function Hl({ text, q }: { text: string; q: string }) {
  const r = findLoose(text, q);
  if (!r) return <>{text}</>;
  return <>{text.slice(0, r[0])}<Text style={{ backgroundColor: '#FDE68A', color: C.text }}>{text.slice(r[0], r[1])}</Text>{text.slice(r[1])}</>;
}

/** The title and booking chip already highlight these — only spell out the rest. */
function showMatchLine(c: WaConv) {
  const m = c.match;
  if (!m || m.field === 'name') return false;
  if (m.field === 'phone') return !!c.displayName;
  if (m.field === 'isNumber') return c.booking?.isNumber !== m.text;
  if (m.field === 'bookingRef') return c.booking?.bookingRef !== m.text;
  return true;
}

function stamp(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function section(iso: string) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : days < 31 ? 'This month' : 'Earlier';
}

function waiting(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${Math.max(1, m)}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

function Avatar({ text, color: c, online, badge }: { text: string; color: string; online?: boolean; badge?: string }) {
  return (
    <View>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 17 }}>{text}</Text>
      </View>
      {online && <View style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: C.green, borderWidth: 2, borderColor: '#FFFFFF' }} />}
      {badge && <View style={{ position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }}><Text style={{ fontSize: 12 }}>{badge}</Text></View>}
    </View>
  );
}

export default function Chats() {
  const params = useLocalSearchParams<{ tab?: 'wa' | 'team' }>();
  const [tab, setTab] = useState<'wa' | 'team'>(params.tab ?? 'wa');
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [srv, setSrv] = useState<{ q: string; convs: WaConv[]; files: FileHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [country, setCountry] = useState<Country>('ALL');
  const [quick, setQuick] = useState<Quick>('all');
  const [wa, setWa] = useState<WaConv[] | null>(null);
  const [team, setTeam] = useState<TeamConv[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);
  useEffect(() => {
    AsyncStorage.getItem(PREF).then(raw => {
      const p = raw ? JSON.parse(raw) as { country?: Country; quick?: Quick } : {};
      if (p.country) setCountry(p.country);
      if (p.quick) setQuick(p.quick);
    }).catch(() => {});
  }, []);
  useEffect(() => { AsyncStorage.setItem(PREF, JSON.stringify({ country, quick })).catch(() => {}); }, [country, quick]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'wa') setWa(await web<WaConv[]>('whatsapp/conversations'));
      else setTeam((await web<{ conversations: TeamConv[] }>('chat/conversations')).conversations);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]));

  const needle = q.trim().toLowerCase();

  // Server search once typing pauses — finds guest names and message text too.
  useEffect(() => {
    if (tab !== 'wa' || needle.length < 2) { setSrv(null); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const enc = encodeURIComponent(needle);
        const [convs, files] = await Promise.all([
          web<WaConv[]>(`whatsapp/conversations?search=${enc}`),
          web<FileHit[]>(`whatsapp/lookup?q=${enc}`).catch(() => [] as FileHit[]),
        ]);
        if (live) setSrv({ q: needle, convs, files });
      } catch { /* the instant local results stay up */ }
      finally { if (live) setSearching(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [needle, tab]);

  const all = useMemo(() => wa ?? [], [wa]);
  const searched = useMemo(() => {
    if (!needle) return all;
    if (srv?.q === needle) return srv.convs;
    const cn = compact(needle);
    return all.filter(c => `${c.phone} ${c.displayName ?? ''} ${c.booking?.bookingRef ?? ''} ${c.booking?.leadName ?? ''}`.toLowerCase().includes(needle)
      || (!!cn && !!c.booking?.isNumber && compact(c.booking.isNumber).includes(cn)));
  }, [all, needle, srv]);
  // Matching files with a number that isn't already a chat in the results.
  const files = useMemo(() => {
    if (!needle || srv?.q !== needle) return [];
    const listed = new Set(srv.convs.map(c => c.phone));
    return srv.files
      .map(f => ({ ...f, numbers: f.numbers.filter(n => !listed.has(n.phone)) }))
      .filter(f => f.numbers.length > 0);
  }, [needle, srv]);
  const countryCount = useMemo(() => {
    const n: Record<Country, { total: number; unread: number }> = { ALL: { total: 0, unread: 0 }, VIETNAM: { total: 0, unread: 0 }, SRILANKA: { total: 0, unread: 0 }, SINGAPORE_MALAYSIA: { total: 0, unread: 0 }, NONE: { total: 0, unread: 0 } };
    for (const c of searched) for (const k of ['ALL', countryOf(c)] as Country[]) { n[k].total += 1; n[k].unread += c.unreadCount ? 1 : 0; }
    return n;
  }, [searched]);
  const inCountry = searched.filter(c => country === 'ALL' || countryOf(c) === country);
  const shown = inCountry.filter(c => quick === 'all' || (quick === 'unread' ? c.unreadCount > 0 : c.direction === 'inbound'));
  const sections = useMemo(() => {
    const out: { title: string; data: WaConv[] }[] = [];
    for (const c of shown) {
      const t = section(c.updatedAt);
      if (out[out.length - 1]?.title !== t) out.push({ title: t, data: [] });
      out[out.length - 1].data.push(c);
    }
    return out;
  }, [shown]);

  const teamRows = team.filter(t => !needle || t.title.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || String(b.last_message.at).localeCompare(String(a.last_message.at)));
  const waUnread = all.reduce((s, c) => s + c.unreadCount, 0);
  const teamUnread = team.reduce((s, c) => s + c.unread, 0);
  const needReply = inCountry.filter(c => c.direction === 'inbound').length;
  const todayCount = inCountry.filter(c => section(c.updatedAt) === 'Today').length;

  const pick = (fn: () => void) => { Haptics.selectionAsync(); fn(); };

  const header = (
    <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, gap: S.md, backgroundColor: C.bg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <H1>Chats</H1>
          <Text style={{ color: C.sub, fontSize: 13 }}>
            {tab === 'wa'
              ? wa ? `${waUnread ? `${waUnread} unread · ` : ''}${needReply} waiting on us · ${todayCount} today` : 'Loading inbox…'
              : `${teamRows.length} conversations${teamUnread ? ` · ${teamUnread} unread` : ''}`}
          </Text>
        </View>
      </Row>

      <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.md, padding: 4 }}>
        {([['wa', 'WhatsApp', 'logo-whatsapp', waUnread], ['team', 'Team chat', 'people', teamUnread]] as const).map(([k, label, icon, n]) => (
          <Pressable key={k} onPress={() => pick(() => setTab(k))} style={{ flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingVertical: 10, borderRadius: R.sm + 2, backgroundColor: tab === k ? C.card : 'transparent', shadowColor: '#0E1525', shadowOpacity: tab === k ? 0.08 : 0, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: tab === k ? 1 : 0 }}>
            <Ionicons name={icon} size={17} color={tab === k ? (k === 'wa' ? WA_GREEN : C.blue) : C.sub} />
            <Text style={{ color: tab === k ? C.text : C.sub, fontWeight: '800' }}>{label}</Text>
            {n > 0 && <View style={{ backgroundColor: k === 'wa' ? WA_GREEN : C.red, borderRadius: 10, paddingHorizontal: 6, minWidth: 20, alignItems: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{n > 99 ? '99+' : n}</Text></View>}
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md }}>
        <Ionicons name="search" size={18} color={C.sub} />
        <TextInput value={q} onChangeText={setQ} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={tab === 'wa' ? 'IS number, ref, guest, phone or message' : 'Search chats'} placeholderTextColor={C.dim}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={{ flex: 1, color: C.text, paddingVertical: 11, fontSize: 15 }} />
        {searching ? <ActivityIndicator size="small" color={WA_GREEN} /> : null}
        {q ? <Ionicons name="close-circle" size={18} color={C.dim} onPress={() => setQ('')} /> : null}
      </View>

      {tab === 'wa' && focused && !q && (
        <Row gap={S.sm} style={{ flexWrap: 'wrap', marginTop: -S.xs }}>
          <Text style={{ color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>FILES</Text>
          {PREFIXES.map(([p, flag]) => (
            <Pressable key={p} onPress={() => pick(() => setQ(p))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
              <Text style={{ fontSize: 13 }}>{flag}</Text>
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] }}>{p}…</Text>
            </Pressable>
          ))}
          <Text style={{ color: C.dim, fontSize: 12, width: '100%' }}>Try VN12345, a booking ref, the guest&apos;s name, a phone number or words from a message.</Text>
        </Row>
      )}

      {tab === 'wa' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingHorizontal: S.lg }} style={{ marginHorizontal: -S.lg }}>
            {COUNTRIES.map(c => {
              const on = country === c.key;
              const n = countryCount[c.key];
              return (
                <Pressable key={c.key} onPress={() => pick(() => setCountry(c.key))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: on ? C.ink : C.card, borderWidth: 1, borderColor: on ? C.ink : C.line }}>
                  <Text style={{ fontSize: 15 }}>{c.flag}</Text>
                  <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700', fontSize: 13 }}>{c.label}</Text>
                  <Text style={{ color: on ? '#FFFFFFAA' : C.dim, fontWeight: '700', fontSize: 12 }}>{n.total}</Text>
                  {n.unread > 0 && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: WA_GREEN }} />}
                </Pressable>
              );
            })}
          </ScrollView>
          <Row gap={S.lg}>
            {([['all', 'All chats', 'chatbubbles-outline'], ['unread', 'Unread', 'mail-unread-outline'], ['reply', 'Needs reply', 'arrow-undo-outline']] as [Quick, string, IconName][]).map(([k, label, icon]) => (
              <Pressable key={k} onPress={() => pick(() => setQuick(k))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, borderBottomWidth: 2, borderBottomColor: quick === k ? WA_GREEN : 'transparent' }}>
                <Ionicons name={icon} size={15} color={quick === k ? WA_GREEN : C.sub} />
                <Text style={{ color: quick === k ? C.text : C.sub, fontWeight: quick === k ? '800' : '600', fontSize: 13 }}>{label}</Text>
              </Pressable>
            ))}
          </Row>
        </>
      )}
      {error && <ErrorBox message={error} onRetry={load} />}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {header}
      {tab === 'wa' ? (
        <SectionList
          sections={sections}
          keyExtractor={c => c.phone}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={loading && !!wa} onRefresh={load} tintColor={C.sub} />}
          renderSectionHeader={({ section: s }) => (
            <Text style={{ backgroundColor: C.bg, color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: 6 }}>{s.title}</Text>
          )}
          ListFooterComponent={files.length ? (
            <View style={{ paddingHorizontal: S.lg, paddingTop: S.lg, gap: S.sm }}>
              <Row gap={6}>
                <Ionicons name="folder-open-outline" size={14} color={C.dim} />
                <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' }}>Matching files · no chat here yet</Text>
              </Row>
              {files.map(f => (
                <View key={f.bookingRef} style={{ backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', padding: S.md, gap: 6 }}>
                  <Row gap={6}>
                    <Text style={{ fontSize: 14 }}>{FLAG[f.operationCountry ?? ''] ?? '🔗'}</Text>
                    {f.isNumber ? <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}><Hl text={f.isNumber} q={needle} /></Text> : null}
                    <Text style={{ color: C.red, fontWeight: '800', fontSize: 12, flex: 1 }} numberOfLines={1}><Hl text={f.bookingRef} q={needle} /></Text>
                    <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700' }}>{STATUS_LABELS[f.status] ?? f.status}</Text>
                  </Row>
                  {f.leadName ? <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}><Hl text={f.leadName} q={needle} /></Text> : null}
                  {f.numbers.map(n => (
                    <Pressable key={n.phone} onPress={() => pick(() => router.push({ pathname: '/wa/[phone]', params: { phone: n.phone, name: f.leadName ?? '' } }))}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 8, paddingHorizontal: S.sm, borderRadius: R.sm, backgroundColor: pressed ? C.cardHi : C.bg })}>
                      <Ionicons name="call-outline" size={14} color={C.sub} />
                      <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>+{n.phone}</Text>
                      <Text style={{ color: C.dim, fontSize: 12, flex: 1 }} numberOfLines={1}>{n.label}</Text>
                      <View style={{ backgroundColor: n.hasChat ? C.blueSoft : C.greenSoft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Text style={{ color: n.hasChat ? C.blue : WA_GREEN, fontWeight: '800', fontSize: 12 }}>{n.hasChat ? 'Open chat' : 'Start chat'}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          ListEmptyComponent={wa && !files.length ? (
            <View style={{ alignItems: 'center', padding: S.xxl, gap: S.sm }}>
              <Ionicons name={needle ? 'search' : 'chatbubbles-outline'} size={40} color={C.dim} />
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{needle ? 'No chats match' : 'All caught up'}</Text>
              <Text style={{ color: C.sub, textAlign: 'center' }}>
                {needle ? `Nothing for “${q.trim()}”${country !== 'ALL' ? ' in this country' : ''}. Try an IS number, booking ref, guest name or message text.` : quick === 'reply' ? 'Every guest has had a reply from us.' : quick === 'unread' ? 'No unread messages.' : 'No conversations here yet.'}
              </Text>
              {(country !== 'ALL' || quick !== 'all') && (
                <Pressable onPress={() => { setCountry('ALL'); setQuick('all'); }}><Text style={{ color: WA_GREEN, fontWeight: '800', marginTop: S.sm }}>Show all chats</Text></Pressable>
              )}
            </View>
          ) : null}
          renderItem={({ item: c }) => {
            const unread = c.unreadCount > 0;
            const ours = c.direction === 'outbound';
            const cancel = c.booking?.status.includes('CANCEL');
            const flag = FLAG[countryOf(c)];
            return (
              <Pressable onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: c.phone, name: c.displayName ?? '' } })}
                style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: pressed ? C.cardHi : C.card, alignItems: 'center' })}>
                <Avatar text={initials(c.displayName, c.phone)} color={color(c.phone)} badge={country === 'ALL' ? flag : undefined} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ color: C.text, fontWeight: unread ? '900' : '700', fontSize: 16, flex: 1 }} numberOfLines={1}><Hl text={c.displayName || `+${c.phone}`} q={needle} /></Text>
                    <Text style={{ color: unread ? WA_GREEN : C.dim, fontSize: 12, fontWeight: unread ? '800' : '500' }}>{stamp(c.updatedAt)}</Text>
                  </Row>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={3} style={{ flex: 1 }}>
                      {ours && (() => { const t = tickFor(c.status); return <Ionicons name={t.icon} size={15} color={t.color} accessibilityLabel={t.label} />; })()}
                      <Text style={{ color: unread ? C.text : C.sub, fontWeight: unread ? '600' : '400', flex: 1, fontSize: 14 }} numberOfLines={1}>{plain(c.snippet) || ' '}</Text>
                    </Row>
                    {unread && <View style={{ backgroundColor: WA_GREEN, borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{c.unreadCount}</Text></View>}
                  </Row>
                  {c.match && showMatchLine(c) && (() => {
                    const m = MATCH[c.match.field];
                    return (
                      <Row gap={6}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: m.bg, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Ionicons name={m.icon} size={10} color={m.fg} />
                          <Text style={{ color: m.fg, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }}>{m.label}</Text>
                        </View>
                        <Text style={{ color: C.text, fontSize: 12, flex: 1, fontStyle: c.match.field === 'message' ? 'italic' : 'normal', fontWeight: c.match.field === 'message' ? '400' : '700' }} numberOfLines={1}>
                          <Hl text={c.match.text} q={needle} />
                        </Text>
                      </Row>
                    );
                  })()}
                  <Row gap={6}>
                    {c.booking ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: cancel ? C.redSoft : C.cardHi, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 }}>
                        {c.booking.isNumber ? <Text style={{ color: '#047857', fontSize: 11, fontWeight: '900' }}><Hl text={c.booking.isNumber} q={needle} /></Text> : null}
                        <Text style={{ color: C.red, fontSize: 11, fontWeight: '800' }}><Hl text={c.booking.bookingRef} q={needle} /></Text>
                        <Text style={{ color: cancel ? C.red : C.sub, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{STATUS_LABELS[c.booking.status] ?? c.booking.status}</Text>
                      </View>
                    ) : (
                      <Text style={{ color: C.dim, fontSize: 11, fontWeight: '600' }}>{c.displayName ? `+${c.phone} · ` : ''}No linked booking</Text>
                    )}
                    {!ours && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.goldSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Ionicons name="arrow-undo" size={10} color={C.gold} />
                        <Text style={{ color: C.gold, fontSize: 11, fontWeight: '700' }}>Waiting {waiting(c.updatedAt)}</Text>
                      </View>
                    )}
                  </Row>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.line, marginLeft: 82 }} />}
        />
      ) : (
        <FlatList data={teamRows} keyExtractor={c => String(c.id)} contentContainerStyle={{ paddingBottom: 120, paddingTop: S.sm }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.sub} />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.line, marginLeft: 82 }} />}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/chat/[id]', params: { id: String(c.id), title: c.title } })}
              style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: pressed ? C.cardHi : C.card, alignItems: 'center' })}>
              <Avatar text={c.emoji || c.peer?.initials || c.title.slice(0, 2).toUpperCase()} color={c.accent || C.blue} online={c.peer?.is_online} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: c.unread ? '900' : '700', fontSize: 16, flex: 1 }} numberOfLines={1}>{c.is_pinned ? '📌 ' : ''}{c.title}</Text>
                  <Text style={{ color: c.unread ? C.red : C.dim, fontSize: 12 }}>{ago(c.last_message.at)}</Text>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.sub, flex: 1 }} numberOfLines={1}>{c.last_message.preview ?? (c.type === 'group' ? `${c.member_count} members` : '')}</Text>
                  {c.unread > 0 && <View style={{ backgroundColor: C.red, borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{c.unread}</Text></View>}
                </Row>
              </View>
            </Pressable>
          )} />
      )}
    </SafeAreaView>
  );
}
