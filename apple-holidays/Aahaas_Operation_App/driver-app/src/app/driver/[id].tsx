/** One driver — profile, vehicle, bank, performance (same scorecard as the web), WhatsApp. */
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScoreRing } from '@/components/score-ring';
import { Button, Card, ErrorBox, IconButton, Ionicons, Label, Loading, P, Pill, Row, Stat } from '@/components/ui';
import { ago } from '@/lib/format';
import { FLAG } from '@/lib/status';
import { C, R, S } from '@/lib/theme';
import { imgUrl, web, webAction } from '@/lib/web';

type D = Record<string, any>;

function waNumber(phone: string, country: string | null) {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = (country === 'VIETNAM' ? '84' : country?.startsWith('SINGAPORE') ? '65' : '94') + d.slice(1);
  return d;
}

export default function DriverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<D | null>(null);
  const [perf, setPerf] = useState<D | null>(null);
  const [msgs, setMsgs] = useState<D[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    web<D>(`ground/drivers/${id}`).then(setD).catch(e => setError(e.message));
    web<D>(`ground/analytics/partner?kind=driver&id=${id}`).then(r => setPerf(r.analytics)).catch(() => {});
    web<D[]>(`ground/drivers/${id}/whatsapp`).then(setMsgs).catch(() => {});
  }, [id]);

  async function send() {
    setSending(true);
    try {
      await webAction(`ground/drivers/${id}/whatsapp`, { message: text.trim() });
      setText('');
      setMsgs(await web<D[]>(`ground/drivers/${id}/whatsapp`));
    } catch (e) { Alert.alert('Not sent', (e as Error).message); }
    finally { setSending(false); }
  }

  if (!d) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.lg, gap: S.lg }}><IconButton icon="chevron-back" onPress={() => router.back()} />{error ? <ErrorBox message={error} /> : <Loading />}</SafeAreaView>;
  const v = d.vehicle;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <Card style={{ alignItems: 'center', gap: S.sm }}>
          {imgUrl(d.photoUrl) ? <Image alt="" source={{ uri: imgUrl(d.photoUrl)! }} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Ionicons name="person-circle" size={96} color={C.dim} />}
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', textAlign: 'center' }}>{d.name}</Text>
          <Row gap={S.sm}><Pill text={d.isActive ? 'Active' : 'Inactive'} tone={d.isActive ? 'green' : 'dim'} /><Text>{FLAG[d.country] ?? ''}</Text></Row>
          <Row gap={S.md}>
            <Button title="Call" icon="call" kind="secondary" onPress={() => Linking.openURL(`tel:${d.phone}`)} style={{ minHeight: 46 }} />
            <Button title="WhatsApp" icon="logo-whatsapp" onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: waNumber(d.phone, d.country), name: d.name } })} style={{ minHeight: 46 }} />
          </Row>
        </Card>

        {perf && (
          <Card style={{ alignItems: 'center', gap: S.md }}>
            <ScoreRing score={perf.score} grade={perf.grade} size={140} />
            <Row gap={S.md}>
              <Stat value={perf.toursDone ?? 0} label="tours" icon="flag" />
              <Stat value={perf.trips ?? 0} label="movements" icon="car" />
              <Stat value={perf.rating != null ? Number(perf.rating).toFixed(1) : '—'} label="rating" icon="star" color={C.gold} />
            </Row>
            <Text style={{ color: C.sub, fontSize: 13 }}>Last trip {perf.lastTrip ? String(perf.lastTrip).slice(0, 10) : '—'} · Next {perf.nextTrip ? String(perf.nextTrip).slice(0, 10) : '—'}</Text>
          </Card>
        )}

        {v && (
          <Card style={{ gap: S.sm }}>
            <Label>Vehicle</Label>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{v.plateNo} · {[v.brand, v.model].filter(Boolean).join(' ') || v.type} · {v.capacity} seats</Text>
            {v.vendor?.name && <Text style={{ color: C.sub }}>Vendor: {v.vendor.name}</Text>}
            <Row gap={S.sm}>
              {[v.photoOutside, v.photoInside].filter(Boolean).map((u: string) => <Image key={u} alt="" source={{ uri: imgUrl(u)! }} style={{ flex: 1, height: 110, borderRadius: R.sm }} contentFit="cover" />)}
            </Row>
          </Card>
        )}

        <Card style={{ gap: 4 }}>
          <Label>Details</Label>
          <Text style={{ color: C.text }}>📞 {d.phone}</Text>
          {d.email && <Text style={{ color: C.text }}>✉️ {d.email}</Text>}
          {d.licenseNo && <Text style={{ color: C.text }}>🪪 {d.licenseNo}</Text>}
          {(d.bankName || d.bankAccountNo) && <Text style={{ color: C.text }}>🏦 {d.bankName} · {d.bankAccountNo} · {d.bankHolder}</Text>}
        </Card>

        <Card style={{ gap: S.sm }}>
          <Label>WhatsApp to driver</Label>
          {msgs.slice(0, 5).map(m => (
            <View key={m.id} style={{ backgroundColor: C.greenSoft, borderRadius: R.sm, padding: S.md }}>
              <Text style={{ color: C.text, fontSize: 13 }} numberOfLines={4}>{m.body}</Text>
              <Text style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{m.bookingRef} · {ago(m.createdAt)}</Text>
            </View>
          ))}
          {msgs.length === 0 && <P>No messages yet.</P>}
          <TextInput value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={C.dim} multiline
            style={{ color: C.text, minHeight: 70, backgroundColor: C.cardHi, borderRadius: R.md, padding: S.md, fontSize: 15, textAlignVertical: 'top' }} />
          <Button title="Send" icon="send" onPress={send} loading={sending} disabled={!text.trim()} />
          <Text style={{ color: C.dim, fontSize: 11 }}>Plain messages reach the driver only if they wrote to us in the last 24h.</Text>
        </Card>
        <P dim>Editing driver details stays on ops.aahaas.com.</P>
      </ScrollView>
    </SafeAreaView>
  );
}
