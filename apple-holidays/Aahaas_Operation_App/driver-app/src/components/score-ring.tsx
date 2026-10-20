import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { CountUp } from './live-day';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Score ring that draws itself in. `light` = on a dark background. */
export function ScoreRing({ score, grade, size = 170, light }: { score: number | null; grade: string | null; size?: number; light?: boolean }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const [c0, c1] = (score ?? 0) >= 80 ? ['#34D399', '#059669'] : (score ?? 0) >= 60 ? ['#FCD34D', '#F59E0B'] : ['#FF7A87', '#FF2638'];
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(200, withTiming(pct, { duration: 1300, easing: Easing.out(Easing.cubic) })); }, [pct, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c0} /><Stop offset="1" stopColor={c1} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={light ? 'rgba(255,255,255,0.14)' : '#E3E6EE'} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke="url(#ring)" strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ} ${circ}`} strokeLinecap="round" animatedProps={props} />
      </Svg>
      {score == null
        ? <Text style={{ color: light ? '#fff' : '#0E1525', fontSize: 48, fontWeight: '900' }}>—</Text>
        : <CountUp value={score} decimals={0} style={{ color: light ? '#fff' : '#0E1525', fontSize: 50, fontWeight: '900' }} />}
      {grade && <Text style={{ color: c1, fontSize: 16, fontWeight: '900', letterSpacing: 1 }}>GRADE {grade}</Text>}
    </View>
  );
}
