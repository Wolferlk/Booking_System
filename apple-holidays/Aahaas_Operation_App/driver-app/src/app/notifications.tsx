import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { Card, ErrorBox, H1, IconButton, Ionicons, Loading, P, Row, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { C, S } from '@/lib/theme';

interface N { id: string; kind: string; title: string; body: string; data: Record<string, string> | null; readAt: string | null; createdAt: string }

const ICON: Record<string, IconName> = {
  TRIP_ASSIGNED: 'car-sport', TRIP_TOMORROW: 'alarm', TODAY_PLAN: 'sunny', VEHICLE_CHECK_DUE: 'camera', VEHICLE_CHECK: 'camera',
  REQUEST_UPDATE: 'chatbox-ellipses', DRIVER_HELP: 'alert-circle', DRIVER_REQUEST: 'chatbox-ellipses', TRIP_COMPLETED: 'flag',
};

export default function Notifications() {
  const { data, error, loading, refreshing, reload } = useLoad<{ items: N[] }>('/api/mobile/notifications');
  useEffect(() => { if (data?.items.some(i => !i.readAt)) api('/api/mobile/notifications', { body: {} }).catch(() => {}); }, [data]);

  function open(n: N) {
    const d = n.data ?? {};
    if (d.screen === 'vehicle' || n.kind.startsWith('VEHICLE')) router.push('/vehicle-check');
    else if (d.bookingRef && (d.screen === 'trip' || n.kind.startsWith('TRIP'))) router.push({ pathname: '/trip/[ref]', params: { ref: d.bookingRef } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row><IconButton icon="chevron-back" onPress={() => router.back()} /><H1 style={{ marginLeft: S.sm }}>Notifications</H1></Row>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.items.length === 0 && <P>Nothing yet.</P>}
      {data?.items.map(n => (
        <Card key={n.id} onPress={() => open(n)} tone={n.readAt ? undefined : 'blue'} style={{ gap: 4 }}>
          <Row gap={S.md}>
            <Ionicons name={ICON[n.kind] ?? 'notifications'} size={22} color={n.kind.includes('HELP') ? C.red : C.gold} />
            <Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{n.title}</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>{ago(n.createdAt)}</Text>
          </Row>
          <Text style={{ color: C.sub, marginLeft: 34 }}>{n.body}</Text>
        </Card>
      ))}
    </Screen>
  );
}
