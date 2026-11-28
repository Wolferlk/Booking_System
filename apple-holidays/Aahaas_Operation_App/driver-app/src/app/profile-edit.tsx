/**
 * Ask operations to change your details. Nothing changes until a person in
 * operations approves it — your bank account and phone are too important to
 * change from a phone alone.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, H1, IconButton, Input, Ionicons, Label, P, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, S } from '@/lib/theme';
import { takeAndUpload } from '@/lib/upload';

export default function ProfileEdit() {
  const { actor, refresh } = useAuth();
  const [f, setF] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<{ url: string; localUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!actor || actor.kind !== 'DRIVER') return null;
  const set = (k: string) => (v: string) => setF(x => ({ ...x, [k]: v }));

  async function save() {
    const mail = f.email?.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { Alert.alert('E-mail', 'That e-mail address does not look right.'); return; }
    const changes = Object.fromEntries(Object.entries({ ...f, ...(photo ? { photoUrl: photo.url } : {}) }).filter(([, v]) => v.trim()));
    if (!Object.keys(changes).length) return router.back();
    setBusy(true);
    try {
      await api('/api/mobile/me', { method: 'PATCH', body: { changes } });
      await refresh().catch(() => {});
      Alert.alert('Sent to operations', 'Your change will show once operations approve it.');
      router.back();
    } catch (e) {
      Alert.alert('Could not send', (e as ApiError).message);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Row><IconButton icon="chevron-back" onPress={() => router.back()} /><H1 style={{ marginLeft: S.sm }}>Change my details</H1></Row>
      <P>Fill only what changed. Operations check and approve every change.</P>

      <Pressable onPress={async () => { try { const r = await takeAndUpload('profile', 'library'); if (r) setPhoto(r); } catch (e) { Alert.alert('Photo', (e as Error).message); } }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
          {photo ? <Image alt="" source={{ uri: photo.localUri }} style={{ width: 64, height: 64, borderRadius: 32 }} /> : <Ionicons name="camera" size={36} color={C.gold} />}
          <Text style={{ color: C.text, fontWeight: '700' }}>{photo ? 'New photo chosen' : 'New profile photo'}</Text>
        </Card>
      </Pressable>

      <Label>Contact</Label>
      <Field now={actor.phone}>
        <Input icon="call-outline" placeholder="New phone number" keyboardType="phone-pad" value={f.phone ?? ''} onChangeText={set('phone')} />
      </Field>
      <Field now={actor.email}>
        <Input icon="mail-outline" placeholder="New e-mail, e.g. name@gmail.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={f.email ?? ''} onChangeText={set('email')} />
      </Field>
      <Field now={actor.licenseNo}>
        <Input icon="id-card-outline" placeholder="New licence no." autoCapitalize="characters" value={f.licenseNo ?? ''} onChangeText={set('licenseNo')} />
      </Field>

      <Label>Bank account</Label>
      <Input icon="business-outline" placeholder="Bank name" value={f.bankName ?? ''} onChangeText={set('bankName')} />
      <Input icon="git-branch-outline" placeholder="Branch" value={f.bankBranch ?? ''} onChangeText={set('bankBranch')} />
      <Input icon="person-outline" placeholder="Account holder" value={f.bankHolder ?? ''} onChangeText={set('bankHolder')} />
      <Input icon="card-outline" placeholder="Account number" keyboardType="number-pad" value={f.bankAccountNo ?? ''} onChangeText={set('bankAccountNo')} />
      <View style={{ height: S.sm }} />
      <Button title="Send for approval" icon="send" onPress={save} loading={busy} />
    </Screen>
  );
}

/** The value on file, shown above the box — a long one no longer hides inside a grey placeholder. */
function Field({ now, children }: { now: string | null | undefined; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={2}>Now: <Text style={{ color: C.text, fontWeight: '700' }}>{now || '—'}</Text></Text>
      {children}
    </View>
  );
}
