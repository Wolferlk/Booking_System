/** "Read my day" — an AI summary of today in the driver's language, read aloud on request. */
import * as Speech from 'expo-speech';
import { useState } from 'react';
import { Text } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useT, type Lang } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { C, S } from '@/lib/theme';
import { Button, Card, Ionicons, Row } from './ui';

const VOICE: Record<Lang, string> = { en: 'en-US', si: 'si-LK', ta: 'ta-IN', vi: 'vi-VN' };

export function AiBrief({ bookingRef }: { bookingRef: string }) {
  const t = useT();
  const { actor } = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lang: Lang = actor?.kind === 'DRIVER' ? actor.language : 'en';

  async function load() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ text: string }>('/api/mobile/ai/brief', { body: { bookingRef } });
      setText(r.text);
      speak(r.text);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function speak(s: string) {
    Speech.stop();
    setSpeaking(true);
    Speech.speak(s, { language: VOICE[lang], rate: 0.95, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  }

  if (!text) {
    return (
      <Button title={t('aiBrief')} kind="secondary" icon="sparkles" onPress={load} loading={busy} />
    );
  }
  return (
    <Card tone="blue" style={{ gap: S.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row><Ionicons name="sparkles" size={18} color={C.blue} /><Text style={{ color: C.blue, fontWeight: '800' }}>Your day</Text></Row>
        <Ionicons name={speaking ? 'stop-circle' : 'volume-high'} size={28} color={C.blue}
          onPress={() => (speaking ? (Speech.stop(), setSpeaking(false)) : speak(text))} />
      </Row>
      <Text style={{ color: C.text, fontSize: 16, lineHeight: 24 }}>{text}</Text>
      {error && <Text style={{ color: C.red }}>{error}</Text>}
    </Card>
  );
}
