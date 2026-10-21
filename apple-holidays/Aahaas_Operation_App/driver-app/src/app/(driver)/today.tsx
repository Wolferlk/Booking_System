import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { AiBrief } from '@/components/ai-brief';
import { DayPlanView } from '@/components/day-plan';
import { NAVY } from '@/components/live-day';
import { TodayHero } from '@/components/today-hero';
import { TripControl } from '@/components/trip-control';
import { ErrorBox, Ionicons, Loading, Row, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useAuth } from '@/lib/auth';
import { firstName, fmtDay, fmtRange, greetingKey, routeOf } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Home } from '@/lib/types';

/** Camera that gives a little wiggle now and then — "this needs you". */
function WiggleIcon({ name, color }: { name: IconName; color: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withSequence(
      withDelay(2400, withTiming(-12, { duration: 90 })), withTiming(12, { duration: 120 }),
      withTiming(-8, { duration: 100 }), withTiming(0, { duration: 90 }),
    ), -1, false);
  }, [r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={st}><Ionicons name={name} size={24} color={color} /></Animated.View>;
}

function Tile({ value, label, icon, colors, accent, delay }: { value: string | number; label: string; icon: IconName; colors: [string, string]; accent: string; delay: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(16)} style={{ flex: 1 }}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <View style={styles.tileIcon}><Ionicons name={icon} size={16} color={accent} /></View>
        <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={styles.tileLabel}>{label}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

function daysUntil(ymd: string) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${ymd}T00:00:00`).getTime() - a.getTime()) / 86_400_000);
}

export default function Today() {
  const t = useT();
  const { actor } = useAuth();
  const { data, setData, error, loading, refreshing, reload } = useLoad<Home>('/api/mobile/home');

  if (loading && !data) return <Screen><Loading /></Screen>;
  const name = firstName(data?.name ?? actor?.name ?? '');
  const cur = data?.current;
  const photo = actor?.kind === 'DRIVER' ? actor.photoUrl : null;
  const nextIn = data?.next ? daysUntil(data.next.startDate) : null;
  // While a day runs the live card carries the trip — no separate trip card.
  const running = !!cur?.progress.days.some(d => d.status === 'STARTED');
  const openCur = () => cur && router.push({ pathname: '/trip/[ref]', params: { ref: cur.trip.bookingRef } });
  const vehicleDue = (data?.alerts.vehicleCheck?.due && (
        <Animated.View entering={FadeInDown.delay(60).springify().damping(16)}>
          <Pressable onPress={() => router.push('/vehicle-check')} style={({ pressed }) => [styles.todo, pressed && { transform: [{ scale: 0.98 }] }]}>
            <LinearGradient colors={['#FFB547', '#F59E0B']} style={styles.todoIcon}>
              <WiggleIcon name="camera" color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.todoTitle}>{t('vehicleDue')}</Text>
              <Text style={styles.todoSub} numberOfLines={2}>{data.alerts.vehicleCheck.rejectedNote ? `Ops asked: ${data.alerts.vehicleCheck.rejectedNote}` : t('vehicleDueHint')}</Text>
            </View>
            <View style={styles.todoChip}><Text style={styles.todoChipText}>2 min</Text></View>
          </Pressable>
        </Animated.View>
      ));

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TodayHero
        greeting={t(greetingKey())}
        name={name}
        photoUrl={photo}
        unread={data?.alerts.unread}
        onBell={() => router.push('/notifications')}
        onHelp={() => router.push({ pathname: '/help', params: { ref: cur?.trip.bookingRef ?? '' } })}
      />

      {error && !data && <ErrorBox message={error} onRetry={reload} />}

      {!running && vehicleDue}

      {cur ? (
        <>
          {!running && <Animated.View entering={FadeInDown.delay(100).springify().damping(18)}>
            <Pressable onPress={openCur}
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
              <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 16, gap: 10 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={styles.dayChip}>
                    <Text style={styles.dayChipText}>
                      {cur.dayIndex ? `${t('day').toUpperCase()} ${cur.dayIndex} ${t('of')} ${cur.dayCount}` : fmtRange(cur.trip.startDate, cur.trip.endDate)}
                    </Text>
                  </View>
                  <View style={styles.openTrip}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Open trip</Text><Ionicons name="chevron-forward" size={14} color="#fff" /></View>
                </Row>
                <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{cur.trip.leadGuest ?? 'Guest'}</Text>
                <Row gap={S.lg}>
                  <Row gap={6}><Ionicons name="people" size={16} color="#BFDBFE" /><Text style={{ color: '#fff', fontSize: 15 }}>{cur.trip.pax.adults + cur.trip.pax.children} {t('pax')}</Text></Row>
                  <Row gap={6}><Ionicons name="document-text" size={16} color="#BFDBFE" /><Text style={{ color: '#DBEAFE', fontSize: 13 }} numberOfLines={1}>{cur.trip.fileNo}</Text></Row>
                </Row>
                {cur.dayCount > 1 && (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {Array.from({ length: cur.dayCount }, (_, i) => (
                      <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: cur.dayIndex && i < cur.dayIndex - 1 ? '#22C55E' : cur.dayIndex === i + 1 ? C.red : 'rgba(255,255,255,0.18)' }} />
                    ))}
                  </View>
                )}
                {cur.trip.specialNotes && <Row gap={6}><Ionicons name="gift" size={15} color="#FCD34D" /><Text style={{ color: '#FDE68A', flex: 1 }} numberOfLines={2}>{cur.trip.specialNotes}</Text></Row>}
              </LinearGradient>
            </Pressable>
          </Animated.View>}

          <TripControl
            bookingRef={cur.trip.bookingRef}
            progress={cur.progress}
            isLastDay={cur.isLastDay}
            dayNo={cur.dayIndex}
            todayPlan={cur.todayPlan}
            heading={{
              guest: cur.trip.leadGuest ?? 'Guest',
              sub: `${cur.dayIndex ? `Day ${cur.dayIndex} of ${cur.dayCount} · ` : ''}${cur.trip.pax.adults + cur.trip.pax.children} ${t('pax')} · ${cur.trip.fileNo}`,
              onOpen: openCur,
            }}
            onChange={p => setData(d => (d && d.current ? { ...d, current: { ...d.current, progress: p } } : d))}
          />

          {cur.todayPlan && (
            <Animated.View entering={FadeInDown.delay(160).springify().damping(18)} style={styles.journey}>
              <Row gap={S.md}>
                <LinearGradient colors={['#FF5A6A', C.red]} style={styles.journeyIcon}><Ionicons name="map" size={20} color="#fff" /></LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.journeyTitle}>Today&apos;s journey</Text>
                  <Text style={styles.journeySub}>{fmtDay(cur.todayPlan.date, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
                </View>
              </Row>
              <DayPlanView day={cur.todayPlan} compact />
            </Animated.View>
          )}
          {cur.todayPlan && <AiBrief bookingRef={cur.trip.bookingRef} />}
          {running && vehicleDue}
        </>
      ) : data && (
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.rest}>
          <Image source={require('../../../assets/images/illustrations/rest-day.png')} alt="" accessibilityIgnoresInvertColors style={{ width: 190, height: 190 }} contentFit="contain" />
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '900' }}>{t('noTripToday')}</Text>
          <Text style={{ color: C.sub, textAlign: 'center', fontSize: 15 }}>{t('restDay')}</Text>
        </Animated.View>
      )}

      {!!data?.alsoToday?.length && (
        <View style={{ gap: S.sm }}>
          <Text style={styles.section}>ALSO TODAY · {data.alsoToday.length}</Text>
          {data.alsoToday.map((o, i) => (
            <Animated.View key={o.bookingRef} entering={FadeInDown.delay(200 + i * 70).springify().damping(18)}>
              <Pressable onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: o.bookingRef } })}
                style={({ pressed }) => [styles.also, pressed && { transform: [{ scale: 0.98 }] }]}>
                <LinearGradient colors={o.started ? ['#34D399', '#059669'] : ['#FFB547', '#F59E0B']} style={styles.alsoTime}>
                  <Text style={styles.alsoTimeText}>{o.firstMovement?.time ?? '—'}</Text>
                  <Ionicons name={o.mode === 'ROUND_TRIP' ? 'repeat' : 'swap-horizontal'} size={14} color="#fff" />
                </LinearGradient>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.alsoGuest} numberOfLines={1}>{o.leadGuest ?? 'Guest'}</Text>
                  {o.firstMovement && <Text style={styles.alsoRoute} numberOfLines={1}>{routeOf(o.firstMovement)}</Text>}
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    <View style={styles.alsoChip}><Text style={styles.alsoChipText}>{o.dayCount > 1 && o.dayNo ? `Day ${o.dayNo}/${o.dayCount}` : 'Transfer'}</Text></View>
                    <View style={styles.alsoChip}><Text style={styles.alsoChipText}>{o.legs} {o.legs === 1 ? 'stop' : 'stops'}</Text></View>
                    <View style={styles.alsoChip}><Text style={styles.alsoChipText}>{o.pax.adults + o.pax.children} {t('pax')}</Text></View>
                    {o.started && <View style={[styles.alsoChip, { backgroundColor: C.greenSoft }]}><Text style={[styles.alsoChipText, { color: C.green }]}>Started</Text></View>}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.dim} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}

      {data?.next && (
        <Animated.View entering={FadeInDown.delay(220).springify().damping(18)}>
          <Pressable onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: data.next!.bookingRef } })}
            style={({ pressed }) => [styles.next, pressed && { transform: [{ scale: 0.98 }] }]}>
            <LinearGradient colors={['#E0E7FF', '#C7D2FE']} style={styles.countdown}>
              <Text style={styles.countdownNo}>{nextIn != null && nextIn >= 0 ? nextIn : '—'}</Text>
              <Text style={styles.countdownLbl}>{nextIn === 1 ? 'day' : 'days'}</Text>
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.nextTag}>{t('nextTrip').toUpperCase()}</Text>
              <Text style={styles.nextTitle} numberOfLines={1}>{data.next.leadGuest ?? 'Guest'}</Text>
              <Text style={styles.nextSub} numberOfLines={1}>
                {fmtRange(data.next.startDate, data.next.endDate)} · {data.next.pax.adults + data.next.pax.children} {t('pax')} · {data.next.dayCount} {data.next.dayCount === 1 ? 'day' : 'days'}
              </Text>
              {data.next.firstMovement && (
                <Text style={styles.nextSub} numberOfLines={1}>{data.next.firstMovement.time ? `${data.next.firstMovement.time} · ` : ''}{routeOf(data.next.firstMovement)}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.dim} />
          </Pressable>
        </Animated.View>
      )}

      {data && (
        <View style={{ gap: S.sm }}>
          <Text style={styles.section}>THIS MONTH</Text>
          <Row gap={S.sm}>
            <Tile value={data.month.km.toLocaleString()} label={t('kmMonth')} icon="speedometer" colors={['#FFF7E0', '#FFE3A3']} accent="#D97706" delay={260} />
            <Tile value={data.month.daysDriven} label="days driven" icon="calendar" colors={['#ECFDF3', '#BBF7D0']} accent="#16A34A" delay={320} />
            <Tile value={data.upcomingCount} label={t('upcoming')} icon="time" colors={['#EFF6FF', '#BFDBFE']} accent="#2563EB" delay={380} />
          </Row>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  also: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 22, padding: 12, borderWidth: 1, borderColor: C.line },
  alsoTime: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2 },
  alsoTimeText: { color: '#fff', fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] },
  alsoGuest: { color: C.text, fontWeight: '900', fontSize: 16 },
  alsoRoute: { color: C.sub, fontSize: 13 },
  alsoChip: { backgroundColor: C.cardHi, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  alsoChipText: { color: C.sub, fontWeight: '800', fontSize: 11 },
  todo: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFBEB', borderRadius: 20, padding: 12, borderWidth: 1, borderColor: '#FDE68A' },
  todoIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  todoTitle: { color: C.text, fontWeight: '900', fontSize: 16 },
  todoSub: { color: '#92400E', fontSize: 13 },
  todoChip: { backgroundColor: '#F59E0B', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  todoChipText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  dayChip: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  dayChipText: { color: '#fff', fontWeight: '900', letterSpacing: 0.8, fontSize: 12 },
  openTrip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.red, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  journey: { backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 14, borderWidth: 1, borderColor: C.line },
  journeyIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  journeyTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
  journeySub: { color: C.sub, fontSize: 13, fontWeight: '600' },
  rest: { alignItems: 'center', gap: 6, paddingVertical: S.lg, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 22, padding: 12, borderWidth: 1, borderColor: C.line },
  countdown: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  countdownNo: { color: '#3730A3', fontSize: 24, fontWeight: '900', lineHeight: 26 },
  countdownLbl: { color: '#4338CA', fontSize: 11, fontWeight: '800' },
  nextTag: { color: '#4F46E5', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  nextTitle: { color: C.text, fontWeight: '900', fontSize: 17 },
  nextSub: { color: C.sub, fontSize: 13 },
  section: { color: C.dim, fontWeight: '900', fontSize: 12, letterSpacing: 1.2 },
  tile: { borderRadius: 20, padding: 12, gap: 2, minHeight: 104 },
  tileIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileValue: { color: C.text, fontSize: 24, fontWeight: '900' },
  tileLabel: { color: C.text, fontSize: 12, fontWeight: '700', opacity: 0.7 },
});
