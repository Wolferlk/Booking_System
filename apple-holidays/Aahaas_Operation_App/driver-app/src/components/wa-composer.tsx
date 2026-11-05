/**
 * WhatsApp composer — text with /shortcut quick replies, an emoji strip,
 * photo / camera / document attachments with a caption, and a draft that
 * survives leaving the chat. When the box is empty the round button opens
 * the template picker instead of sending.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/sheet';
import { Button, Ionicons, Row, type IconName } from '@/components/ui';
import { C, R, S } from '@/lib/theme';
import {
  EMOJIS, WA_TEXT_LIMIT, expandTokens, loadDraft, loadQuickReplies, saveCustomQuickReplies, saveDraft,
  type Pending, type QuickReply,
} from '@/lib/wa';

const WA_GREEN = '#00A884';
const MAX_BYTES = 16 * 1024 * 1024;
type File = NonNullable<Pending['file']>;

export function WaComposer({ phone, ctx, windowOpen, onSendText, onSendMedia, onTemplates }: {
  phone: string
  ctx: { name?: string | null; ref?: string | null; me?: string | null }
  windowOpen: boolean
  onSendText: (text: string) => void
  onSendMedia: (file: File, caption: string) => void
  onTemplates: () => void
}) {
  const [text, setText] = useState('');
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [panel, setPanel] = useState<'none' | 'emoji' | 'quick'>('none');
  const [attachOpen, setAttachOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const loaded = useRef(false);

  useEffect(() => { loadQuickReplies().then(setReplies); }, []);
  useEffect(() => { loadDraft(phone).then(d => { if (d) setText(d); loaded.current = true; }); }, [phone]);
  useEffect(() => { if (!loaded.current) return; const t = setTimeout(() => saveDraft(phone, text), 400); return () => clearTimeout(t); }, [phone, text]);

  // "/dri" → the matching quick replies, straight above the keyboard.
  const slash = /^\/(\S*)$/.exec(text)?.[1]?.toLowerCase();
  const suggestions = useMemo(() => (slash === undefined ? [] : replies.filter(q => q.shortcut.toLowerCase().startsWith(slash) || q.text.toLowerCase().includes(slash)).slice(0, 5)), [slash, replies]);

  const over = text.length > WA_TEXT_LIMIT;
  const canSend = (!!text.trim() || !!file) && !over;

  function insert(s: string) {
    setText(t => t.slice(0, sel.start) + s + t.slice(sel.end));
    setSel(p => ({ start: p.start + s.length, end: p.start + s.length }));
  }

  function applyReply(q: QuickReply) {
    Haptics.selectionAsync();
    setText(expandTokens(q.text, ctx));
    setPanel('none');
  }

  function send() {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (file) onSendMedia(file, text.trim());
    else onSendText(text.trim());
    setText(''); setFile(null); setPanel('none'); saveDraft(phone, '');
  }

  async function pick(from: 'camera' | 'library' | 'document') {
    setAttachOpen(false);
    if (!windowOpen) {
      Alert.alert('Outside the 24h window', 'WhatsApp only delivers photos and files after the guest has written to us in the last 24 hours. Send an approved template first; once they reply you can attach files.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Choose template', onPress: onTemplates },
      ]);
      return;
    }
    try {
      let f: File | null = null;
      let size: number | undefined;
      if (from === 'document') {
        const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
        const a = r.canceled ? null : r.assets[0];
        if (a) { f = { uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream', isImage: !!a.mimeType?.startsWith('image/') }; size = a.size; }
      } else {
        const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) throw new Error(from === 'camera' ? 'Camera permission is needed.' : 'Photo access is needed.');
        const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
        const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
        const a = r.canceled ? null : r.assets[0];
        if (a) {
          // HEIC doesn't open on most Android phones; the picker hands us a JPEG-compatible file at quality < 1.
          const type = a.mimeType && a.mimeType !== 'image/heic' ? a.mimeType : 'image/jpeg';
          f = { uri: a.uri, name: a.fileName?.replace(/\.heic$/i, '.jpg') ?? `photo-${Date.now()}.jpg`, type, isImage: true };
          size = a.fileSize;
        }
      }
      if (!f) return;
      if (size && size > MAX_BYTES) throw new Error('That file is over 16 MB, WhatsApp’s limit.');
      setFile(f);
    } catch (e) { Alert.alert('Could not attach', (e as Error).message); }
  }

  return (
    <View style={{ backgroundColor: '#F0F2F5' }}>
      {suggestions.length > 0 && (
        <View style={{ backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }}>
          {suggestions.map(q => (
            <Pressable key={q.id} onPress={() => applyReply(q)} style={({ pressed }) => ({ paddingHorizontal: S.lg, paddingVertical: 10, backgroundColor: pressed ? C.cardHi : C.card, borderBottomWidth: 1, borderBottomColor: C.line })}>
              <Text style={{ color: WA_GREEN, fontWeight: '800', fontSize: 13 }}>/{q.shortcut}</Text>
              <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}>{expandTokens(q.text, ctx)}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {file && (
        <Row style={{ margin: S.sm, marginBottom: 0, padding: S.sm, backgroundColor: C.card, borderRadius: R.md, gap: S.md }}>
          {file.isImage
            ? <Image alt="" source={{ uri: file.uri }} style={{ width: 52, height: 52, borderRadius: 10 }} contentFit="cover" />
            : <View style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-text" size={26} color={C.blue} /></View>}
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '700' }} numberOfLines={1}>{file.name}</Text>
            <Text style={{ color: C.sub, fontSize: 12 }}>Type a caption below (optional)</Text>
          </View>
          <Ionicons name="close-circle" size={24} color={C.dim} onPress={() => setFile(null)} />
        </Row>
      )}

      {panel === 'emoji' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: S.sm, paddingTop: S.sm, gap: 2 }}>
          {EMOJIS.map(e => <Pressable key={e} onPress={() => insert(e)} style={{ padding: 6 }}><Text style={{ fontSize: 26 }}>{e}</Text></Pressable>)}
        </ScrollView>
      )}
      {panel === 'quick' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: S.sm, paddingTop: S.sm, gap: S.sm }}>
          {replies.map(q => (
            <Pressable key={q.id} onPress={() => applyReply(q)} style={{ maxWidth: 220, backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: 8, borderWidth: 1, borderColor: C.line }}>
              <Text style={{ color: WA_GREEN, fontWeight: '800', fontSize: 12 }}>/{q.shortcut}</Text>
              <Text style={{ color: C.text, fontSize: 13 }} numberOfLines={2}>{expandTokens(q.text, ctx)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setManageOpen(true)} style={{ backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: S.md, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' }}>
            <Ionicons name="add" size={20} color={C.sub} /><Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>Manage</Text>
          </Pressable>
        </ScrollView>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: S.sm, paddingBottom: Platform.OS === 'ios' ? 28 : S.sm }}>
        <Tool icon="add" onPress={() => setAttachOpen(true)} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: C.card, borderRadius: 24, paddingLeft: 4 }}>
          <Tool icon={panel === 'emoji' ? 'close' : 'happy-outline'} small onPress={() => setPanel(p => (p === 'emoji' ? 'none' : 'emoji'))} />
          <TextInput value={text} onChangeText={setText} onSelectionChange={e => setSel(e.nativeEvent.selection)} multiline
            placeholder={file ? 'Add a caption…' : windowOpen ? 'Message  ·  type / for quick replies' : 'Message (sent as template)'} placeholderTextColor={C.dim}
            style={{ flex: 1, maxHeight: 130, color: C.text, fontSize: 16, paddingTop: 11, paddingBottom: 11, paddingHorizontal: 4 }} />
          <Tool icon={panel === 'quick' ? 'close' : 'flash-outline'} small color={panel === 'quick' ? WA_GREEN : C.sub} onPress={() => setPanel(p => (p === 'quick' ? 'none' : 'quick'))} />
        </View>
        <Pressable onPress={canSend ? send : text.trim() || file ? undefined : onTemplates}
          style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: over ? C.dim : WA_GREEN, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
          <Ionicons name={canSend || over ? 'send' : 'document-text'} size={21} color="#FFFFFF" />
        </Pressable>
      </View>
      {text.length > WA_TEXT_LIMIT - 400 && (
        <Text style={{ position: 'absolute', right: 70, bottom: Platform.OS === 'ios' ? 6 : 0, fontSize: 11, color: over ? C.red : C.sub, fontWeight: '700' }}>{text.length}/{WA_TEXT_LIMIT}</Text>
      )}

      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} title="Send">
        <Row gap={S.md} style={{ justifyContent: 'space-around', paddingVertical: S.sm }}>
          <Tile icon="camera" color="#FF2E74" label="Camera" onPress={() => pick('camera')} />
          <Tile icon="images" color="#7F66FF" label="Photos" onPress={() => pick('library')} />
          <Tile icon="document" color="#5157AE" label="Document" onPress={() => pick('document')} />
          <Tile icon="document-text" color={WA_GREEN} label="Template" onPress={() => { setAttachOpen(false); onTemplates(); }} />
        </Row>
        {!windowOpen && <Text style={{ color: C.sub, fontSize: 13, textAlign: 'center' }}>The 24h window is closed, so only templates reach the guest right now.</Text>}
      </Sheet>

      <QuickReplyManager open={manageOpen} onClose={() => setManageOpen(false)} replies={replies}
        onChange={r => { setReplies(r); saveCustomQuickReplies(r).catch(() => {}); }} />
    </View>
  );
}

function Tool({ icon, onPress, small, color = C.sub }: { icon: IconName; onPress: () => void; small?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ width: small ? 38 : 44, height: small ? 46 : 48, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={small ? 23 : 28} color={color} />
    </Pressable>
  );
}

function Tile({ icon, color, label, onPress }: { icon: IconName; color: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={27} color="#FFFFFF" /></View>
      <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** Add your own /shortcuts (kept on this phone); the four desk defaults can't be removed. */
export function QuickReplyManager({ open, onClose, replies, onChange, seed }: {
  open: boolean; onClose: () => void; replies: QuickReply[]; onChange: (r: QuickReply[]) => void; seed?: string
}) {
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => { if (open && seed) setBody(seed); }, [open, seed]);
  const key = shortcut.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const taken = replies.some(q => q.shortcut === key);

  function add() {
    onChange([{ id: `qr-${Date.now()}`, shortcut: key, text: body.trim(), custom: true }, ...replies]);
    setShortcut(''); setBody('');
    if (seed) onClose();
  }

  const input = { color: C.text, fontSize: 15, backgroundColor: C.cardHi, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 10 } as const;
  return (
    <Sheet open={open} onClose={onClose} title="Quick replies">
      <View style={{ gap: S.sm }}>
        <TextInput value={shortcut} onChangeText={setShortcut} placeholder="Shortcut, e.g. pickup" autoCapitalize="none" placeholderTextColor={C.dim} style={input} />
        <TextInput value={body} onChangeText={setBody} multiline placeholder="Message — {name}, {ref} and {me} are filled in for you" placeholderTextColor={C.dim} style={[input, { minHeight: 80, textAlignVertical: 'top' }]} />
        {taken && <Text style={{ color: C.red, fontSize: 12 }}>/{key} already exists.</Text>}
        <Button title="Save quick reply" icon="flash" onPress={add} disabled={!key || !body.trim() || taken} />
      </View>
      {!seed && replies.map(q => (
        <Row key={q.id} style={{ paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.line, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: WA_GREEN, fontWeight: '800' }}>/{q.shortcut}{q.custom ? '' : '  · desk default'}</Text>
            <Text style={{ color: C.sub, fontSize: 13 }}>{q.text}</Text>
          </View>
          {q.custom && <Ionicons name="trash-outline" size={20} color={C.red} onPress={() => onChange(replies.filter(r => r.id !== q.id))} />}
        </Row>
      ))}
    </Sheet>
  );
}
