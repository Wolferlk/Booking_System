/**
 * Entrance tickets on a trip: what ops bought for each day, what the driver
 * has uploaded so far, and a way to add one bought at the gate. Every ticket
 * needs at least one photo / PDF before the trip can be finished.
 */
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLoad } from '@/hooks/use-load';
import { api, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { fmtDay } from '@/lib/format';
import { C, R, S } from '@/lib/theme';
import type { TripTicket, TripTickets } from '@/lib/types';
import { filesForm, pickTicketFiles, type PickedFile } from '@/lib/upload';
import { Sheet } from './sheet';
import { Button, Input, Ionicons, Pill, Row } from './ui';

const abs = (url: string) => (url.startsWith('http') ? url : `${API_URL}${url}`);

/** Camera, photos or files — resolves null when the driver backs out. */
function chooseSource(): Promise<'camera' | 'library' | 'pdf' | null> {
  return new Promise(resolve => {
    const opts = [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'From photos', onPress: () => resolve('library') },
      { text: 'PDF / files', onPress: () => resolve('pdf') },
    ];
    // Android shows at most three buttons; tapping outside cancels there.
    Alert.alert('Add ticket', 'One photo or file per guest is best.',
      Platform.OS === 'ios' ? [...opts, { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }] : opts,
      { cancelable: true, onDismiss: () => resolve(null) });
  });
}

async function pick(): Promise<PickedFile[]> {
  const from = await chooseSource();
  if (!from) return [];
  try {
    return await pickTicketFiles(from);
  } catch (e) {
    Alert.alert('Could not open', (e as Error).message);
    return [];
  }
}

/** The trip's tickets plus the upload / add / remove actions. */
export function useTripTickets(bookingRef: string) {
  const base = `/api/mobile/trips/${encodeURIComponent(bookingRef)}/tickets`;
  const { data, setData, error, silent } = useLoad<TripTickets>(base);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(t: TripTicket) {
    const files = await pick();
    if (!files.length) return;
    setBusy(t.id);
    try {
      setData(await api<TripTickets>(`${base}/${t.id}/files`, { form: filesForm(files) }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Not uploaded', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  function remove(t: TripTicket, fileId: string) {
    Alert.alert('Remove this file?', t.name, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(t.id);
          try {
            setData(await api<TripTickets>(`${base}/${t.id}/files?fileId=${encodeURIComponent(fileId)}`, { method: 'DELETE' }));
          } catch (e) {
            Alert.alert('Not removed', (e as ApiError).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  async function add(fields: { name: string; qty: number; date: string }, files: PickedFile[]) {
    setData(await api<TripTickets>(base, { form: filesForm(files, { name: fields.name, qty: String(fields.qty), date: fields.date }) }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return { data, error, busy, upload, remove, add, pick, reload: silent };
}
export type TicketsCtl = ReturnType<typeof useTripTickets>;

/** "1/2" for a day header, red while something is missing. */
export function ticketTally(tickets: TripTicket[]) {
  const done = tickets.filter(t => t.done).length;
  return { done, total: tickets.length, missing: tickets.length - done };
}

function FileThumb({ f, onLongPress }: { f: TripTicket['files'][number]; onLongPress?: () => void }) {
  return (
    <Pressable onPress={() => Linking.openURL(abs(f.url))} onLongPress={onLongPress} style={styles.thumb}>
      {f.type === 'image'
        ? <Image source={{ uri: abs(f.url) }} alt="" style={StyleSheet.absoluteFill} contentFit="cover" />
        : <Ionicons name="document-text" size={26} color={C.red} />}
    </Pressable>
  );
}

function TicketRow({ t, ctl, editable }: { t: TripTicket; ctl: TicketsCtl; editable: boolean }) {
  const busy = ctl.busy === t.id;
  return (
    <View style={[styles.row, !t.done && editable && { borderColor: '#FCA5A5', backgroundColor: '#FFF7F7' }]}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={[styles.icon, t.done && { backgroundColor: C.greenSoft }]}>
          <Ionicons name={t.done ? 'checkmark-circle' : 'ticket'} size={20} color={t.done ? C.green : '#7C3AED'} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={2}>{t.name}</Text>
          <Text style={styles.meta}>× {t.qty}{t.addedByDriver ? ' · added from the app' : ''}</Text>
        </View>
        {t.done
          ? <Pill text={`${t.files.length} file${t.files.length === 1 ? '' : 's'}`} tone="green" icon="cloud-done" />
          : <Pill text="Needed" tone="red" icon="alert-circle" />}
      </Row>
      {(t.files.length > 0 || editable) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingLeft: 48 }}>
          {t.files.map(f => <FileThumb key={f.id} f={f} onLongPress={editable && f.mine ? () => ctl.remove(t, f.id) : undefined} />)}
          {editable && (
            <Pressable disabled={busy} onPress={() => ctl.upload(t)} style={[styles.thumb, styles.addThumb]}>
              <Ionicons name={busy ? 'hourglass' : 'camera'} size={22} color={C.red} />
              <Text style={styles.addText}>{busy ? 'Sending' : t.done ? 'More' : 'Upload'}</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** The tickets for one day (or the whole trip), with the add button. */
export function TicketList({ tickets, ctl, editable, onAdd, title = 'Entrance tickets' }: {
  tickets: TripTicket[]; ctl: TicketsCtl; editable: boolean; onAdd?: () => void; title?: string
}) {
  if (!tickets.length && !(editable && onAdd)) return null;
  const { done, total } = ticketTally(tickets);
  return (
    <View style={{ gap: S.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.head}>{title.toUpperCase()}{total ? `  ${done}/${total}` : ''}</Text>
        {editable && onAdd && (
          <Pressable onPress={onAdd} hitSlop={8} style={styles.addBtn}>
            <Ionicons name="add" size={16} color="#7C3AED" />
            <Text style={{ color: '#7C3AED', fontWeight: '800', fontSize: 13 }}>Add ticket</Text>
          </Pressable>
        )}
      </Row>
      {tickets.map(t => <TicketRow key={t.id} t={t} ctl={ctl} editable={editable} />)}
      {editable && tickets.some(t => t.files.some(f => f.mine)) && (
        <Text style={{ color: C.dim, fontSize: 12 }}>Tap a file to open it · press and hold one you sent to remove it.</Text>
      )}
    </View>
  );
}

/** A ticket ops did not have — bought at the gate. Needs a name, a day and a photo. */
export function AddTicketSheet({ open, onClose, days, date, ctl }: {
  open: boolean; onClose: () => void; days: { date: string; dayNo: number }[]; date: string | null; ctl: TicketsCtl
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [day, setDay] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [saving, setSaving] = useState(false);
  const chosen = day ?? date ?? days[0]?.date ?? null;

  function close() {
    setName(''); setQty(1); setDay(null); setFiles([]);
    onClose();
  }

  async function save() {
    if (!chosen) return;
    setSaving(true);
    try {
      await ctl.add({ name: name.trim(), qty, date: chosen }, files);
      close();
    } catch (e) {
      Alert.alert('Ticket not added', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Add a ticket">
      <Text style={{ color: C.sub }}>For a ticket bought at the gate or not on the list. Operations see it on the booking.</Text>
      <Input icon="ticket-outline" placeholder="e.g. Sigiriya Rock Fortress" value={name} onChangeText={setName} autoCapitalize="words" />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>Tickets</Text>
        <Row gap={S.md}>
          <Pressable onPress={() => setQty(q => Math.max(1, q - 1))} style={styles.step}><Ionicons name="remove" size={20} color={C.text} /></Pressable>
          <Text style={{ color: C.text, fontWeight: '900', fontSize: 20, minWidth: 28, textAlign: 'center' }}>{qty}</Text>
          <Pressable onPress={() => setQty(q => Math.min(99, q + 1))} style={styles.step}><Ionicons name="add" size={20} color={C.text} /></Pressable>
        </Row>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
        {days.map(d => (
          <Pressable key={d.date} onPress={() => setDay(d.date)} style={[styles.dayChip, chosen === d.date && styles.dayChipOn]}>
            <Text style={[styles.dayChipT, chosen === d.date && { color: '#fff' }]}>Day {d.dayNo}</Text>
            <Text style={[styles.dayChipS, chosen === d.date && { color: '#FFE4E6' }]}>{fmtDay(d.date, { day: 'numeric', month: 'short' })}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
        {files.map((f, i) => (
          <Pressable key={f.uri} onLongPress={() => setFiles(fs => fs.filter((_, j) => j !== i))} style={styles.thumb}>
            {f.type.startsWith('image/')
              ? <Image source={{ uri: f.uri }} alt="" style={StyleSheet.absoluteFill} contentFit="cover" />
              : <Ionicons name="document-text" size={26} color={C.red} />}
          </Pressable>
        ))}
        <Pressable onPress={async () => { const more = await ctl.pick(); if (more.length) setFiles(fs => [...fs, ...more]); }} style={[styles.thumb, styles.addThumb]}>
          <Ionicons name="camera" size={22} color={C.red} />
          <Text style={styles.addText}>{files.length ? 'More' : 'Photo'}</Text>
        </Pressable>
      </ScrollView>
      <Button title="Add ticket" icon="checkmark" onPress={save} loading={saving} disabled={!name.trim() || !files.length || !chosen} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { color: '#7C3AED', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#F5F3FF', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  row: { gap: S.sm, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' },
  name: { color: C.text, fontWeight: '800', fontSize: 15 },
  meta: { color: C.sub, fontSize: 13 },
  thumb: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  addThumb: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#FCA5A5', backgroundColor: C.redSoft, gap: 2 },
  addText: { color: C.red, fontWeight: '800', fontSize: 11 },
  step: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  dayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: C.cardHi, alignItems: 'center' },
  dayChipOn: { backgroundColor: C.red },
  dayChipT: { color: C.text, fontWeight: '800' },
  dayChipS: { color: C.sub, fontSize: 12 },
});
