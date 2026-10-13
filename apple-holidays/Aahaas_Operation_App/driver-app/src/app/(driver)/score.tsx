import { Text, View } from 'react-native';
import { ScoreRing } from '@/components/score-ring';
import { Card, ErrorBox, H1, Ionicons, Label, Loading, P, Row, Screen, Stat, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { fmtDay } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';

interface Perf {
  score: number | null; grade: string | null; rating: number | null; vehicleRating: number | null
  ratedBookings: number; responseRate: number | null; praiseCount: number; complaintCount: number
  trips: number; toursDone: number; daysOnRoad: number; pax: number; upcomingTrips: number
  topRoutes: { label: string; count: number }[]
  comments: { tone: 'praise' | 'complaint' | 'neutral'; text: string; date: string | null; bookingRef: string }[]
  app: { totalKm: number; daysDriven: number; tripsCompleted: number; feedbackRate: number | null; kmByMonth: { month: string; km: number }[] }
  badges: { id: string; label: string; icon: string; earned: boolean }[]
}

const BADGE_ICON: Record<string, IconName> = { road: 'trail-sign', trophy: 'trophy', star: 'star', chat: 'chatbubbles', flag: 'flag', shield: 'shield-checkmark', car: 'car-sport' };

function stars(n: number | null) {
  if (n == null) return 'Not rated yet';
  const full = Math.round(n);
  return `${'★'.repeat(full)}${'☆'.repeat(5 - full)}  ${n.toFixed(1)}`;
}

export default function Score() {
  const t = useT();
  const { data, error, loading, refreshing, reload } = useLoad<Perf>('/api/mobile/performance');
  if (loading && !data) return <Screen><Loading /></Screen>;
  const maxKm = Math.max(1, ...(data?.app.kmByMonth.map(m => m.km) ?? [1]));

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <H1>{t('score')}</H1>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <Card style={{ alignItems: 'center', gap: S.md }}>
            <ScoreRing score={data.score} grade={data.grade} />
            <Text style={{ color: C.gold, fontSize: 20 }}>{stars(data.rating)}</Text>
            <P>From {data.ratedBookings} guest {data.ratedBookings === 1 ? 'rating' : 'ratings'}{data.responseRate != null ? ` · ${Math.round(data.responseRate * (data.responseRate <= 1 ? 100 : 1))}% of guests rated` : ''}</P>
          </Card>

          <Row gap={S.md}>
            <Stat value={data.app.totalKm.toLocaleString()} label="km in the app" icon="speedometer" color={C.gold} />
            <Stat value={data.toursDone} label="tours done" icon="flag" />
            <Stat value={data.pax} label="guests driven" icon="people" />
          </Row>
          <Row gap={S.md}>
            <Stat value={data.praiseCount} label="praises" icon="happy" color={C.green} />
            <Stat value={data.complaintCount} label="complaints" icon="sad" color={data.complaintCount ? C.red : C.text} />
            <Stat value={data.app.feedbackRate != null ? `${data.app.feedbackRate}%` : '—'} label="feedback collected" icon="star" />
          </Row>

          <Label>Badges</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
            {data.badges.map(b => (
              <View key={b.id} style={{ width: '30%', alignItems: 'center', gap: 6, padding: S.md, borderRadius: 16, backgroundColor: b.earned ? C.goldSoft : C.card, borderWidth: 1, borderColor: b.earned ? C.gold : C.line, opacity: b.earned ? 1 : 0.45 }}>
                <Ionicons name={BADGE_ICON[b.icon] ?? 'ribbon'} size={30} color={b.earned ? C.gold : C.dim} />
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{b.label}</Text>
              </View>
            ))}
          </View>

          {data.app.kmByMonth.length > 0 && (
            <Card style={{ gap: S.md }}>
              <Label>Kilometres per month</Label>
              <Row style={{ alignItems: 'flex-end', height: 120, gap: S.md }}>
                {data.app.kmByMonth.map(m => (
                  <View key={m.month} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: C.sub, fontSize: 11 }}>{m.km}</Text>
                    <View style={{ width: '70%', height: Math.max(4, (m.km / maxKm) * 80), backgroundColor: C.red, borderRadius: 6 }} />
                    <Text style={{ color: C.sub, fontSize: 11 }}>{fmtDay(`${m.month}-01`, { month: 'short' })}</Text>
                  </View>
                ))}
              </Row>
            </Card>
          )}

          {data.comments.length > 0 && (
            <>
              <Label>What guests said</Label>
              {data.comments.map((c, i) => (
                <Card key={i} tone={c.tone === 'praise' ? 'green' : c.tone === 'complaint' ? 'red' : undefined} style={{ gap: 4 }}>
                  <Text style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>“{c.text}”</Text>
                  <Text style={{ color: C.dim, fontSize: 12 }}>{c.bookingRef}{c.date ? ` · ${fmtDay(c.date.slice(0, 10))}` : ''}</Text>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
