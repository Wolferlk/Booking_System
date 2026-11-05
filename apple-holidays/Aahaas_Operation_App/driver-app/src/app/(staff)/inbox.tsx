/** Ops view: approve / decline driver requests and vehicle photo checks. */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorBox, H1, Ionicons, Label, Loading, P, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ago } from '@/lib/format';
import { C, R, S } from '@/lib/theme';

interface Req { id: string; kind: string; driverName: string | null; driverPhone: string | null; bookingRef: string | null; reason: string | null; createdAt: string; payload: Record<string, unknown> | null }
interface Check { id: string; driverName: string; createdAt: string; photos: Record<string, string>; vehicle: { plateNo: string; type: string } | null; aiReview: { verdict: string; summary: string } | null }
const KIND: Record<string, { label: string; tone: 'red' | 'gold' | 'blue' | 'dim' }> = {
  HELP: { label: 'HELP', tone: 'red' }, HANDOVER: { label: 'Driver change', tone: 'gold' },
  PROFILE_CHANGE: { label: 'Profile change', tone: 'blue' }, FEEDBACK_WAIVER: { label: 'Feedback waiver', tone: 'dim' },
};

export default function Inbox() {
  const { data, error, loading, refreshing, reload, silent } = useLoad<{ requests: Req[]; vehicleChecks: Check[] }>('/api/mobile/staff/requests');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(path: 'requests' | 'vehicle-checks', id: string, decision: 'APPROVED' | 'REJECTED') {
    setBusy(id);
    try {
      await api(`/api/mobile/staff/${path}/${id}`, { method: 'PATCH', body: { decision, note: notes[id] || undefined } });
      silent();
    } catch (e) { Alert.alert('Not saved', (e as ApiError).message); }
    finally { setBusy(null); }
  }

  if (loading && !data) return <Screen><Loading /></Screen>;
  const empty = data && !data.requests.length && !data.vehicleChecks.length;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <H1>Requests</H1>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {empty && <P>All clear — nothing waiting. 🎉</P>}
      {data?.requests.map(r => {
        const k = KIND[r.kind] ?? { label: r.kind, tone: 'dim' as const };
        const p = r.payload ?? {};
        return (
          <Card key={r.id} tone={r.kind === 'HELP' ? 'red' : undefined} style={{ gap: S.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Pill text={k.label} tone={k.tone} />
              <Text style={{ color: C.dim, fontSize: 12 }}>{ago(r.createdAt)}</Text>
            </Row>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{r.driverName}{r.bookingRef ? ` · ${r.bookingRef}` : ''}</Text>
            {r.reason && <Text style={{ color: C.text }}>“{r.reason}”</Text>}
            {r.kind === 'PROFILE_CHANGE' && Object.entries(p).map(([key, v]) => <Text key={key} style={{ color: C.sub }}>{key}: <Text style={{ color: C.text }}>{String(v)}</Text></Text>)}
            <Row gap={S.lg}>
              {r.driverPhone && <Row gap={4}><Ionicons name="call" size={18} color={C.green} /><Text style={{ color: C.green, fontWeight: '700' }} onPress={() => Linking.openURL(`tel:${r.driverPhone}`)}>Call</Text></Row>}
              {typeof p.map === 'string' && <Row gap={4}><Ionicons name="location" size={18} color={C.blue} /><Text style={{ color: C.blue, fontWeight: '700' }} onPress={() => Linking.openURL(String(p.map))}>Location</Text></Row>}
            </Row>
            <TextInput placeholder="Note to the driver (optional)" placeholderTextColor={C.dim} value={notes[r.id] ?? ''} onChangeText={v => setNotes(n => ({ ...n, [r.id]: v }))}
              style={{ color: C.text, backgroundColor: C.cardHi, borderRadius: R.sm, padding: S.md }} />
            <Row gap={S.sm}>
              <Button title={r.kind === 'HELP' ? 'Handled' : 'Approve'} icon="checkmark" style={{ flex: 1 }} loading={busy === r.id} onPress={() => decide('requests', r.id, 'APPROVED')} />
              {r.kind !== 'HELP' && <Button title="Decline" kind="secondary" style={{ flex: 1 }} disabled={busy === r.id} onPress={() => decide('requests', r.id, 'REJECTED')} />}
            </Row>
          </Card>
        );
      })}

      {!!data?.vehicleChecks.length && <Label>Vehicle photos</Label>}
      {data?.vehicleChecks.map(c => (
        <Card key={c.id} style={{ gap: S.sm }}>
          <Text style={{ color: C.text, fontWeight: '800' }}>{c.driverName}{c.vehicle ? ` · ${c.vehicle.plateNo}` : ''}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row gap={S.sm}>
              {Object.entries(c.photos).map(([slot, url]) => (
                <View key={slot} style={{ alignItems: 'center' }}>
                  <Image alt="" source={{ uri: `${API_URL}${url}` }} style={{ width: 120, height: 90, borderRadius: 8 }} contentFit="cover" />
                  <Text style={{ color: C.dim, fontSize: 11 }}>{slot}</Text>
                </View>
              ))}
            </Row>
          </ScrollView>
          {c.aiReview && <Text style={{ color: c.aiReview.verdict === 'LOOKS_GOOD' ? C.green : C.amber }}>AI: {c.aiReview.summary}</Text>}
          <TextInput placeholder="What to retake (needed to decline)" placeholderTextColor={C.dim} value={notes[c.id] ?? ''} onChangeText={v => setNotes(n => ({ ...n, [c.id]: v }))}
            style={{ color: C.text, backgroundColor: C.cardHi, borderRadius: R.sm, padding: S.md }} />
          <Row gap={S.sm}>
            <Button title="Approve" icon="checkmark" style={{ flex: 1 }} loading={busy === c.id} onPress={() => decide('vehicle-checks', c.id, 'APPROVED')} />
            <Button title="Retake" kind="secondary" style={{ flex: 1 }} disabled={busy === c.id || !notes[c.id]?.trim()} onPress={() => decide('vehicle-checks', c.id, 'REJECTED')} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
