/**
 * One WhatsApp conversation — the same thread as ops.aahaas.com → WhatsApp.
 * Opening it marks the guest's messages read (the web does the same).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Thread, type Bubble } from '@/components/thread';
import { IconButton, Ionicons, Loading, Row } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { STATUS_LABELS } from '@/lib/status';
import { C, S } from '@/lib/theme';
import { openWebFile, web, webAction, webImageSource } from '@/lib/web';

interface Msg { id: string; direction: string; body: string | null; createdAt: string; status: string; senderName: string | null; mediaUrl: string | null; mediaType: string | null }
interface Data { messages: Msg[]; booking: { bookingRef: string; leadName: string | null; status: string } | null; windowOpen: boolean }

/** WhatsApp media lives behind the session (/api/...) or at a public URL. */
const isApi = (u: string) => u.startsWith('/api/');

export default function WaThread() {
  const { phone, name } = useLocalSearchParams<{ phone: string; name?: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [auth, setAuth] = useState<Record<string, string>>({});
  useEffect(() => { webImageSource('whatsapp').then(s => setAuth(s.headers)); }, []);

  const load = useCallback(async () => {
    try { setData(await web<Data>(`whatsapp/messages?phone=${encodeURIComponent(phone)}`)); } catch (e) { if (!data) Alert.alert('Could not load', (e as Error).message); }
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const items: Bubble[] = (data?.messages ?? []).map(m => ({
    id: m.id, mine: m.direction === 'outbound', text: m.body, at: m.createdAt, status: m.status,
    author: m.direction === 'inbound' ? m.senderName : null,
    image: m.mediaUrl && m.mediaType === 'image'
      ? (isApi(m.mediaUrl) ? { uri: `${API_URL}/api/mobile/web/${m.mediaUrl.slice(5)}`, headers: auth } : { uri: m.mediaUrl })
      : null,
    onOpenFile: m.mediaUrl ? () => {
      const u = m.mediaUrl!;
      (isApi(u) ? openWebFile(u.slice(5).split('?')[0], `${m.mediaType ?? 'file'}-${m.id}`) : Linking.openURL(u)).catch(e => Alert.alert('Could not open', (e as Error).message));
    } : null,
    fileLabel: m.mediaType ? `📎 ${m.mediaType}` : null,
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <Row style={{ padding: S.md, gap: S.md, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{name || data?.booking?.leadName || `+${phone}`}</Text>
          <Text style={{ color: C.sub, fontSize: 12 }}>+{phone}</Text>
        </View>
        {data?.booking && (
          <Pressable onPress={() => router.push({ pathname: '/booking/[ref]', params: { ref: data.booking!.bookingRef } })} style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: C.red, fontWeight: '800' }}>{data.booking.bookingRef}</Text>
            <Text style={{ color: C.dim, fontSize: 11 }}>{STATUS_LABELS[data.booking.status] ?? data.booking.status}</Text>
          </Pressable>
        )}
      </Row>
      {!data ? <Loading /> : (
        <Thread items={items} mineColor={C.green} placeholder="WhatsApp message"
          banner={!data.windowOpen ? (
            <Row style={{ backgroundColor: C.goldSoft, padding: S.md, gap: S.sm }}>
              <Ionicons name="time" size={16} color={C.gold} />
              <Text style={{ color: C.text, fontSize: 12, flex: 1 }}>Outside the 24h window — your message goes as the approved re-engagement template.</Text>
            </Row>
          ) : null}
          onSend={async text => {
            try { await webAction('whatsapp/send', { phone, message: text }); await load(); }
            catch (e) { Alert.alert('Not sent', (e as Error).message); throw e; }
          }} />
      )}
    </SafeAreaView>
  );
}
