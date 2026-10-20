import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AiBrief } from '@/components/ai-brief';
import { DayPlanView } from '@/components/day-plan';
import { NAVY } from '@/components/live-day';
import { TripControl } from '@/components/trip-control';
import { Card, ErrorBox, H1, IconButton, Ionicons, Label, Loading, P, Pill, Row, Screen, Stat } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useAuth } from '@/lib/auth';
import { firstName, fmtDay, fmtRange, greetingKey, routeOf } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Home } from '@/lib/types';

export default function Today() {
  const t = useT();
  const { actor } = useAuth();
  const { data, setData, error, loading, refreshing, reload } = useLoad<Home>('/api/mobile/home');

  if (loading && !data) return <Screen><Loading /></Screen>;
  const name = firstName(data?.name ?? actor?.name ?? '');
  const cur = data?.current;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <P>{t(greetingKey())},</P>
          <H1>{name} 👋</H1>
        </View>
        <Row gap={S.sm}>
          <IconButton icon="notifications" badge={data?.alerts.unread} onPress={() => router.push('/notifications')} />
          <IconButton icon="alert-circle" color={C.red} onPress={() => router.push({ pathname: '/help', params: { ref: cur?.trip.bookingRef ?? '' } })} />
        </Row>
      </Row>

      {error && !data && <ErrorBox message={error} onRetry={reload} />}

      {data?.alerts.vehicleCheck?.due && (
        <Card tone="gold" onPress={() => router.push('/vehicle-check')}>
          <Row gap={S.md}>
            <Ionicons name="camera" size={30} color={C.gold} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontWeight: '800', fontSize: 17 }}>{t('vehicleDue')}</Text>
              <Text style={{ color: C.sub }}>{data.alerts.vehicleCheck.rejectedNote ? `Ops asked: ${data.alerts.vehicleCheck.rejectedNote}` : t('vehicleDueHint')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={C.gold} />
          </Row>
        </Card>
      )}

      {cur ? (
        <>
          <Animated.View entering={FadeInDown.springify().damping(18)}>
            <Pressable onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: cur.trip.bookingRef } })}
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
              <LinearGradient colors={NAVY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 16, gap: 10 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: '#93C5FD', fontWeight: '800', letterSpacing: 0.6 }}>
                    {cur.dayIndex ? `${t('day').toUpperCase()} ${cur.dayIndex} ${t('of')} ${cur.dayCount}` : fmtRange(cur.trip.startDate, cur.trip.endDate)}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color="#93C5FD" />
                </Row>
                <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{cur.trip.fileNo}</Text>
                <Row gap={S.lg}>
                  <Row gap={6}><Ionicons name="person" size={16} color="#BFDBFE" /><Text style={{ color: '#fff', fontSize: 15 }}>{cur.trip.leadGuest ?? 'Guest'}</Text></Row>
                  <Row gap={6}><Ionicons name="people" size={16} color="#BFDBFE" /><Text style={{ color: '#fff', fontSize: 15 }}>{cur.trip.pax.adults + cur.trip.pax.children} {t('pax')}</Text></Row>
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
          </Animated.View>

          <TripControl
            bookingRef={cur.trip.bookingRef}
            progress={cur.progress}
            isLastDay={cur.isLastDay}
            dayNo={cur.dayIndex}
            todayPlan={cur.todayPlan}
            onChange={p => setData(d => (d && d.current ? { ...d, current: { ...d.current, progress: p } } : d))}
          />

          {cur.todayPlan && (
            <Card style={{ gap: S.md }}>
              <Label>{t('today')} · {fmtDay(cur.todayPlan.date)}</Label>
              <DayPlanView day={cur.todayPlan} compact />
            </Card>
          )}
          {cur.todayPlan && <AiBrief bookingRef={cur.trip.bookingRef} />}
        </>
      ) : data && (
        <Card style={{ alignItems: 'center', gap: S.sm, paddingVertical: S.xxl }}>
          <Text style={{ fontSize: 44 }}>🌴</Text>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{t('noTripToday')}</Text>
          <P style={{ textAlign: 'center' }}>{t('restDay')}</P>
        </Card>
      )}

      {data?.next && (
        <Card onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: data.next!.bookingRef } })} style={{ gap: 6 }}>
          <Label>{t('nextTrip')}</Label>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{data.next.fileNo}</Text>
            <Text style={{ color: C.gold, fontWeight: '700' }}>{fmtRange(data.next.startDate, data.next.endDate)}</Text>
          </Row>
          <Text style={{ color: C.sub }}>
            {data.next.leadGuest ?? 'Guest'} · {data.next.pax.adults + data.next.pax.children} {t('pax')} · {data.next.dayCount} {data.next.dayCount === 1 ? 'day' : 'days'}
          </Text>
          {data.next.firstMovement && (
            <Text style={{ color: C.text }}>{data.next.firstMovement.time ? `${data.next.firstMovement.time} · ` : ''}{routeOf(data.next.firstMovement)}</Text>
          )}
        </Card>
      )}

      {data && (
        <Row gap={S.md}>
          <Stat value={data.month.km.toLocaleString()} label={t('kmMonth')} icon="speedometer" color={C.gold} />
          <Stat value={data.month.daysDriven} label="days driven" icon="calendar" />
          <Stat value={data.upcomingCount} label={t('upcoming')} icon="time" />
        </Row>
      )}
    </Screen>
  );
}
