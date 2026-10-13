import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { AiBrief } from '@/components/ai-brief';
import { DayPlanView } from '@/components/day-plan';
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
          <Card onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: cur.trip.bookingRef } })} style={{ gap: S.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>{cur.dayIndex ? `${t('day')} ${cur.dayIndex} ${t('of')} ${cur.dayCount}` : fmtRange(cur.trip.startDate, cur.trip.endDate)}</Label>
              <Pill text={cur.trip.mode === 'ROUND_TRIP' ? 'Round trip' : 'Transfers'} tone="gold" />
            </Row>
            <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{cur.trip.fileNo}</Text>
            <Row gap={S.lg}>
              <Row gap={6}><Ionicons name="person" size={16} color={C.sub} /><Text style={{ color: C.text, fontSize: 16 }}>{cur.trip.leadGuest ?? 'Guest'}</Text></Row>
              <Row gap={6}><Ionicons name="people" size={16} color={C.sub} /><Text style={{ color: C.text, fontSize: 16 }}>{cur.trip.pax.adults + cur.trip.pax.children} {t('pax')}</Text></Row>
            </Row>
            {cur.trip.specialNotes && <Row gap={6}><Ionicons name="gift" size={16} color={C.gold} /><Text style={{ color: C.gold, flex: 1 }}>{cur.trip.specialNotes}</Text></Row>}
          </Card>

          <TripControl
            bookingRef={cur.trip.bookingRef}
            progress={cur.progress}
            isLastDay={cur.isLastDay}
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
