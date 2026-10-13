/** Ops view: drivers on the road (map + list), who has not started, km today. */
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Card, ErrorBox, H1, IconButton, Ionicons, Label, Loading, P, Pill, Row, Screen, Stat } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { C, R, S } from '@/lib/theme';

interface LiveRow {
  dayId: string; driverName: string; driverPhone: string | null; vehicle: string | null; bookingRef: string
  status: string; startedAt: string; endedAt: string | null; km: number; tripKm: number
  lastLat: number | null; lastLng: number | null; lastSpeedKmh: number | null; lastPingAt: string | null; silent: boolean
}
interface Live {
  driving: LiveRow[]; finishedToday: LiveRow[]
  notStarted: { driverId: string; driverName: string; driverPhone: string | null; bookingRef: string; firstTime: string | null; usesApp: boolean }[]
  totals: { driving: number; kmToday: number; pendingRequests: number; pendingChecks: number; appDrivers: number }
}

export default function LiveBoard() {
  const { data, error, loading, refreshing, reload, silent } = useLoad<Live>('/api/mobile/staff/live');
  const [selected, setSelected] = useState<string | null>(null);
  const [track, setTrack] = useState<{ latitude: number; longitude: number }[]>([]);
  const map = useRef<MapView>(null);

  useEffect(() => { const id = setInterval(silent, 30_000); return () => clearInterval(id); }, [silent]);
  useEffect(() => {
    if (!selected) { setTrack([]); return; }
    api<{ points: { lat: number; lng: number }[] }>(`/api/mobile/staff/track/${selected}`)
      .then(r => setTrack(r.points.map(p => ({ latitude: p.lat, longitude: p.lng })))).catch(() => setTrack([]));
  }, [selected]);

  const pins = useMemo(() => (data?.driving ?? []).filter(d => d.lastLat != null && d.lastLng != null), [data]);
  useEffect(() => {
    if (pins.length && map.current) {
      map.current.fitToCoordinates(pins.map(p => ({ latitude: p.lastLat!, longitude: p.lastLng! })), { edgePadding: { top: 60, bottom: 60, left: 60, right: 60 }, animated: true });
    }
  }, [pins.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Screen><Loading /></Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row style={{ justifyContent: 'space-between' }}>
        <H1>Live drivers</H1>
        <IconButton icon="file-tray-full" badge={(data?.totals.pendingRequests ?? 0) + (data?.totals.pendingChecks ?? 0)} onPress={() => router.push('/inbox')} />
      </Row>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <Row gap={S.md}>
            <Stat value={data.totals.driving} label="driving now" icon="car-sport" color={C.green} />
            <Stat value={data.totals.kmToday} label="km today" icon="speedometer" color={C.gold} />
            <Stat value={data.notStarted.length} label="not started" icon="time" color={data.notStarted.length ? C.amber : C.text} />
          </Row>

          <View style={{ height: 300, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
            <MapView ref={map} style={{ flex: 1 }} initialRegion={{ latitude: 7.87, longitude: 80.77, latitudeDelta: 4, longitudeDelta: 4 }} userInterfaceStyle="dark">
              {pins.map(d => (
                <Marker key={d.dayId} coordinate={{ latitude: d.lastLat!, longitude: d.lastLng! }} pinColor={d.silent ? 'orange' : 'green'}
                  title={d.driverName} description={`${d.bookingRef} · ${d.km} km · ${ago(d.lastPingAt)}`} onPress={() => setSelected(d.dayId)} />
              ))}
              {track.length > 1 && <Polyline coordinates={track} strokeColor={C.red} strokeWidth={4} />}
            </MapView>
          </View>

          <Label>On the road ({data.driving.length})</Label>
          {data.driving.length === 0 && <P>Nobody is driving right now.</P>}
          {data.driving.map(d => (
            <Card key={d.dayId} onPress={() => setSelected(d.dayId === selected ? null : d.dayId)} style={{ gap: 4, borderColor: d.dayId === selected ? C.gold : C.line }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontWeight: '800', fontSize: 16, flex: 1 }}>{d.driverName}</Text>
                <Pill text={d.silent ? `No GPS ${ago(d.lastPingAt)}` : d.lastSpeedKmh != null ? `${d.lastSpeedKmh} km/h` : 'Live'} tone={d.silent ? 'gold' : 'green'} />
              </Row>
              <Text style={{ color: C.sub }}>{d.bookingRef} · {d.vehicle ?? '—'}</Text>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text }}><Text style={{ fontWeight: '800' }}>{d.km}</Text> km today · {d.tripKm} km trip</Text>
                {d.driverPhone && <Ionicons name="call" size={22} color={C.green} onPress={() => Linking.openURL(`tel:${d.driverPhone}`)} />}
              </Row>
            </Card>
          ))}

          <Label>Not started today ({data.notStarted.length})</Label>
          {data.notStarted.map(n => (
            <Card key={n.driverId} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{n.driverName}</Text>
                {n.driverPhone && <Ionicons name="call" size={22} color={C.green} onPress={() => Linking.openURL(`tel:${n.driverPhone}`)} />}
              </Row>
              <Text style={{ color: C.sub }}>{n.bookingRef} · first pickup {n.firstTime ?? '—'} · {n.usesApp ? 'on the app' : 'not on the app'}</Text>
            </Card>
          ))}

          {data.finishedToday.length > 0 && <Label>Finished today ({data.finishedToday.length})</Label>}
          {data.finishedToday.map(d => (
            <Card key={d.dayId} onPress={() => setSelected(d.dayId)}>
              <Text style={{ color: C.text }}>{d.driverName} · {d.bookingRef} · <Text style={{ fontWeight: '800' }}>{d.km} km</Text></Text>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
