/**
 * Finish a trip: the guest scans the feedback QR on the driver's phone and
 * rates the trip. The screen checks every few seconds; once the form is in
 * (or ops waived it) the driver swipes to finish.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QrCard } from '@/components/qr-card';
import { SwipeButton } from '@/components/swipe-button';
import { Button, Card, IconButton, Ionicons, Loading, Row } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';

interface Fb { submitted: boolean; waived: boolean; feedbackUrl: string; overall: string | null }

export default function FinishTrip() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const t = useT();
  const [fb, setFb] = useState<Fb | null>(null);
  const [busy, setBusy] = useState(false);
  const notified = useRef(false);
  const base = `/api/mobile/trips/${encodeURIComponent(ref)}`;

  useEffect(() => {
    api(`${base}/feedback`, { body: {} }).catch(() => {});
    let alive = true;
    const poll = async () => {
      try {
        const r = await api<Fb>(`${base}/feedback`);
        if (!alive) return;
        setFb(r);
        if ((r.submitted || r.waived) && !notified.current) {
          notified.current = true;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch { /* keep polling */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [base]);

  async function finish() {
    setBusy(true);
    try {
      await api(`${base}/complete`, { body: {} });
      Alert.alert('Trip finished 🎉', 'Great job! Your kilometres and the guest’s feedback are saved.');
      router.dismissAll?.();
      router.replace('/today');
    } catch (e) {
      Alert.alert('Not yet', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const ok = !!fb && (fb.submitted || fb.waived);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.xl, justifyContent: 'space-between' }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="close" onPress={() => router.back()} />
        <Text style={{ color: C.sub, fontWeight: '700' }}>{t('feedbackTitle')}</Text>
        <View style={{ width: 46 }} />
      </Row>

      {!fb ? <Loading /> : ok ? (
        <View style={{ alignItems: 'center', gap: S.lg }}>
          <Ionicons name="checkmark-circle" size={110} color={C.green} />
          <Text style={{ color: C.text, fontSize: 24, fontWeight: '900', textAlign: 'center' }}>
            {fb.submitted ? t('feedbackReceived') : 'Operations let you finish without feedback.'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: S.lg }}>
          <QrCard value={fb.feedbackUrl} title="Scan to rate your trip ⭐" caption={t('feedbackHint')} />
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, justifyContent: 'center' }}>
            <ActivityIndicator color={C.gold} />
            <Text style={{ color: C.sub }}>{t('waitingFeedback')}</Text>
          </Card>
        </View>
      )}

      <View style={{ gap: S.md }}>
        <SwipeButton label={t('finishTrip')} icon="flag" colors={[C.gold, '#B45309']} onComplete={finish} loading={busy} disabled={!ok} />
        {!ok && (
          <Button title={t('guestWontRate')} kind="ghost" icon="help-circle-outline"
            onPress={() => router.push({ pathname: '/help', params: { ref, kind: 'FEEDBACK_WAIVER' } })} />
        )}
      </View>
    </SafeAreaView>
  );
}
