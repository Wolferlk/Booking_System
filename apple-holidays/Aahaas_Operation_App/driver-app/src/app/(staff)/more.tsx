import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Card, Ionicons, Label, Row, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { C, R, S } from '@/lib/theme';

function Item({ icon, label, hint, onPress, tone = C.red }: { icon: IconName; label: string; hint?: string; onPress: () => void; tone?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${tone}18`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={tone} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>{label}</Text>
        {hint && <Text style={{ color: C.sub, fontSize: 12 }}>{hint}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.dim} />
    </Pressable>
  );
}

export default function More() {
  const { actor, signOut } = useAuth();
  if (!actor || actor.kind !== 'STAFF') return null;
  return (
    <Screen>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 20 }}>{actor.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>{actor.name}</Text>
          <Text style={{ color: C.sub }}>{actor.email}</Text>
          <Text style={{ color: C.red, fontWeight: '700', fontSize: 12, marginTop: 2 }}>{actor.role.replace(/_/g, ' ')} · {actor.country}</Text>
        </View>
      </Card>

      <Label>Operations</Label>
      <Card style={{ paddingVertical: S.xs }}>
        <Item icon="grid" label="MC Report" hint="Movements, drivers, what needs a driver" onPress={() => router.push('/mc-report')} />
        <Item icon="speedometer" label="Ops Board" hint="Who is on the ground and is every tour ready" tone={C.blue} onPress={() => router.push('/ops-board')} />
        <Item icon="map" label="Live drivers" hint="Who is on the road, km today" tone={C.green} onPress={() => router.push('/live')} />
        <Item icon="file-tray-full" label="Driver requests" hint="Help calls, driver changes, vehicle photos" tone={C.amber} onPress={() => router.push('/inbox')} />
        <Item icon="car-sport" label="Drivers & vehicles" tone={C.blue} onPress={() => router.push('/drivers')} />
      </Card>

      <Label>Communication</Label>
      <Card style={{ paddingVertical: S.xs }}>
        <Item icon="logo-whatsapp" label="WhatsApp inbox" tone={C.green} onPress={() => router.push({ pathname: '/chats', params: { tab: 'wa' } })} />
        <Item icon="people" label="Team chat" tone={C.blue} onPress={() => router.push({ pathname: '/chats', params: { tab: 'team' } })} />
        <Item icon="notifications" label="WhatsApp alerts" hint="Sounds, vibration, quiet hours, muted chats" tone={C.green} onPress={() => router.push('/wa-alerts')} />
      </Card>

      <Label>Account</Label>
      <Card style={{ paddingVertical: S.xs }}>
        <Item icon="globe-outline" label="Open ops.aahaas.com" hint="Full web system" tone={C.sub} onPress={() => Linking.openURL(API_URL)} />
        <Item icon="log-out-outline" label="Sign out" tone={C.red} onPress={() => Alert.alert('Sign out', 'Sign out of this phone?', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { signOut(); router.replace('/welcome'); } },
        ])} />
      </Card>

      <Row gap={S.sm} style={{ justifyContent: 'center', marginTop: S.lg }}>
        <Image alt="" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 90, height: 34, opacity: 0.8 }} contentFit="contain" />
      </Row>
      <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12, borderRadius: R.sm }}>Version {APP_VERSION} · every change is logged</Text>
    </Screen>
  );
}
