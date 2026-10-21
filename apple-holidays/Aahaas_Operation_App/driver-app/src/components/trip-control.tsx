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
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { currentPosition, flushPoints, LocationError, needsLocationDisclosure, onDayKm, resumeTracking, startTracking, stopTracking, trackingSupportsBackground } from '@/lib/location';
import { C, S } from '@/lib/theme';
import type { DayPlan, Progress } from '@/lib/types';
import { DayDoneCard, LiveDayCard, ReadyCard, type TripHeading } from './live-day';
import { SwipeButton } from './swipe-button';
import { Button, Card, Ionicons, Row } from './ui';

export function TripControl({ bookingRef, progress, isLastDay, onChange, startsLater, dayNo, todayPlan, heading }: {
  bookingRef: string
  progress: Progress
  isLastDay: boolean
  onChange: (p: Progress) => void
  /** trip begins on a later day — nothing to swipe yet */
  startsLater?: boolean
  /** today's day number in the trip and its plan, for the live / ready cards */
  dayNo?: number | null
  todayPlan?: DayPlan | null
  /** shown inside the live card while a day runs (Today screen) */
  heading?: TripHeading
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [liveKm, setLiveKm] = useState<number | null>(null);
  const [mode, setMode] = useState<'background' | 'foreground' | null>(null);

  const running = progress.days.find(d => d.status === 'STARTED');
  const todayDay = progress.days.find(d => d.date === progress.today);
  const session = progress.session;

  // Keep GPS alive across app restarts while a day is running; tick the timer.
  useEffect(() => {
    if (!running) return;
    resumeTracking().then(setMode);
    // The GPS task usually sends points before this timer does, so km comes
    // from whichever send got the server's answer.
    const unsub = onDayKm(setLiveKm);
    const timer = setInterval(() => { flushPoints(); }, 30_000);
    return () => { clearInterval(timer); unsub(); };
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(path: string, body: Record<string, unknown>) {
    const r = await api<{ progress: Progress }>(`/api/mobile/trips/${encodeURIComponent(bookingRef)}/${path}`, { body });
    onChange(r.progress);
    return r.progress;
  }

  /**
   * Prominent disclosure (Google Play policy): said in the app, before the
   * system permission prompt, that location is collected in the background
   * and why. Resolves false if the driver says "Not now".
   */
  function discloseLocation(): Promise<boolean> {
    return new Promise(resolve => {
      Alert.alert(
        'Location while you drive',
        'Aahaas CORE collects location data to count the kilometres you drive and to show operations where your vehicle is, '
        + 'even when the app is closed or not in use (for example with the screen off or Google Maps open).\n\n'
        + 'This happens only between "Start day" and "End day". Tracking stops when you end the day, and a notification is shown while it runs.\n\n'
        + 'On the next screen, please choose "Allow all the time".',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }

  async function startDay() {
    if (await needsLocationDisclosure() && !(await discloseLocation())) return;
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
      <Animated.View entering={FadeInDown.springify().damping(16)}>
        <Card tone="green" style={{ gap: S.sm, alignItems: 'center', paddingVertical: S.xl }}>
          <Image source={require('../../assets/images/illustrations/trip-done.png')} alt="" accessibilityIgnoresInvertColors style={{ width: 150, height: 150 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>{t('completed')}</Text>
          <Text style={{ color: C.sub, textAlign: 'center' }}>{Math.round(session.totalKm)} km driven on this trip. Thank you!</Text>
        </Card>
      </Animated.View>
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
    // Trip total = ended days (server) + today's live km.
    const tripKm = (session?.totalKm ?? 0) - running.km + km;
    return (
      <View style={{ gap: S.md }}>
        <LiveDayCard dayNo={dayNo} startedAt={running.startedAt} km={km} tripKm={tripKm}
          background={mode == null ? null : mode === 'background'} todayPlan={todayPlan} title={bookingRef} heading={heading} />
        <SwipeButton label={t('endDay')} icon="flag" colors={[C.gold, '#B45309']} onComplete={endDay} loading={busy} />
      </View>
    );
  }

  if (todayDay?.status === 'ENDED') {
    if (isLastDay) {
      return (
        <View style={{ gap: S.md }}>
          <DayDoneCard km={todayDay.km} dayNo={dayNo} lastDay />
          <SwipeButton label={t('finishTrip')} icon="star" colors={[C.gold, '#B45309']}
            onComplete={() => router.push({ pathname: '/trip/finish', params: { ref: bookingRef } })} />
        </View>
      );
    }
    return (
      <DayDoneCard km={todayDay.km} dayNo={dayNo} lastDay={false} busy={busy}
        onContinue={() => Alert.alert('Continue today?', 'Kilometres will keep counting on today. Only do this if you ended the day by mistake.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: startDay },
        ])} />
    );
  }

  if (startsLater) return null;
  return (
    <View style={{ gap: S.md }}>
      <ReadyCard dayNo={dayNo} todayPlan={todayPlan} title={dayNo && dayNo > 1 ? 'Ready for another day?' : 'Ready to roll?'} />
      <SwipeButton label={t('startDay')} icon="play" colors={[C.green, '#047857']} onComplete={startDay} loading={busy} />
      {(isLastDay || progress.today > (progress.days[progress.days.length - 1]?.date ?? progress.today)) && (
        <Button title="No driving today — finish trip" kind="ghost" icon="flag-outline"
          onPress={() => router.push({ pathname: '/trip/finish', params: { ref: bookingRef } })} />
      )}
    </View>
  );
}
