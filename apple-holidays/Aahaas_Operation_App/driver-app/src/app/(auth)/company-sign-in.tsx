/**
 * Company sign-in — the same e-mail and password as ops.aahaas.com. Ultra Super
 * Admin also gives the critical services password, as on the web.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorBox, IconButton, Input, Ionicons, P, Row } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Actor } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { C, S } from '@/lib/theme';

export default function CompanySignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
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
        body: { identifier: email.trim().toLowerCase(), password, criticalPassword: critical || undefined, as: 'COMPANY', platform: Platform.OS, appVersion: APP_VERSION },
      });
      await signIn(r.token, r.actor);
      router.replace('/');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'critical_required') setNeedCritical(true);
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: S.xl, gap: S.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
          <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 110, height: 42 }} contentFit="contain" />
        </Row>
        <View style={{ gap: S.sm, marginTop: S.lg }}>
          <Row gap={S.sm}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="briefcase" size={20} color={C.red} />
            </View>
            <Text style={{ color: C.red, fontWeight: '800', letterSpacing: 1 }}>COMPANY LOGIN</Text>
          </Row>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>Welcome back</Text>
          <P>Use your ops.aahaas.com e-mail and password. You see and do exactly what your role allows on the web.</P>
        </View>
        <Input icon="mail-outline" placeholder="you@appleholidays.com" value={email} onChangeText={setEmail}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
        <View>
          <Input icon="lock-closed-outline" placeholder="Password" value={password} onChangeText={setPassword}
            secureTextEntry={!show} textContentType="password" onSubmitEditing={submit} />
          <Pressable onPress={() => setShow(s => !s)} style={{ position: 'absolute', right: 16, top: 18 }}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.sub} />
          </Pressable>
        </View>
        {needCritical && (
          <Card tone="gold" style={{ gap: S.sm }}>
            <Text style={{ color: C.text, fontWeight: '700' }}>Ultra Super Admin — second factor</Text>
            <Input icon="shield-checkmark-outline" placeholder="Critical services password" value={critical} onChangeText={setCritical} secureTextEntry />
          </Card>
        )}
        {error && <ErrorBox message={error} />}
        <Button title="Sign in" icon="log-in-outline" onPress={submit} loading={busy} disabled={!email.includes('@') || !password} />
        <Row gap={6} style={{ justifyContent: 'center' }}>
          <Ionicons name="shield-checkmark" size={14} color={C.green} />
          <Text style={{ color: C.dim, fontSize: 12 }}>Every change made in the app is recorded in the activity log.</Text>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
