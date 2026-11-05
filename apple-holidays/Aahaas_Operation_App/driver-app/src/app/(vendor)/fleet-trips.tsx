/**
 * Vendor trips — everything ops gave this fleet: what still needs a driver or
 * vehicle, all upcoming, and the last 60 days.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { PageHeader, Segmented } from '@/components/fancy';
import { ErrorBox, Label, Loading, Screen } from '@/components/ui';
import { JobCard } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { fmtDay } from '@/lib/format';
import { C } from '@/lib/theme';
import type { VendorJob } from '@/lib/vendor';

type View_ = 'todo' | 'upcoming' | 'past';

export default function FleetTrips() {
  const params = useLocalSearchParams<{ view?: View_ }>();
  const [view, setView] = useState<View_>(params.view ?? 'upcoming');
  useEffect(() => { if (params.view) setView(params.view); }, [params.view]);
  const { data, error, loading, refreshing, reload } = useLoad<{ today: string; jobs: VendorJob[] }>(
    `/api/mobile/vendor/trips?scope=${view === 'past' ? 'past' : 'upcoming'}`,
  );
  const all = data?.jobs ?? [];
  const todo = all.filter(j => j.state === 'NEEDS_DRIVER' || j.state === 'NEEDS_VEHICLE');
  const list = view === 'todo' ? todo : all;

  // Group by month so a long season stays readable.
  const groups = new Map<string, VendorJob[]>();
  for (const j of list) {
    const k = fmtDay(j.startDate, { month: 'long', year: 'numeric' });
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <PageHeader title="Trips" icon="map" colors={['#0E1525', '#16213E', '#24345E']}
        sub={data ? `${all.length} ${view === 'past' ? 'done' : 'upcoming'}${view !== 'past' && todo.length ? ` · ${todo.length} need a driver` : ''}` : 'Loading…'} />
      <Segmented<View_> value={view} onChange={setView} options={[
        { id: 'todo', label: 'To do', count: view === 'past' ? undefined : todo.length },
        { id: 'upcoming', label: 'Upcoming' },
        { id: 'past', label: 'Past' },
      ]} />
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && list.length === 0 && (
        <View style={{ alignItems: 'center', padding: 30, gap: 6 }}>
          <Text style={{ fontSize: 40 }}>{view === 'todo' ? '✅' : '🗺️'}</Text>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 17 }}>{view === 'todo' ? 'Every trip has a driver' : view === 'past' ? 'No trips in the last 60 days' : 'No upcoming trips yet'}</Text>
          {view === 'upcoming' && <Text style={{ color: C.sub, textAlign: 'center' }}>Request open trips in Get trips — approved ones appear here.</Text>}
        </View>
      )}
      {Array.from(groups.entries()).map(([month, jobs]) => (
        <View key={month} style={{ gap: 10 }}>
          <Label>{month}</Label>
          {jobs.map((j, i) => <JobCard key={j.key} job={j} i={i} />)}
        </View>
      ))}
    </Screen>
  );
}
