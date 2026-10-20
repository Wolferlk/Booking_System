/**
 * Today's route, live. iPhone: Apple Maps. Android: Google Maps when the build
 * carries a Maps key (GOOGLE_MAPS_ANDROID_API_KEY, see app.config.js) — without
 * one a native map would be blank, so it draws the route as an animated sketch
 * instead.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { PathPoint } from '@/lib/location';
import { C } from '@/lib/theme';

const androidKey = (Constants.expoConfig?.android as { config?: { googleMaps?: { apiKey?: string } } } | undefined)?.config?.googleMaps?.apiKey;
export const nativeMapAvailable = Platform.OS === 'ios' || !!androidKey;

const SRI_LANKA = { latitude: 7.87, longitude: 80.77, latitudeDelta: 3.5, longitudeDelta: 3.5 };

/** Expanding ring — "we are listening for GPS". */
function Radar({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false); }, [p]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + p.value * 1.6 }], opacity: 1 - p.value }));
  return <Animated.View style={[styles.radar, { borderColor: color }, st]} />;
}

function Sketch({ path, height }: { path: PathPoint[]; height: number }) {
  const W = 320, H = height, M = 22;
  const d = useMemo(() => {
    if (path.length < 2) return null;
    const lats = path.map(p => p.lat), lngs = path.map(p => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const span = Math.max(maxLat - minLat, maxLng - minLng, 0.002);
    const sx = (W - 2 * M) / span, sy = (H - 2 * M) / span, s = Math.min(sx, sy);
    const ox = (W - (maxLng - minLng) * s) / 2, oy = (H - (maxLat - minLat) * s) / 2;
    const pts = path.map(p => [ox + (p.lng - minLng) * s, H - (oy + (p.lat - minLat) * s)]);
    return { line: pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '), a: pts[0], b: pts[pts.length - 1] };
  }, [path, H]);

  return (
    <View style={[styles.sketch, { height }]}>
      {/* map-ish grid */}
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 9 }, (_, i) => <Path key={`v${i}`} d={`M${(i + 1) * 32},0 V${H}`} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
        {Array.from({ length: 6 }, (_, i) => <Path key={`h${i}`} d={`M0,${(i + 1) * 30} H${W}`} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
        {d && (
          <>
            <Path d={d.line} stroke="rgba(255,38,56,0.25)" strokeWidth={10} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={d.line} stroke={C.red} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={d.a[0]} cy={d.a[1]} r={6} fill="#22C55E" stroke="#fff" strokeWidth={2} />
            <Circle cx={d.b[0]} cy={d.b[1]} r={7} fill={C.red} stroke="#fff" strokeWidth={2.5} />
          </>
        )}
      </Svg>
      {!d && (
        <View style={styles.waiting}>
          <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center' }}>
            <Radar color="#60A5FA" />
            <Ionicons name="navigate" size={26} color="#93C5FD" />
          </View>
          <Text style={styles.waitText}>Waiting for the first GPS points…</Text>
        </View>
      )}
    </View>
  );
}

export function RouteMap({ path, height = 190 }: { path: PathPoint[]; height?: number }) {
  const map = useRef<MapView>(null);
  const coords = useMemo(() => path.map(p => ({ latitude: p.lat, longitude: p.lng })), [path]);
  const last = coords[coords.length - 1];

  useEffect(() => {
    if (!map.current || !coords.length) return;
    if (coords.length === 1) {
      map.current.animateCamera({ center: coords[0], zoom: 15 }, { duration: 600 });
    } else {
      map.current.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    }
  }, [coords]);

  if (!nativeMapAvailable) return <Sketch path={path} height={height} />;

  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={last ? { ...last, latitudeDelta: 0.02, longitudeDelta: 0.02 } : SRI_LANKA}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {coords.length > 1 && <Polyline coordinates={coords} strokeColor={C.red} strokeWidth={5} lineCap="round" lineJoin="round" />}
        {coords.length > 0 && (
          <Marker coordinate={coords[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.startDot} />
          </Marker>
        )}
      </MapView>
      {!coords.length && (
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>Waiting for the first GPS points…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#0B1739' },
  sketch: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#0B1739' },
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitText: { color: '#93C5FD', fontWeight: '700' },
  radar: { position: 'absolute', width: 70, height: 70, borderRadius: 35, borderWidth: 2 },
  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 3, borderColor: '#fff' },
  mapHint: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 8, borderRadius: 12, backgroundColor: 'rgba(11,23,57,0.8)', alignItems: 'center' },
  mapHintText: { color: '#fff', fontWeight: '700' },
});
