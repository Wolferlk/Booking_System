/**
 * One open trip, day by day — every movement with time, route and what it
 * involves, free days, and where the guests sleep — then Request.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { openMaps } from '@/components/day-plan';
import { Button, Card, ErrorBox, H1, IconButton, Ionicons, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDay, fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cachedTrip, openTripsPath, rememberTrips, type OpenTrip } from '@/lib/open-trips';
import { C, S } from '@/lib/theme';

export default function OpenTripScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const { actor } = useAuth();
  const path = openTripsPath(actor);
  const cached = cachedTrip(key);
  // Always refresh, so a trip just taken by someone else shows as gone.
  const { data, error, loading, reload } = useLoad<{ trips: OpenTrip[] }>(path);
  if (data) rememberTrips(data.trips);
  const trip = data ? data.trips.find(x => x.key === key) ?? null : cached;
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    if (!trip) return [];
    const byDate = new Map<string, OpenTrip['legs']>();
    for (const l of trip.legs) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
    // Include days with no movement inside the trip span (round trips).
    for (let d = trip.startDate; d <= trip.endDate; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)) {
      if (!byDate.has(d)) byDate.set(d, []);
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [trip]);

  async function request() {
    if (!trip) return;
    setBusy(true);
    try {
      const r = await api<{ mode: string }>(path, { body: { action: 'request', tripKey: trip.key } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(r.mode === 'assigned' ? 'The trip is yours! 🎉' : 'Request sent', r.mode === 'assigned' ? (actor?.kind === 'VENDOR' ? 'It is in your Trips — choose a driver and vehicle for it.' : 'It is now in My trips.') : 'Operations will confirm. You will get a notification.');
      reload();
    } catch (e) {
      Alert.alert('Not possible', (e as ApiError).message);
    } finally { setBusy(false); }
  }

  if (!trip) {
    return (
      <Screen>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
          <Card tone="gold"><Text style={{ color: C.text }}>This trip is no longer open — another driver may have taken it.</Text></Card>
        )}
      </Screen>
    );
  }

  const hotelFor = (date: string) => trip.stays.find(s => s.checkIn <= date && s.checkOut > date) ?? null;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <Pill text={trip.daysAway === 0 ? 'Today' : trip.daysAway === 1 ? 'Tomorrow' : `In ${trip.daysAway} days`} tone={trip.daysAway <= 1 ? 'red' : 'blue'} />
      </Row>

      <View style={{ gap: 6 }}>
        <Label>{trip.countryLabel} · {trip.kind === 'BOOKING' ? 'Round trip · one driver' : 'Single movement'}</Label>
        <H1>{trip.fileNo}</H1>
        <Text style={{ color: C.gold, fontWeight: '800', fontSize: 16 }}>{fmtRange(trip.startDate, trip.endDate)} · {trip.days} {trip.days === 1 ? 'day' : 'days'}</Text>
        <Row gap={S.lg} style={{ flexWrap: 'wrap' }}>
          <Row gap={4}><Ionicons name="people" size={16} color={C.sub} /><Text style={{ color: C.text }}>{trip.paxAdults} adults{trip.paxChildren ? ` · ${trip.paxChildren} children` : ''}</Text></Row>
          {trip.vehicleType && <Row gap={4}><Ionicons name="car" size={16} color={C.sub} /><Text style={{ color: C.text }}>{trip.vehicleType}</Text></Row>}
        </Row>
        {trip.cities.length > 0 && <Text style={{ color: C.sub }}>{trip.cities.join(' → ')}</Text>}
      </View>

      {trip.busy && <Card tone="gold"><Text style={{ color: C.text }}>⚠ You already have a trip on some of these dates.</Text></Card>}
      {trip.fits === false && <Card tone="gold"><Text style={{ color: C.text }}>⚠ More guests than your vehicle seats.</Text></Card>}
      {trip.noAgenda && <Card tone="blue"><Text style={{ color: C.text }}>The day plan is not on the chart yet — operations will add it. Dates and hotels are below.</Text></Card>}

      <Label>Day by day</Label>
      {days.map(([date, legs], n) => {
        const hotel = hotelFor(date);
        const driven = legs.filter(l => l.driven);
        return (
          <Card key={date} style={{ gap: S.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={{ color: C.red, fontWeight: '800' }}>{t('day')} {n + 1}</Text>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>{fmtDay(date, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
              </View>
              {legs.length > 0 && driven.length === 0 && <Pill text="Free day" />}
              {driven.length > 0 && <Pill text={`${driven.length} movement${driven.length > 1 ? 's' : ''}`} tone="green" />}
            </Row>

            {legs.length === 0 && <Text style={{ color: C.sub }}>No movement on the chart for this day yet.</Text>}
            {legs.map((l, i) => (
              <View key={l.agendaItemId} style={{ flexDirection: 'row', gap: S.md }}>
                <View style={{ alignItems: 'center', width: 54 }}>
                  <Text style={{ color: l.driven ? C.gold : C.dim, fontWeight: '900' }}>{l.time ?? '—'}</Text>
                  {l.timeTo ? <Text style={{ color: C.dim, fontSize: 11 }}>to {l.timeTo}</Text> : null}
                  {i < legs.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: C.line, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, gap: 4, paddingBottom: S.sm }}>
                  <Text style={{ color: l.driven ? C.text : C.sub, fontWeight: '800', fontSize: 16 }}>
                    {l.from || l.location}{l.to && l.to !== (l.from || l.location) ? ` → ${l.to}` : ''}
                  </Text>
                  {!l.driven && <Text style={{ color: C.dim, fontSize: 13 }}>Leisure / hotel only — no driving</Text>}
                  {l.details ? <Text style={{ color: C.sub, fontSize: 14, lineHeight: 20 }}>{l.details}</Text> : null}
                  <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
                    <Pill text={l.serviceType.replace(/_/g, ' ').toLowerCase()} />
                    {l.mealPlan ? <Pill text={`🍽 ${l.mealPlan}`} /> : null}
                  </Row>
                  {l.driven && (l.to || l.from) ? (
                    <Text style={{ color: C.blue, fontWeight: '700', marginTop: 2 }} onPress={() => openMaps(l.to || l.from || l.location)}>View on map</Text>
                  ) : null}
                </View>
              </View>
            ))}

            {hotel && (
              <Row gap={S.sm} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md }}>
                <Ionicons name="bed" size={18} color={C.gold} />
                <Text style={{ color: C.text, flex: 1 }}>Night: <Text style={{ fontWeight: '800' }}>{hotel.hotel}</Text>, {hotel.city}</Text>
              </Row>
            )}
          </Card>
        );
      })}

      <View style={{ gap: S.sm }}>
        {trip.myRequestId ? (
          <Card tone="blue"><Row><Ionicons name="hourglass" size={18} color={C.blue} /><Text style={{ color: C.text, flex: 1 }}>You requested this trip. Operations will confirm.</Text></Row></Card>
        ) : (
          <Button title={trip.requireApproval ? 'Request this trip' : 'Take this trip'} icon="hand-right" onPress={request} loading={busy} />
        )}
        <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center' }}>Guest names and contacts are shared once the trip is yours.</Text>
      </View>
    </Screen>
  );
}
