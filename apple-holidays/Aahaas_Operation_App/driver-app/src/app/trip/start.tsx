/**
 * Start a trip: 1) show the guest their trip-portal QR (skippable),
 * 2) swipe to start. The first day then starts from the trip screen.
 */
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QrCard } from '@/components/qr-card';
import { SwipeButton } from '@/components/swipe-button';
import { Button, IconButton, Loading, Row } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Links, Trip } from '@/lib/types';

export default function StartTrip() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const t = useT();
  const { data } = useLoad<{ trip: Trip; links: Links }>(`/api/mobile/trips/${encodeURIComponent(ref)}`);
  const [step, setStep] = useState<'portal' | 'go'>('portal');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start(skipped: boolean) {
    setBusy(true);
    try {
      await api(`/api/mobile/trips/${encodeURIComponent(ref)}/start`, { body: { portalShown: shown && !skipped, portalSkipped: skipped } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Alert.alert('Could not start', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.xl, justifyContent: 'space-between' }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="close" onPress={() => router.back()} />
        <Text style={{ color: C.sub, fontWeight: '700' }}>{step === 'portal' ? '1 / 2' : '2 / 2'}</Text>
      </Row>

      {!data ? <Loading /> : step === 'portal' ? (
        <View style={{ gap: S.xl }}>
          <QrCard value={data.links.portalUrl} title={t('showPortal')} caption={t('portalHint')} />
          <Text style={{ color: C.dim, textAlign: 'center' }}>{data.trip.leadGuest ?? ''} · {data.trip.fileNo}</Text>
        </View>
      ) : (
        <View style={{ gap: S.md, alignItems: 'center' }}>
          <Text style={{ fontSize: 64 }}>🚗</Text>
          <Text style={{ color: C.text, fontSize: 26, fontWeight: '900', textAlign: 'center' }}>Ready to roll?</Text>
          <Text style={{ color: C.sub, fontSize: 16, textAlign: 'center' }}>
            Starting the trip tells operations you have met the guest. Then swipe “Start day” and drive safely.
          </Text>
        </View>
      )}

      {step === 'portal' ? (
        <Row gap={S.md}>
          <Button title={t('skip')} kind="ghost" style={{ flex: 1 }} onPress={() => { setShown(false); setStep('go'); }} />
          <Button title={t('done')} icon="checkmark" style={{ flex: 2 }} onPress={() => { setShown(true); setStep('go'); }} />
        </Row>
      ) : (
        <SwipeButton label={t('startTrip')} icon="car-sport" onComplete={() => start(!shown)} loading={busy} />
      )}
    </SafeAreaView>
  );
}
