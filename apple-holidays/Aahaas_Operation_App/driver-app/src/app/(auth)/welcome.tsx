import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, type IconName } from '@/components/ui';
import { C, R, S, shadow } from '@/lib/theme';

function RoleCard({ icon, title, lines, onPress, tone }: { icon: IconName; title: string; lines: string; onPress: () => void; tone: 'red' | 'ink' }) {
  const colors: [string, string] = tone === 'red' ? [C.red, C.redDeep] : ['#16213E', '#0E1525'];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[{ borderRadius: R.lg, padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.lg }, shadow]}>
        <View style={{ width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' }}>
          <Ionicons name={icon} size={28} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{lines}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
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
        <View style={{ marginTop: 40, gap: S.lg }}>
          <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 230, height: 87 }} contentFit="contain" />
          <View style={{ gap: S.sm }}>
            <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.6, lineHeight: 36 }}>Every trip,{'\n'}in your pocket.</Text>
            <Text style={{ color: C.sub, fontSize: 16, lineHeight: 23 }}>Operations for Aahaas & Apple Holidays — Sri Lanka, Vietnam, Singapore and Malaysia.</Text>
          </View>
        </View>

        <View style={{ gap: S.md }}>
          <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>SIGN IN AS</Text>
          <RoleCard tone="red" icon="car-sport" title="Driver" lines="Today’s trip, km, guest QR, your score"
            onPress={() => router.push({ pathname: '/sign-in', params: { as: 'DRIVER' } })} />
          <RoleCard tone="ink" icon="bus" title="Vehicle Vendor" lines="Your fleet, drivers, vehicles and trips"
            onPress={() => router.push('/vendor-sign-in')} />
          <Pressable onPress={() => router.push({ pathname: '/verify', params: { purpose: 'ACTIVATE' } })} style={{ alignItems: 'center', paddingTop: S.sm }}>
            <Text style={{ color: C.sub }}>New driver? <Text style={{ color: C.red, fontWeight: '800' }}>Verify your phone</Text></Text>
          </Pressable>
          {/* Staff use ops.aahaas.com day to day — the app login is the minor door. */}
          <Pressable onPress={() => router.push('/company-sign-in')} hitSlop={8}
            style={({ pressed }) => [{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 99, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: pressed ? C.cardHi : '#FFFFFF' }]}>
            <Ionicons name="briefcase-outline" size={14} color={C.sub} />
            <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>Company login</Text>
          </Pressable>
          <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>aahaas · uniquely yours</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
