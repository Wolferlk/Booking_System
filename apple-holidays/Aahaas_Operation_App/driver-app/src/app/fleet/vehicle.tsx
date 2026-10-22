/**
 * Add or edit a vehicle of the vendor's fleet — type, plate, seats, outside and
 * inside photos, and the driver who drives it (one vehicle, one driver).
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorBox, IconButton, Input, Ionicons, Label, Loading, Row } from '@/components/ui';
import { Avatar, Chip, pickSource } from '@/components/vendor-ui';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { C, S } from '@/lib/theme';
import { takeAndUpload } from '@/lib/upload';
import { imgUrl } from '@/lib/web';
import { VEHICLE_ICON, VEHICLE_LABEL, type VendorDriver, type VendorVehicle } from '@/lib/vendor';

const DEFAULT_SEATS: Record<string, number> = { car: 3, 'flatroof-van': 6, 'highroof-van': 9, van: 8, minibus: 15, 'bus-medium': 25, 'bus-high': 40, motorbike: 1, other: 4 };

function PhotoBox({ label, url, busy, onPress }: { label: string; url: string | null; busy: boolean; onPress: () => void }) {
  const uri = imgUrl(url);
  return (
    <Pressable onPress={onPress} style={styles.photo}>
      {uri ? <Image source={{ uri }} alt={label} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={[styles.photoTag, uri && { backgroundColor: 'rgba(14,21,37,0.6)' }]}>
        <Ionicons name={busy ? 'cloud-upload' : uri ? 'refresh' : 'camera'} size={16} color={uri ? '#fff' : C.blue} />
        <Text style={{ color: uri ? '#fff' : C.blue, fontWeight: '800', fontSize: 12 }}>{busy ? 'Uploading…' : label}</Text>
      </View>
    </Pressable>
  );
}

export default function VehicleForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const vehicles = useLoad<{ vehicles: VendorVehicle[]; types: string[] }>('/api/mobile/vendor/vehicles');
  const drivers = useLoad<VendorDriver[]>('/api/mobile/vendor/drivers');
  const existing = vehicles.data?.vehicles.find(v => v.id === id) ?? null;

  const [type, setType] = useState('car');
  const [plateNo, setPlateNo] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState(DEFAULT_SEATS.car);
  const [photoOutside, setPhotoOutside] = useState<string | null>(null);
  const [photoInside, setPhotoInside] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'out' | 'in' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [touchedSeats, setTouchedSeats] = useState(false);

  useEffect(() => {
    if (!existing || filled) return;
    setType(existing.type); setPlateNo(existing.plateNo); setBrand(existing.brand ?? ''); setModel(existing.model ?? '');
    setCapacity(existing.capacity); setPhotoOutside(existing.photoOutside); setPhotoInside(existing.photoInside);
    setDriverId(existing.driver?.id ?? null); setFilled(true); setTouchedSeats(true);
  }, [existing, filled]);

  async function photo(which: 'out' | 'in') {
    const from = await pickSource(which === 'out' ? 'Outside photo' : 'Inside photo');
    if (!from) return;
    setUploading(which);
    try {
      const r = await takeAndUpload('vehicle', from);
      if (r) (which === 'out' ? setPhotoOutside : setPhotoInside)(r.url);
    } catch (e) { Alert.alert('Photo not saved', (e as Error).message); }
    finally { setUploading(null); }
  }

  async function save() {
    setBusy(true); setError(null);
    const body = { type, plateNo, brand, model, capacity, photoOutside: photoOutside ?? '', photoInside: photoInside ?? '', driverId };
    try {
      if (editing) await api(`/api/mobile/vendor/vehicles/${id}`, { method: 'PATCH', body });
      else await api('/api/mobile/vendor/vehicles', { body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  }

  function toggleActive() {
    if (!existing) return;
    const off = existing.isActive;
    Alert.alert(off ? `Switch ${existing.plateNo} off?` : `Switch ${existing.plateNo} back on?`,
      off ? 'It is taken off its driver and cannot be put on new trips. Nothing is deleted.' : 'It can be paired and put on trips again.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: off ? 'Switch off' : 'Switch on', style: off ? 'destructive' : 'default', onPress: async () => {
          try { await api(`/api/mobile/vendor/vehicles/${existing.id}`, { method: 'PATCH', body: { isActive: !off } }); router.back(); }
          catch (e) { Alert.alert('Not possible', (e as ApiError).message); }
        },
      }]);
  }

  if (editing && vehicles.loading && !existing) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><Loading /></SafeAreaView>;
  const types = vehicles.data?.types ?? Object.keys(VEHICLE_LABEL);
  const activeDrivers = (drivers.data ?? []).filter(d => d.isActive);
  const picked = activeDrivers.find(d => d.id === driverId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{editing ? 'Edit vehicle' : 'Add a vehicle'}</Text>
            <IconButton icon="close" onPress={() => router.back()} />
          </Row>

          {/* the plate, typed onto a plate */}
          <View style={styles.plate}>
            <TextInput value={plateNo} onChangeText={v => setPlateNo(v.toUpperCase())} placeholder="WP CAB-1234" placeholderTextColor="#8A7A2A"
              autoCapitalize="characters" autoCorrect={false} maxLength={20} style={styles.plateInput} />
          </View>

          <Label>Type</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {types.map(t => (
              <Chip key={t} on={type === t} onPress={() => { setType(t); if (!touchedSeats) setCapacity(DEFAULT_SEATS[t] ?? 4); }}>
                <Ionicons name={VEHICLE_ICON[t] ?? 'car'} size={16} color={type === t ? C.red : C.sub} />
                <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{VEHICLE_LABEL[t] ?? t}</Text>
              </Chip>
            ))}
          </View>

          <Label>Guest seats</Label>
          <View style={styles.stepper}>
            <Pressable onPress={() => { setTouchedSeats(true); setCapacity(c => Math.max(1, c - 1)); }} style={styles.step}><Ionicons name="remove" size={22} color={C.text} /></Pressable>
            <Text style={styles.seats}>{capacity}</Text>
            <Pressable onPress={() => { setTouchedSeats(true); setCapacity(c => Math.min(80, c + 1)); }} style={styles.step}><Ionicons name="add" size={22} color={C.text} /></Pressable>
          </View>

          <Row gap={S.md}>
            <View style={{ flex: 1 }}><Input placeholder="Brand (Toyota)" value={brand} onChangeText={setBrand} /></View>
            <View style={{ flex: 1 }}><Input placeholder="Model (KDH)" value={model} onChangeText={setModel} /></View>
          </Row>

          <Label>Photos</Label>
          <Row gap={S.md}>
            <PhotoBox label="Outside" url={photoOutside} busy={uploading === 'out'} onPress={() => photo('out')} />
            <PhotoBox label="Inside" url={photoInside} busy={uploading === 'in'} onPress={() => photo('in')} />
          </Row>

          <Label>Driver</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip on={!driverId} onPress={() => setDriverId(null)}><Text style={{ color: C.text, fontWeight: '800' }}>No driver</Text></Chip>
            {activeDrivers.map(d => (
              <Chip key={d.id} on={driverId === d.id} onPress={() => setDriverId(d.id)}>
                <Avatar name={d.name} photoUrl={d.photoUrl} size={24} />
                <Text style={{ color: C.text, fontWeight: '800' }}>{d.name.split(' ')[0]}</Text>
              </Chip>
            ))}
          </ScrollView>
          {picked?.vehicle && picked.vehicle.id !== id && (
            <Text style={{ color: C.amber, fontSize: 13 }}>{picked.name} drives {picked.vehicle.plateNo} now — saving moves them to this vehicle.</Text>
          )}

          {error && <ErrorBox message={error} />}
          <Button title={editing ? 'Save' : 'Add vehicle'} icon={editing ? 'checkmark' : 'car-sport'} onPress={save} loading={busy}
            disabled={plateNo.trim().length < 3 || !!uploading} />

          {existing && (
            <Pressable onPress={toggleActive} style={{ alignSelf: 'center', padding: 6 }}>
              <Text style={{ color: existing.isActive ? C.red : C.green, fontWeight: '800' }}>{existing.isActive ? 'Switch vehicle off' : 'Switch vehicle on'}</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  plate: { alignSelf: 'center', backgroundColor: '#FFD43B', borderRadius: 14, borderWidth: 3, borderColor: '#0E1525', paddingHorizontal: 18, paddingVertical: 6, minWidth: 240 },
  plateInput: { color: '#0E1525', fontSize: 30, fontWeight: '900', letterSpacing: 3, textAlign: 'center', paddingVertical: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 8 },
  step: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  seats: { color: C.text, fontSize: 32, fontWeight: '900', minWidth: 60, textAlign: 'center', fontVariant: ['tabular-nums'] },
  photo: { flex: 1, height: 120, borderRadius: 18, backgroundColor: C.blueSoft, borderWidth: 1, borderColor: '#BFD3FF', overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' },
  photoTag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 10 },
});
