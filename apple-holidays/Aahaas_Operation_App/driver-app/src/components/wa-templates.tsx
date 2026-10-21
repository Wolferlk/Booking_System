/**
 * Approved-template picker — GET /api/whatsapp/templates, then fill the
 * {{n}} variables (guessed from the booking where the wording makes it clear)
 * and send through /api/whatsapp/send-template, same as the web inbox.
 * Templates are the only thing that reaches a guest outside the 24h window.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/sheet';
import { Button, Ionicons, Pill, Row } from '@/components/ui';
import { WaText } from '@/components/wa-text';
import { C, R, S } from '@/lib/theme';
import { fillTemplate, guessParams, type WaTemplate } from '@/lib/wa';
import { web } from '@/lib/web';

let cache: { at: number; list: WaTemplate[] } | null = null;

export function TemplateSheet({ open, onClose, ctx, onSend }: {
  open: boolean
  onClose: () => void
  ctx: { name?: string | null; ref?: string | null }
  onSend: (t: { name: string; lang: string; bodyParams: string[]; headerParams: string[]; preview: string }) => void
}) {
  const [list, setList] = useState<WaTemplate[] | null>(cache?.list ?? null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<WaTemplate | null>(null);
  const [body, setBody] = useState<string[]>([]);
  const [head, setHead] = useState<string[]>([]);

  useEffect(() => {
    if (!open) { setPick(null); setQ(''); return; }
    if (cache && Date.now() - cache.at < 10 * 60_000) return;
    setError(null);
    web<WaTemplate[]>('whatsapp/templates?status=APPROVED')
      .then(l => { cache = { at: Date.now(), list: l }; setList(l); })
      .catch(e => setError((e as Error).message));
  }, [open]);

  function choose(t: WaTemplate) {
    setPick(t);
    setBody(guessParams(t.bodyText, t.bodyVariableCount, ctx));
    setHead(guessParams(t.headerText, t.headerVariableCount, ctx));
  }

  const shown = useMemo(() => (list ?? []).filter(t => !q.trim() || `${t.name} ${t.bodyText}`.toLowerCase().includes(q.trim().toLowerCase())), [list, q]);
  const mediaHeader = !!pick?.headerFormat && pick.headerFormat !== 'TEXT';
  const ready = pick && !mediaHeader && body.every(v => v.trim()) && head.every(v => v.trim());
  const preview = pick ? [pick.headerText && fillTemplate(pick.headerText, head) ? `*${fillTemplate(pick.headerText, head)}*` : '', fillTemplate(pick.bodyText, body)].filter(Boolean).join('\n\n') : '';

  const field = (label: string, vals: string[], set: (v: string[]) => void) => vals.map((v, i) => (
    <View key={`${label}${i}`} style={{ gap: 4 }}>
      <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>{label} {`{{${i + 1}}}`}</Text>
      <TextInput value={v} onChangeText={t => set(vals.map((x, j) => (j === i ? t : x)))} placeholder="Value" placeholderTextColor={C.dim}
        style={{ color: C.text, fontSize: 15, backgroundColor: C.cardHi, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 10 }} />
    </View>
  ));

  return (
    <Sheet open={open} onClose={onClose} title={pick ? pick.name.replace(/_/g, ' ') : 'Send a template'}>
      {!pick ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.cardHi, borderRadius: R.md, paddingHorizontal: S.md }}>
            <Ionicons name="search" size={16} color={C.sub} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search approved templates" placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 10, fontSize: 15 }} />
          </View>
          {error ? <Text style={{ color: C.red }}>{error}</Text> : !list ? <ActivityIndicator color={C.green} style={{ padding: S.xl }} /> : null}
          {list && !shown.length ? <Text style={{ color: C.sub, textAlign: 'center', padding: S.lg }}>No approved templates match.</Text> : null}
          {shown.map(t => (
            <Pressable key={`${t.name}:${t.language}`} onPress={() => choose(t)}
              style={({ pressed }) => ({ gap: 6, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.cardHi : C.card })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{t.name.replace(/_/g, ' ')}</Text>
                <Pill text={`${(t.category ?? 'template').toLowerCase()} · ${t.language}`} tone={t.category === 'MARKETING' ? 'gold' : 'green'} />
              </Row>
              <WaText text={t.bodyText} numberOfLines={3} style={{ color: C.sub, fontSize: 13, lineHeight: 18 }} />
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Pressable onPress={() => setPick(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="chevron-back" size={16} color={C.blue} /><Text style={{ color: C.blue, fontWeight: '700' }}>All templates</Text>
          </Pressable>
          {mediaHeader && (
            <Row style={{ backgroundColor: C.goldSoft, padding: S.md, borderRadius: R.sm }}>
              <Ionicons name="document-attach" size={16} color={C.gold} />
              <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>This template needs a {pick.headerFormat?.toLowerCase()} header. Send it from ops.aahaas.com.</Text>
            </Row>
          )}
          {field('Header', head, setHead)}
          {field('Variable', body, setBody)}
          <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700', marginTop: S.sm }}>PREVIEW</Text>
          <View style={{ backgroundColor: '#EFEAE2', borderRadius: R.md, padding: S.md }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: '#D9FDD3', borderRadius: R.sm, padding: S.md }}>
              <WaText text={preview} style={{ color: '#111B21', fontSize: 14, lineHeight: 20 }} />
            </View>
          </View>
          <Button title="Send template" icon="send" disabled={!ready} onPress={() => {
            onSend({ name: pick.name, lang: pick.language, bodyParams: body.map(v => v.trim()), headerParams: head.map(v => v.trim()), preview });
            onClose();
          }} />
        </>
      )}
    </Sheet>
  );
}
