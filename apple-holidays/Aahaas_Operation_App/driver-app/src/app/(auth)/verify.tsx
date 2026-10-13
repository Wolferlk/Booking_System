/**
 * Phone / e-mail verification — first time ("activate"), forgot password, and
 * sign in with a code. The code goes to the number or address already on the
 * driver's registration, chosen here: WhatsApp or e-mail.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorBox, H1, IconButton, Input, Ionicons, P, Row } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Actor } from '@/lib/auth';
import { C, S } from '@/lib/theme';

type Purpose = 'ACTIVATE' | 'LOGIN' | 'RESET';
type Step = 'who' | 'code' | 'password';

const TITLES: Record<Purpose, string> = {
  ACTIVATE: 'Welcome! Let’s find you',
  RESET: 'Reset your password',
  LOGIN: 'Sign in with a code',
};

export default function Verify() {
  const params = useLocalSearchParams<{ purpose?: Purpose; identifier?: string }>();
  const purpose: Purpose = params.purpose ?? 'ACTIVATE';
  const { signIn } = useAuth();
  const [step, setStep] = useState<Step>('who');
  const [identifier, setIdentifier] = useState(params.identifier ?? '');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [otp, setOtp] = useState<{ otpId: string; sentTo: string; driverName: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pending, setPending] = useState<{ token: string; resetToken: string | null; actor: Actor } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function send(ch = channel) {
    setBusy(true); setError(null);
    try {
      const r = await api<{ otpId: string; sentTo: string; driverName: string }>('/api/mobile/auth/otp/request', {
        auth: false, body: { identifier: identifier.trim(), channel: ch, purpose },
      });
      setOtp(r); setStep('code'); setCode(''); setResendIn(45);
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (!otp || value.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; resetToken: string | null; needsPassword: boolean; actor: Actor }>('/api/mobile/auth/otp/verify', {
        auth: false, body: { otpId: otp.otpId, code: value },
      });
      if (r.needsPassword && r.resetToken) {
        setPending({ token: r.token, resetToken: r.resetToken, actor: r.actor });
        setStep('password');
      } else {
        await signIn(r.token, r.actor);
        router.replace('/');
      }
    } catch (e) {
      setError((e as ApiError).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (!pending?.resetToken) return;
    if (password.length < 6) return setError('Use at least 6 characters.');
    if (password !== password2) return setError('The two passwords are not the same.');
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; actor: Actor }>('/api/mobile/auth/set-password', {
        auth: false, body: { resetToken: pending.resetToken, password },
      });
      await signIn(r.token, r.actor);
      router.replace('/');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: S.xl, gap: S.lg }}>
        <IconButton icon="chevron-back" onPress={() => (step === 'code' ? setStep('who') : router.back())} />

        {step === 'who' && (
          <>
            <View style={{ gap: S.sm }}>
              <H1>{TITLES[purpose]}</H1>
              <P>Type the phone number or e-mail you gave when you registered as a driver. We send a 6-digit code to it.</P>
            </View>
            <Input icon="call-outline" placeholder="07X XXX XXXX or e-mail" value={identifier} onChangeText={setIdentifier}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <Text style={{ color: C.sub, fontWeight: '700' }}>Send the code by</Text>
            <Row gap={S.md}>
              {(['WHATSAPP', 'EMAIL'] as const).map(ch => (
                <Pressable key={ch} onPress={() => setChannel(ch)} style={{ flex: 1 }}>
                  <Card tone={channel === ch ? (ch === 'WHATSAPP' ? 'green' : 'blue') : undefined} style={{ alignItems: 'center', gap: S.sm, paddingVertical: S.xl }}>
                    <Ionicons name={ch === 'WHATSAPP' ? 'logo-whatsapp' : 'mail'} size={34} color={ch === 'WHATSAPP' ? C.green : C.blue} />
                    <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{ch === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</Text>
                  </Card>
                </Pressable>
              ))}
            </Row>
            {error && <ErrorBox message={error} />}
            <Button title="Send code" icon="paper-plane" onPress={() => send()} loading={busy} disabled={identifier.trim().length < 5} />
          </>
        )}

        {step === 'code' && otp && (
          <>
            <View style={{ gap: S.sm }}>
              <H1>Hi {otp.driverName} 👋</H1>
              <P>Enter the 6-digit code we sent to {otp.sentTo}.</P>
            </View>
            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={v => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6) verify(d); }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              style={{ color: C.text, fontSize: 40, fontWeight: '800', letterSpacing: 16, textAlign: 'center', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingVertical: 18 }}
              placeholder="••••••"
              placeholderTextColor={C.dim}
            />
            {error && <ErrorBox message={error} />}
            <Button title="Verify" onPress={() => verify()} loading={busy} disabled={code.length !== 6} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable disabled={resendIn > 0} onPress={() => send()}>
                <Text style={{ color: resendIn > 0 ? C.dim : C.gold, fontWeight: '700', padding: 6 }}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</Text>
              </Pressable>
              <Pressable onPress={() => { const other = channel === 'WHATSAPP' ? 'EMAIL' : 'WHATSAPP'; setChannel(other); send(other); }}>
                <Text style={{ color: C.blue, fontWeight: '700', padding: 6 }}>Use {channel === 'WHATSAPP' ? 'e-mail' : 'WhatsApp'} instead</Text>
              </Pressable>
            </Row>
          </>
        )}

        {step === 'password' && (
          <>
            <View style={{ gap: S.sm }}>
              <H1>Choose a password</H1>
              <P>Next time you sign in with your phone number and this password.</P>
            </View>
            <Input icon="lock-closed-outline" placeholder="New password (6+ characters)" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" />
            <Input icon="lock-closed-outline" placeholder="Type it again" value={password2} onChangeText={setPassword2} secureTextEntry textContentType="newPassword" />
            {error && <ErrorBox message={error} />}
            <Button title="Save and continue" icon="checkmark" onPress={savePassword} loading={busy} disabled={!password || !password2} />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
