/**
 * Slide-to-confirm. A trip start / day end is never a mis-tap in a pocket: the
 * driver drags the knob all the way across. Haptic tick at the end, then the
 * knob springs back (or stays while `loading`).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { C } from '@/lib/theme';
import type { IconName } from './ui';

const KNOB = 64;
const PAD = 6;

export function SwipeButton({ label, onComplete, colors = [C.red, '#9F1239'], icon = 'arrow-forward', loading, disabled }: {
  label: string
  onComplete: () => void
  colors?: [string, string]
  icon?: IconName
  loading?: boolean
  disabled?: boolean
}) {
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const max = Math.max(0, width - KNOB - PAD * 2);
  const maxRef = useRef(max);
  maxRef.current = max;
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;
  const blocked = useRef(false);
  blocked.current = !!loading || !!disabled;

  useEffect(() => {
    if (!loading) Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  }, [loading, x]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !blocked.current,
    onMoveShouldSetPanResponder: (_e, g) => !blocked.current && Math.abs(g.dx) > 4,
    onPanResponderGrant: () => Haptics.selectionAsync(),
    onPanResponderMove: (_e, g) => x.setValue(Math.min(Math.max(0, g.dx), maxRef.current)),
    onPanResponderRelease: (_e, g) => {
      if (g.dx >= maxRef.current * 0.88) {
        Animated.timing(x, { toValue: maxRef.current, duration: 120, useNativeDriver: false }).start();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        doneRef.current();
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 8 }).start();
      }
    },
  })).current;

  const textOpacity = x.interpolate({ inputRange: [0, Math.max(1, max * 0.6)], outputRange: [1, 0], extrapolate: 'clamp' });
  const fill = x.interpolate({ inputRange: [0, Math.max(1, max)], outputRange: [KNOB + PAD * 2, Math.max(KNOB + PAD * 2, width)], extrapolate: 'clamp' });

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={[styles.track, disabled && { opacity: 0.4 }]}>
      <Animated.View style={[styles.fill, { width: fill }]}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.Text style={[styles.label, { opacity: textOpacity }]} numberOfLines={1}>{label}  ›››</Animated.Text>
      <Animated.View {...pan.panHandlers} style={[styles.knob, { transform: [{ translateX: x }] }]}>
        {loading ? <ActivityIndicator color={colors[0]} /> : <Ionicons name={icon} size={30} color={colors[0]} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: KNOB + PAD * 2, borderRadius: 99, backgroundColor: C.cardHi, borderWidth: 1, borderColor: C.line, justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, overflow: 'hidden' },
  label: { position: 'absolute', left: KNOB + 24, right: 16, color: C.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  knob: { position: 'absolute', left: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
