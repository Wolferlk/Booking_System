/**
 * One WhatsApp conversation — the same thread as ops.aahaas.com → WhatsApp.
 * Opening it marks the guest's messages read (the web does the same).
 *
 * On top of the web's thread: WhatsApp formatting and links, delivery ticks,
 * a live 24h-window countdown, sends that show instantly (and retry on
 * failure), photos / documents / templates, quick replies, in-chat search
 * and a full-screen photo viewer.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sheet } from '@/components/sheet';
import { IconButton, Ionicons, Loading, Row, type IconName } from '@/components/ui';
import { QuickReplyManager, WaComposer } from '@/components/wa-composer';
import { TemplateSheet } from '@/components/wa-templates';
import { WaText } from '@/components/wa-text';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { fmtRange } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/status';
import { C, R, S } from '@/lib/theme';
import { filePart } from '@/lib/upload';
import { fmtLeft, loadQuickReplies, saveCustomQuickReplies, tickFor, windowLeft, type Pending, type QuickReply } from '@/lib/wa';
import { openWebFile, web, webAction, webForm, webImageSource } from '@/lib/web';

interface Msg { id: string; direction: string; body: string | null; createdAt: string; status: string; senderName: string | null; mediaUrl: string | null; mediaType: string | null }
interface Related { phone: string; bookingRef: string; displayName: string | null; messageCount: number; lastAt: string }
interface Data {
  messages: Msg[]
  booking: { bookingRef: string; leadName: string | null; status: string; arrivalDate?: string | null; departureDate?: string | null } | null
  windowOpen: boolean
  relatedThreads?: Related[]
}

type Row_ =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; m: Msg; first: boolean; last: boolean }
  | { kind: 'pending'; key: string; p: Pending };

const WALL = '#EFEAE2';
const OUT = '#D9FDD3';
const INK = '#111B21';
const META = '#667781';
const AVATARS = ['#00A884', '#2563EB', '#7C3AED', '#E11D48', '#D97706', '#0891B2', '#DB2777', '#4F46E5'];

/** WhatsApp media lives behind the session (/api/...) or at a public URL. */
const isApi = (u: string) => u.startsWith('/api/');
const dayKey = (iso: string) => new Date(iso).toDateString();
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sig = (d: Data) => `${d.windowOpen}|${d.booking?.status}|${d.messages.map(m => `${m.id}:${m.status}`).join(',')}`;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: Date.now() - d.getTime() < 6 * 86400_000 ? 'long' : undefined, day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function initials(name: string, phone: string) {
  const n = name.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
  return n ? n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : phone.slice(-2);
}

export default function WaThread() {
  const { phone, name } = useLocalSearchParams<{ phone: string; name?: string }>();
  const { actor } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [auth, setAuth] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<Msg | null>(null);
  const [viewer, setViewer] = useState<Msg | null>(null);
  const [saveReply, setSaveReply] = useState<{ text: string; list: QuickReply[] } | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [hit, setHit] = useState(0);
  const [away, setAway] = useState(false);
  const [seen, setSeen] = useState(0);
  const list = useRef<FlatList<Row_>>(null);
  const lastSig = useRef('');

  useEffect(() => { webImageSource('whatsapp').then(s => setAuth(s.headers)); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    try {
      const d = await web<Data>(`whatsapp/messages?phone=${encodeURIComponent(phone)}`);
      const s = sig(d);
      if (s !== lastSig.current) { lastSig.current = s; setData(d); }
    } catch (e) { if (!lastSig.current) Alert.alert('Could not load', (e as Error).message); }
  }, [phone]);

  // Poll every 8 s while the app is in front; catch up as soon as it comes back.
  useEffect(() => {
    load();
    let t = setInterval(load, 8000);
    const sub = AppState.addEventListener('change', st => {
      clearInterval(t);
      if (st === 'active') { load(); t = setInterval(load, 8000); }
    });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]);

  const msgs = useMemo(() => data?.messages ?? [], [data]);
  const lead = data?.booking?.leadName || name || '';
  const title = name || data?.booking?.leadName || `+${phone}`;
  const ctx = { name: lead, ref: data?.booking?.bookingRef ?? null, me: actor?.name ?? null };
  const lastInbound = [...msgs].reverse().find(m => m.direction === 'inbound')?.createdAt ?? null;
  const left = data?.windowOpen ? windowLeft(lastInbound, now) : null;
  const windowOpen = !!data?.windowOpen;
  const inboundCount = msgs.filter(m => m.direction === 'inbound').length;
  const unseen = away ? Math.max(0, inboundCount - seen) : 0;

  useEffect(() => { if (!away) setSeen(inboundCount); }, [away, inboundCount]);

  const rows = useMemo(() => {
    const out: Row_[] = [];
    let prevDay = '';
    msgs.forEach((m, i) => {
      const d = dayKey(m.createdAt);
      if (d !== prevDay) { out.push({ kind: 'day', key: `d-${d}`, label: dayLabel(m.createdAt) }); prevDay = d; }
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const joins = (a?: Msg, b?: Msg) => !!a && !!b && a.direction === b.direction && dayKey(a.createdAt) === dayKey(b.createdAt) && Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < 5 * 60_000;
      out.push({ kind: 'msg', key: m.id, m, first: !joins(prev, m), last: !joins(m, next) });
    });
    pending.forEach(p => out.push({ kind: 'pending', key: p.tempId, p }));
    return out.reverse();
  }, [msgs, pending]);

  const q = search?.trim().toLowerCase() ?? '';
  const hits = useMemo(() => (q ? rows.flatMap((r, i) => (r.kind === 'msg' && r.m.body?.toLowerCase().includes(q) ? [i] : [])) : []), [rows, q]);
  useEffect(() => { setHit(0); }, [q]);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  // Jump only when the query or the chosen match changes — not on every poll.
  useEffect(() => {
    const h = hitsRef.current;
    if (h.length) list.current?.scrollToIndex({ index: h[Math.min(hit, h.length - 1)], viewPosition: 0.5, animated: true });
  }, [q, hit, hits.length]);

  // ── sending ──────────────────────────────────────────────────────────────

  async function run(p: Pending) {
    setPending(ps => [...ps.filter(x => x.tempId !== p.tempId), { ...p, state: 'sending', error: undefined }]);
    try {
      if (p.kind === 'text') await webAction('whatsapp/send', { phone, message: p.text });
      else if (p.kind === 'template' && p.template) {
        await webAction('whatsapp/send-template', { phone, template: p.template.name, lang: p.template.lang, bodyParams: p.template.bodyParams, headerParams: p.template.headerParams, previewText: p.text });
      } else if (p.file) {
        const form = new FormData();
        form.append('phone', phone);
        if (p.text) form.append('caption', p.text);
        form.append('file', filePart(p.file));
        await webForm('whatsapp/send-media', form);
      }
      await load();
      setPending(ps => ps.filter(x => x.tempId !== p.tempId));
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPending(ps => ps.map(x => (x.tempId === p.tempId ? { ...x, state: 'failed', error: (e as ApiError).message } : x)));
    }
  }

  const queue = (p: Omit<Pending, 'tempId' | 'at' | 'state'>) => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    run({ ...p, tempId: `tmp-${Date.now()}`, at: new Date().toISOString(), state: 'sending' });
  };

  function retry(p: Pending) {
    Alert.alert('Not sent', p.error ?? 'The message did not go through.', [
      { text: 'Discard', style: 'destructive', onPress: () => setPending(ps => ps.filter(x => x.tempId !== p.tempId)) },
      { text: 'Cancel', style: 'cancel' },
      { text: 'Try again', onPress: () => run(p) },
    ]);
  }

  // ── media ────────────────────────────────────────────────────────────────

  const imgSource = (u: string) => (isApi(u) ? { uri: `${API_URL}/api/mobile/web/${u.slice(5)}`, headers: auth } : { uri: u });
  const openFile = (m: Msg) => {
    const u = m.mediaUrl!;
    (isApi(u) ? openWebFile(u.slice(5).split('?')[0], `${m.mediaType ?? 'file'}-${m.id}`) : Linking.openURL(u)).catch(e => Alert.alert('Could not open', (e as Error).message));
  };

  function exportChat() {
    const lines = msgs.map(m => `[${new Date(m.createdAt).toLocaleString()}] ${m.direction === 'inbound' ? title : m.senderName ?? 'Apple Holidays'}: ${m.body ?? `<${m.mediaType ?? 'attachment'}>`}`);
    Share.share({ title: `WhatsApp · ${title}`, message: `WhatsApp chat with ${title} (+${phone})${ctx.ref ? ` · ${ctx.ref}` : ''}\n\n${lines.join('\n')}` });
  }

  // ── render ───────────────────────────────────────────────────────────────

  const avatarColor = AVATARS[[...phone].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % AVATARS.length];
  const b = data?.booking;

  const renderRow = ({ item: r, index }: { item: Row_; index: number }) => {
    if (r.kind === 'day') {
      return (
        <View style={{ alignItems: 'center', marginVertical: S.sm }}>
          <Text style={{ backgroundColor: '#FFFFFF', color: META, fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' }}>{r.label}</Text>
        </View>
      );
    }
    if (r.kind === 'pending') {
      const p = r.p;
      const failed = p.state === 'failed';
      return (
        <Pressable onPress={failed ? () => retry(p) : undefined} style={{ alignItems: 'flex-end', marginTop: 6 }}>
          <View style={[bubble(true, true), { opacity: failed ? 1 : 0.8 }]}>
            {p.file?.isImage ? <Image alt="" source={{ uri: p.file.uri }} style={{ width: 230, height: 170, borderRadius: 8 }} contentFit="cover" /> : null}
            {p.file && !p.file.isImage ? <FileChip name={p.file.name} /> : null}
            {p.kind === 'template' ? <TemplateTag /> : null}
            {p.text ? <WaText text={p.text} style={{ color: INK, fontSize: 15.5, lineHeight: 21 }} /> : null}
            <Row gap={4} style={{ alignSelf: 'flex-end' }}>
              <Text style={{ color: failed ? C.red : META, fontSize: 11 }}>{failed ? 'Not sent · tap to retry' : 'Sending…'}</Text>
              <Ionicons name={failed ? 'alert-circle' : 'time-outline'} size={14} color={failed ? C.red : META} />
            </Row>
          </View>
        </Pressable>
      );
    }
    const { m, first, last } = r;
    const mine = m.direction === 'outbound';
    const tpl = /^\[Template: (.+)\]$/.exec(m.body ?? '')?.[1];
    const tick = tickFor(m.status);
    const current = hits.length > 0 && hits[Math.min(hit, hits.length - 1)] === index;
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: first ? 8 : 2 }}>
        <Pressable onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAction(m); }} delayLongPress={300}
          style={[bubble(mine, last), current && { borderWidth: 2, borderColor: '#F5B700' }]}>
          {mine && first && m.senderName ? <Text style={{ color: '#008069', fontSize: 12, fontWeight: '700' }}>{m.senderName}</Text> : null}
          {m.mediaUrl && m.mediaType === 'image' ? (
            <Pressable onPress={() => setViewer(m)}><Image alt="" source={imgSource(m.mediaUrl)} style={{ width: 230, height: 170, borderRadius: 8, backgroundColor: '#00000010' }} contentFit="cover" transition={150} /></Pressable>
          ) : m.mediaUrl ? (
            <Pressable onPress={() => openFile(m)}><FileChip name={m.mediaType ?? 'Attachment'} /></Pressable>
          ) : null}
          {tpl ? <TemplateTag name={tpl} /> : m.body ? <WaText text={m.body} highlight={q} style={{ color: INK, fontSize: 15.5, lineHeight: 21 }} /> : null}
          <Row gap={3} style={{ alignSelf: 'flex-end' }}>
            <Text style={{ color: META, fontSize: 11 }}>{hhmm(m.createdAt)}</Text>
            {mine ? <Ionicons name={tick.icon} size={15} color={tick.color} /> : null}
          </Row>
          {mine && m.status === 'failed' ? (
            <Pressable onPress={() => setAction(m)}><Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>WhatsApp did not deliver this · options</Text></Pressable>
          ) : null}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.card }} edges={['top']}>
      {/* header */}
      {search === null ? (
        <Row style={{ paddingHorizontal: S.sm, paddingVertical: S.sm, gap: S.sm, backgroundColor: C.card }}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: avatarColor, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>{initials(title.startsWith('+') ? '' : title, phone)}</Text>
          </View>
          <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(true)}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{title}</Text>
            {!data ? <Text style={{ color: C.sub, fontSize: 12 }}>+{phone}</Text> : windowOpen ? (
              <Row gap={4}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: left !== null && left < 2 * 3_600_000 ? C.amber : '#25D366' }} />
                <Text style={{ color: left !== null && left < 2 * 3_600_000 ? C.amber : '#008069', fontSize: 12, fontWeight: '600' }}>
                  {left !== null ? `Chat open · ${fmtLeft(left)} left` : 'Chat open'}
                </Text>
              </Row>
            ) : (
              <Row gap={4}><Ionicons name="lock-closed" size={11} color={C.gold} /><Text style={{ color: C.gold, fontSize: 12, fontWeight: '600' }}>24h window closed · templates only</Text></Row>
            )}
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setSearch('')} style={{ padding: 6 }}><Ionicons name="search" size={22} color={C.text} /></Pressable>
          <Pressable hitSlop={8} onPress={() => setMenuOpen(true)} style={{ padding: 6 }}><Ionicons name="ellipsis-vertical" size={22} color={C.text} /></Pressable>
        </Row>
      ) : (
        <Row style={{ paddingHorizontal: S.md, paddingVertical: S.sm, gap: S.sm, backgroundColor: C.card }}>
          <Pressable hitSlop={8} onPress={() => setSearch(null)}><Ionicons name="arrow-back" size={24} color={C.text} /></Pressable>
          <TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search this chat" placeholderTextColor={C.dim} returnKeyType="search"
            onSubmitEditing={() => setHit(h => (hits.length ? (h + 1) % hits.length : 0))}
            style={{ flex: 1, color: C.text, fontSize: 16, backgroundColor: C.cardHi, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: 9 }} />
          <Text style={{ color: C.sub, fontSize: 12, minWidth: 38, textAlign: 'center' }}>{q ? (hits.length ? `${Math.min(hit, hits.length - 1) + 1}/${hits.length}` : '0') : ''}</Text>
          <Pressable disabled={!hits.length} onPress={() => setHit(h => (h + 1) % hits.length)}><Ionicons name="chevron-up" size={24} color={hits.length ? C.text : C.dim} /></Pressable>
          <Pressable disabled={!hits.length} onPress={() => setHit(h => (h - 1 + hits.length) % hits.length)}><Ionicons name="chevron-down" size={24} color={hits.length ? C.text : C.dim} /></Pressable>
        </Row>
      )}

      {/* booking strip */}
      {b && search === null && (
        <View style={{ backgroundColor: C.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: S.md, paddingVertical: 8, gap: S.sm, alignItems: 'center' }}>
            <Chip icon="briefcase" tone={C.red} text={b.bookingRef} strong onPress={() => router.push({ pathname: '/booking/[ref]', params: { ref: b.bookingRef } })} />
            <Chip icon="flag" tone={C.blue} text={STATUS_LABELS[b.status] ?? b.status} />
            {b.arrivalDate && b.departureDate ? <Chip icon="calendar" tone={C.sub} text={fmtRange(b.arrivalDate.slice(0, 10), b.departureDate.slice(0, 10))} /> : null}
            {(data?.relatedThreads ?? []).map(t => (
              <Chip key={t.phone} icon="git-branch" tone={C.gold} text={`${t.displayName || `+${t.phone}`} · ${t.messageCount}`}
                onPress={() => router.replace({ pathname: '/wa/[phone]', params: { phone: t.phone, name: t.displayName ?? '' } })} />
            ))}
          </ScrollView>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: WALL }}>
        {!data ? <Loading /> : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={list}
              inverted
              data={rows}
              keyExtractor={r => r.key}
              renderItem={renderRow}
              contentContainerStyle={{ paddingHorizontal: S.md, paddingVertical: S.md }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onScroll={e => setAway(e.nativeEvent.contentOffset.y > 280)}
              scrollEventThrottle={64}
              onScrollToIndexFailed={info => {
                list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
                setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 120);
              }}
              ListFooterComponent={(
                <View style={{ alignSelf: 'center', maxWidth: '88%', backgroundColor: '#FFEECD', borderRadius: 8, padding: S.sm, marginBottom: S.sm }}>
                  <Text style={{ color: '#54656F', fontSize: 12, textAlign: 'center' }}>🔒 Shared Operations inbox. Everyone on the desk sees this chat, and it’s also on ops.aahaas.com.</Text>
                </View>
              )}
            />
            {away && (
              <Pressable onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
                style={{ position: 'absolute', right: S.md, bottom: S.md, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
                <Ionicons name="chevron-down" size={24} color={META} />
                {unseen > 0 && <View style={{ position: 'absolute', top: -6, right: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{unseen}</Text></View>}
              </Pressable>
            )}
          </View>
        )}

        {data && !windowOpen && (
          <Pressable onPress={() => setTemplatesOpen(true)} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center', backgroundColor: C.goldSoft, paddingHorizontal: S.md, paddingVertical: 10 }}>
            <Ionicons name="time" size={16} color={C.gold} />
            <Text style={{ color: C.text, fontSize: 12, flex: 1 }}>Outside the 24h window. Typed messages go out as the approved re-engagement template. <Text style={{ fontWeight: '800', color: C.gold }}>Pick another template →</Text></Text>
          </Pressable>
        )}
        {data && (
          <WaComposer phone={phone} ctx={ctx} windowOpen={windowOpen}
            onSendText={text => queue({ kind: 'text', text })}
            onSendMedia={(file, caption) => queue({ kind: 'media', text: caption, file })}
            onTemplates={() => setTemplatesOpen(true)} />
        )}
      </KeyboardAvoidingView>

      <TemplateSheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} ctx={{ name: lead.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '') || null, ref: ctx.ref }}
        onSend={t => queue({ kind: 'template', text: t.preview, template: { name: t.name, lang: t.lang, bodyParams: t.bodyParams, headerParams: t.headerParams } })} />

      {/* chat menu */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={title}>
        <Text style={{ color: C.sub, marginTop: -S.sm }}>+{phone}{b ? ` · ${b.bookingRef}` : ''}</Text>
        <Row gap={S.sm} style={{ justifyContent: 'space-between' }}>
          <Big icon="call" label="Call" onPress={() => Linking.openURL(`tel:+${phone}`)} />
          <Big icon="logo-whatsapp" label="My WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${phone}`)} />
          <Big icon="copy" label="Copy no." onPress={() => { Clipboard.setStringAsync(`+${phone}`); setMenuOpen(false); }} />
          <Big icon="share-outline" label="Export" onPress={() => { setMenuOpen(false); exportChat(); }} />
        </Row>
        <MenuRow icon="search" label="Search this chat" onPress={() => { setMenuOpen(false); setSearch(''); }} />
        <MenuRow icon="document-text" label="Send an approved template" onPress={() => { setMenuOpen(false); setTemplatesOpen(true); }} />
        {b && <MenuRow icon="briefcase" label={`Open booking ${b.bookingRef}`} onPress={() => { setMenuOpen(false); router.push({ pathname: '/booking/[ref]', params: { ref: b.bookingRef } }); }} />}
        {b && <MenuRow icon="document-attach" label="Send Tour Confirmation PDF" onPress={() => { setMenuOpen(false); router.push({ pathname: '/booking/send', params: { ref: b.bookingRef, phone, name: lead } }); }} />}
        <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.sm }}>
          <Stat n={msgs.filter(m => m.direction === 'inbound').length} label="from guest" />
          <Stat n={msgs.filter(m => m.direction === 'outbound').length} label="from us" />
          <Stat n={msgs.filter(m => m.mediaUrl).length} label="files" />
        </View>
      </Sheet>

      {/* long-press actions */}
      <Sheet open={!!action} onClose={() => setAction(null)} title={action?.direction === 'outbound' ? 'Our message' : 'Guest message'}>
        {action && (
          <>
            <Text style={{ color: C.sub, fontSize: 13, marginTop: -S.sm }}>
              {new Date(action.createdAt).toLocaleString()}{action.direction === 'outbound' ? ` · ${action.senderName ?? 'Staff'} · ${tickFor(action.status).label}` : ''}
            </Text>
            {action.body && <MenuRow icon="copy" label="Copy text" onPress={() => { Clipboard.setStringAsync(action.body!); Haptics.selectionAsync(); setAction(null); }} />}
            {action.body && <MenuRow icon="share-outline" label="Share" onPress={() => { Share.share({ message: action.body! }); setAction(null); }} />}
            {action.body && action.direction === 'outbound' && (
              <MenuRow icon="flash" label="Save as quick reply" onPress={() => { const text = action.body!; setAction(null); loadQuickReplies().then(l => setSaveReply({ text, list: l })); }} />
            )}
            {action.body && action.direction === 'outbound' && (
              <MenuRow icon="refresh" label={action.status === 'failed' ? 'Send again' : 'Send again as new message'} onPress={() => { const text = action.body!; setAction(null); queue({ kind: 'text', text }); }} />
            )}
            {action.mediaUrl && <MenuRow icon="open-outline" label={`Open ${action.mediaType ?? 'attachment'}`} onPress={() => { const m = action; setAction(null); openFile(m); }} />}
            {action.status === 'failed' && (
              <Text style={{ color: C.sub, fontSize: 13 }}>WhatsApp reported this as not delivered. If the guest hasn’t written in 24 hours, send an approved template instead. If the number isn’t on WhatsApp, call them.</Text>
            )}
          </>
        )}
      </Sheet>

      {saveReply && <QuickReplyManager open onClose={() => setSaveReply(null)} replies={saveReply.list} seed={saveReply.text}
        onChange={r => { saveCustomQuickReplies(r).catch(() => {}); setSaveReply(null); }} />}

      {/* photo viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: '#000000F2' }}>
          <SafeAreaView edges={['top']}>
            <Row style={{ padding: S.md, justifyContent: 'space-between' }}>
              <Pressable hitSlop={10} onPress={() => setViewer(null)}><Ionicons name="close" size={28} color="#FFFFFF" /></Pressable>
              <Text style={{ color: '#FFFFFF', fontSize: 13 }}>{viewer ? `${viewer.direction === 'inbound' ? title : viewer.senderName ?? 'Us'} · ${new Date(viewer.createdAt).toLocaleString()}` : ''}</Text>
              <Pressable hitSlop={10} onPress={() => viewer && openFile(viewer)}><Ionicons name="share-outline" size={26} color="#FFFFFF" /></Pressable>
            </Row>
          </SafeAreaView>
          {viewer?.mediaUrl && (
            <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
              <Image alt="" source={imgSource(viewer.mediaUrl)} style={{ width: '100%', aspectRatio: 0.75 }} contentFit="contain" />
            </ScrollView>
          )}
          {viewer?.body ? <View style={{ padding: S.lg, paddingBottom: 40 }}><WaText text={viewer.body} style={{ color: '#FFFFFF', fontSize: 15, textAlign: 'center' }} /></View> : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function bubble(mine: boolean, tail: boolean) {
  return {
    maxWidth: '84%' as const, gap: 4, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 5, borderRadius: 10,
    backgroundColor: mine ? OUT : '#FFFFFF',
    borderTopRightRadius: mine && tail ? 2 : 10, borderTopLeftRadius: !mine && tail ? 2 : 10,
    shadowColor: '#0B141A', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  };
}

function FileChip({ name }: { name: string }) {
  return (
    <Row gap={S.sm} style={{ backgroundColor: '#0000000A', borderRadius: 8, padding: S.sm, minWidth: 200 }}>
      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#5157AE', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-text" size={20} color="#FFFFFF" /></View>
      <Text style={{ color: INK, fontWeight: '600', flex: 1, textTransform: 'capitalize' }} numberOfLines={1}>{name}</Text>
      <Ionicons name="download-outline" size={20} color={META} />
    </Row>
  );
}

function TemplateTag({ name }: { name?: string }) {
  return (
    <Row gap={6} style={{ backgroundColor: '#00000008', borderRadius: 8, paddingHorizontal: S.sm, paddingVertical: 6 }}>
      <Ionicons name="document-text" size={15} color="#008069" />
      <Text style={{ color: '#008069', fontSize: 12, fontWeight: '700' }}>{name ? `Template · ${name.replace(/_/g, ' ')}` : 'Approved template'}</Text>
    </Row>
  );
}

function Chip({ icon, text, tone, onPress, strong }: { icon: IconName; text: string; tone: string; onPress?: () => void; strong?: boolean }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: strong ? `${tone}14` : C.cardHi, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={13} color={tone} />
      <Text style={{ color: strong ? tone : C.text, fontSize: 12, fontWeight: strong ? '800' : '600' }}>{text}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={12} color={C.dim} /> : null}
    </Pressable>
  );
}

function Big({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, paddingVertical: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.cardHi : C.card })}>
      <Ionicons name={icon} size={22} color="#008069" />
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function MenuRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={icon} size={20} color={C.sub} />
      <Text style={{ color: C.text, fontSize: 16, flex: 1 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={C.dim} />
    </Pressable>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: C.cardHi, borderRadius: R.md, paddingVertical: S.sm }}>
      <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{n}</Text>
      <Text style={{ color: C.sub, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
