import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { BookingCard, type BookingLite } from '@/components/booking-card';
import { ErrorBox, Ionicons, Label, Loading, P, Row, Screen, type IconName } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { firstName, fmtDay, greetingKey } from '@/lib/format';
import { FLAG } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';

interface Home {
  today: string; name: string; role: string; country: string; driverOps: boolean
  arrivals: BookingLite[]; departures: BookingLite[]
  counts: { onTour: number; waUnread: number; driverRequests: number; driving: number }
}

const GREET = { goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening' };

function Tile({ value, label, icon, tone, onPress }: { value: number | string; label: string; icon: IconName; tone: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1, minWidth: '30%', backgroundColor: C.card, borderRadius: R.md, padding: S.md, gap: 4, borderWidth: 1, borderColor: C.line, opacity: pressed ? 0.85 : 1 }, shadow]}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${tone}18`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: C.sub, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Quick({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 6, width: '23%' }}>
      <View style={[{ width: 56, height: 56, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, shadow]}>
        <Ionicons name={icon} size={24} color={C.red} />
      </View>
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export default function CompanyHome() {
  const { data, error, loading, refreshing, reload } = useLoad<Home>('/api/mobile/staff/home');
  if (loading && !data) return <Screen><Loading /></Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <LinearGradient colors={[C.red, C.redDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: R.lg, padding: S.xl, gap: S.md, overflow: 'hidden' }}>
        <Image alt="" source={require('@/assets/images/aahaas-mark.png')} style={{ position: 'absolute', width: 220, height: 220, right: -50, top: -40, opacity: 0.18, tintColor: '#FFFFFF' }} />
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>{GREET[greetingKey()]},</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '900' }}>{firstName(data?.name ?? '')}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
          {data ? `${fmtDay(data.today, { weekday: 'long', day: 'numeric', month: 'long' })} · ${FLAG[data.country] ?? ''} ${data.role.replace(/_/g, ' ')}` : ''}
        </Text>
        <Pressable onPress={() => router.push({ pathname: '/bookings', params: { focus: '1' } })}
          style={{ marginTop: S.sm, backgroundColor: '#FFFFFF', borderRadius: R.md, flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.lg, paddingVertical: 14 }}>
          <Ionicons name="search" size={20} color={C.sub} />
          <Text style={{ color: C.dim, fontSize: 16 }}>Search booking, IS no., guest…</Text>
        </Pressable>
      </LinearGradient>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
            <Tile value={data.counts.onTour} label="On tour now" icon="airplane" tone={C.blue} onPress={() => router.push({ pathname: '/bookings', params: { quick: 'on_ground' } })} />
            <Tile value={data.arrivals.length} label="Arriving today" icon="log-in" tone={C.green} onPress={() => router.push({ pathname: '/bookings', params: { quick: 'arrivals_today' } })} />
            <Tile value={data.departures.length} label="Leaving today" icon="log-out" tone={C.gold} onPress={() => router.push({ pathname: '/bookings', params: { quick: 'departures_today' } })} />
            <Tile value={data.counts.waUnread} label="WhatsApp unread" icon="logo-whatsapp" tone={C.green} onPress={() => router.push('/chats')} />
            {data.driverOps && <Tile value={data.counts.driving} label="Drivers driving" icon="navigate" tone={C.red} onPress={() => router.push('/live')} />}
            {data.driverOps && <Tile value={data.counts.driverRequests} label="Driver requests" icon="file-tray-full" tone={C.amber} onPress={() => router.push('/inbox')} />}
          </View>

          <Row style={{ justifyContent: 'space-between' }}>
            <Quick icon="grid-outline" label="MC Report" onPress={() => router.push('/mc-report')} />
            <Quick icon="logo-whatsapp" label="WhatsApp" onPress={() => router.push({ pathname: '/chats', params: { tab: 'wa' } })} />
            <Quick icon="people-outline" label="Team chat" onPress={() => router.push({ pathname: '/chats', params: { tab: 'team' } })} />
            <Quick icon="map-outline" label="Live map" onPress={() => router.push('/live')} />
          </Row>

          <Label>Arriving today ({data.arrivals.length})</Label>
          {data.arrivals.length === 0 && <P>No arrivals today.</P>}
          {data.arrivals.map(b => <BookingCard key={`a-${b.bookingRef}`} b={b} accent={C.green} />)}

          <Label>Leaving today ({data.departures.length})</Label>
          {data.departures.length === 0 && <P>No departures today.</P>}
          {data.departures.map(b => <BookingCard key={`d-${b.bookingRef}`} b={b} accent={C.gold} />)}
        </>
      )}
    </Screen>
  );
}
