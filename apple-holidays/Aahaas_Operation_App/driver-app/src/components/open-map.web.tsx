/** Web stand-in for the WebView map (open-map.tsx) — same exports, a plain box. */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export interface LatLng { lat: number; lng: number }
export interface MapPin extends LatLng { id: string; color: string; label?: string }
export interface OpenMapState {
  line?: LatLng[]
  start?: LatLng | null
  car?: (LatLng & { heading: number }) | null
  pins?: MapPin[]
  camera?: 'follow' | 'fit'
  bottomInset?: number
}

export function OpenMap({ style }: {
  state: OpenMapState; style?: StyleProp<ViewStyle>; interactive?: boolean
  onPress?: () => void; onPinPress?: (id: string) => void; onFail?: () => void; initial?: LatLng & { zoom?: number }
}) {
  return (
    <View style={[styles.box, style]}>
      <Text style={styles.text}>The map is available in the mobile app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#0B1739', alignItems: 'center', justifyContent: 'center', padding: 16 },
  text: { color: '#93C5FD', fontWeight: '700', textAlign: 'center' },
});
