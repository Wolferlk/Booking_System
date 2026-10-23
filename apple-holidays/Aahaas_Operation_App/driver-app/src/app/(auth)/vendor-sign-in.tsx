/**
 * Vehicle vendor sign-in — the same e-mail or phone and password as the vendor
 * portal (ops.aahaas.com/vendor/login). Changing that password signs the app out.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorBox, IconButton, Input, Ionicons, P, Row } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Actor } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { getPendingSignup } from '@/lib/signup';
import { C, S } from '@/lib/theme';

const PERKS: { icon: 'people' | 'car' | 'git-compare' | 'flash'; text: string }[] = [
  { icon: 'people', text: 'Add drivers — they sign in with a WhatsApp code' },
  { icon: 'car', text: 'Add vehicles and pair each one with a driver' },
  { icon: 'git-compare', text: 'Put a driver and vehicle on every trip' },
  { icon: 'flash', text: 'Request open trips for your fleet' },
];

export default function VendorSignIn() {
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const [identifier, setIdentifier] = useState(params.identifier ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; actor: Actor }>('/api/mobile/auth/login', {
        auth: false,
        body: { identifier: identifier.trim(), password, as: 'VENDOR', platform: Platform.OS, appVersion: APP_VERSION },
      });
      await signIn(r.token, r.actor);
      router.replace('/');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'pending_approval' && (await getPendingSignup())?.kind === 'VENDOR') router.push('/pending');
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: S.xl, gap: S.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
          <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 110, height: 42 }} contentFit="contain" />
        </Row>

        <LinearGradient colors={['#16213E', '#0E1525']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: S.lg, gap: S.md }}>
          <Row gap={S.sm}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="bus" size={20} color="#fff" />
            </View>
            <View>
              <Text style={{ color: '#FF8A95', fontWeight: '800', letterSpacing: 1, fontSize: 12 }}>VEHICLE VENDOR</Text>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>Run your fleet</Text>
            </View>
          </Row>
          {PERKS.map(p => (
            <Row key={p.text} gap={10}>
              <Ionicons name={p.icon} size={15} color="#93C5FD" />
              <Text style={{ color: 'rgba(255,255,255,0.86)', fontSize: 13, flex: 1 }}>{p.text}</Text>
            </Row>
          ))}
        </LinearGradient>

        <P>Use the e-mail or phone number and password of your vendor portal account.</P>
        <Input icon="person-outline" placeholder="E-mail or phone" value={identifier} onChangeText={setIdentifier}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
        <View>
          <Input icon="lock-closed-outline" placeholder="Password" value={password} onChangeText={setPassword}
            secureTextEntry={!show} textContentType="password" onSubmitEditing={submit} />
          <Pressable onPress={() => setShow(s => !s)} style={{ position: 'absolute', right: 16, top: 18 }}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.sub} />
          </Pressable>
        </View>
        {error && <ErrorBox message={error} />}
        <Button title="Sign in" icon="log-in-outline" onPress={submit} loading={busy} disabled={identifier.trim().length < 5 || !password} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.push('/register-vendor')}>
            <Text style={{ color: C.blue, fontWeight: '700', padding: 6 }}>New vendor? Register</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(`${API_URL}/vendor/login`)}>
            <Text style={{ color: C.gold, fontWeight: '700', padding: 6 }}>Open web portal</Text>
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
