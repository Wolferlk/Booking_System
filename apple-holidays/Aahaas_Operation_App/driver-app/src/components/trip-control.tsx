/**
 * The one control a driver needs on a driving day. It always shows exactly
 * one next step:
 *
 *   not started        → Swipe to start trip   (opens the guest-portal QR first)
 *   started, day off   → Swipe to start day    (asks for location)
 *   day running        → live km + timer, Swipe to end day
 *   last day ended     → Swipe to finish trip  (opens the feedback QR)
 *   day ended          → "See you tomorrow"
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { currentPosition, flushPoints, LocationError, onPoint, resumeTracking, startTracking, stopTracking, trackingSupportsBackground } from '@/lib/location';
import { C, S } from '@/lib/theme';
import type { Progress } from '@/lib/types';
import { SwipeButton } from './swipe-button';
import { Button, Card, Ionicons, Pill, Row } from './ui';

function elapsed(fromIso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function TripControl({ bookingRef, progress, isLastDay, onChange, startsLater }: {
  bookingRef: string
  progress: Progress
  isLastDay: boolean
  onChange: (p: Progress) => void
  /** trip begins on a later day — nothing to swipe yet */
  startsLater?: boolean
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [liveKm, setLiveKm] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [mode, setMode] = useState<'background' | 'foreground' | null>(null);

  const running = progress.days.find(d => d.status === 'STARTED');
  const todayDay = progress.days.find(d => d.date === progress.today);
  const session = progress.session;

  // Keep GPS alive across app restarts while a day is running; tick the timer.
  useEffect(() => {
    if (!running) return;
    resumeTracking().then(setMode);
    const unsub = onPoint(() => {});
    const timer = setInterval(async () => {
      tick(x => x + 1);
      const km = await flushPoints();
      if (km != null) setLiveKm(km);
    }, 30_000);
    return () => { clearInterval(timer); unsub(); };
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(path: string, body: Record<string, unknown>) {
    const r = await api<{ progress: Progress }>(`/api/mobile/trips/${encodeURIComponent(bookingRef)}/${path}`, { body });
    onChange(r.progress);
    return r.progress;
  }

  async function startDay() {
    setBusy(true);
    try {
      const m = await startTracking();
      setMode(m);
      const pos = await currentPosition();
      await act('day', { action: 'start', lat: pos?.lat, lng: pos?.lng });
      setLiveKm(0);
      if (m === 'foreground') {
        Alert.alert('Keep the app open', trackingSupportsBackground
          ? 'Kilometres are counted while the app is open. For counting with the screen off, choose "Allow all the time" for Location in Settings.'
          : 'This test version counts kilometres while the app is open on screen.');
      }
    } catch (e) {
      if (e instanceof LocationError) {
        Alert.alert(t('locationNeeded'), e.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
      } else Alert.alert('Could not start the day', (e as ApiError).message);
      await stopTracking();
    } finally {
      setBusy(false);
    }
  }

  async function endDay() {
    setBusy(true);
    try {
      await flushPoints();
      const pos = await currentPosition();
      const p = await act('day', { action: 'end', lat: pos?.lat, lng: pos?.lng });
      await stopTracking();
      setMode(null);
      const km = p.days.find(d => d.id === running?.id)?.km ?? 0;
      if (isLastDay) router.push({ pathname: '/trip/finish', params: { ref: bookingRef } });
      else Alert.alert('Day finished 👏', `${km.toFixed(1)} km today. Rest well!`);
    } catch (e) {
      Alert.alert('Could not end the day', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (session?.status === 'COMPLETED') {
    return (
      <Card tone="green" style={{ gap: S.sm }}>
        <Row><Ionicons name="checkmark-circle" size={26} color={C.green} /><Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{t('completed')}</Text></Row>
        <Text style={{ color: C.sub }}>{Math.round(session.totalKm)} km driven on this trip. Thank you!</Text>
      </Card>
    );
  }
  if (session?.status === 'HANDED_OVER') {
    return <Card tone="gold"><Text style={{ color: C.text }}>This trip was handed to another driver.</Text></Card>;
  }

  if (!session) {
    if (startsLater) return null;
    return (
      <SwipeButton label={t('startTrip')} icon="car-sport"
        onComplete={() => router.push({ pathname: '/trip/start', params: { ref: bookingRef } })} />
    );
  }

  if (running) {
    const km = liveKm ?? running.km;
    return (
      <View style={{ gap: S.md }}>
        <Card tone="green" style={{ gap: S.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.green }} /><Text style={{ color: C.green, fontWeight: '800' }}>{t('dayRunning')}</Text></Row>
            <Pill text={mode === 'background' ? 'GPS · screen off OK' : 'GPS · keep app open'} tone={mode === 'background' ? 'green' : 'gold'} icon="navigate" />
          </Row>
          <Row style={{ alignItems: 'flex-end', gap: S.lg }}>
            <View>
              <Text style={{ color: C.text, fontSize: 48, fontWeight: '900', lineHeight: 52 }}>{km.toFixed(1)}</Text>
              <Text style={{ color: C.sub }}>{t('kmToday')}</Text>
            </View>
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{elapsed(running.startedAt)}</Text>
              <Text style={{ color: C.sub }}>on the road</Text>
            </View>
          </Row>
          {session && <Text style={{ color: C.sub }}>{Math.round(session.totalKm)} {t('kmTrip')}</Text>}
        </Card>
        <SwipeButton label={t('endDay')} icon="flag" colors={[C.gold, '#B45309']} onComplete={endDay} loading={busy} />
      </View>
    );
  }

  if (todayDay?.status === 'ENDED') {
    if (isLastDay) {
      return (
        <View style={{ gap: S.md }}>
          <Card tone="gold"><Text style={{ color: C.text, fontSize: 16 }}>Last day done — {todayDay.km.toFixed(1)} km. Show the guest the feedback QR to close the trip.</Text></Card>
          <SwipeButton label={t('finishTrip')} icon="star" colors={[C.gold, '#B45309']}
            onComplete={() => router.push({ pathname: '/trip/finish', params: { ref: bookingRef } })} />
        </View>
      );
    }
    return (
      <Card style={{ gap: S.xs }}>
        <Row><Ionicons name="moon" size={20} color={C.gold} /><Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>Day done · {todayDay.km.toFixed(1)} km</Text></Row>
        <Text style={{ color: C.sub }}>See you tomorrow. Started by mistake? Swipe start again to continue counting.</Text>
        <View style={{ marginTop: S.sm }}>
          <SwipeButton label={t('startDay')} onComplete={startDay} loading={busy} colors={[C.cardHi, C.line]} />
        </View>
      </Card>
    );
  }

  if (startsLater) return null;
  return (
    <View style={{ gap: S.md }}>
      <SwipeButton label={t('startDay')} icon="play" colors={[C.green, '#047857']} onComplete={startDay} loading={busy} />
      {(isLastDay || progress.today > (progress.days[progress.days.length - 1]?.date ?? progress.today)) && (
        <Button title="No driving today — finish trip" kind="ghost" icon="flag-outline"
          onPress={() => router.push({ pathname: '/trip/finish', params: { ref: bookingRef } })} />
      )}
    </View>
  );
}
