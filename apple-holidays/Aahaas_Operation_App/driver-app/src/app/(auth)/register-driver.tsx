/**
 * New independent driver — registers from the app and waits for the operations
 * team to approve them (ops.aahaas.com → Drivers & Vehicles). Until then they
 * cannot sign in; the waiting screen (/pending) tells them when they can.
 *
 * Drivers who work for a vehicle vendor do not register here — their vendor
 * adds them and they are ready straight away.
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CountryChips, PasswordFields, SignupHero } from '@/components/signup-ui';
import { Button, Card, ErrorBox, IconButton, Input, Ionicons, Label, P, Row } from '@/components/ui';
import { Chip } from '@/components/vendor-ui';
import { api, ApiError } from '@/lib/api';
import { SIGNUP_COUNTRIES, passwordProblem, setPendingSignup, type SignupKind } from '@/lib/signup';
import { C, S } from '@/lib/theme';
import { VEHICLE_LABEL } from '@/lib/vendor';

export default function RegisterDriver() {
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [hasVehicle, setHasVehicle] = useState(false);
  const [vType, setVType] = useState('car');
  const [plateNo, setPlateNo] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [seats, setSeats] = useState('4');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dial = SIGNUP_COUNTRIES.find(c => c.value === country)?.dial ?? '+94';
  const ready = name.trim().length >= 2 && !!country && phone.replace(/\D/g, '').length >= 9 && password.length > 0 && again.length > 0
    && (!hasVehicle || plateNo.trim().length >= 3);

  async function submit() {
    const problem = passwordProblem(password, again)
      ?? (hasVehicle && !(Number(seats) >= 1 && Number(seats) <= 80) ? 'Seats must be between 1 and 80.' : null)
      ?? (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'That e-mail address does not look right.' : null);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const r = await api<{ kind: SignupKind; name: string; identifier: string; pendingToken: string }>('/api/mobile/auth/register', {
        auth: false,
        body: {
          as: 'DRIVER', name: name.trim(), country, phone: phone.trim(), email: email.trim(), licenseNo: licenseNo.trim(), password,
          vehicle: hasVehicle ? { type: vType, plateNo: plateNo.trim(), brand: brand.trim(), model: model.trim(), capacity: seats } : null,
        },
      });
      await setPendingSignup({ kind: 'DRIVER', token: r.pendingToken, name: r.name, identifier: r.identifier, submittedAt: new Date().toISOString() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/pending');
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Row style={{ justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" onPress={() => router.back()} />
            <Image alt="Aahaas" source={require('@/assets/images/aahaas-wordmark.png')} style={{ width: 110, height: 42 }} contentFit="contain" />
          </Row>

          <SignupHero tone="red" icon="car-sport" kicker="NEW DRIVER" title="Register to drive"
            lines={['For independent drivers with their own work', 'The operations team checks every registration', 'You can sign in as soon as you are approved']} />

          <Label>Full name *</Label>
          <Input icon="person-outline" placeholder="As on your driving licence" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />

          <Label>Country you drive in *</Label>
          <CountryChips value={country} onChange={setCountry} options={SIGNUP_COUNTRIES} />

          <Label>WhatsApp number *</Label>
          <Input icon="logo-whatsapp" placeholder={`${dial} 77 123 4567`} value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" />
          <P style={{ fontSize: 13, marginTop: -8 }}>You sign in with this number, and operations reach you on it.</P>

          <Label>Optional</Label>
          <Input icon="mail-outline" placeholder="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
          <Input icon="card-outline" placeholder="Driving licence no." value={licenseNo} onChangeText={setLicenseNo} autoCapitalize="characters" />

          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
            <Ionicons name="car" size={26} color={C.red} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontWeight: '800' }}>I drive my own vehicle</Text>
              <Text style={{ color: C.sub, fontSize: 13 }}>Add it now — operations check it with you.</Text>
            </View>
            <Switch value={hasVehicle} onValueChange={setHasVehicle} trackColor={{ true: C.red }} />
          </Card>

          {hasVehicle && (
            <>
              <Label>Vehicle type</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                {Object.entries(VEHICLE_LABEL).map(([value, label]) => (
                  <Chip key={value} on={vType === value} onPress={() => setVType(value)}>
                    <Text style={{ color: C.text, fontWeight: '800' }}>{label}</Text>
                  </Chip>
                ))}
              </ScrollView>
              <Input icon="pricetag-outline" placeholder="Number plate *" value={plateNo} onChangeText={setPlateNo} autoCapitalize="characters" autoCorrect={false} />
              <Row gap={S.sm}>
                <View style={{ flex: 1 }}><Input placeholder="Brand" value={brand} onChangeText={setBrand} autoCapitalize="words" /></View>
                <View style={{ flex: 1 }}><Input placeholder="Model" value={model} onChangeText={setModel} autoCapitalize="words" /></View>
              </Row>
              <Input icon="people-outline" placeholder="Seats" value={seats} onChangeText={t => setSeats(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
            </>
          )}

          <PasswordFields password={password} setPassword={setPassword} again={again} setAgain={setAgain} />

          {error && <ErrorBox message={error} />}
          <Button title="Register as driver" icon="person-add" onPress={submit} loading={busy} disabled={!ready} />

          <Pressable onPress={() => router.replace({ pathname: '/sign-in', params: { as: 'DRIVER' } })} style={{ alignItems: 'center', padding: 6 }}>
            <Text style={{ color: C.sub }}>Already registered? <Text style={{ color: C.red, fontWeight: '800' }}>Sign in</Text></Text>
          </Pressable>
          <P dim style={{ fontSize: 12, textAlign: 'center' }}>Driving for a vehicle vendor? You don’t need to register — your vendor adds you and sends your sign-in code.</P>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
