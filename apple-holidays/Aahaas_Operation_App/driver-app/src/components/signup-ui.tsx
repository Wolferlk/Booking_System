/**
 * Pieces shared by the two registration forms (new driver, new vehicle vendor).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Input, Ionicons, Label, Row, type IconName } from '@/components/ui';
import { Chip } from '@/components/vendor-ui';
import { C, S } from '@/lib/theme';

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
  heroIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
});
