import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Ionicons, Row } from '@/components/ui';
import { C, S } from '@/lib/theme';

export default function Welcome() {
  return (
    <LinearGradient colors={['#2A0A14', C.bg, C.bg]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: S.xl, justifyContent: 'space-between' }}>
        <View style={{ alignItems: 'center', marginTop: 60, gap: S.lg }}>
          <Image alt="" source={require('@/assets/images/icon.png')} style={{ width: 132, height: 132, borderRadius: 32 }} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ color: C.text, fontSize: 32, fontWeight: '900' }}>Aahaas Driver</Text>
            <Text style={{ color: C.gold, fontSize: 16, fontWeight: '700', letterSpacing: 2 }}>APPLE HOLIDAYS · OPERATIONS</Text>
          </View>
          <View style={{ gap: S.md, marginTop: S.xl, alignSelf: 'stretch' }}>
            {[
              ['calendar', 'Your trips, day by day'],
              ['speedometer', 'Kilometres counted for you'],
              ['qr-code', 'Guest portal & feedback in one tap'],
              ['trophy', 'See your score and badges'],
            ].map(([icon, text]) => (
              <Row key={text} gap={S.md}>
                <Ionicons name={icon as never} size={22} color={C.gold} />
                <Text style={{ color: C.text, fontSize: 17 }}>{text}</Text>
              </Row>
            ))}
          </View>
        </View>
        <View style={{ gap: S.md }}>
          <Button title="Sign in" icon="log-in-outline" onPress={() => router.push('/sign-in')} />
          <Button title="First time? Verify your phone" kind="secondary" icon="phone-portrait-outline" onPress={() => router.push({ pathname: '/verify', params: { purpose: 'ACTIVATE' } })} />
          <Text style={{ color: C.dim, textAlign: 'center', fontSize: 13 }}>Use the phone number or e-mail you gave on the driver registration form.</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
