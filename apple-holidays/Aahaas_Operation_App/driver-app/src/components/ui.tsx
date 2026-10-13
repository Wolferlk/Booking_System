import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R, S, shadow } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

export function Screen({ children, refreshing, onRefresh, scroll = true, padded = true }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean
}) {
  const inner = padded ? { padding: S.lg, paddingBottom: 120, gap: S.lg } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.sub} /> : undefined}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : <View style={[{ flex: 1 }, inner]}>{children}</View>}
    </SafeAreaView>
  );
}

export function H1({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[{ color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[{ color: C.text, fontSize: 20, fontWeight: '700' }, style]}>{children}</Text>;
}
export function P({ children, style, dim }: { children: ReactNode; style?: TextStyle; dim?: boolean }) {
  return <Text style={[{ color: dim ? C.dim : C.sub, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{children}</Text>;
}

export function Card({ children, style, onPress, tone }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; tone?: 'red' | 'gold' | 'green' | 'blue' }) {
  const toneStyle = tone ? { borderColor: { red: C.red, gold: C.gold, green: C.green, blue: C.blue }[tone], backgroundColor: { red: C.redSoft, gold: C.goldSoft, green: C.greenSoft, blue: C.blueSoft }[tone] } : null;
  const body = <View style={[styles.card, toneStyle, style]}>{children}</View>;
  if (!onPress) return body;
  return <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable>;
}

export function Button({ title, onPress, icon, kind = 'primary', loading, disabled, style }: {
  title: string; onPress: () => void; icon?: IconName; kind?: 'primary' | 'secondary' | 'danger' | 'gold' | 'ghost'
  loading?: boolean; disabled?: boolean; style?: ViewStyle
}) {
  const bg = { primary: C.red, secondary: C.cardHi, danger: C.redDeep, gold: C.gold, ghost: 'transparent' }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? C.text : C.onBrand;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: C.line }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={22} color={fg} />}
          <Text style={{ color: fg, fontSize: 17, fontWeight: '700' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { icon?: IconName }) {
  const { icon, style, ...rest } = props;
  return (
    <View style={styles.input}>
      {icon && <Ionicons name={icon} size={20} color={C.sub} />}
      <TextInput placeholderTextColor={C.dim} style={[{ flex: 1, color: C.text, fontSize: 18, paddingVertical: 14 }, style]} {...rest} />
    </View>
  );
}

export function Pill({ text, tone = 'dim', icon }: { text: string; tone?: 'dim' | 'red' | 'gold' | 'green' | 'blue'; icon?: IconName }) {
  const color = { dim: C.sub, red: C.red, gold: C.gold, green: C.green, blue: C.blue }[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 99, borderWidth: 1, borderColor: color, paddingHorizontal: 10, paddingVertical: 3 }}>
      {icon && <Ionicons name={icon} size={12} color={color} />}
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Row({ children, style, gap = S.sm }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Stat({ value, label, icon, color = C.text }: { value: string | number; label: string; icon?: IconName; color?: string }) {
  return (
    <View style={[styles.card, { flex: 1, padding: S.md, gap: 2 }]}>
      {icon && <Ionicons name={icon} size={18} color={C.sub} />}
      <Text style={{ color, fontSize: 26, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: C.sub, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}><ActivityIndicator color={C.red} size="large" /></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="red" style={{ gap: S.sm }}>
      <Row><Ionicons name="alert-circle" size={20} color={C.red} /><Text style={{ color: C.text, flex: 1 }}>{message}</Text></Row>
      {onRetry && <Button title="Try again" kind="secondary" onPress={onRetry} />}
    </Card>
  );
}

export function IconButton({ icon, onPress, badge, color = C.text }: { icon: IconName; onPress: () => void; badge?: number; color?: string }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} hitSlop={12} style={styles.iconBtn}>
      <Ionicons name={icon} size={24} color={color} />
      {!!badge && <View style={styles.badge}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{badge > 9 ? '9+' : badge}</Text></View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.lg, ...shadow },
  btn: { minHeight: 58, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, paddingHorizontal: S.lg },
  input: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg },
  iconBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
