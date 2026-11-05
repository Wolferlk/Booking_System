import type { ReactNode } from 'react';
import { Linking, Platform, Text, type TextStyle } from 'react-native';
import { parseWa } from '@/lib/wa';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** A WhatsApp message body with its *bold* / _italic_ / ~strike~ / `mono`, tappable links and search hits. */
export function WaText({ text, style, highlight, numberOfLines }: { text: string; style?: TextStyle; highlight?: string; numberOfLines?: number }) {
  const q = highlight?.trim().toLowerCase();
  return (
    <Text style={style} numberOfLines={numberOfLines} selectable>
      {parseWa(text).map((s, i) => {
        const st: TextStyle = {
          fontWeight: s.b ? '700' : undefined,
          fontStyle: s.i ? 'italic' : undefined,
          textDecorationLine: s.s ? 'line-through' : s.url ? 'underline' : undefined,
          fontFamily: s.m ? MONO : undefined,
          color: s.url ? '#027EB5' : undefined,
        };
        return (
          <Text key={i} style={st} onPress={s.url ? () => Linking.openURL(s.url!).catch(() => {}) : undefined}>
            {q ? hits(s.t, q) : s.t}
          </Text>
        );
      })}
    </Text>
  );
}

function hits(t: string, q: string) {
  const parts: ReactNode[] = [];
  const lower = t.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) parts.push(t.slice(at, i));
    parts.push(<Text key={i} style={{ backgroundColor: '#FFE16A', color: '#0E1525' }}>{t.slice(i, i + q.length)}</Text>);
    at = i + q.length;
  }
  parts.push(t.slice(at));
  return parts;
}
