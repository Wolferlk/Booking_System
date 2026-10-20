import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { DayPlanView } from '@/components/day-plan';
import { NAVY, PulseDot } from '@/components/live-day';
import { TripControl } from '@/components/trip-control';
import { Button, Card, ErrorBox, IconButton, Ionicons, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { fmtDay, fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Feedback, Links, Progress, Trip } from '@/lib/types';

interface Detail { trip: Trip; progress: Progress; feedback: Feedback; links: Links }

function ProgressBar({ value }: { value: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withDelay(250, withTiming(Math.max(0, Math.min(1, value)), { duration: 900 })); }, [value, w]);
  const st = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, st]}>
        <LinearGradient colors={['#FF5A6A', C.red]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

function HeroChip({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={13} color="#BFDBFE" />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

export default function TripDetail() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const t = useT();
  const { data, setData, error, loading, refreshing, reload } = useLoad<Detail>(`/api/mobile/trips/${encodeURIComponent(ref)}`);
  const [open, setOpen] = useState<string | null>(null);

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (!data) return <Screen><IconButton icon="chevron-back" onPress={() => router.back()} />{error && <ErrorBox message={error} onRetry={reload} />}</Screen>;

  const { trip, progress } = data;
  const today = progress.today;
  const kmByDay = new Map(progress.days.map(d => [d.date, d]));
  const isLastDay = trip.endDate <= today;
  const startsLater = trip.startDate > today;
  const openDay = open ?? (trip.days.find(d => d.date >= today)?.date ?? trip.days[0]?.date);
  const todayPlan = trip.days.find(d => d.date === today) ?? null;
  const done = trip.days.filter(d => kmByDay.get(d.date)?.status === 'ENDED').length;
  const finished = progress.session?.status === 'COMPLETED';
  const share = finished ? 1 : trip.days.length ? done / trip.days.length : 0;
  const first = trip.days[0]?.movements.find(m => m.mine)?.from;
  const lastDay = trip.days[trip.days.length - 1];
  const lastStop = lastDay?.movements.filter(m => m.mine).slice(-1)[0]?.to;

  function requestHandover() {
    router.push({ pathname: '/help', params: { ref, kind: 'HANDOVER' } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={styles.heroBtn}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
            <Pressable onPress={() => router.push({ pathname: '/help', params: { ref } })} style={[styles.heroBtn, { backgroundColor: 'rgba(255,38,56,0.25)' }]}>
              <Ionicons name="alert-circle" size={22} color="#FF8A95" />
            </Pressable>
          </Row>
          <Text style={styles.heroDates}>{fmtRange(trip.startDate, trip.endDate)}</Text>
          <Text style={styles.heroTitle} numberOfLines={1} adjustsFontSizeToFit>{trip.fileNo}</Text>
          <Text style={styles.heroGuest}>{trip.leadGuest ?? 'Guest'} · {trip.pax.adults} adults{trip.pax.children ? ` · ${trip.pax.children} children` : ''}</Text>
          {(first || lastStop) && (
            <View style={styles.routeLine}>
              <View style={[styles.routeDot, { backgroundColor: '#22C55E' }]} />
              <Text style={styles.routeText} numberOfLines={1}>{first ?? '—'}</Text>
              <Ionicons name="arrow-forward" size={14} color="#93C5FD" />
              <Text style={styles.routeText} numberOfLines={1}>{lastStop ?? '—'}</Text>
              <View style={[styles.routeDot, { backgroundColor: C.red }]} />
            </View>
          )}
          <View style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.heroSmall}>{finished ? 'Trip finished' : `Day ${Math.min(done + 1, trip.days.length)} of ${trip.days.length}`}</Text>
              <Text style={styles.heroSmall}>{Math.round(share * 100)}%</Text>
            </Row>
            <ProgressBar value={share} />
          </View>
          <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
            <HeroChip icon="speedometer" text={`${Math.round(progress.session?.totalKm ?? 0)} km`} />
            <HeroChip icon={trip.mode === 'ROUND_TRIP' ? 'repeat' : 'swap-horizontal'} text={trip.mode === 'ROUND_TRIP' ? 'Round trip' : 'Transfers'} />
            {trip.vehicle && <HeroChip icon="car" text={trip.vehicle} />}
            {data.feedback.submitted && <HeroChip icon="star" text="Feedback in" />}
          </Row>
        </LinearGradient>
      </Animated.View>

      {trip.specialNotes && (
        <Animated.View entering={FadeInDown.delay(80)}>
          <Card tone="gold"><Row><Ionicons name="gift" size={18} color={C.gold} /><Text style={{ color: C.text, flex: 1 }}>{trip.specialNotes}</Text></Row></Card>
        </Animated.View>
      )}

      <TripControl bookingRef={trip.bookingRef} progress={progress} isLastDay={isLastDay} startsLater={startsLater}
        dayNo={todayPlan?.dayNo ?? null} todayPlan={todayPlan}
        onChange={p => setData(d => (d ? { ...d, progress: p } : d))} />

      <Label>Day by day</Label>
      <View>
        {trip.days.map((d, i) => {
          const run = kmByDay.get(d.date);
          const isOpen = openDay === d.date;
          const isToday = d.date === today;
          const ended = run?.status === 'ENDED' || (finished && d.date <= today);
          const live = run?.status === 'STARTED';
          const lastRow = i === trip.days.length - 1;
          return (
            <Animated.View key={d.date} entering={FadeInDown.delay(120 + i * 60).springify().damping(18)} layout={LinearTransition.springify()} style={{ flexDirection: 'row', gap: S.md }}>
              {/* timeline rail */}
              <View style={{ alignItems: 'center', width: 30 }}>
                {live ? <View style={{ marginTop: 10 }}><PulseDot color={C.red} size={12} /></View>
                  : (
                    <View style={[styles.node, ended && { backgroundColor: C.green, borderColor: C.green }, isToday && !ended && { borderColor: C.red }]}>
                      {ended ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Text style={[styles.nodeNo, isToday && { color: C.red }]}>{d.dayNo}</Text>}
                    </View>
                  )}
                {!lastRow && <View style={[styles.rail, ended && { backgroundColor: C.green }]} />}
              </View>
              <Card style={{ flex: 1, gap: S.md, marginBottom: S.md, borderColor: isToday ? C.red : C.line, borderWidth: isToday ? 1.5 : 1 }}>
                <Pressable onPress={() => setOpen(isOpen ? '' : d.date)}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: isToday ? C.red : C.gold, fontWeight: '800' }}>{t('day')} {d.dayNo}{isToday ? ` · ${t('today')}` : ''}</Text>
                      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{fmtDay(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
                      {!isOpen && d.movements.find(m => m.mine) && (
                        <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}>
                          {d.movements.filter(m => m.mine).map(m => m.to || m.location).join(' → ')}
                        </Text>
                      )}
                    </View>
                    <Row gap={S.sm}>
                      {run && <Pill text={`${run.km.toFixed(0)} km`} tone={live ? 'green' : 'dim'} />}
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={C.sub} />
                    </Row>
                  </Row>
                </Pressable>
                {isOpen && <Animated.View entering={FadeInDown.duration(220)}><DayPlanView day={d} /></Animated.View>}
              </Card>
            </Animated.View>
          );
        })}
      </View>

      {progress.session?.status === 'ACTIVE' && (
        <Button title={t('cantContinue')} kind="ghost" icon="swap-horizontal" onPress={requestHandover} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 28, padding: 16, gap: 10, overflow: 'hidden' },
  heroBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  heroDates: { color: '#93C5FD', fontWeight: '800', letterSpacing: 0.6, marginTop: 4 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
  heroGuest: { color: '#DBEAFE', fontSize: 15 },
  heroSmall: { color: '#BFDBFE', fontWeight: '700', fontSize: 12 },
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { color: '#fff', fontWeight: '700', flexShrink: 1, fontSize: 13 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  node: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  nodeNo: { color: C.sub, fontWeight: '800', fontSize: 12 },
  rail: { flex: 1, width: 2, backgroundColor: C.line, marginVertical: 2 },
});
