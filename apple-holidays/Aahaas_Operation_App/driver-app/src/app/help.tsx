/**
 * Help — three things a driver may need from ops in a hurry:
 *   HELP             breakdown / accident / guest issue → instant push to ops with GPS
 *   HANDOVER         can't continue the trip → ops arranges another driver
 *   FEEDBACK_WAIVER  guest won't fill the form → ops can let the trip close
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, H1, IconButton, Ionicons, P, Row, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { OPS_PHONE } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { currentPosition } from '@/lib/location';
import { C, R, S } from '@/lib/theme';

const TOPICS: { id: string; label: string; icon: IconName }[] = [
  { id: 'BREAKDOWN', label: 'Vehicle problem', icon: 'construct' },
  { id: 'ACCIDENT', label: 'Accident', icon: 'warning' },
  { id: 'GUEST', label: 'Guest issue', icon: 'person' },
  { id: 'ROUTE', label: 'Road / route', icon: 'map' },
  { id: 'OTHER', label: 'Something else', icon: 'chatbubble-ellipses' },
];

export default function Help() {
  const t = useT();
  const { ref, kind = 'HELP' } = useLocalSearchParams<{ ref?: string; kind?: 'HELP' | 'HANDOVER' | 'FEEDBACK_WAIVER' }>();
  const [topic, setTopic] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      if (kind === 'HELP') {
        const pos = await currentPosition();
        await api('/api/mobile/requests', { body: { kind: 'HELP', topic: topic ?? 'OTHER', reason, lat: pos?.lat, lng: pos?.lng, bookingRef: ref || undefined } });
      } else {
        await api(`/api/mobile/trips/${encodeURIComponent(ref!)}/handover`, { body: { kind, reason } });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Sent to operations', kind === 'HELP' ? 'They have your location and will call you now.' : 'You will get a notification when they answer.');
      router.back();
    } catch (e) {
      Alert.alert('Could not send', `${(e as ApiError).message}\n\nPlease call operations.`);
    } finally {
      setBusy(false);
    }
  }

  const title = kind === 'HANDOVER' ? t('cantContinue') : kind === 'FEEDBACK_WAIVER' ? t('guestWontRate') : t('needHelp');
  const canSend = kind === 'HELP' ? !!topic : reason.trim().length >= 3;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.xl, gap: S.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <H1 style={{ flex: 1 }}>{title}</H1>
        <IconButton icon="close" onPress={() => router.back()} />
      </Row>

      <Pressable onPress={() => Linking.openURL(`tel:${OPS_PHONE}`)}
        style={{ backgroundColor: C.red, borderRadius: R.lg, padding: S.xl, flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
        <Ionicons name="call" size={36} color="#fff" />
        <View>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{t('callOps')}</Text>
          <Text style={{ color: '#fecdd3' }}>{OPS_PHONE}</Text>
        </View>
      </Pressable>

      {kind === 'HELP' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
          {TOPICS.map(x => (
            <Pressable key={x.id} onPress={() => { Haptics.selectionAsync(); setTopic(x.id); }}
              style={{ width: '47%', padding: S.lg, borderRadius: R.md, borderWidth: 2, borderColor: topic === x.id ? C.red : C.line, backgroundColor: topic === x.id ? C.redSoft : C.card, gap: S.sm }}>
              <Ionicons name={x.icon} size={28} color={topic === x.id ? C.red : C.sub} />
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <P>{kind === 'HANDOVER' ? 'Tell operations why. They will arrange another driver and call you.' : 'Tell operations what the guest said. They can let you finish the trip.'}</P>
      )}

      <TextInput value={reason} onChangeText={setReason} placeholder={kind === 'HELP' ? 'Add a few words (optional)' : 'Why?'} placeholderTextColor={C.dim}
        multiline style={{ color: C.text, fontSize: 17, minHeight: 90, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.lg, textAlignVertical: 'top' }} />

      <Button title={kind === 'HELP' ? 'Send help request' : 'Send to operations'} icon="send" onPress={send} loading={busy} disabled={!canSend} />
    </SafeAreaView>
  );
}
