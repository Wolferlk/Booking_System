import { router } from 'expo-router';
import { Text } from 'react-native';
import { Card, ErrorBox, H1, IconButton, Loading, P, Pill, Row, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { ago } from '@/lib/format';
import { C, S } from '@/lib/theme';

interface R_ { id: string; kind: string; bookingRef: string | null; reason: string | null; status: string; decisionNote: string | null; createdAt: string }
const KIND: Record<string, string> = { HELP: 'Help call', HANDOVER: 'Driver change', PROFILE_CHANGE: 'Profile change', FEEDBACK_WAIVER: 'Feedback waiver' };

export default function MyRequests() {
  const { data, error, loading, refreshing, reload } = useLoad<{ items: R_[] }>('/api/mobile/requests');
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row><IconButton icon="chevron-back" onPress={() => router.back()} /><H1 style={{ marginLeft: S.sm }}>My requests</H1></Row>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.items.length === 0 && <P>No requests yet.</P>}
      {data?.items.map(r => (
        <Card key={r.id} style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontWeight: '800' }}>{KIND[r.kind] ?? r.kind}{r.bookingRef ? ` · ${r.bookingRef}` : ''}</Text>
            <Pill text={r.status === 'PENDING' ? 'Waiting' : r.status === 'APPROVED' ? (r.kind === 'HELP' ? 'Handled' : 'Approved') : 'Declined'}
              tone={r.status === 'PENDING' ? 'gold' : r.status === 'APPROVED' ? 'green' : 'red'} />
          </Row>
          {r.reason && <Text style={{ color: C.sub }}>{r.reason}</Text>}
          {r.decisionNote && <Text style={{ color: C.text }}>Ops: {r.decisionNote}</Text>}
          <Text style={{ color: C.dim, fontSize: 12 }}>{ago(r.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
