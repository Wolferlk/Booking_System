/**
 * The in-app WhatsApp banner: drops in from the top over any screen, swipe it
 * up to dismiss, tap to open the chat. Several chats at once collapse into one
 * card with stacked avatars. Amber when a guest has been left waiting.
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Ionicons } from '@/components/ui';
import { C, R, S } from '@/lib/theme';
import { alertText, flagOf, muteChat, onWaBanner, type WaBannerEvent } from '@/lib/wa-alerts';

const WA_GREEN = '#00A884';
const AVATARS = ['#00A884', '#2563EB', '#7C3AED', '#E11D48', '#D97706', '#0891B2', '#DB2777', '#4F46E5'];
const color = (seed: string) => AVATARS[[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % AVATARS.length];
const initials = (name: string | null, phone: string) => {
  const n = (name ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
  return n ? n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : phone.slice(-2);
};
const SHOW_MS = 6000;

function Bell({ tone }: { tone: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withSequence(...[18, -16, 12, -8, 4, 0].map(d => withTiming(d, { duration: 90, easing: Easing.inOut(Easing.quad) })));
  }, [r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={st}><Ionicons name="notifications" size={13} color={tone} /></Animated.View>;
}

function Pulse({ tone }: { tone: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false); }, [p]);
  const st = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ scale: 1 + p.value * 0.5 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: tone }, st]} />;
}

export function WaBanner() {
  const insets = useSafeAreaInsets();
  const [e, setE] = useState<WaBannerEvent | null>(null);
  const y = useSharedValue(-220);
  const progress = useSharedValue(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setE(null), []);
  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    y.value = withTiming(-220, { duration: 220 }, done => { if (done) scheduleOnRN(clear); });
  }, [y, clear]);

  useEffect(() => onWaBanner(ev => {
    setE(ev);
    y.value = -220;
    y.value = withSpring(0, { damping: 17, stiffness: 190 });
    progress.value = 1;
    progress.value = withTiming(0, { duration: SHOW_MS, easing: Easing.linear });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, SHOW_MS);
  }), [y, progress, hide]);

  const pan = Gesture.Pan()
    .onUpdate(g => { y.value = g.translationY < 0 ? g.translationY : g.translationY * 0.15; })
    .onEnd(g => {
      if (g.translationY < -30 || g.velocityY < -500) { y.value = withTiming(-220, { duration: 180 }, done => { if (done) scheduleOnRN(clear); }); }
      else y.value = withSpring(0, { damping: 17, stiffness: 190 });
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: 1 + Math.min(0, y.value) / 220 }));
  const bar = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  if (!e) return null;

  const nudge = e.kind === 'nudge';
  const tone = nudge ? C.amber : WA_GREEN;
  const one = e.items.length === 1 ? e.items[0] : null;
  const { title, body } = alertText(e.kind, e.items);
  const tag = nudge ? 'Waiting for a reply' : e.kind === 'away' ? 'While you were away' : e.kind === 'test' ? 'Test alert' : 'WhatsApp';
  const ref = one?.conv.booking ? (one.conv.booking.isNumber || one.conv.booking.bookingRef) : null;

  const open = () => {
    Haptics.selectionAsync();
    hide();
    if (e.kind === 'test') return;
    if (one) router.push({ pathname: '/wa/[phone]', params: { phone: one.conv.phone, name: one.conv.displayName ?? '' } });
    else router.push({ pathname: '/chats', params: { tab: 'wa' } });
  };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingHorizontal: S.md }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{
          backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: `${tone}40`,
          shadowColor: '#0E1525', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 16,
        }, slide]}>
          <Pressable onPress={open} style={({ pressed }) => ({ padding: S.md, gap: 8, backgroundColor: pressed ? C.cardHi : C.card })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={nudge ? 'time' : 'logo-whatsapp'} size={13} color="#FFFFFF" />
              </View>
              <Text style={{ color: tone, fontSize: 12, fontWeight: '900', letterSpacing: 0.3, flex: 1 }}>{tag.toUpperCase()}</Text>
              {e.quiet ? <Ionicons name="moon" size={13} color={C.dim} /> : <Bell tone={C.dim} />}
              <Text style={{ color: C.dim, fontSize: 12 }}>now</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
              {one ? (
                <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
                  {nudge && <Pulse tone={tone} />}
                  <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color(one.conv.phone), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 16 }}>{initials(one.conv.displayName, one.conv.phone)}</Text>
                  </View>
                  <View style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }}>
                    <Text style={{ fontSize: 11 }}>{flagOf(one.conv)}</Text>
                  </View>
                </View>
              ) : (
                <View style={{ width: 46 + Math.min(e.items.length - 1, 2) * 14, height: 46 }}>
                  {e.items.slice(0, 3).map((it, i) => (
                    <View key={it.conv.phone} style={{ position: 'absolute', left: i * 14, width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: color(it.conv.phone), alignItems: 'center', justifyContent: 'center', zIndex: 3 - i }}>
                      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{initials(it.conv.displayName, it.conv.phone)}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: C.text, fontWeight: '900', fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
                  {one && one.count > 1 && (
                    <View style={{ backgroundColor: tone, borderRadius: 10, paddingHorizontal: 6, minWidth: 20, alignItems: 'center' }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{one.count}</Text>
                    </View>
                  )}
                </View>
                {ref ? <Text style={{ color: C.red, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{ref}</Text> : null}
                <Text style={{ color: C.sub, fontSize: 14 }} numberOfLines={2}>{body}</Text>
              </View>
            </View>

            {one && e.kind !== 'test' && (
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Action icon="arrow-undo" label="Reply" tone={tone} strong onPress={open} />
                <Action icon="notifications-off-outline" label="Mute 1 h" tone={C.sub} onPress={() => { muteChat(one.conv.phone, 60); Haptics.selectionAsync(); hide(); }} />
              </View>
            )}
          </Pressable>
          <View style={{ height: 3, backgroundColor: C.cardHi }}>
            <Animated.View style={[{ height: 3, backgroundColor: tone }, bar]} />
          </View>
        </Animated.View>
      </GestureDetector>
      <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#0E152522', marginTop: 5 }} pointerEvents="none" />
    </View>
  );
}

function Action({ icon, label, tone, strong, onPress }: { icon: 'arrow-undo' | 'notifications-off-outline'; label: string; tone: string; strong?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: R.sm, backgroundColor: strong ? `${tone}18` : C.cardHi, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={15} color={tone} />
      <Text style={{ color: strong ? tone : C.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
