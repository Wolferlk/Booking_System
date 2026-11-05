/**
 * "Waiting for approval" — after a new driver or vehicle vendor registers.
 * Asks the server where the registration stands whenever the screen or the app
 * comes back to the front (and every 30 s while it is open), and hands this
 * phone's push token over so the approval also arrives as a notification.
 * Once approved, they sign in with the password they chose.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorBox, Ionicons, Loading, P, Row, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { OPS_PHONE } from '@/lib/config';
import { ago, firstName } from '@/lib/format';
import { expoPushToken } from '@/lib/push';
import { getPendingSignup, setPendingSignup, type PendingSignup, type SignupStatus } from '@/lib/signup';
import { C, S } from '@/lib/theme';

interface StatusReply { status: SignupStatus; name: string | null; note: string | null }

const LOOK: Record<SignupStatus, { icon: IconName; colors: [string, string]; title: string }> = {
  PENDING: { icon: 'hourglass', colors: ['#F59E0B', '#D97706'], title: 'Waiting for approval' },
  APPROVED: { icon: 'checkmark-circle', colors: ['#10B981', '#0E9F6E'], title: 'You’re approved!' },
  REJECTED: { icon: 'close-circle', colors: [C.red, C.redDeep], title: 'Not approved' },
  GONE: { icon: 'help-circle', colors: ['#64748B', '#475569'], title: 'Registration not found' },
};

export default function Pending() {
  const [pending, setPending] = useState<PendingSignup | null | undefined>(undefined);
  const [state, setState] = useState<StatusReply | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushSent = useRef(false);

  useEffect(() => { getPendingSignup().then(setPending); }, []);

  const check = useCallback(async () => {
    if (!pending) return;
    setChecking(true);
    try {
      // Once is enough — the server keeps the token until the person signs in.
      const pushToken = pushSent.current ? null : await expoPushToken();
      const r = await api<StatusReply>('/api/mobile/auth/register/status', {
        auth: false, body: { token: pending.token, pushToken: pushToken ?? undefined, platform: Platform.OS },
      });
      if (pushToken) pushSent.current = true;
      setState(r); setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'expired') setState({ status: 'GONE', name: pending.name, note: null });
      else setError(err.message);
    } finally { setChecking(false); }
  }, [pending]);

  useFocusEffect(useCallback(() => {
    if (!pending) return;
    check();
    const t = setInterval(check, 30_000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [pending, check]));

  useEffect(() => {
    if (pending === null) router.replace('/welcome');
  }, [pending]);

  if (!pending) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><Loading /></SafeAreaView>;

  const status: SignupStatus = state?.status ?? 'PENDING';
  const look = LOOK[status];
  const isDriver = pending.kind === 'DRIVER';
  const first = isDriver ? firstName(state?.name ?? pending.name) : (state?.name ?? pending.name);

  async function signInNow() {
    await setPendingSignup(null);
    router.replace(isDriver
      ? { pathname: '/sign-in', params: { as: 'DRIVER', identifier: pending!.identifier } }
      : { pathname: '/vendor-sign-in', params: { identifier: pending!.identifier } });
  }

  async function startOver() {
    await setPendingSignup(null);
    router.replace('/welcome');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 48 }}>
        <LinearGradient colors={look.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 28, padding: S.xl, alignItems: 'center', gap: S.md, marginTop: S.lg }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={look.icon} size={46} color="#fff" />
          </View>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center' }}>{look.title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 15, textAlign: 'center', lineHeight: 21 }}>
            {status === 'PENDING' && `Thanks, ${first}! The operations team is checking your ${isDriver ? 'driver' : 'vendor'} registration. We’ll notify you here as soon as you’re approved.`}
            {status === 'APPROVED' && `Welcome to Aahaas, ${first}. Sign in with your ${isDriver ? 'WhatsApp number' : 'e-mail'} and the password you chose.`}
            {status === 'REJECTED' && (state?.note || 'Your registration was not approved. Please contact the operations team.')}
            {status === 'GONE' && 'We can’t find this registration any more. Please contact the operations team, or register again.'}
          </Text>
        </LinearGradient>

        <Card style={{ gap: S.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.sub }}>Registered as</Text>
            <Text style={{ color: C.text, fontWeight: '800' }}>{isDriver ? 'Independent driver' : 'Vehicle vendor'}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.sub }}>{isDriver ? 'Name' : 'Company'}</Text>
            <Text style={{ color: C.text, fontWeight: '800', flexShrink: 1, textAlign: 'right' }}>{pending.name}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.sub }}>Sign in with</Text>
            <Text style={{ color: C.text, fontWeight: '800', flexShrink: 1, textAlign: 'right' }}>{pending.identifier}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.sub }}>Sent</Text>
            <Text style={{ color: C.text, fontWeight: '800' }}>{ago(pending.submittedAt)}</Text>
          </Row>
        </Card>

        {error && <ErrorBox message={error} />}

        {status === 'APPROVED' && <Button title="Sign in now" icon="log-in-outline" onPress={signInNow} />}
        {status === 'PENDING' && (
          <>
            <Button title={checking ? 'Checking…' : 'Check again'} icon="refresh" kind="secondary" onPress={check} loading={checking} />
            <P dim style={{ textAlign: 'center', fontSize: 13 }}>
              {state ? 'Still waiting — this screen checks again by itself.' : 'Checking…'}
            </P>
          </>
        )}
        {(status === 'REJECTED' || status === 'GONE') && <Button title="Start over" icon="arrow-undo" kind="secondary" onPress={startOver} />}

        <Button title={`Call operations · ${OPS_PHONE}`} icon="call-outline" kind="ghost" onPress={() => Linking.openURL(`tel:${OPS_PHONE}`)} />
        {status === 'PENDING' && (
          <Button title="Back to start" kind="ghost" onPress={() => router.replace('/welcome')} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
