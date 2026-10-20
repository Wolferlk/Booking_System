/**
 * Slide-to-confirm. A trip start / day end is never a mis-tap in a pocket: the
 * driver slides the knob across.
 *
 * The whole bar is the touch target (not just the knob), the gesture runs on
 * the UI thread (Reanimated + Gesture Handler) so it tracks the finger with no
 * lag, and it claims the touch as soon as the finger moves sideways — a page
 * scroll only wins when the finger clearly moves up/down. Haptic ticks while
 * sliding, a success buzz at the end; a tap shows a little "slide me" nudge.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation, interpolate, type SharedValue, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { C } from '@/lib/theme';
import type { IconName } from './ui';

const KNOB = 64;
const PAD = 6;
const DONE_AT = 0.7;

function tick() { Haptics.selectionAsync().catch(() => {}); }
function success() { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }

export function SwipeButton({ label, onComplete, colors = [C.red, C.redDeep], icon = 'arrow-forward', loading, disabled }: {
  label: string
  onComplete: () => void
  colors?: [string, string]
  icon?: IconName
  loading?: boolean
  disabled?: boolean
}) {
  const [width, setWidth] = useState(0);
  const [done, setDone] = useState(false);
  const max = useSharedValue(0);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const step = useSharedValue(0);
  const pressed = useSharedValue(0);
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
  }, [shimmer]);

  // Back to the start when the work is over (or the button is reused).
  useEffect(() => {
    if (loading || !done) return;
    const t = setTimeout(() => {
      x.value = withSpring(0, { damping: 16, stiffness: 160 });
      setDone(false);
    }, 450);
    return () => clearTimeout(t);
  }, [loading, done, x]);

  function finish() {
    setDone(true);
    success();
    onComplete();
  }

  const blocked = !!loading || !!disabled || done;

  const pan = Gesture.Pan()
    .enabled(!blocked)
    .activeOffsetX([-8, 8])
    .failOffsetY([-22, 22])
    .hitSlop({ vertical: 12 })
    .onBegin(() => {
      pressed.value = withTiming(1, { duration: 120 });
      start.value = x.value;
      step.value = 0;
    })
    .onUpdate(e => {
      const m = max.value;
      x.value = Math.min(Math.max(0, start.value + e.translationX), m);
      const s = m > 0 ? Math.floor((x.value / m) * 4) : 0;
      if (s > step.value) { step.value = s; scheduleOnRN(tick); }
    })
    .onEnd(e => {
      const m = max.value;
      if (m > 0 && (x.value >= m * DONE_AT || (e.velocityX > 1100 && x.value > m * 0.35))) {
        x.value = withSpring(m, { damping: 18, stiffness: 220, overshootClamping: true });
        scheduleOnRN(finish);
      } else {
        x.value = withSpring(0, { damping: 14, stiffness: 180 });
      }
    })
    .onFinalize(() => { pressed.value = withTiming(0, { duration: 160 }); });

  // A tap means "I don't know I have to slide" — show it.
  const tap = Gesture.Tap()
    .enabled(!blocked)
    .onEnd(() => {
      x.value = withSequence(withTiming(46, { duration: 180 }), withSpring(0, { damping: 9, stiffness: 160 }));
      scheduleOnRN(tick);
    });

  const gesture = Gesture.Race(pan, tap);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { scale: 1 + pressed.value * 0.06 },
      { rotate: `${interpolate(x.value, [0, Math.max(1, max.value)], [0, 360], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + KNOB + PAD * 2 }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, Math.max(1, max.value * 0.55)], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(x.value, [0, Math.max(1, max.value)], [0, 40], Extrapolation.CLAMP) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.06 + pressed.value * 0.1 }));

  function onLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    max.value = Math.max(0, w - KNOB - PAD * 2);
  }

  return (
    <GestureDetector gesture={gesture}>
      <View onLayout={onLayout} style={[styles.track, disabled && { opacity: 0.4 }]} accessibilityRole="adjustable" accessibilityLabel={label}
        accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => !blocked && finish()}>
        <Animated.View style={[styles.glow, { backgroundColor: colors[0] }, glowStyle]} />
        <Animated.View style={[styles.fill, fillStyle]}>
          <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        {width > 0 && (
          <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
            <Text style={styles.label} numberOfLines={1}>{label}</Text>
            <View style={styles.chevrons}>
              {[0, 1, 2].map(i => <Chevron key={i} i={i} shimmer={shimmer} color={colors[0]} />)}
            </View>
          </Animated.View>
        )}
        <Animated.View style={[styles.knob, knobStyle]}>
          {loading ? <ActivityIndicator color={colors[0]} />
            : <Ionicons name={done ? 'checkmark' : icon} size={30} color={colors[0]} />}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** One of the three "›››" arrows; they light up in turn to say "slide this way". */
function Chevron({ i, shimmer, color }: { i: number; shimmer: SharedValue<number>; color: string }) {
  const st = useAnimatedStyle(() => {
    const p = (shimmer.value * 3 - i + 3) % 3;
    return { opacity: interpolate(p, [0, 0.5, 1, 3], [0.25, 1, 0.25, 0.25], Extrapolation.CLAMP) };
  });
  return <Animated.View style={st}><Ionicons name="chevron-forward" size={18} color={color} /></Animated.View>;
}

const styles = StyleSheet.create({
  track: {
    height: KNOB + PAD * 2, borderRadius: 99, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line,
    justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#0E1525', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  glow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 99 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, overflow: 'hidden' },
  labelWrap: { position: 'absolute', left: KNOB + 22, right: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { color: C.text, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  chevrons: { flexDirection: 'row', marginLeft: 2 },
  knob: {
    position: 'absolute', left: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
});
