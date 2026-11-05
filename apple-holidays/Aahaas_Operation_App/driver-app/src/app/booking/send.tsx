/**
 * Send the Tour Confirmation / Full Details PDF to the client on WhatsApp —
 * POST /api/bookings/[ref]/whatsapp, the same route as the web's WhatsApp
 * button (approved template first, free-form only inside the 24h window).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, H1, IconButton, Input, Ionicons, P, Row, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { C, R, S } from '@/lib/theme';
import { webAction } from '@/lib/web';

function message(type: 'confirmation' | 'full', first: string) {
  return type === 'full'
    ? `Dear ${first},\n\nPlease find attached your full tour details and vouchers. We wish you a wonderful trip!\n\nWarm regards,\nAahaas · Apple Holidays`
    : `Dear ${first},\n\nPlease find attached your tour confirmation. Kindly review it and confirm all details are correct.\n\nWarm regards,\nAahaas · Apple Holidays`;
}

export default function SendTc() {
  const p = useLocalSearchParams<{ ref: string; phone?: string; name?: string }>();
  const first = (p.name || 'Guest').split(' ')[0];
  const [to, setTo] = useState(p.phone ?? '');
  const [type, setType] = useState<'confirmation' | 'full'>('confirmation');
  const [format, setFormat] = useState<'pdf' | 'word'>('pdf');
  const [attach, setAttach] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const msg = await webAction(`bookings/${encodeURIComponent(p.ref)}/whatsapp`, {
        to: to.replace(/\D/g, ''), name: p.name || 'Guest', note: note.trim() || undefined,
        message: message(type, first), attachPdf: attach, pdfType: type, fileFormat: format,
      });
      Alert.alert('Sent', msg);
      router.back();
    } catch (e) { Alert.alert('Not sent', (e as ApiError).message); }
    finally { setBusy(false); }
  }

  const chip = (on: boolean, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 12, borderRadius: R.md, alignItems: 'center', backgroundColor: on ? C.red : C.card, borderWidth: 1, borderColor: on ? C.red : C.line }}>
      <Text style={{ color: on ? '#FFFFFF' : C.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <Row><IconButton icon="chevron-back" onPress={() => router.back()} /><H1 style={{ marginLeft: S.sm, fontSize: 24 }}>WhatsApp · {p.ref}</H1></Row>
      <Input icon="logo-whatsapp" placeholder="Client WhatsApp number" keyboardType="phone-pad" value={to} onChangeText={setTo} />
      <Row gap={S.sm}>{chip(type === 'confirmation', 'Tour Confirmation', () => setType('confirmation'))}{chip(type === 'full', 'Full details + vouchers', () => setType('full'))}</Row>
      <Row gap={S.sm}>{chip(attach && format === 'pdf', 'PDF', () => { setAttach(true); setFormat('pdf'); })}{chip(attach && format === 'word', 'Word', () => { setAttach(true); setFormat('word'); })}{chip(!attach, 'No file', () => setAttach(false))}</Row>
      <Card style={{ gap: S.sm }}>
        <Text style={{ color: C.sub, fontSize: 13 }}>Message (approved template; this text is used only inside the 24h window)</Text>
        <Text style={{ color: C.text }}>{message(type, first)}</Text>
      </Card>
      <TextInput value={note} onChangeText={setNote} placeholder="Personal note (optional)" placeholderTextColor={C.dim} multiline
        style={{ color: C.text, minHeight: 80, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.lg, fontSize: 16, textAlignVertical: 'top' }} />
      <Row gap={6}><Ionicons name="information-circle" size={16} color={C.sub} /><P style={{ fontSize: 13, flex: 1 }}>If the number has not written to us in 24 hours, the approved template is used and the message is queued until they reply — same as the web.</P></Row>
      <View style={{ height: S.sm }} />
      <Button title="Send on WhatsApp" icon="send" onPress={send} loading={busy} disabled={to.replace(/\D/g, '').length < 9} />
    </Screen>
  );
}
