import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DayPlanView } from '@/components/day-plan';
import { TripControl } from '@/components/trip-control';
import { Button, Card, ErrorBox, H1, IconButton, Ionicons, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { fmtDay, fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Feedback, Links, Progress, Trip } from '@/lib/types';

interface Detail { trip: Trip; progress: Progress; feedback: Feedback; links: Links }

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

  function requestHandover() {
    router.push({ pathname: '/help', params: { ref, kind: 'HANDOVER' } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <IconButton icon="alert-circle" color={C.red} onPress={() => router.push({ pathname: '/help', params: { ref } })} />
      </Row>
      <View style={{ gap: 4 }}>
        <Label>{fmtRange(trip.startDate, trip.endDate)}</Label>
        <H1>{trip.fileNo}</H1>
        <Text style={{ color: C.sub, fontSize: 16 }}>{trip.leadGuest ?? 'Guest'} · {trip.pax.adults} adults{trip.pax.children ? ` · ${trip.pax.children} children` : ''}</Text>
        <Row gap={S.sm} style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <Pill text={trip.mode === 'ROUND_TRIP' ? 'Round trip · one driver' : 'Transfers'} tone="gold" />
          {trip.vehicle && <Pill text={trip.vehicle} icon="car" />}
          {progress.session && <Pill text={`${Math.round(progress.session.totalKm)} km`} tone="green" icon="speedometer" />}
          {data.feedback.submitted && <Pill text="Feedback in" tone="green" icon="star" />}
        </Row>
      </View>
      {trip.specialNotes && <Card tone="gold"><Row><Ionicons name="gift" size={18} color={C.gold} /><Text style={{ color: C.text, flex: 1 }}>{trip.specialNotes}</Text></Row></Card>}

      <TripControl bookingRef={trip.bookingRef} progress={progress} isLastDay={isLastDay} startsLater={startsLater}
        onChange={p => setData(d => (d ? { ...d, progress: p } : d))} />

      <Label>Day by day</Label>
      {trip.days.map(d => {
        const run = kmByDay.get(d.date);
        const isOpen = openDay === d.date;
        return (
          <Card key={d.date} style={{ gap: S.md, borderColor: d.date === today ? C.red : C.line }}>
            <Pressable onPress={() => setOpen(isOpen ? '' : d.date)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: d.date === today ? C.red : C.gold, fontWeight: '800' }}>{t('day')} {d.dayNo}{d.date === today ? ` · ${t('today')}` : ''}</Text>
                  <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{fmtDay(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
                </View>
                <Row gap={S.sm}>
                  {run && <Pill text={`${run.km.toFixed(0)} km`} tone={run.status === 'STARTED' ? 'green' : 'dim'} />}
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={C.sub} />
                </Row>
              </Row>
            </Pressable>
            {isOpen && <DayPlanView day={d} />}
          </Card>
        );
      })}

      {progress.session?.status === 'ACTIVE' && (
        <Button title={t('cantContinue')} kind="ghost" icon="swap-horizontal" onPress={requestHandover} />
      )}
    </Screen>
  );
}
