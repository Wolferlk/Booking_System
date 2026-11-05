/**
 * Vehicle photo renewal (every 60 days). Big photo tiles the driver taps to
 * shoot; an AI first look comes back right after sending.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, ErrorBox, H1, IconButton, Input, Ionicons, Label, Loading, P, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDay } from '@/lib/format';
import { C, R, S } from '@/lib/theme';
import { takeAndUpload } from '@/lib/upload';

const SLOT_LABEL: Record<string, string> = { front: 'Front', back: 'Back', left: 'Left side', right: 'Right side', inside: 'Inside (seats)', odometer: 'Odometer' };

interface State {
  state: { due: boolean; daysLeft: number; lastAt: string | null; lastStatus: string | null; rejectedNote: string | null }
  history: { id: string; status: string; createdAt: string; aiReview: { verdict: string; summary: string } | null; reviewNote: string | null }[]
  vehicle: { type: string; plateNo: string } | null
  slots: string[]
  required: string[]
}
interface Ai { verdict: 'LOOKS_GOOD' | 'CHECK' | 'RETAKE'; summary: string; issues: string[] }

export default function VehicleCheck() {
  const { refresh } = useAuth();
  const { data, error, loading, reload } = useLoad<State>('/api/mobile/vehicle-check');
  const [photos, setPhotos] = useState<Record<string, { url: string; localUri: string }>>({});
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [odo, setOdo] = useState('');
  const [sending, setSending] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);

  async function shoot(slot: string) {
    setBusySlot(slot);
    try {
      const r = await takeAndUpload(slot === 'odometer' ? 'odometer' : 'vehicle');
      if (r) setPhotos(p => ({ ...p, [slot]: r }));
    } catch (e) {
      Alert.alert('Photo not saved', (e as Error).message);
    } finally { setBusySlot(null); }
  }

  async function submit() {
    setSending(true);
    try {
      const r = await api<{ aiReview: Ai | null }>('/api/mobile/vehicle-check', {
        body: { photos: Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, v.url])), odometer: odo ? Number(odo.replace(/\D/g, '')) : undefined },
      });
      setAi(r.aiReview);
      setPhotos({});
      refresh().catch(() => {});
      reload();
      if (!r.aiReview) Alert.alert('Sent ✅', 'Operations will review your photos.');
    } catch (e) {
      Alert.alert('Could not send', (e as ApiError).message);
    } finally { setSending(false); }
  }

  if (loading && !data) return <Screen><Loading /></Screen>;
  const missing = (data?.required ?? []).filter(s => !photos[s]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        {data?.vehicle && <Pill text={`${data.vehicle.type} · ${data.vehicle.plateNo}`} icon="car" />}
      </Row>
      <H1>Vehicle photos</H1>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <Card tone={data.state.due ? 'gold' : 'green'}>
          <Text style={{ color: C.text, fontSize: 16 }}>
            {data.state.rejectedNote ? `Operations asked you to retake: ${data.state.rejectedNote}`
              : data.state.due ? 'Your vehicle photos are due. Park in good light and take each photo below.'
              : `All good — next photos in ${data.state.daysLeft} days.`}
          </Text>
        </Card>
      )}

      {ai && (
        <Card tone={ai.verdict === 'LOOKS_GOOD' ? 'green' : ai.verdict === 'RETAKE' ? 'red' : 'gold'} style={{ gap: S.sm }}>
          <Row><Ionicons name="sparkles" size={18} color={C.text} /><Text style={{ color: C.text, fontWeight: '800' }}>
            {ai.verdict === 'LOOKS_GOOD' ? 'Looks good — sent to operations' : ai.verdict === 'RETAKE' ? 'Some photos may need a retake' : 'Sent — operations will check'}
          </Text></Row>
          <Text style={{ color: C.text }}>{ai.summary}</Text>
          {ai.issues.map((i, n) => <Text key={n} style={{ color: C.sub }}>• {i}</Text>)}
        </Card>
      )}

      {data && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
          {data.slots.map(slot => {
            const p = photos[slot];
            const req = data.required.includes(slot);
            return (
              <Pressable key={slot} onPress={() => shoot(slot)} style={{ width: '47%', aspectRatio: 1.2, borderRadius: R.md, borderWidth: 2, borderStyle: p ? 'solid' : 'dashed', borderColor: p ? C.green : req ? C.gold : C.line, backgroundColor: C.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {p ? <Image alt="" source={{ uri: p.localUri }} style={{ position: 'absolute', inset: 0 } as never} contentFit="cover" /> : null}
                {busySlot === slot ? <Loading /> : (
                  <View style={{ alignItems: 'center', gap: 4, backgroundColor: p ? 'rgba(255,255,255,0.85)' : 'transparent', padding: 8, borderRadius: 10 }}>
                    <Ionicons name={p ? 'checkmark-circle' : 'camera'} size={30} color={p ? C.green : req ? C.gold : C.sub} />
                    <Text style={{ color: C.text, fontWeight: '800' }}>{SLOT_LABEL[slot] ?? slot}</Text>
                    {!p && <Text style={{ color: C.dim, fontSize: 12 }}>{req ? 'needed' : 'optional'}</Text>}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <Input icon="speedometer-outline" placeholder="Odometer reading (km) — optional" value={odo} onChangeText={setOdo} keyboardType="number-pad" />
      <Button title={missing.length ? `Add ${missing.map(m => SLOT_LABEL[m].toLowerCase()).join(', ')}` : 'Send photos'} icon="cloud-upload"
        onPress={submit} loading={sending} disabled={missing.length > 0} />

      {data && data.history.length > 0 && (
        <>
          <Label>Previous checks</Label>
          {data.history.map(h => (
            <Card key={h.id} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontWeight: '700' }}>{fmtDay(h.createdAt.slice(0, 10))}</Text>
                <Pill text={h.status === 'SUBMITTED' ? 'Waiting' : h.status === 'APPROVED' ? 'Approved' : 'Retake'} tone={h.status === 'APPROVED' ? 'green' : h.status === 'REJECTED' ? 'red' : 'gold'} />
              </Row>
              {h.reviewNote && <P>{h.reviewNote}</P>}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
