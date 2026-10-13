/** Drivers & vehicles — the registry from ops.aahaas.com → Drivers, searchable. */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBox, H1, IconButton, Ionicons, Pill, Row } from '@/components/ui';
import { FLAG } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';
import { imgUrl, web } from '@/lib/web';

interface DriverRow {
  id: string; name: string; phone: string; email: string | null; isActive: boolean; country: string | null; photoUrl: string | null
  vehicle: { type: string; plateNo: string; capacity: number; brand: string | null; model: string | null; vendor?: { name: string } | null } | null
}

export default function Drivers() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await web<DriverRow[]>('ground/drivers')); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (!rows.length) load(); }, [load, rows.length]));

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(d => (showInactive || d.isActive) && (!s || [d.name, d.phone, d.vehicle?.plateNo, d.vehicle?.vendor?.name].some(v => v?.toLowerCase().includes(s))));
  }, [rows, q, showInactive]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ padding: S.lg, gap: S.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H1>Drivers</H1>
          <Row gap={S.sm}>
            <IconButton icon="map" onPress={() => router.push('/live')} />
            <IconButton icon="file-tray-full" onPress={() => router.push('/inbox')} />
          </Row>
        </Row>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.lg }}>
          <Ionicons name="search" size={18} color={C.sub} />
          <TextInput value={q} onChangeText={setQ} placeholder="Name, phone, plate, vendor" placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 12, fontSize: 15 }} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: C.dim, fontSize: 12 }}>{list.length} drivers</Text>
          <Pressable onPress={() => setShowInactive(v => !v)}><Text style={{ color: C.red, fontWeight: '700', fontSize: 12 }}>{showInactive ? 'Hide inactive' : 'Show inactive'}</Text></Pressable>
        </Row>
      </View>
      {error && <View style={{ paddingHorizontal: S.lg }}><ErrorBox message={error} onRetry={load} /></View>}
      <FlatList data={list} keyExtractor={d => d.id} contentContainerStyle={{ padding: S.lg, paddingTop: 0, gap: S.md, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.sub} />}
        renderItem={({ item: d }) => (
          <Pressable onPress={() => router.push({ pathname: '/driver/[id]', params: { id: d.id } })}
            style={[{ flexDirection: 'row', gap: S.md, backgroundColor: C.card, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.line, alignItems: 'center', opacity: d.isActive ? 1 : 0.55 }, shadow]}>
            {imgUrl(d.photoUrl) ? <Image alt="" source={{ uri: imgUrl(d.photoUrl)! }} style={{ width: 54, height: 54, borderRadius: 27 }} /> : (
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={26} color={C.red} /></View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: C.text, fontWeight: '800' }} numberOfLines={1}>{d.name}</Text>
              <Text style={{ color: C.sub, fontSize: 13 }}>{d.phone}</Text>
              {d.vehicle && <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}>{d.vehicle.plateNo} · {[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.type} · {d.vehicle.capacity} seats</Text>}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text>{FLAG[d.country ?? ''] ?? ''}</Text>
              {!d.isActive && <Pill text="Inactive" />}
            </View>
          </Pressable>
        )} />
    </SafeAreaView>
  );
}
