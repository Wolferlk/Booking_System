import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, H1, Ionicons, Label, Pill, Row, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { LANGS, useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';

function Line({ icon, label, value }: { icon: IconName; label: string; value: string | null | undefined }) {
  return (
    <Row gap={S.md} style={{ paddingVertical: 6 }}>
      <Ionicons name={icon} size={20} color={C.sub} />
      <Text style={{ color: C.sub, width: 92 }}>{label}</Text>
      <Text style={{ color: C.text, flex: 1, fontWeight: '600' }}>{value || '—'}</Text>
    </Row>
  );
}

export default function Me() {
  const t = useT();
  const { actor, signOut, setLanguage, refresh } = useAuth();
  useFocusEffect(useCallback(() => { refresh().catch(() => {}); }, [refresh]));
  if (!actor || actor.kind !== 'DRIVER') return null;
  const photo = actor.photoUrl ? (actor.photoUrl.startsWith('http') ? actor.photoUrl : `${API_URL}${actor.photoUrl}`) : null;
  const vc = actor.vehicleCheck;

  return (
    <Screen>
      <Row gap={S.lg}>
        {photo ? <Image alt="" source={{ uri: photo }} style={{ width: 76, height: 76, borderRadius: 38 }} /> : (
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={36} color={C.sub} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <H1 style={{ fontSize: 22 }}>{actor.name}</H1>
          <Text style={{ color: C.sub }}>{actor.vendor ? `Driver · ${actor.vendor}` : 'Driver'}</Text>
        </View>
      </Row>

      <Card style={{ gap: S.sm }} onPress={() => router.push('/vehicle-check')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>{t('vehiclePhotos')}</Label>
          {vc && <Pill text={vc.due ? 'Due now' : `${vc.daysLeft} days left`} tone={vc.due ? 'red' : 'green'} />}
        </Row>
        <Line icon="car-sport" label="Vehicle" value={actor.vehicle ? `${actor.vehicle.brand ?? ''} ${actor.vehicle.model ?? actor.vehicle.type}`.trim() : null} />
        <Line icon="card" label="Plate" value={actor.vehicle?.plateNo} />
        <Line icon="people" label="Seats" value={actor.vehicle ? String(actor.vehicle.capacity) : null} />
      </Card>

      <Card style={{ gap: S.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>My details</Label>
          <Pressable onPress={() => router.push('/profile-edit')}><Text style={{ color: C.gold, fontWeight: '800' }}>Change</Text></Pressable>
        </Row>
        <Line icon="call" label="Phone" value={actor.phone} />
        <Line icon="mail" label="E-mail" value={actor.email} />
        <Line icon="id-card" label="Licence" value={actor.licenseNo} />
        <Line icon="business" label="Bank" value={actor.bank ? `${actor.bank.bankName ?? ''} ${actor.bank.accountNo ?? ''}`.trim() : null} />
        {!!actor.pendingProfileChanges && <Pill text="Change waiting for operations" tone="gold" icon="hourglass" />}
      </Card>

      <Card style={{ gap: S.sm }}>
        <Label>{t('language')}</Label>
        <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
          {LANGS.map(l => (
            <Pressable key={l.id} onPress={() => setLanguage(l.id).catch(e => Alert.alert('Could not change', e.message))}
              style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: actor.language === l.id ? C.red : C.cardHi }}>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>{l.label}</Text>
            </Pressable>
          ))}
        </Row>
      </Card>

      <Card style={{ gap: S.sm }}>
        <Button title={t('notifications')} kind="secondary" icon="notifications" onPress={() => router.push('/notifications')} />
        <Button title="My requests to operations" kind="secondary" icon="chatbox-ellipses" onPress={() => router.push('/requests')} />
        <Button title={t('help')} kind="secondary" icon="alert-circle" onPress={() => router.push('/help')} />
      </Card>

      <Button title={t('signOut')} kind="ghost" icon="log-out-outline" onPress={() => Alert.alert(t('signOut'), 'Sign out of this phone?', [
        { text: 'Cancel', style: 'cancel' }, { text: t('signOut'), style: 'destructive', onPress: () => { signOut(); router.replace('/welcome'); } },
      ])} />
      <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>Aahaas Driver {APP_VERSION}</Text>
    </Screen>
  );
}
