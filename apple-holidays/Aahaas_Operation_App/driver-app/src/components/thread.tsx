import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { C, R, S } from '@/lib/theme';
import { Ionicons } from './ui';

export interface Bubble {
  id: string; mine: boolean; text: string | null; at: string | null; author?: string | null; status?: string | null
  image?: { uri: string; headers?: Record<string, string> } | null
  onOpenFile?: (() => void) | null
  fileLabel?: string | null
}

function time(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Chat bubbles (newest at the bottom) + a composer. Used by WhatsApp and team chat. */
export function Thread({ items, onSend, header, banner, sendingDisabled, placeholder = 'Message', mineColor = C.red }: {
  items: Bubble[]
  onSend: (text: string) => Promise<void>
  header?: ReactNode
  banner?: ReactNode
  sendingDisabled?: boolean
  placeholder?: string
  mineColor?: string
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Bubble>>(null);
  const data = [...items].reverse();

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try { await onSend(t); setText(''); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      {header}
      <FlatList
        ref={list}
        inverted
        data={data}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: S.lg, gap: S.sm }}
        renderItem={({ item: m }) => (
          <View style={{ alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
            {!m.mine && m.author ? <Text style={{ color: C.dim, fontSize: 11, marginLeft: 6, marginBottom: 2 }}>{m.author}</Text> : null}
            <View style={{ maxWidth: '82%', backgroundColor: m.mine ? mineColor : C.card, borderRadius: R.md, borderBottomRightRadius: m.mine ? 4 : R.md, borderBottomLeftRadius: m.mine ? R.md : 4, padding: S.md, borderWidth: m.mine ? 0 : 1, borderColor: C.line, gap: 6 }}>
              {m.image ? <Pressable onPress={() => m.onOpenFile?.()}><Image alt="" source={m.image} style={{ width: 220, height: 160, borderRadius: 10 }} contentFit="cover" /></Pressable> : null}
              {m.onOpenFile && !m.image ? (
                <Pressable onPress={() => m.onOpenFile?.()} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Ionicons name="document-attach" size={18} color={m.mine ? '#FFFFFF' : C.blue} />
                  <Text style={{ color: m.mine ? '#FFFFFF' : C.blue, fontWeight: '700' }}>{m.fileLabel ?? 'Attachment'}</Text>
                </Pressable>
              ) : null}
              {m.text ? <Text style={{ color: m.mine ? '#FFFFFF' : C.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text> : null}
              <Text style={{ color: m.mine ? 'rgba(255,255,255,0.75)' : C.dim, fontSize: 10, alignSelf: 'flex-end' }}>{time(m.at)}{m.mine && m.status ? ` · ${m.status}` : ''}</Text>
            </View>
          </View>
        )}
      />
      {banner}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: S.sm, padding: S.md, paddingBottom: Platform.OS === 'ios' ? 28 : S.md, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }}>
        <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={C.dim} multiline editable={!sendingDisabled}
          style={{ flex: 1, maxHeight: 120, color: C.text, fontSize: 16, backgroundColor: C.cardHi, borderRadius: 22, paddingHorizontal: S.lg, paddingTop: 11, paddingBottom: 11 }} />
        <Pressable onPress={send} disabled={busy || !text.trim() || sendingDisabled}
          style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: text.trim() && !sendingDisabled ? mineColor : C.line, alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send" size={20} color="#FFFFFF" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
