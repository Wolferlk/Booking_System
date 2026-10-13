import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, ErrorBox, H1, Ionicons, Loading, P, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';

interface Row_ {
  bookingRef: string; fileNo: string; leadGuest: string | null; pax: { adults: number; children: number }
  startDate: string; endDate: string; mode: string; dayCount: number; firstStop: string | null
  phase: 'DONE' | 'RUNNING' | 'MISSED' | 'READY' | 'UPCOMING'; km: number
}

const PHASE: Record<Row_['phase'], { tone: 'green' | 'gold' | 'blue' | 'dim' | 'red'; key: 'running' | 'ready' | 'upcoming' | 'completed' }> = {
  RUNNING: { tone: 'green', key: 'running' },
  READY: { tone: 'gold', key: 'ready' },
  UPCOMING: { tone: 'blue', key: 'upcoming' },
  DONE: { tone: 'dim', key: 'completed' },
  MISSED: { tone: 'dim', key: 'completed' },
};

export default function Trips() {
  const t = useT();
  const { data, error, loading, refreshing, reload } = useLoad<{ today: string; trips: Row_[] }>('/api/mobile/trips');
  const [tab, setTab] = useState<'now' | 'past'>('now');
  const list = useMemo(() => {
    const rows = data?.trips ?? [];
    return tab === 'now'
      ? rows.filter(r => r.phase === 'RUNNING' || r.phase === 'READY' || r.phase === 'UPCOMING')
      : rows.filter(r => r.phase === 'DONE' || r.phase === 'MISSED').reverse();
  }, [data, tab]);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <H1>{t('trips')}</H1>
      <Row gap={S.sm}>
        {(['now', 'past'] as const).map(k => (
          <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: tab === k ? C.red : C.card, alignItems: 'center' }}>
            <Text style={{ color: C.text, fontWeight: '800' }}>{k === 'now' ? `${t('upcoming')}` : t('completed')}</Text>
          </Pressable>
        ))}
      </Row>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && list.length === 0 && <P>{tab === 'now' ? 'No trips assigned yet. Check “Get trips” for open ones.' : 'No finished trips in the last 30 days.'}</P>}
      {list.map(r => (
        <Card key={r.bookingRef} onPress={() => router.push({ pathname: '/trip/[ref]', params: { ref: r.bookingRef } })} style={{ gap: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 19, fontWeight: '900' }}>{r.fileNo}</Text>
            <Pill text={t(PHASE[r.phase].key)} tone={PHASE[r.phase].tone} />
          </Row>
          <Text style={{ color: C.gold, fontWeight: '700' }}>{fmtRange(r.startDate, r.endDate)} · {r.dayCount} {r.dayCount === 1 ? 'day' : 'days'}</Text>
          <Text style={{ color: C.sub }}>{r.leadGuest ?? 'Guest'} · {r.pax.adults + r.pax.children} {t('pax')}{r.firstStop ? ` · from ${r.firstStop}` : ''}</Text>
          {r.km > 0 && <Row gap={6}><Ionicons name="speedometer" size={14} color={C.sub} /><Text style={{ color: C.sub }}>{Math.round(r.km)} km</Text></Row>}
        </Card>
      ))}
      <View style={{ height: 20 }} />
    </Screen>
  );
}
