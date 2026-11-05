/**
 * Breaks inside a driving day: the "Pause trip" button, the reason sheet, and
 * the paused card that takes the live card's place until the driver resumes.
 * State and syncing live in lib/pause.ts.
 */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { OPS_PHONE } from '@/lib/config';
import { routeOf } from '@/lib/format';
import { getMotion, getPause, onMotion, onPauseChange, pauseNow, REASONS, reasonOf, suggestedReason, type ActivePause, type Motion, type PauseReason } from '@/lib/pause';
import { C, S } from '@/lib/theme';
import type { Movement } from '@/lib/types';
import { CountUp, PulseDot, type TripHeading } from './live-day';
import { Sheet } from './sheet';
import { Button, Ionicons, type IconName } from './ui';

export const BREAK: [string, string, string] = ['#2B1607', '#7C2D12', '#C2410C'];

/** 12:34, or 1:02:03 past an hour. */
export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** 1h 05m / 25m */
export function fmtMin(ms: number) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** The break running on this trip (or null), and how the car has moved since. */
export function useTripPause(ref: string) {
  const [pause, setPause] = useState<ActivePause | null>(() => (pauseNow()?.ref === ref ? pauseNow() : null));
  const [motion, setMotion] = useState<Motion | null>(null);
  useEffect(() => {
    let alive = true;
    getPause().then(p => {
      if (!alive) return;
      const mine = p?.ref === ref ? p : null;
      setPause(mine);
      if (mine) getMotion(mine.id).then(m => { if (alive) setMotion(m); });
    });
    const a = onPauseChange(p => { setPause(p?.ref === ref ? p : null); setMotion(null); });
    const b = onMotion(m => setMotion(m));
    return () => { alive = false; a(); b(); };
  }, [ref]);
  return { pause, motion: pause && motion?.id === pause.id ? motion : null };
}

/** The car is clearly driving although the trip is paused. */
export const isMoving = (m: Motion | null) => !!m && m.fast >= 2;

/**
 * Before resuming: if the car moved a real distance on the break, ask whether
 * the guest was in it — those km then belong to the trip. Resolves null on cancel.
 */
export function askResume(motion: Motion | null): Promise<{ countMoved: boolean } | null> {
  const km = (motion?.movedM ?? 0) / 1000;
  if (km < 1) return Promise.resolve({ countMoved: false });
  return new Promise(resolve => {
    Alert.alert(
      `You moved ${km.toFixed(1)} km on the break`,
      'Was the guest in the car? Then these kilometres are part of the trip and should count.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'No — don’t count', onPress: () => resolve({ countMoved: false }) },
        { text: 'Yes — count them', onPress: () => resolve({ countMoved: true }) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export function PauseButton({ onPress, label, compact }: { onPress: () => void; label: string; compact?: boolean }) {
  return (
    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      style={({ pressed }) => [compact ? styles.pauseCompact : styles.pauseBtn, pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 }]}>
      <View style={styles.pauseIcon}><Ionicons name="pause" size={compact ? 14 : 18} color="#fff" /></View>
      <View style={{ flex: compact ? 0 : 1 }}>
        <Text style={[styles.pauseTitle, compact && { fontSize: 14, color: '#fff' }]}>{label}</Text>
        {!compact && <Text style={styles.pauseSub} numberOfLines={1}>Meal, fuel, guest stop — km and time stop counting</Text>}
      </View>
      {!compact && <Ionicons name="chevron-forward" size={18} color={C.dim} />}
    </Pressable>
  );
}

const PLANS: [string, number | null][] = [['15m', 15], ['30m', 30], ['45m', 45], ['1h', 60], ['2h', 120], ['Not sure', null]];

/** Pick why and roughly how long. */
export function PauseSheet({ open, onClose, onConfirm, busy }: {
  open: boolean
  onClose: () => void
  onConfirm: (v: { reason: PauseReason; plannedMin: number | null; note: string | null }) => void
  busy?: boolean
}) {
  const [reason, setReason] = useState<PauseReason>(suggestedReason());
  const [plan, setPlan] = useState<number | null>(reasonOf(reason).minutes);
  const [note, setNote] = useState('');
  const suggested = suggestedReason();

  useEffect(() => {
    if (!open) return;
    const r = suggestedReason();
    setReason(r); setPlan(reasonOf(r).minutes); setNote('');
  }, [open]);

  function pick(r: PauseReason) {
    Haptics.selectionAsync().catch(() => {});
    setReason(r);
    setPlan(reasonOf(r).minutes);
  }

  const vehicle = reason === 'VEHICLE';
  const wantsNote = vehicle || reason === 'OTHER' || reason === 'PERSONAL';

  return (
    <Sheet open={open} onClose={onClose} title="Take a break">
      <Text style={{ color: C.sub, marginTop: -6 }}>Kilometres and driving time stop counting until you resume. GPS stays on so ops can still see the car.</Text>

      <View style={styles.grid}>
        {REASONS.map(r => {
          const on = r.id === reason;
          return (
            <Pressable key={r.id} onPress={() => pick(r.id)}
              style={({ pressed }) => [styles.tile, on && { borderColor: r.color, backgroundColor: `${r.color}14` }, pressed && { transform: [{ scale: 0.97 }] }]}>
              <View style={[styles.tileIcon, { backgroundColor: on ? r.color : `${r.color}22` }]}>
                <Ionicons name={r.icon as IconName} size={20} color={on ? '#fff' : r.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tileLabel} numberOfLines={1}>{r.label}</Text>
                <Text style={styles.tileHint} numberOfLines={1}>{r.id === suggested && !on ? 'Suggested now' : r.hint}</Text>
              </View>
              {on && <Ionicons name="checkmark-circle" size={20} color={r.color} />}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>ABOUT HOW LONG?</Text>
      <View style={styles.chips}>
        {PLANS.map(([label, v]) => {
          const on = plan === v;
          return (
            <Pressable key={label} onPress={() => { Haptics.selectionAsync().catch(() => {}); setPlan(v); }} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {plan != null && <Text style={{ color: C.sub, fontSize: 13 }}>We{'’'}ll remind you after {plan >= 60 ? `${plan / 60} h` : `${plan} min`}.</Text>}

      {wantsNote && (
        <TextInput value={note} onChangeText={setNote} maxLength={300} multiline
          placeholder={vehicle ? 'What happened? e.g. flat tyre near Dambulla' : 'A short note (optional)'}
          placeholderTextColor={C.dim} style={styles.note} />
      )}
      {vehicle && (
        <Animated.View entering={FadeIn} style={styles.alertBox}>
          <Ionicons name="alert-circle" size={20} color={C.red} />
          <Text style={{ color: C.text, flex: 1, fontSize: 13 }}>Ops get an alert straight away. If the guest is stuck, call them too.</Text>
          <Pressable onPress={() => Linking.openURL(`tel:${OPS_PHONE}`)} style={styles.callBtn}>
            <Ionicons name="call" size={14} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Call</Text>
          </Pressable>
        </Animated.View>
      )}

      <Button title={`Pause · ${reasonOf(reason).label}`} icon="pause" loading={busy}
        onPress={() => onConfirm({ reason, plannedMin: plan, note: note.trim() || null })} />
    </Sheet>
  );
}

/** Ring that fills toward the planned break length; turns red once it runs over. */
function BreakRing({ elapsedMs, plannedMin, color, children }: { elapsedMs: number; plannedMin: number | null; color: string; children: ReactNode }) {
  const size = 132, sw = 10, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  const spin = useSharedValue(0);
  useEffect(() => {
    if (plannedMin) return;
    spin.value = withRepeat(withTiming(360, { duration: 9000, easing: Easing.linear }), -1, false);
  }, [plannedMin, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const frac = plannedMin ? Math.min(1, elapsedMs / (plannedMin * 60_000)) : 0.22;
  const over = !!plannedMin && elapsedMs > plannedMin * 60_000;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, !plannedMin && spinStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.14)" strokeWidth={sw} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={over ? '#F87171' : color} strokeWidth={sw} fill="none" strokeLinecap="round"
            strokeDasharray={`${circ * frac} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </Svg>
      </Animated.View>
      {children}
    </View>
  );
}

/** Minutes until a HH:MM later today (negative = already past). */
function minutesUntil(hhmm: string | null) {
  if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
}

function Glass({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

/** Takes the live card's place while on a break. */
export function PausedCard({ pause, motion, dayNo, km, drivingMs, breaksToday, next, heading, onResume }: {
  pause: ActivePause
  motion: Motion | null
  dayNo?: number | null
  km: number
  /** driving time today, breaks left out, up to the start of this one */
  drivingMs: number
  /** breaks today including this one */
  breaksToday: number
  next: Movement | null
  heading?: TripHeading
  onResume: (by: 'DRIVER' | 'MOVING') => void
}) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const breathe = useSharedValue(1);
  useEffect(() => {
    breathe.value = withRepeat(withSequence(withTiming(1.08, { duration: 1600 }), withTiming(1, { duration: 1600 })), -1, false);
  }, [breathe]);
  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  const moving = isMoving(motion);
  useEffect(() => {
    if (moving) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [moving]);

  const meta = reasonOf(pause.reason);
  const elapsed = Date.now() - pause.startedAt;
  const overMin = pause.plannedMin ? Math.floor(elapsed / 60_000) - pause.plannedMin : null;
  const leaveIn = next ? minutesUntil(next.time) : null;

  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.wrap}>
      <LinearGradient colors={BREAK} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PulseDot color="#FBBF24" />
            <Text style={styles.tag}>PAUSED{dayNo ? ` · DAY ${dayNo}` : ''}</Text>
          </View>
          <View style={[styles.reasonChip, { backgroundColor: `${meta.color}33` }]}>
            <Ionicons name={meta.icon as IconName} size={13} color="#FED7AA" />
            <Text style={{ color: '#FED7AA', fontWeight: '800', fontSize: 12 }}>{meta.label}</Text>
          </View>
        </View>

        {heading && (
          <Pressable onPress={heading.onOpen} style={({ pressed }) => [styles.heading, pressed && { opacity: 0.8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guest} numberOfLines={1}>{heading.guest}</Text>
              <Text style={styles.sub} numberOfLines={1}>{heading.sub}</Text>
            </View>
            <View style={styles.openBtn}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Open trip</Text><Ionicons name="chevron-forward" size={14} color="#fff" /></View>
          </Pressable>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <BreakRing elapsedMs={elapsed} plannedMin={pause.plannedMin} color="#FDBA74">
            <Animated.View style={[styles.cup, breatheStyle]}>
              <Ionicons name={meta.icon as IconName} size={18} color="#C2410C" />
            </Animated.View>
            <Text style={styles.timer}>{fmtDur(elapsed)}</Text>
            <Text style={[styles.small, overMin != null && overMin > 0 && { color: '#FCA5A5' }]}>
              {overMin == null ? 'on break' : overMin > 0 ? `+${overMin} min over` : `of ${pause.plannedMin} min`}
            </Text>
          </BreakRing>
          <View style={{ flex: 1, gap: 8 }}>
            <Glass>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                <CountUp value={km} style={styles.stat} />
                <Text style={[styles.small, { marginBottom: 3 }]}>km</Text>
                <Ionicons name="lock-closed" size={11} color="#FDBA74" style={{ marginBottom: 5, marginLeft: 2 }} />
              </View>
              <Text style={styles.small}>today · on hold</Text>
            </Glass>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Glass style={{ flex: 1 }}>
                <Text style={styles.statSm}>{fmtMin(drivingMs)}</Text>
                <Text style={styles.small}>driving</Text>
              </Glass>
              <Glass style={{ flex: 1 }}>
                <Text style={styles.statSm}>#{breaksToday}</Text>
                <Text style={styles.small}>break</Text>
              </Glass>
            </View>
          </View>
        </View>

        {pause.note && <Text style={styles.noteText} numberOfLines={2}>“{pause.note}”</Text>}

        {moving && (
          <Animated.View entering={FadeInDown} style={styles.moving}>
            <Ionicons name="car-sport" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>You{'’'}re driving{motion?.kmh != null ? ` · ${motion.kmh} km/h` : ''}</Text>
              <Text style={{ color: '#FEE2E2', fontSize: 12 }}>The trip is paused — these km are not counting.</Text>
            </View>
            <Pressable onPress={() => onResume('MOVING')} style={({ pressed }) => [styles.resumeNow, pressed && { opacity: 0.8 }]}>
              <Text style={{ color: C.red, fontWeight: '900' }}>Resume</Text>
            </Pressable>
          </Animated.View>
        )}

        {next && (
          <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.flag}><Ionicons name="flag" size={16} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.small}>NEXT{next.time ? ` · ${next.time}` : ''}</Text>
              <Text style={{ color: '#fff', fontWeight: '700' }} numberOfLines={1}>{routeOf(next)}</Text>
            </View>
            {leaveIn != null && leaveIn > -180 && (
              <View style={[styles.leave, leaveIn <= 10 && { backgroundColor: leaveIn < 0 ? '#DC2626' : '#F59E0B' }]}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>
                  {leaveIn < 0 ? `${-leaveIn}m late` : leaveIn >= 60 ? `in ${Math.floor(leaveIn / 60)}h ${leaveIn % 60}m` : `in ${leaveIn}m`}
                </Text>
              </View>
            )}
          </Glass>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

/** One line under the "day done" card: how many breaks and how long. */
export function BreaksLine({ breaks }: { breaks: { reason: string; startedAt: string; endedAt: string | null }[] }) {
  if (!breaks.length) return null;
  const ms = breaks.reduce((s, b) => s + (b.endedAt ? new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime() : 0), 0);
  const kinds = Array.from(new Set(breaks.map(b => b.reason))).slice(0, 4);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {kinds.map(k => <Ionicons key={k} name={reasonOf(k).icon as IconName} size={14} color="#fff" />)}
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
        {breaks.length} break{breaks.length === 1 ? '' : 's'} · {fmtMin(ms)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#FED7AA' },
  pauseCompact: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingLeft: 4, paddingRight: 12, paddingVertical: 4 },
  pauseIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#EA580C', alignItems: 'center', justifyContent: 'center' },
  pauseTitle: { color: C.text, fontWeight: '900', fontSize: 16 },
  pauseSub: { color: C.sub, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 16, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.card },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: C.text, fontWeight: '800', fontSize: 14 },
  tileHint: { color: C.sub, fontSize: 11 },
  section: { color: C.sub, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginTop: S.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: C.cardHi },
  chipOn: { backgroundColor: '#EA580C' },
  chipText: { color: C.text, fontWeight: '800' },
  note: { minHeight: 60, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, color: C.text, fontSize: 15, textAlignVertical: 'top' },
  alertBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redSoft, borderRadius: 14, padding: 10 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.red, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },

  wrap: { borderRadius: 28, shadowColor: '#7C2D12', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  card: { borderRadius: 28, padding: 14, gap: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { color: '#fff', fontWeight: '900', letterSpacing: 1.2, fontSize: 13 },
  reasonChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  guest: { color: '#fff', fontSize: 20, fontWeight: '900' },
  sub: { color: '#FDBA74', fontSize: 12, fontWeight: '700' },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.red, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  cup: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  timer: { color: '#fff', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  small: { color: '#FDBA74', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  stat: { color: '#fff', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statSm: { color: '#fff', fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  glass: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  noteText: { color: '#FFEDD5', fontStyle: 'italic', paddingHorizontal: 4 },
  moving: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#DC2626', borderRadius: 16, padding: 12 },
  resumeNow: { backgroundColor: '#fff', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  flag: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  leave: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
});
