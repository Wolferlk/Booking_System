/**
 * New vehicle vendor — the same registration as the vendor portal
 * (ops.aahaas.com/vendor/register): one account for the portal and this app.
 * The operations team approves it (ops.aahaas.com → Vehicle Vendors); until
 * then the waiting screen (/pending) shows where it stands.
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CountryChips, PasswordFields, SignupHero } from '@/components/signup-ui';
import { Button, ErrorBox, IconButton, Input, Label, P, Row } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { SIGNUP_COUNTRIES, passwordProblem, setPendingSignup, type SignupKind } from '@/lib/signup';
import { C, S } from '@/lib/theme';

const VENDOR_COUNTRIES = [...SIGNUP_COUNTRIES, { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia', flag: '🇸🇬🇲🇾', dial: '+65' }];

export default function RegisterVendor() {
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = company.trim().length >= 2 && email.trim().length > 3 && !!country && password.length > 0 && again.length > 0;

  async function submit() {
    const problem = (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'That e-mail address does not look right.' : null)
      ?? (whatsapp.trim() && whatsapp.replace(/\D/g, '').length < 9 ? 'That WhatsApp number looks too short — include the country code.' : null)
      ?? passwordProblem(password, again);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const r = await api<{ kind: SignupKind; name: string; identifier: string; pendingToken: string }>('/api/mobile/auth/register', {
        auth: false,
        body: { as: 'VENDOR', name: company.trim(), email: email.trim(), whatsappPhone: whatsapp.trim(), country, password },
      });
      await setPendingSignup({ kind: 'VENDOR', token: r.pendingToken, name: r.name, identifier: r.identifier, submittedAt: new Date().toISOString() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/pending');
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Row style={{ justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" onPress={() => router.back()} />
            <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 110, height: 42 }} contentFit="contain" />
          </Row>

          <SignupHero tone="ink" icon="bus" kicker="VEHICLE VENDOR" title="Vendor registration"
            lines={['One account for this app and the vendor portal', 'The operations team approves every new vendor', 'Then add your drivers and vehicles — no approval needed for them']} />

          <Label>Company name *</Label>
          <Input icon="business-outline" placeholder="Your transport company name" value={company} onChangeText={setCompany} autoCapitalize="words" textContentType="organizationName" />

          <Label>E-mail *</Label>
          <Input icon="mail-outline" placeholder="contact@yourcompany.com" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />

          <Label>WhatsApp number</Label>
          <Input icon="logo-whatsapp" placeholder={`${VENDOR_COUNTRIES.find(c => c.value === country)?.dial ?? '+94'} 77 123 4567`} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" textContentType="telephoneNumber" />

          <Label>Operation country *</Label>
          <CountryChips value={country} onChange={setCountry} options={VENDOR_COUNTRIES} />

          <PasswordFields password={password} setPassword={setPassword} again={again} setAgain={setAgain} />

          {error && <ErrorBox message={error} />}
          <Button title="Register as vendor" icon="business" onPress={submit} loading={busy} disabled={!ready} />

          <Pressable onPress={() => router.replace('/vendor-sign-in')} style={{ alignItems: 'center', padding: 6 }}>
            <Text style={{ color: C.sub }}>Already registered? <Text style={{ color: C.gold, fontWeight: '800' }}>Sign in here</Text></Text>
          </Pressable>
          <P dim style={{ fontSize: 12, textAlign: 'center' }}>You sign in with your e-mail (or WhatsApp number) and this password once approved.</P>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
