/**
 * Chats — the WhatsApp inbox (guests, agents, drivers) and the internal team chat.
 *
 * The WhatsApp list is fetched whole and filtered on the phone, so search
 * (name, number or booking ref), the country tabs and the Unread / Needs reply
 * filters are instant. Countries group the way the web inbox does: Singapore
 * and Malaysia are one desk.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBox, H1, Ionicons, Row, type IconName } from '@/components/ui';
import { ago } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/status';
import { C, R, S } from '@/lib/theme';
import { tickFor } from '@/lib/wa';
import { web } from '@/lib/web';

interface WaConv { phone: string; displayName: string | null; snippet: string; direction: string; status?: string; updatedAt: string; unreadCount: number; booking: { bookingRef: string; status: string; operationCountry?: string | null } | null }
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
const FLAG: Record<string, string> = { VIETNAM: '🇻🇳', SRILANKA: '🇱🇰', SINGAPORE_MALAYSIA: '🇸🇬' };
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
  const all = useMemo(() => wa ?? [], [wa]);
  const searched = useMemo(() => all.filter(c => !needle || `${c.phone} ${c.displayName ?? ''} ${c.booking?.bookingRef ?? ''}`.toLowerCase().includes(needle)), [all, needle]);
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
        <TextInput value={q} onChangeText={setQ} placeholder={tab === 'wa' ? 'Name, number or booking ref' : 'Search chats'} placeholderTextColor={C.dim} autoCorrect={false} style={{ flex: 1, color: C.text, paddingVertical: 11, fontSize: 15 }} />
        {q ? <Ionicons name="close-circle" size={18} color={C.dim} onPress={() => setQ('')} /> : null}
      </View>

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
          ListEmptyComponent={wa ? (
            <View style={{ alignItems: 'center', padding: S.xxl, gap: S.sm }}>
              <Ionicons name={needle ? 'search' : 'chatbubbles-outline'} size={40} color={C.dim} />
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{needle ? 'No chats match' : 'All caught up'}</Text>
              <Text style={{ color: C.sub, textAlign: 'center' }}>
                {needle ? `Nothing for “${q.trim()}”${country !== 'ALL' ? ' in this country' : ''}.` : quick === 'reply' ? 'Every guest has had a reply from us.' : quick === 'unread' ? 'No unread messages.' : 'No conversations here yet.'}
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
                    <Text style={{ color: C.text, fontWeight: unread ? '900' : '700', fontSize: 16, flex: 1 }} numberOfLines={1}>{c.displayName || `+${c.phone}`}</Text>
                    <Text style={{ color: unread ? WA_GREEN : C.dim, fontSize: 12, fontWeight: unread ? '800' : '500' }}>{stamp(c.updatedAt)}</Text>
                  </Row>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={3} style={{ flex: 1 }}>
                      {ours && (() => { const t = tickFor(c.status); return <Ionicons name={t.icon} size={15} color={t.color} accessibilityLabel={t.label} />; })()}
                      <Text style={{ color: unread ? C.text : C.sub, fontWeight: unread ? '600' : '400', flex: 1, fontSize: 14 }} numberOfLines={1}>{plain(c.snippet) || ' '}</Text>
                    </Row>
                    {unread && <View style={{ backgroundColor: WA_GREEN, borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{c.unreadCount}</Text></View>}
                  </Row>
                  <Row gap={6}>
                    {c.booking ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: cancel ? C.redSoft : C.cardHi, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 }}>
                        <Text style={{ color: C.red, fontSize: 11, fontWeight: '800' }}>{c.booking.bookingRef}</Text>
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
