import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, type IconName } from '@/components/ui';
import { C, R, S, shadow } from '@/lib/theme';

function RoleCard({ icon, title, lines, onPress, primary }: { icon: IconName; title: string; lines: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <LinearGradient
        colors={primary ? [C.red, C.redDeep] : ['#FFFFFF', '#FFFFFF']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[{ borderRadius: R.lg, padding: S.xl, flexDirection: 'row', alignItems: 'center', gap: S.lg, borderWidth: primary ? 0 : 1, borderColor: C.line }, shadow]}>
        <View style={{ width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? 'rgba(255,255,255,0.18)' : C.redSoft }}>
          <Ionicons name={icon} size={30} color={primary ? '#FFFFFF' : C.red} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: primary ? '#FFFFFF' : C.text, fontSize: 20, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: primary ? 'rgba(255,255,255,0.85)' : C.sub, fontSize: 14 }}>{lines}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={primary ? '#FFFFFF' : C.dim} />
      </LinearGradient>
    </Pressable>
  );
}

export default function Welcome() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* the logo's dashed orbit, echoed large behind the brand */}
      <Image alt="" source={require('@/assets/images/aahaas-mark.png')} style={{ position: 'absolute', width: 520, height: 520, top: -150, right: -190, opacity: 0.07 }} />
      <SafeAreaView style={{ flex: 1, padding: S.xl, justifyContent: 'space-between' }}>
        <View style={{ marginTop: 48, gap: S.lg }}>
          <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 230, height: 87 }} contentFit="contain" />
          <View style={{ gap: S.sm }}>
            <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.6, lineHeight: 36 }}>Every trip,{'\n'}in your pocket.</Text>
            <Text style={{ color: C.sub, fontSize: 16, lineHeight: 23 }}>Operations for Aahaas & Apple Holidays — Sri Lanka, Vietnam, Singapore and Malaysia.</Text>
          </View>
        </View>

        <View style={{ gap: S.md }}>
          <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>SIGN IN AS</Text>
          <RoleCard primary icon="car-sport" title="Driver" lines="Today’s trip, km, guest QR, your score"
            onPress={() => router.push({ pathname: '/sign-in', params: { as: 'DRIVER' } })} />
          <RoleCard icon="briefcase" title="Company" lines="Bookings, chats, MC report, drivers"
            onPress={() => router.push('/company-sign-in')} />
          <Pressable onPress={() => router.push({ pathname: '/verify', params: { purpose: 'ACTIVATE' } })} style={{ alignItems: 'center', padding: S.md }}>
            <Text style={{ color: C.sub }}>New driver? <Text style={{ color: C.red, fontWeight: '800' }}>Verify your phone</Text></Text>
          </Pressable>
          <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>aahaas · uniquely yours</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
