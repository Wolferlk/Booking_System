/**
 * Pieces shared by the two registration forms (new driver, new vehicle vendor).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Input, Ionicons, Label, Row, type IconName } from '@/components/ui';
import { Chip } from '@/components/vendor-ui';
import { C, R, S } from '@/lib/theme';

export function SignupHero({ tone, icon, kicker, title, lines }: { tone: 'red' | 'ink'; icon: IconName; kicker: string; title: string; lines: string[] }) {
  const colors: [string, string] = tone === 'red' ? [C.red, C.redDeep] : ['#16213E', '#0E1525'];
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: S.lg, gap: S.md }}>
      <Row gap={S.sm}>
        <View style={styles.heroIcon}><Ionicons name={icon} size={20} color="#fff" /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: tone === 'red' ? '#FFE1E4' : '#FF8A95', fontWeight: '800', letterSpacing: 1, fontSize: 12 }}>{kicker}</Text>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{title}</Text>
        </View>
      </Row>
      {lines.map(l => (
        <Row key={l} gap={10} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="checkmark-circle" size={15} color={tone === 'red' ? '#FFFFFF' : '#93C5FD'} style={{ marginTop: 1 }} />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, flex: 1 }}>{l}</Text>
        </Row>
      ))}
    </LinearGradient>
  );
}

/** Outlined "register" door — on the welcome screen and under each sign-in form. */
export function RegisterButton({ icon, label, onPress, style }: { icon: IconName; label: string; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [styles.register, { backgroundColor: pressed ? C.cardHi : '#FFFFFF' }, style]}>
      <Ionicons name={icon} size={16} color={C.red} />
      <Text style={{ color: C.text, fontSize: 14, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

/** "New here?" + one register button, under a sign-in form. */
export function RegisterBlock({ icon, label, hint, onPress }: { icon: IconName; label: string; hint: string; onPress: () => void }) {
  return (
    <View style={{ gap: S.sm, marginTop: S.sm }}>
      <Row gap={S.sm}>
        <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
        <Text style={{ color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>NEW HERE?</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
      </Row>
      <RegisterButton icon={icon} label={label} onPress={onPress} />
      <Text style={{ color: C.sub, fontSize: 12, textAlign: 'center' }}>{hint}</Text>
    </View>
  );
}

export function CountryChips({ value, onChange, options }: {
  value: string | null
  onChange: (v: string) => void
  options: { value: string; label: string; flag: string }[]
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
      {options.map(o => (
        <Chip key={o.value} on={value === o.value} onPress={() => onChange(o.value)}>
          <Text style={{ fontSize: 16 }}>{o.flag}</Text>
          <Text style={{ color: C.text, fontWeight: '800' }}>{o.label}</Text>
        </Chip>
      ))}
    </ScrollView>
  );
}

export function PasswordFields({ password, setPassword, again, setAgain }: {
  password: string; setPassword: (v: string) => void; again: string; setAgain: (v: string) => void
}) {
  const [show, setShow] = useState(false);
  const mismatch = again.length > 0 && again !== password;
  return (
    <>
      <Label>Password</Label>
      <View>
        <Input icon="lock-closed-outline" placeholder="At least 6 characters" value={password} onChangeText={setPassword}
          secureTextEntry={!show} textContentType="newPassword" autoCapitalize="none" autoCorrect={false} />
        <Pressable onPress={() => setShow(s => !s)} hitSlop={8} style={{ position: 'absolute', right: 16, top: 18 }}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.sub} />
        </Pressable>
      </View>
      <Input icon="lock-closed-outline" placeholder="Repeat your password" value={again} onChangeText={setAgain}
        secureTextEntry={!show} textContentType="newPassword" autoCapitalize="none" autoCorrect={false} />
      {mismatch && <Text style={{ color: C.red, fontSize: 13, marginTop: -8 }}>The two passwords do not match yet.</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  register: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: R.md, borderWidth: 1.5, borderColor: C.line, paddingVertical: 12 },
  heroIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
});
