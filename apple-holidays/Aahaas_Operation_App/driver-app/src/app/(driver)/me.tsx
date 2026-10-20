import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { IconBubble } from '@/components/fancy';
import { Ionicons, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { LANGS, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';

const WORDMARK_WHITE = require('../../../assets/images/aahaas-wordmark-white.png');
const FLAGS: Record<string, string> = { en: '🇬🇧', si: '🇱🇰', ta: '🇱🇰', vi: '🇻🇳' };

function Line({ icon, color, bg, label, value }: { icon: IconName; color: string; bg: string; label: string; value: string | null | undefined }) {
  return (
    <View style={styles.line}>
      <IconBubble icon={icon} color={color} bg={bg} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.lineLabel}>{label}</Text>
        <Text style={styles.lineValue} numberOfLines={1}>{value || '—'}</Text>
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

export default function Me() {
  const t = useT();
  const { actor, signOut, setLanguage, refresh } = useAuth();
  useFocusEffect(useCallback(() => { refresh().catch(() => {}); }, [refresh]));
  if (!actor || actor.kind !== 'DRIVER') return null;
  const photo = actor.photoUrl ? (actor.photoUrl.startsWith('http') ? actor.photoUrl : `${API_URL}${actor.photoUrl}`) : null;
  const vc = actor.vehicleCheck;
  const v = actor.vehicle;
  const initials = actor.name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <Screen>
      {/* profile */}
      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <LinearGradient colors={['#0A1640', '#122B78', '#1D3FA0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.circleA} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Image source={WORDMARK_WHITE} style={{ width: 74, height: 24 }} contentFit="contain" alt="Aahaas" />
            <View style={styles.rolePill}><Ionicons name="car-sport" size={12} color="#fff" /><Text style={styles.roleText}>DRIVER</Text></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <LinearGradient colors={['#FF7A87', '#FF2638', '#FCD34D']} style={styles.ring}>
              <View style={styles.avatar}>
                {photo ? <Image alt="" source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={styles.initials}>{initials}</Text>}
              </View>
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>{actor.name}</Text>
              <Text style={styles.vendor} numberOfLines={1}>{actor.vendor ? actor.vendor : 'Aahaas driver'}</Text>
              <Text style={styles.version}>Aahaas CORE {APP_VERSION}</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      {/* vehicle */}
      <Animated.View entering={FadeInDown.delay(80).springify().damping(18)}>
        <Pressable onPress={() => router.push('/vehicle-check')} style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.99 }] }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.section}>{t('vehiclePhotos').toUpperCase()}</Text>
            {vc && (
              <View style={[styles.due, { backgroundColor: vc.due ? C.redSoft : C.greenSoft }]}>
                <Ionicons name={vc.due ? 'camera' : 'checkmark-circle'} size={12} color={vc.due ? C.red : C.green} />
                <Text style={{ color: vc.due ? C.red : C.green, fontWeight: '900', fontSize: 12 }}>{vc.due ? 'Photos due' : `${vc.daysLeft} days left`}</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <LinearGradient colors={['#E0E7FF', '#C7D2FE']} style={styles.carBox}>
              <Ionicons name="car-sport" size={34} color="#3730A3" />
            </LinearGradient>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.vehicle} numberOfLines={1}>{v ? `${v.brand ?? ''} ${v.model ?? v.type}`.trim() : 'No vehicle yet'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.plate}><Text style={styles.plateText}>{v?.plateNo || '— — —'}</Text></View>
                {v && <View style={styles.seats}><Ionicons name="people" size={12} color={C.sub} /><Text style={styles.seatsText}>{v.capacity} seats</Text></View>}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.dim} />
          </View>
        </Pressable>
      </Animated.View>

      {/* details */}
      <Animated.View entering={FadeInDown.delay(140).springify().damping(18)} style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.section}>MY DETAILS</Text>
          <Pressable onPress={() => router.push('/profile-edit')} style={styles.change} hitSlop={8}>
            <Ionicons name="create" size={14} color="#B45309" /><Text style={{ color: '#B45309', fontWeight: '900', fontSize: 12 }}>Change</Text>
          </Pressable>
        </View>
        <Line icon="call" color="#16A34A" bg="#ECFDF3" label="Phone" value={actor.phone} />
        <Line icon="mail" color="#2563EB" bg="#EFF6FF" label="E-mail" value={actor.email} />
        <Line icon="id-card" color="#7C3AED" bg="#F5F3FF" label="Licence" value={actor.licenseNo} />
        <Line icon="business" color="#D97706" bg="#FFFBEB" label="Bank" value={actor.bank ? `${actor.bank.bankName ?? ''} ${actor.bank.accountNo ?? ''}`.trim() : null} />
        {!!actor.pendingProfileChanges && (
          <View style={[styles.due, { backgroundColor: C.goldSoft, alignSelf: 'flex-start' }]}>
            <Ionicons name="hourglass" size={12} color={C.gold} /><Text style={{ color: C.gold, fontWeight: '900', fontSize: 12 }}>Change waiting for operations</Text>
          </View>
        )}
      </Animated.View>

      {/* language */}
      <Animated.View entering={FadeInDown.delay(200).springify().damping(18)} style={styles.card}>
        <Text style={styles.section}>{t('language').toUpperCase()}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LANGS.map(l => {
            const on = actor.language === l.id;
            return (
              <Pressable key={l.id} onPress={() => setLanguage(l.id).catch(e => Alert.alert('Could not change', e.message))}
                style={({ pressed }) => [styles.lang, on && styles.langOn, pressed && { transform: [{ scale: 0.96 }] }]}>
                <Text style={{ fontSize: 18 }}>{FLAGS[l.id] ?? '🌐'}</Text>
                <Text style={[styles.langText, on && { color: '#fff' }]}>{l.label}</Text>
                {on && <Ionicons name="checkmark-circle" size={16} color="#fff" />}
              </Pressable>
            );
          })}
        </View>
      </Animated.View>

      {/* menu */}
      <Animated.View entering={FadeInDown.delay(260).springify().damping(18)} style={[styles.card, { padding: 6, gap: 0 }]}>
        <MenuRow icon="notifications" color="#2563EB" bg="#EFF6FF" title={t('notifications')} sub="Trips, reminders and updates" onPress={() => router.push('/notifications')} />
        <MenuRow icon="chatbox-ellipses" color="#7C3AED" bg="#F5F3FF" title="My requests to operations" sub="Hand-overs, help, profile changes" onPress={() => router.push('/requests')} />
        <MenuRow icon="alert-circle" color={C.red} bg={C.redSoft} title={t('help')} sub="Call or message operations" onPress={() => router.push('/help')} />
      </Animated.View>

      <Pressable onPress={() => Alert.alert(t('signOut'), 'Sign out of this phone?', [
        { text: 'Cancel', style: 'cancel' }, { text: t('signOut'), style: 'destructive', onPress: () => { signOut(); router.replace('/welcome'); } },
      ])} style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: C.redSoft }]}>
        <Ionicons name="log-out-outline" size={18} color={C.red} />
        <Text style={{ color: C.red, fontWeight: '900', fontSize: 15 }}>{t('signOut')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 28, padding: 16, gap: 16, overflow: 'hidden' },
  circleA: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.06)', right: -60, top: -70 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  ring: { width: 84, height: 84, borderRadius: 30, padding: 3 },
  avatar: { flex: 1, borderRadius: 27, overflow: 'hidden', backgroundColor: '#122B78', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#0A1640' },
  initials: { color: '#fff', fontSize: 26, fontWeight: '900' },
  name: { color: '#fff', fontSize: 24, fontWeight: '900', textTransform: 'capitalize' },
  vendor: { color: '#C7D2FE', fontSize: 14, fontWeight: '700' },
  version: { color: '#93C5FD', fontSize: 11, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line },
  section: { color: C.dim, fontWeight: '900', fontSize: 12, letterSpacing: 1.2 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  carBox: { width: 66, height: 66, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  vehicle: { color: C.text, fontSize: 17, fontWeight: '900' },
  plate: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#0E1525', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  plateText: { color: '#0E1525', fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
  seats: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.cardHi, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  seatsText: { color: C.sub, fontWeight: '800', fontSize: 12 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFBEB', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineLabel: { color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  lineValue: { color: C.text, fontSize: 15, fontWeight: '700' },
  lang: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.cardHi },
  langOn: { backgroundColor: C.red },
  langText: { color: C.text, fontWeight: '800', fontSize: 15 },
  menu: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18 },
  menuTitle: { color: C.text, fontWeight: '800', fontSize: 15 },
  menuSub: { color: C.sub, fontSize: 12 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 18, borderWidth: 1.5, borderColor: '#FECDD3', paddingVertical: 14 },
});
