/**
 * WhatsApp alerts — how this phone tells you a guest has written.
 * Everything here is saved on the phone (lib/wa-alerts); nothing changes on
 * the server or for anyone else on the desk.
 */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Card, IconButton, Ionicons, Label, Row, Screen, type IconName } from '@/components/ui';
import { C, R, S } from '@/lib/theme';
import {
  customTonesAvailable, DESKS, fmtMuted, hhmm, inQuietHours, muteChat, mutedChats, playTone, setWaAlertSettings, testAlert,
  TONES, useWaAlertSettings, type AlertStyle, type Desk, type ToneId, type WaAlertSettings,
} from '@/lib/wa-alerts';

const WA_GREEN = '#00A884';
const WA_DEEP = ['#075E54', '#00A884'] as const;

const STYLES: { key: AlertStyle; label: string; hint: string; icon: IconName }[] = [
  { key: 'banner', label: 'Aahaas banner', hint: 'Slides in over any screen · Reply or Mute in one tap', icon: 'albums' },
  { key: 'system', label: 'Phone notification', hint: 'Shows in the notification centre too', icon: 'phone-portrait' },
  { key: 'silent', label: 'Badge only', hint: 'Counts on the Chats tab, no interruption', icon: 'ellipse' },
];
const NUDGES = [0, 10, 15, 30, 60];

function RingingBell({ on }: { on: boolean }) {
  const r = useSharedValue(0);
  useEffect(() => {
    if (!on) { r.value = withTiming(0); return; }
    const shake = withSequence(...[16, -14, 10, -7, 4, 0].map(d => withTiming(d, { duration: 80, easing: Easing.inOut(Easing.quad) })));
    r.value = withRepeat(withSequence(shake, withDelay(2200, withTiming(0, { duration: 1 }))), -1, false);
  }, [on, r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Animated.View style={[{ width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF26', alignItems: 'center', justifyContent: 'center' }, st]}>
      <Ionicons name={on ? 'notifications' : 'notifications-off'} size={30} color="#FFFFFF" />
    </Animated.View>
  );
}

function Section({ title, icon, children, delay = 0 }: { title: string; icon: IconName; children: ReactNode; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(320)} style={{ gap: S.sm }}>
      <Row gap={6}><Ionicons name={icon} size={13} color={C.dim} /><Label>{title}</Label></Row>
      <Card style={{ gap: S.md }}>{children}</Card>
    </Animated.View>
  );
}

function Toggle({ label, hint, value, onChange, icon }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  return (
    <Row gap={S.md}>
      {icon && <Ionicons name={icon} size={20} color={value ? WA_GREEN : C.dim} />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{label}</Text>
        {hint && <Text style={{ color: C.sub, fontSize: 12, marginTop: 1 }}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={v => { Haptics.selectionAsync(); onChange(v); }} trackColor={{ true: WA_GREEN, false: C.line }} thumbColor="#FFFFFF" />
    </Row>
  );
}

/** 24 h strip with the quiet part shaded and a marker for now. */
function QuietStrip({ s }: { s: WaAlertSettings }) {
  const pct = (m: number) => `${(m / 1440) * 100}%` as const;
  const { from, to } = s.quiet;
  const parts = from < to ? [[from, to]] : [[from, 1440], [0, to]];
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 26, borderRadius: 8, backgroundColor: '#FFF6DF', overflow: 'hidden' }}>
        {parts.map(([a, b]) => (
          <LinearGradient key={a} colors={['#312E81', '#4C1D95']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', top: 0, bottom: 0, left: pct(a), width: pct(b - a), opacity: s.quiet.on ? 0.9 : 0.25 }} />
        ))}
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: pct(now), width: 2, backgroundColor: C.red }} />
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        {['00', '06', '12', '18', '24'].map(h => <Text key={h} style={{ color: C.dim, fontSize: 10, fontWeight: '700' }}>{h}</Text>)}
      </Row>
    </View>
  );
}

function TimeStepper({ label, value, onChange }: { label: string; value: number; onChange: (m: number) => void }) {
  const step = (d: number) => { Haptics.selectionAsync(); onChange((value + d + 1440) % 1440); };
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4, backgroundColor: C.cardHi, borderRadius: R.md, paddingVertical: S.sm }}>
      <Text style={{ color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>{label}</Text>
      <Row gap={S.md}>
        <Pressable hitSlop={8} onPress={() => step(-30)}><Ionicons name="remove-circle" size={26} color={C.sub} /></Pressable>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'center' }}>{hhmm(value)}</Text>
        <Pressable hitSlop={8} onPress={() => step(30)}><Ionicons name="add-circle" size={26} color={C.sub} /></Pressable>
      </Row>
    </View>
  );
}

function summary(s: WaAlertSettings) {
  if (!s.enabled) return 'Alerts are off — the Chats tab still counts unread.';
  const tone = TONES.find(t => t.id === s.tone)?.label ?? '';
  const desks = s.desks.length === DESKS.length ? 'every desk' : s.desks.map(d => DESKS.find(x => x.key === d)?.label).join(', ') || 'no desks';
  return `${STYLES.find(x => x.key === s.style)?.label} · ${tone}${s.vibrate ? ' + buzz' : ''} · ${desks}${s.quiet.on ? ` · quiet ${hhmm(s.quiet.from)}–${hhmm(s.quiet.to)}` : ''}`;
}

export default function WaAlerts() {
  const s = useWaAlertSettings();
  const set = (p: Partial<WaAlertSettings>) => setWaAlertSettings(p);
  const muted = mutedChats();
  const quietNow = inQuietHours(s);
  const tonesOk = customTonesAvailable();

  const pickStyle = async (k: AlertStyle) => {
    Haptics.selectionAsync();
    set({ style: k });
    if (k === 'system') {
      const p = await Notifications.getPermissionsAsync().catch(() => null);
      if (p && p.status !== 'granted') await Notifications.requestPermissionsAsync().catch(() => {});
    }
  };
  const pickTone = (id: ToneId) => {
    Haptics.selectionAsync();
    set({ tone: id });
    playTone(id);
  };
  const toggleDesk = (d: Desk) => {
    Haptics.selectionAsync();
    set({ desks: s.desks.includes(d) ? s.desks.filter(x => x !== d) : [...s.desks, d] });
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <Text style={{ color: C.text, fontWeight: '900', fontSize: 17 }}>WhatsApp alerts</Text>
        <View style={{ width: 46 }} />
      </Row>

      {/* hero */}
      <Animated.View entering={FadeInDown.duration(320)}>
        <LinearGradient colors={s.enabled ? WA_DEEP : ['#475569', '#64748B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: R.lg, padding: S.lg, gap: S.md }}>
          <Row gap={S.md}>
            <RingingBell on={s.enabled && !quietNow} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}>{!s.enabled ? 'Alerts off' : quietNow ? 'Quiet hours now' : 'Listening for guests'}</Text>
              <Text style={{ color: '#FFFFFFCC', fontSize: 12, marginTop: 2 }}>{summary(s)}</Text>
            </View>
            <Switch value={s.enabled} onValueChange={v => { Haptics.selectionAsync(); set({ enabled: v }); }} trackColor={{ true: '#25D366', false: '#FFFFFF55' }} thumbColor="#FFFFFF" />
          </Row>
          {s.enabled && (
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); testAlert(); }}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: R.md, paddingVertical: 11, opacity: pressed ? 0.85 : 1 })}>
              <Ionicons name="paper-plane" size={16} color="#075E54" />
              <Text style={{ color: '#075E54', fontWeight: '900' }}>Send me a test alert</Text>
            </Pressable>
          )}
        </LinearGradient>
      </Animated.View>

      {s.enabled && (
        <>
          <Section title="How to alert me" icon="sparkles" delay={60}>
            {STYLES.map(st => {
              const on = s.style === st.key;
              return (
                <Pressable key={st.key} onPress={() => pickStyle(st.key)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.md, borderWidth: 2, borderColor: on ? WA_GREEN : C.line, backgroundColor: on ? '#E7F8F3' : pressed ? C.cardHi : C.card })}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: on ? WA_GREEN : C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={st.icon} size={20} color={on ? '#FFFFFF' : C.sub} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>{st.label}</Text>
                    <Text style={{ color: C.sub, fontSize: 12 }}>{st.hint}</Text>
                  </View>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? WA_GREEN : C.dim} />
                </Pressable>
              );
            })}
          </Section>

          {s.style !== 'silent' && (
            <Section title="Sound" icon="musical-notes" delay={120}>
              {!tonesOk && (
                <Row gap={S.sm} style={{ backgroundColor: C.goldSoft, borderRadius: R.sm, padding: S.sm }}>
                  <Ionicons name="information-circle" size={18} color={C.gold} />
                  <Text style={{ color: C.text, fontSize: 12, flex: 1 }}>This build of the app can’t play the custom tones yet — your phone’s own sound rings instead. They arrive with the next app update.</Text>
                </Row>
              )}
              {TONES.map(t => {
                const on = s.tone === t.id;
                return (
                  <Pressable key={t.id} onPress={() => pickTone(t.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, opacity: pressed ? 0.6 : 1 })}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: on ? WA_GREEN : C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={t.id === 'none' ? 'volume-mute' : t.id === 'system' ? 'phone-portrait-outline' : on ? 'musical-note' : 'play'} size={16} color={on ? '#FFFFFF' : C.sub} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.text, fontWeight: on ? '800' : '600', fontSize: 15 }}>{t.label}</Text>
                      <Text style={{ color: C.dim, fontSize: 12 }}>{t.hint}</Text>
                    </View>
                    {on && <Ionicons name="checkmark" size={20} color={WA_GREEN} />}
                  </Pressable>
                );
              })}
              <View style={{ height: 1, backgroundColor: C.line }} />
              <Toggle icon="pulse" label="Vibrate" hint="A short buzz with every alert" value={s.vibrate} onChange={v => set({ vibrate: v })} />
            </Section>
          )}

          <Section title="Which chats" icon="funnel" delay={180}>
            <Text style={{ color: C.sub, fontSize: 13 }}>Only alert me for guests on these desks. Muted desks still count in the Chats badge.</Text>
            <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
              {DESKS.map(d => {
                const on = s.desks.includes(d.key);
                return (
                  <Pressable key={d.key} onPress={() => toggleDesk(d.key)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : C.card }}>
                    <Text style={{ fontSize: 15 }}>{d.flag}</Text>
                    <Text style={{ color: on ? '#FFFFFF' : C.sub, fontWeight: '700', fontSize: 13 }}>{d.label}</Text>
                    <Ionicons name={on ? 'checkmark' : 'add'} size={14} color={on ? '#FFFFFF' : C.dim} />
                  </Pressable>
                );
              })}
            </Row>
            <Toggle icon="eye" label="Show message text" hint="Off: alerts say only who wrote and the file number" value={s.preview} onChange={v => set({ preview: v })} />
          </Section>

          <Section title="Quiet hours" icon="moon" delay={240}>
            <Toggle icon="moon" label="Quiet hours" hint="No sound or buzz — banners and badges still show" value={s.quiet.on} onChange={v => set({ quiet: { ...s.quiet, on: v } })} />
            <QuietStrip s={s} />
            {s.quiet.on && (
              <Row gap={S.sm}>
                <TimeStepper label="FROM" value={s.quiet.from} onChange={m => set({ quiet: { ...s.quiet, from: m } })} />
                <Ionicons name="arrow-forward" size={18} color={C.dim} />
                <TimeStepper label="TO" value={s.quiet.to} onChange={m => set({ quiet: { ...s.quiet, to: m } })} />
              </Row>
            )}
          </Section>

          <Section title="Guest waiting" icon="hourglass" delay={300}>
            <Text style={{ color: C.sub, fontSize: 13 }}>Nudge me once with a different tone when a guest’s last message has had no reply for…</Text>
            <View style={{ flexDirection: 'row', backgroundColor: C.cardHi, borderRadius: R.md, padding: 4 }}>
              {NUDGES.map(n => {
                const on = s.nudgeMin === n;
                return (
                  <Pressable key={n} onPress={() => { Haptics.selectionAsync(); set({ nudgeMin: n }); if (n) playTone('urgent'); }}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: R.sm, backgroundColor: on ? (n ? C.amber : C.card) : 'transparent' }}>
                    <Text style={{ color: on ? (n ? '#FFFFFF' : C.text) : C.sub, fontWeight: '800', fontSize: 13 }}>{n ? `${n} min` : 'Off'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        </>
      )}

      <Section title="Badges" icon="ellipse" delay={360}>
        <Toggle icon="apps" label="Count on the app icon" hint="Unread WhatsApp chats on your home screen" value={s.appBadge} onChange={v => set({ appBadge: v })} />
      </Section>

      {muted.length > 0 && (
        <Section title={`Muted chats (${muted.length})`} icon="notifications-off" delay={420}>
          {muted.map(m => (
            <Row key={m.phone} gap={S.md}>
              <Ionicons name="notifications-off" size={18} color={C.dim} />
              <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: m.phone } })}>
                <Text style={{ color: C.text, fontWeight: '700' }}>+{m.phone}</Text>
                <Text style={{ color: C.dim, fontSize: 12 }}>Muted {fmtMuted(m.until)}</Text>
              </Pressable>
              <Pressable onPress={() => { Haptics.selectionAsync(); muteChat(m.phone, null); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: '#E7F8F3' }}>
                <Text style={{ color: WA_GREEN, fontWeight: '800', fontSize: 12 }}>Unmute</Text>
              </Pressable>
            </Row>
          ))}
        </Section>
      )}

      <Row gap={S.sm} style={{ paddingHorizontal: S.sm }}>
        <Ionicons name="lock-closed" size={13} color={C.dim} />
        <Text style={{ color: C.dim, fontSize: 12, flex: 1 }}>Saved on this phone only. Alerts come while the app is open; the desk and the web inbox are not affected.</Text>
      </Row>
    </Screen>
  );
}
