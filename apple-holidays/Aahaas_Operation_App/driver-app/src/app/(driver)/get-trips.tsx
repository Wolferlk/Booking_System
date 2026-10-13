/** Open trips — the Driver-Auto board in the app. Request with one tap; ops approves. */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, ErrorBox, H1, Ionicons, Loading, P, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rememberTrips, type OpenTrip } from '@/lib/open-trips';
import { C, S } from '@/lib/theme';

interface Claim { id: string; tripKey: string; status: string; bookingRef: string; createdAt: string; snapshot?: { fileNo?: string; route?: string } | null }

export default function GetTrips() {
  const t = useT();
  const { data, error, loading, refreshing, reload, silent } = useLoad<{ enabled: boolean; trips: OpenTrip[]; claims: Claim[] }>('/api/mobile/open-trips');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data?.trips) rememberTrips(data.trips); }, [data]);

  async function request(trip: OpenTrip) {
    setBusy(trip.key);
    try {
      const r = await api<{ mode: string }>('/api/mobile/open-trips', { body: { action: 'request', tripKey: trip.key } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(r.mode === 'assigned' ? 'The trip is yours! 🎉' : 'Request sent', r.mode === 'assigned' ? 'It is now in My trips.' : 'Operations will confirm. You will get a notification.');
      silent();
    } catch (e) {
      Alert.alert('Not possible', (e as ApiError).message);
    } finally { setBusy(null); }
  }

  async function withdraw(id: string) {
    setBusy(id);
    try { await api('/api/mobile/open-trips', { body: { action: 'withdraw', claimId: id } }); silent(); }
    catch (e) { Alert.alert('Could not withdraw', (e as ApiError).message); }
    finally { setBusy(null); }
  }

  const pending = (data?.claims ?? []).filter(c => c.status === 'PENDING');

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <H1>{t('getTrips')}</H1>
      <P>Trips that still need a driver. Tap Request — operations confirm it.</P>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && !data.enabled && <Card tone="gold"><Text style={{ color: C.text }}>Trip requests are not switched on yet.</Text></Card>}

      {pending.length > 0 && (
        <Card tone="blue" style={{ gap: S.sm }}>
          <Text style={{ color: C.blue, fontWeight: '800' }}>Waiting for approval ({pending.length})</Text>
          {pending.map(c => (
            <Row key={c.id} style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: C.text, flex: 1 }}>{c.snapshot?.fileNo ?? c.bookingRef} · {c.snapshot?.route ?? ''}</Text>
              <Button title={t('withdraw')} kind="ghost" onPress={() => withdraw(c.id)} loading={busy === c.id} style={{ minHeight: 40 }} />
            </Row>
          ))}
        </Card>
      )}

      {data?.enabled && data.trips.length === 0 && <P>No open trips right now. We will notify you when new ones come.</P>}
      {data?.trips.map(trip => (
        <Card key={trip.key} style={{ gap: 6 }} onPress={() => router.push({ pathname: '/open-trip', params: { key: trip.key } })}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.gold, fontWeight: '800' }}>{fmtRange(trip.startDate, trip.endDate)}</Text>
            <Pill text={trip.daysAway === 0 ? 'Today' : trip.daysAway === 1 ? 'Tomorrow' : `In ${trip.daysAway} days`} tone={trip.daysAway <= 1 ? 'red' : 'dim'} />
          </Row>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{trip.title}</Text>
          <Text style={{ color: C.sub }} numberOfLines={2}>{trip.route}</Text>
          <Row gap={S.lg} style={{ flexWrap: 'wrap' }}>
            <Row gap={4}><Ionicons name="people" size={14} color={C.sub} /><Text style={{ color: C.sub }}>{trip.pax} {t('pax')}</Text></Row>
            <Row gap={4}><Ionicons name="calendar" size={14} color={C.sub} /><Text style={{ color: C.sub }}>{trip.days} {trip.days === 1 ? 'day' : 'days'}</Text></Row>
            {trip.vehicleType && <Row gap={4}><Ionicons name="car" size={14} color={C.sub} /><Text style={{ color: C.sub }}>{trip.vehicleType}</Text></Row>}
          </Row>
          {trip.legs.filter(l => l.driven).slice(0, 2).map(l => (
            <Row key={l.agendaItemId} gap={6}>
              <Text style={{ color: C.gold, fontWeight: '800', width: 46 }}>{l.time ?? '—'}</Text>
              <Text style={{ color: C.text, flex: 1 }} numberOfLines={1}>{l.from || l.location}{l.to ? ` → ${l.to}` : ''}</Text>
            </Row>
          ))}
          <Row gap={4}><Text style={{ color: C.red, fontWeight: '800' }}>See day-by-day plan</Text><Ionicons name="chevron-forward" size={16} color={C.red} /></Row>
          {trip.busy && <Text style={{ color: C.amber }}>⚠ You already have a trip on these dates</Text>}
          {trip.fits === false && <Text style={{ color: C.amber }}>⚠ More guests than your vehicle seats</Text>}
          <View style={{ marginTop: 6 }}>
            {trip.myRequestId
              ? <Pill text={t('requested')} tone="blue" icon="hourglass" />
              : <Button title={t('request')} icon="hand-right" onPress={() => request(trip)} loading={busy === trip.key} />}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
