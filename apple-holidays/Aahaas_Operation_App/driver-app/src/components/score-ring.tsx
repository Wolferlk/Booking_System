import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from '@/lib/theme';

export function ScoreRing({ score, grade, size = 170 }: { score: number | null; grade: string | null; size?: number }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const color = (score ?? 0) >= 80 ? C.green : (score ?? 0) >= 60 ? C.gold : C.red;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.line} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round" />
      </Svg>
      <Text style={{ color: C.text, fontSize: 48, fontWeight: '900' }}>{score ?? '—'}</Text>
      {grade && <Text style={{ color, fontSize: 18, fontWeight: '800' }}>Grade {grade}</Text>}
    </View>
  );
}
