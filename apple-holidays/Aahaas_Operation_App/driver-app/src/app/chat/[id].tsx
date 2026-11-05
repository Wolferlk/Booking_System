/** Internal team chat thread — the same conversations as ops.aahaas.com → Chat. */
import { useAuth } from '@/lib/auth';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Thread, type Bubble } from '@/components/thread';
import { IconButton, Loading, Row } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { C, S } from '@/lib/theme';

const API_URL_BRIDGE = `${API_URL}/api/mobile/web/`;
import { openWebFile, web, webImageSource } from '@/lib/web';

interface Msg {
  id: number | null; kind: string; body: string | null; created_at: string | null; deleted: boolean; client_uuid: string | null
  sender: { system: string; user_ref: string; name: string }
  card: { label: string; ref: string } | null
  attachments: { url?: string; name?: string; mime?: string }[]
}

export default function TeamThread() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { actor } = useAuth();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [auth, setAuth] = useState<Record<string, string>>({});
  useEffect(() => { webImageSource('chat').then(s => setAuth(s.headers)); }, []);
  const last = useRef<number>(0);

  const load = useCallback(async (initial = false) => {
    try {
      const qs = initial || !last.current ? 'limit=60' : `after=${last.current}`;
      const r = await web<{ messages: Msg[] }>(`chat/conversations/${id}/messages?${qs}`);
      const rows = r.messages ?? [];
      if (rows.length) {
        last.current = Math.max(last.current, ...rows.map(m => m.id ?? 0));
        setMsgs(prev => {
          const map = new Map((initial ? [] : prev ?? []).map(m => [m.id ?? m.client_uuid, m]));
          rows.forEach(m => map.set(m.id ?? m.client_uuid, m));
          return Array.from(map.values()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        });
        web(`chat/conversations/${id}/read`, { body: { up_to: last.current } }).catch(() => {});
      } else if (initial) setMsgs([]);
    } catch (e) { if (initial) Alert.alert('Could not load', (e as Error).message); }
  }, [id]);

  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [load]);

  const me = actor?.id;
  const items: Bubble[] = (msgs ?? []).filter(m => m.kind !== 'system' || m.body).map(m => {
    const att = m.attachments?.[0];
    const path = att?.url ? att.url.replace(/^\/api\//, '') : null;
    const isImg = !!att?.mime?.startsWith('image/');
    return {
      id: String(m.id ?? m.client_uuid),
      mine: m.sender.system === 'ops' && m.sender.user_ref === me,
      text: m.deleted ? 'Message deleted' : m.card ? `📇 ${m.card.label} · ${m.card.ref}${m.body ? `\n${m.body}` : ''}` : m.body,
      at: m.created_at,
      author: m.sender.name,
      image: path && isImg ? { uri: `${API_URL_BRIDGE}${path}`, headers: auth } : null,
      onOpenFile: path ? () => { openWebFile(path, att?.name ?? 'attachment').catch(e => Alert.alert('Could not open', (e as Error).message)); } : null,
      fileLabel: att?.name ?? null,
    };
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <Row style={{ padding: S.md, gap: S.md, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{title ?? 'Chat'}</Text></View>
      </Row>
      {!msgs ? <Loading /> : (
        <Thread items={items} placeholder="Message the team"
          onSend={async text => {
            const uuid = `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            try {
              await web(`chat/conversations/${id}/messages`, { body: { body: text, kind: 'text', client_uuid: uuid } });
              await load(false);
            } catch (e) { Alert.alert('Not sent', (e as Error).message); throw e; }
          }} />
      )}
    </SafeAreaView>
  );
}
