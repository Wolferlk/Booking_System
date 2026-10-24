/** Vendor account — company details on file, the web portal, sign out. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { IconBubble } from '@/components/fancy';
import { Ionicons, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL, APP_NAME, APP_VERSION_LABEL, OPS_PHONE } from '@/lib/config';
import { C } from '@/lib/theme';
import { initials } from '@/lib/vendor';

const WORDMARK_WHITE = require('@/assets/images/aahaas-wordmark-white.png');
const COUNTRY: Record<string, string> = { SRILANKA: 'Sri Lanka', VIETNAM: 'Vietnam', SINGAPORE_MALAYSIA: 'Singapore & Malaysia', SINGAPORE: 'Singapore', MALAYSIA: 'Malaysia', ALL: 'All countries' };

function Line({ icon, label, value }: { icon: IconName; label: string; value: string | null | undefined }) {
  return (
    <View style={styles.line}>
      <IconBubble icon={icon} color={C.blue} bg={C.blueSoft} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.lineLabel}>{label}</Text>
        <Text style={styles.lineValue} numberOfLines={2}>{value || '—'}</Text>
      </View>
    </View>
  );
}

function MenuRow({ icon, color, bg, title, sub, onPress }: { icon: IconName; color: string; bg: string; title: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menu, pressed && { backgroundColor: C.cardHi }]}>
      <IconBubble icon={icon} color={color} bg={bg} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.dim} />
    </Pressable>
  );
}

export default function FleetAccount() {
  const { actor, signOut, refresh } = useAuth();
  useFocusEffect(useCallback(() => { refresh().catch(() => {}); }, [refresh]));
  if (!actor || actor.kind !== 'VENDOR') return null;

  return (
    <Screen>
      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <LinearGradient colors={['#0E1525', '#16213E', '#24345E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Image source={WORDMARK_WHITE} style={{ width: 74, height: 24 }} contentFit="contain" alt="Aahaas" />
            <View style={styles.rolePill}><Ionicons name="bus" size={12} color="#fff" /><Text style={styles.roleText}>VEHICLE VENDOR</Text></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={styles.logo}><Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }}>{initials(actor.name)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }} numberOfLines={2}>{actor.name}</Text>
              <Text style={{ color: '#C7D2FE', fontWeight: '700' }}>{COUNTRY[actor.country ?? ''] ?? actor.country ?? '—'}</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      <View style={styles.card}>
        <Line icon="mail" label="E-mail" value={actor.email} />
        <Line icon="call" label="Phone" value={actor.phone} />
        <Line icon="logo-whatsapp" label="WhatsApp" value={actor.whatsappPhone} />
        <Line icon="location" label="Address" value={actor.address} />
        <Line icon="card" label="Bank" value={actor.bank ? [actor.bank.bankName, actor.bank.accountNo].filter(Boolean).join(' · ') : null} />
      </View>
      <Text style={{ color: C.dim, fontSize: 12, marginTop: -8 }}>To change company or bank details, use the web portal or ask operations.</Text>

      <View style={styles.card}>
        <MenuRow icon="notifications" color={C.red} bg={C.redSoft} title="Notifications" sub="Trip approvals and changes" onPress={() => router.push('/notifications')} />
        <MenuRow icon="globe" color={C.blue} bg={C.blueSoft} title="Open the web portal" sub="ops.aahaas.com/vendor" onPress={() => Linking.openURL(`${API_URL}/vendor/login`)} />
        <MenuRow icon="headset" color={C.green} bg={C.greenSoft} title="Call operations" sub={OPS_PHONE} onPress={() => Linking.openURL(`tel:${OPS_PHONE}`)} />
        <MenuRow icon="log-out" color={C.sub} bg={C.cardHi} title="Sign out" onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { signOut(); } }])} />
      </View>
      <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>{APP_NAME} · {APP_VERSION_LABEL}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 28, padding: 18, gap: 18, overflow: 'hidden' },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  lineLabel: { color: C.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  lineValue: { color: C.text, fontSize: 15, fontWeight: '700' },
  menu: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16 },
  menuTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  menuSub: { color: C.sub, fontSize: 12 },
});
