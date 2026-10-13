import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorBox, H1, Input, IconButton, P } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Actor } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { C, S } from '@/lib/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [critical, setCritical] = useState('');
  const [needCritical, setNeedCritical] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; actor: Actor }>('/api/mobile/auth/login', {
        auth: false,
        body: { identifier: identifier.trim(), password, criticalPassword: critical || undefined, as: 'DRIVER', platform: Platform.OS, appVersion: APP_VERSION },
      });
      await signIn(r.token, r.actor);
      router.replace('/');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'not_activated') {
        router.push({ pathname: '/verify', params: { purpose: 'ACTIVATE', identifier: identifier.trim() } });
      } else if (err.code === 'critical_required') {
        setNeedCritical(true);
        setError(err.message);
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: S.xl, gap: S.lg }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={{ gap: S.sm }}>
          <Text style={{ color: C.red, fontWeight: '800', letterSpacing: 1 }}>DRIVER LOGIN</Text>
          <H1>Hello, driver 👋</H1>
          <P>Sign in with the phone number or e-mail you registered with.</P>
        </View>
        <Input icon="person-outline" placeholder="Phone or e-mail" value={identifier} onChangeText={setIdentifier}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
        <View>
          <Input icon="lock-closed-outline" placeholder="Password" value={password} onChangeText={setPassword}
            secureTextEntry={!show} textContentType="password" onSubmitEditing={submit} />
          <Pressable onPress={() => setShow(s => !s)} style={{ position: 'absolute', right: 16, top: 18 }}>
            <Text style={{ color: C.sub }}>{show ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        {needCritical && <Input icon="shield-checkmark-outline" placeholder="Critical services password" value={critical} onChangeText={setCritical} secureTextEntry />}
        {error && <ErrorBox message={error} />}
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!identifier.trim() || !password} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.push({ pathname: '/verify', params: { purpose: 'RESET', identifier: identifier.trim() } })}>
            <Text style={{ color: C.gold, fontWeight: '700', padding: 6 }}>Forgot password?</Text>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/verify', params: { purpose: 'LOGIN', identifier: identifier.trim() } })}>
            <Text style={{ color: C.blue, fontWeight: '700', padding: 6 }}>Sign in with a code</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
