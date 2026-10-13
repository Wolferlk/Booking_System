/** Chats — the WhatsApp inbox (guests, agents, drivers) and the internal team chat. */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBox, H1, Ionicons, Row } from '@/components/ui';
import { ago } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/status';
import { C, R, S } from '@/lib/theme';
import { web } from '@/lib/web';

interface WaConv { phone: string; displayName: string | null; snippet: string; direction: string; updatedAt: string; unreadCount: number; booking: { bookingRef: string; status: string } | null }
interface TeamConv { id: number; title: string; type: string; emoji: string | null; accent: string; unread: number; is_pinned: boolean; last_message: { preview: string | null; at: string | null }; peer: { name: string; initials: string; is_online: boolean } | null; member_count: number }

function Avatar({ text, color, online }: { text: string; color: string; online?: boolean }) {
  return (
    <View>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontWeight: '900', fontSize: 16 }}>{text}</Text>
      </View>
      {online && <View style={{ position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: C.green, borderWidth: 2, borderColor: '#FFFFFF' }} />}
    </View>
  );
}

export default function Chats() {
  const params = useLocalSearchParams<{ tab?: 'wa' | 'team' }>();
  const [tab, setTab] = useState<'wa' | 'team'>(params.tab ?? 'wa');
  const [q, setQ] = useState('');
  const [wa, setWa] = useState<WaConv[]>([]);
  const [team, setTeam] = useState<TeamConv[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'wa') setWa(await web<WaConv[]>(`whatsapp/conversations${q.trim() ? `?search=${encodeURIComponent(q.trim())}` : ''}`));
      else setTeam((await web<{ conversations: TeamConv[] }>('chat/conversations')).conversations);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [tab, q]);

  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]));

  const teamRows = team.filter(t => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || String(b.last_message.at).localeCompare(String(a.last_message.at)));
  const waUnread = wa.reduce((s, c) => s + c.unreadCount, 0);
  const teamUnread = team.reduce((s, c) => s + c.unread, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ padding: S.lg, gap: S.md }}>
        <H1>Chats</H1>
        <Row gap={S.sm}>
          {([['wa', 'WhatsApp', 'logo-whatsapp', waUnread], ['team', 'Team chat', 'people', teamUnread]] as const).map(([k, label, icon, n]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingVertical: 11, borderRadius: R.md, backgroundColor: tab === k ? C.ink : C.card, borderWidth: 1, borderColor: tab === k ? C.ink : C.line }}>
              <Ionicons name={icon} size={17} color={tab === k ? '#FFFFFF' : C.text} />
              <Text style={{ color: tab === k ? '#FFFFFF' : C.text, fontWeight: '800' }}>{label}</Text>
              {n > 0 && <View style={{ backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{n}</Text></View>}
            </Pressable>
          ))}
        </Row>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg }}>
          <Ionicons name="search" size={18} color={C.sub} />
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder={tab === 'wa' ? 'Name, number or booking' : 'Search chats'} placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 12, fontSize: 15 }} />
        </View>
      </View>
      {error && <View style={{ paddingHorizontal: S.lg }}><ErrorBox message={error} onRetry={load} /></View>}
      {tab === 'wa' ? (
        <FlatList data={wa} keyExtractor={c => c.phone} contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.sub} />}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: c.phone, name: c.displayName ?? '' } })}
              style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: pressed ? C.cardHi : 'transparent', alignItems: 'center' })}>
              <Avatar text={(c.displayName || c.phone).slice(0, 2).toUpperCase()} color={C.green} />
              <View style={{ flex: 1, gap: 2, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: S.md }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: c.unreadCount ? '900' : '700', flex: 1 }} numberOfLines={1}>{c.displayName || `+${c.phone}`}</Text>
                  <Text style={{ color: c.unreadCount ? C.green : C.dim, fontSize: 12 }}>{ago(c.updatedAt)}</Text>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.sub, flex: 1 }} numberOfLines={1}>{c.direction === 'outbound' ? '✓ ' : ''}{c.snippet}</Text>
                  {c.unreadCount > 0 && <View style={{ backgroundColor: C.green, borderRadius: 10, minWidth: 20, alignItems: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{c.unreadCount}</Text></View>}
                </Row>
                {c.booking && <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>{c.booking.bookingRef} · {STATUS_LABELS[c.booking.status] ?? c.booking.status}</Text>}
              </View>
            </Pressable>
          )} />
      ) : (
        <FlatList data={teamRows} keyExtractor={c => String(c.id)} contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.sub} />}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/chat/[id]', params: { id: String(c.id), title: c.title } })}
              style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: pressed ? C.cardHi : 'transparent', alignItems: 'center' })}>
              <Avatar text={c.emoji || c.peer?.initials || c.title.slice(0, 2).toUpperCase()} color={c.accent || C.blue} online={c.peer?.is_online} />
              <View style={{ flex: 1, gap: 2, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: S.md }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: c.unread ? '900' : '700', flex: 1 }} numberOfLines={1}>{c.is_pinned ? '📌 ' : ''}{c.title}</Text>
                  <Text style={{ color: c.unread ? C.red : C.dim, fontSize: 12 }}>{ago(c.last_message.at)}</Text>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.sub, flex: 1 }} numberOfLines={1}>{c.last_message.preview ?? (c.type === 'group' ? `${c.member_count} members` : '')}</Text>
                  {c.unread > 0 && <View style={{ backgroundColor: C.red, borderRadius: 10, minWidth: 20, alignItems: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{c.unread}</Text></View>}
                </Row>
              </View>
            </Pressable>
          )} />
      )}
    </SafeAreaView>
  );
}
