import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { PageHeader, StatTile } from '@/components/fancy';
import { ScoreRing } from '@/components/score-ring';
import { ErrorBox, Ionicons, Loading, Screen, type IconName } from '@/components/ui';
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

function Stars({ n }: { n: number | null }) {
  if (n == null) return <Text style={{ color: '#C7D2FE', fontWeight: '800' }}>No guest ratings yet</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Animated.View key={i} entering={FadeInDown.delay(600 + i * 90).springify()}>
          <Ionicons name={i < Math.round(n) ? 'star' : 'star-outline'} size={22} color="#FCD34D" />
        </Animated.View>
      ))}
      <Text style={{ color: '#fff', fontWeight: '900', marginLeft: 6 }}>{n.toFixed(1)}</Text>
    </View>
  );
}

function Badge({ b, i }: { b: Perf['badges'][number]; i: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (b.earned) y.value = withDelay(i * 200, withRepeat(withSequence(withTiming(-4, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1, false));
  }, [b.earned, i, y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View entering={FadeInDown.delay(300 + i * 60).springify()} style={{ width: '31%' }}>
      {b.earned ? (
        <LinearGradient colors={['#FFF4CC', '#FCD34D']} style={styles.badge}>
          <Animated.View style={[styles.badgeIcon, { backgroundColor: '#fff' }, st]}>
            <Ionicons name={BADGE_ICON[b.icon] ?? 'ribbon'} size={26} color="#D97706" />
          </Animated.View>
          <Text style={[styles.badgeText, { color: '#78350F' }]}>{b.label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.badge, { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' }]}>
          <View style={[styles.badgeIcon, { backgroundColor: C.cardHi }]}>
            <Ionicons name={BADGE_ICON[b.icon] ?? 'ribbon'} size={24} color={C.dim} />
            <View style={styles.lock}><Ionicons name="lock-closed" size={10} color="#fff" /></View>
          </View>
          <Text style={[styles.badgeText, { color: C.dim }]}>{b.label}</Text>
        </View>
      )}
    </Animated.View>
  );
}

function Bar({ km, max, label, i }: { km: number; max: number; label: string; i: number }) {
  const h = useSharedValue(0);
  useEffect(() => { h.value = withDelay(300 + i * 120, withSpring(Math.max(6, (km / max) * 100), { damping: 14 })); }, [km, max, i, h]);
  const st = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text style={{ color: C.sub, fontSize: 11, fontWeight: '800' }}>{km}</Text>
      <Animated.View style={[{ width: '62%', borderRadius: 8, overflow: 'hidden' }, st]}>
        <LinearGradient colors={['#FF7A87', C.red]} style={{ flex: 1 }} />
      </Animated.View>
      <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700' }}>{fmtDay(`${label}-01`, { month: 'short' })}</Text>
    </View>
  );
}

export default function Score() {
  const t = useT();
  const { data, error, loading, refreshing, reload } = useLoad<Perf>('/api/mobile/performance');
  if (loading && !data) return <Screen><Loading /></Screen>;
  const maxKm = Math.max(1, ...(data?.app.kmByMonth.map(m => m.km) ?? [1]));
  const earned = data?.badges.filter(b => b.earned).length ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <PageHeader title={t('score')} icon="trophy" sub={`${earned} of ${data.badges.length} badges earned`}>
            <View style={{ alignItems: 'center', gap: 8, paddingBottom: 4 }}>
              <ScoreRing score={data.score} grade={data.grade} light />
              <Stars n={data.rating} />
              <Text style={{ color: '#C7D2FE', fontSize: 12, fontWeight: '700' }}>
                From {data.ratedBookings} guest {data.ratedBookings === 1 ? 'rating' : 'ratings'}{data.responseRate != null ? ` · ${Math.round(data.responseRate * (data.responseRate <= 1 ? 100 : 1))}% of guests rated` : ''}
              </Text>
            </View>
          </PageHeader>

          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <StatTile value={data.app.totalKm} label="km in the app" icon="speedometer" colors={['#FFF7E0', '#FFE3A3']} accent="#D97706" delay={100} />
            <StatTile value={data.toursDone} label="tours done" icon="flag" colors={['#EFF6FF', '#BFDBFE']} accent="#2563EB" delay={160} />
            <StatTile value={data.pax} label="guests driven" icon="people" colors={['#F5F3FF', '#DDD6FE']} accent="#7C3AED" delay={220} />
          </View>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <StatTile value={data.praiseCount} label="praises" icon="happy" colors={['#ECFDF3', '#BBF7D0']} accent="#16A34A" delay={280} />
            <StatTile value={data.complaintCount} label="complaints" icon="sad" colors={data.complaintCount ? ['#FFF1F2', '#FECDD3'] : ['#F8FAFC', '#E2E8F0']} accent={data.complaintCount ? C.red : '#64748B'} delay={340} />
            <StatTile value={data.app.feedbackRate} suffix="%" label="feedback collected" icon="star" colors={['#FFFBEB', '#FDE68A']} accent="#D97706" delay={400} />
          </View>

          <Text style={styles.section}>BADGES</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
            {data.badges.map((b, i) => <Badge key={b.id} b={b} i={i} />)}
          </View>

          {data.app.kmByMonth.length > 0 && (
            <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.chart}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="bar-chart" size={18} color={C.red} />
                <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>Kilometres per month</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 6 }}>
                {data.app.kmByMonth.map((m, i) => <Bar key={m.month} km={m.km} max={maxKm} label={m.month} i={i} />)}
              </View>
            </Animated.View>
          )}

          {data.comments.length > 0 && (
            <>
              <Text style={styles.section}>WHAT GUESTS SAID</Text>
              {data.comments.map((c, i) => {
                const tone = c.tone === 'praise' ? { bg: '#ECFDF3', fg: '#166534', icon: 'happy' as IconName } : c.tone === 'complaint' ? { bg: '#FFF1F2', fg: '#9F1239', icon: 'sad' as IconName } : { bg: C.card, fg: C.text, icon: 'chatbubble' as IconName };
                return (
                  <Animated.View key={i} entering={FadeInDown.delay(i * 60).springify()} style={[styles.bubble, { backgroundColor: tone.bg }]}>
                    <Ionicons name={tone.icon} size={20} color={tone.fg} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: tone.fg, fontSize: 15, lineHeight: 21, fontWeight: '600' }}>“{c.text}”</Text>
                      <Text style={{ color: C.dim, fontSize: 12 }}>{c.bookingRef}{c.date ? ` · ${fmtDay(c.date.slice(0, 10))}` : ''}</Text>
                    </View>
                  </Animated.View>
                );
              })}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: C.dim, fontWeight: '900', fontSize: 12, letterSpacing: 1.2, marginTop: 4 },
  badge: { borderRadius: 20, padding: 12, alignItems: 'center', gap: 8, minHeight: 116 },
  badgeIcon: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  lock: { position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.dim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  chart: { backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line },
  bubble: { flexDirection: 'row', gap: 10, borderRadius: 20, borderTopLeftRadius: 6, padding: 14, borderWidth: 1, borderColor: C.line },
});
