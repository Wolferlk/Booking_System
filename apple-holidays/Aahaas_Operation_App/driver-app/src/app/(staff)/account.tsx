import { router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, H1, P, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { C, S } from '@/lib/theme';

export default function Account() {
  const { actor, signOut } = useAuth();
  if (!actor || actor.kind !== 'STAFF') return null;
  return (
    <Screen>
      <H1>{actor.name}</H1>
      <Card style={{ gap: S.sm }}>
        <P>{actor.email}</P>
        <Text style={{ color: C.gold, fontWeight: '800' }}>{actor.role.replace(/_/g, ' ')} · {actor.country}</Text>
      </Card>
      <P>The full Driver App board (map, requests, vehicle photos, app drivers) is also on ops.aahaas.com → Driver App.</P>
      <Button title="Sign out" kind="ghost" icon="log-out-outline" onPress={() => { signOut(); router.replace('/welcome'); }} />
      <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>Aahaas Driver {APP_VERSION}</Text>
    </Screen>
  );
}
