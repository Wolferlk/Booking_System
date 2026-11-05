/**
 * Add or edit one of the vendor's drivers. The WhatsApp number is the driver's
 * sign-in: on a new driver we send a 6-digit code there straight away (unless
 * switched off), and the vendor can share the steps.
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorBox, IconButton, Input, Ionicons, Label, Loading, P, Row } from '@/components/ui';
import { Chip, Plate, pickSource } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, S } from '@/lib/theme';
import { takeAndUpload } from '@/lib/upload';
import { imgUrl } from '@/lib/web';
import { shareInvite, vehicleLabel, type VendorDriver, type VendorVehicle } from '@/lib/vendor';

export default function DriverForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const { actor } = useAuth();
  const vendorName = actor?.kind === 'VENDOR' ? actor.name : 'Your vendor';
  const drivers = useLoad<VendorDriver[]>(editing ? '/api/mobile/vendor/drivers' : null);
  const vehicles = useLoad<{ vehicles: VendorVehicle[] }>('/api/mobile/vendor/vehicles');
  const existing = drivers.data?.find(d => d.id === id) ?? null;

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [sendCode, setSendCode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!existing || filled) return;
    setName(existing.name); setWhatsapp(existing.whatsapp); setEmail(existing.email ?? ''); setLicenseNo(existing.licenseNo ?? '');
    setPhotoUrl(existing.photoUrl); setVehicleId(existing.vehicle?.id ?? null); setFilled(true);
  }, [existing, filled]);

  async function photo() {
    const from = await pickSource('Driver photo');
    if (!from) return;
    setUploading(true);
    try {
      const r = await takeAndUpload('driver', from);
      if (r) setPhotoUrl(r.url);
    } catch (e) { Alert.alert('Photo not saved', (e as Error).message); }
    finally { setUploading(false); }
  }

  async function save() {
    setBusy(true); setError(null);
    const body = { name, whatsapp, email, licenseNo, photoUrl: photoUrl ?? '', vehicleId };
    try {
      if (editing) {
        await api(`/api/mobile/vendor/drivers/${id}`, { method: 'PATCH', body });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      } else {
        const r = await api<{ id: string; code: { sent: boolean; to: string | null; error: string | null } | null }>('/api/mobile/vendor/drivers', { body: { ...body, sendCode } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const invite = { name, whatsapp: whatsapp.trim() };
        const msg = !r.code ? 'You can send the sign-in code from the Fleet tab whenever you are ready.'
          : r.code.sent ? `A 6-digit sign-in code went to ${r.code.to} on WhatsApp. Share the steps so they know what to do with it.`
          : `The WhatsApp code could not be sent (${r.code.error}). Share the steps — they can tap "Send code" in the app.`;
        Alert.alert(`${name.trim().split(' ')[0]} is in your fleet 🎉`, msg, [
          { text: 'Share steps', onPress: () => { shareInvite(invite, vendorName).finally(() => router.back()); } },
          { text: 'Done', onPress: () => router.back() },
        ]);
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  }

  function toggleActive() {
    if (!existing) return;
    const off = existing.isActive;
    Alert.alert(off ? `Switch ${existing.name} off?` : `Switch ${existing.name} back on?`,
      off ? 'They can no longer sign in to the app or be put on trips. Nothing is deleted — you can switch them on again.' : 'They can sign in and be put on trips again.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: off ? 'Switch off' : 'Switch on', style: off ? 'destructive' : 'default', onPress: async () => {
          try {
            await api(`/api/mobile/vendor/drivers/${existing.id}`, { method: 'PATCH', body: { isActive: !off } });
            router.back();
          } catch (e) { Alert.alert('Not possible', (e as ApiError).message); }
        },
      }]);
  }

  const free = (vehicles.data?.vehicles ?? []).filter(v => v.isActive);
  const photo_ = imgUrl(photoUrl);

  if (editing && drivers.loading && !existing) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><Loading /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{editing ? 'Edit driver' : 'Add a driver'}</Text>
            <IconButton icon="close" onPress={() => router.back()} />
          </Row>

          <Pressable onPress={photo} style={{ alignSelf: 'center', alignItems: 'center', gap: 6 }}>
            <View style={styles.photo}>
              {photo_ ? <Image source={{ uri: photo_ }} alt="Driver" style={{ width: '100%', height: '100%' }} contentFit="cover" />
                : <Ionicons name={uploading ? 'cloud-upload' : 'camera'} size={30} color={C.red} />}
            </View>
            <Text style={{ color: C.red, fontWeight: '800', fontSize: 13 }}>{uploading ? 'Uploading…' : photo_ ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>

          <Label>Name</Label>
          <Input icon="person-outline" placeholder="Full name" value={name} onChangeText={setName} autoCapitalize="words" />

          <Label>WhatsApp number</Label>
          <Input icon="logo-whatsapp" placeholder="+94 77 123 4567" value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" textContentType="telephoneNumber" />
          <P style={{ fontSize: 13, marginTop: -8 }}>This is how they sign in: the app sends a 6-digit code to this WhatsApp. Changing it later signs their old phone out.</P>

          <Label>Optional</Label>
          <Input icon="mail-outline" placeholder="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Input icon="card-outline" placeholder="Driving licence no." value={licenseNo} onChangeText={setLicenseNo} autoCapitalize="characters" />

          <Label>Vehicle</Label>
          {vehicles.loading && !vehicles.data ? <Loading /> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip on={!vehicleId} onPress={() => setVehicleId(null)}><Text style={styles.chipText}>None</Text></Chip>
              {free.map(v => (
                <Chip key={v.id} on={vehicleId === v.id} onPress={() => setVehicleId(v.id)}>
                  <Plate plate={v.plateNo} small />
                  <Text style={styles.chipSub}>{vehicleLabel(v.type)} · {v.capacity}{v.driver && v.driver.id !== id ? ` · ${v.driver.name.split(' ')[0]}` : ''}</Text>
                </Chip>
              ))}
              <Chip on={false} onPress={() => router.push('/fleet/vehicle')}><Ionicons name="add" size={16} color={C.red} /><Text style={[styles.chipText, { color: C.red }]}>New</Text></Chip>
            </ScrollView>
          )}
          {vehicleId && free.find(v => v.id === vehicleId)?.driver && free.find(v => v.id === vehicleId)!.driver!.id !== id && (
            <P style={{ fontSize: 13, color: C.amber }}>{free.find(v => v.id === vehicleId)!.driver!.name} drives this vehicle now — saving moves it to this driver.</P>
          )}

          {!editing && (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
              <Ionicons name="logo-whatsapp" size={26} color={C.green} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '800' }}>Send sign-in code now</Text>
                <Text style={{ color: C.sub, fontSize: 13 }}>They get a 6-digit code on WhatsApp.</Text>
              </View>
              <Switch value={sendCode} onValueChange={setSendCode} trackColor={{ true: C.green }} />
            </Card>
          )}

          {error && <ErrorBox message={error} />}
          <Button title={editing ? 'Save' : 'Add driver'} icon={editing ? 'checkmark' : 'person-add'} onPress={save} loading={busy}
            disabled={name.trim().length < 2 || whatsapp.replace(/\D/g, '').length < 9 || uploading} />

          {existing && (
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable onPress={() => shareInvite(existing, vendorName)} style={{ padding: 6 }}>
                <Text style={{ color: C.blue, fontWeight: '800' }}>Share sign-in steps</Text>
              </Pressable>
              <Pressable onPress={toggleActive} style={{ padding: 6 }}>
                <Text style={{ color: existing.isActive ? C.red : C.green, fontWeight: '800' }}>{existing.isActive ? 'Switch driver off' : 'Switch driver on'}</Text>
              </Pressable>
            </Row>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 3, borderColor: '#fff' },
  chipText: { color: C.text, fontWeight: '800' },
  chipSub: { color: C.sub, fontWeight: '700', fontSize: 12 },
});
