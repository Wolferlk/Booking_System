/**
 * Today's route, live, with the car on it (turned to the way it is driving).
 * iPhone: Apple Maps. Android: Google Maps when the build carries a Maps key
 * (GOOGLE_MAPS_ANDROID_API_KEY, see app.config.js) — without one a native map
 * would be blank, so it draws the route as an animated sketch instead.
 *
 *   card mode   small, not draggable, "tap to expand"
 *   full mode   draggable; camera follows the car or shows the whole route
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Image as SvgImage, Path } from 'react-native-svg';
import type { PathPoint } from '@/lib/location';
import { C } from '@/lib/theme';

const CAR = require('../../assets/images/illustrations/car-top.png');

const androidKey = (Constants.expoConfig?.android as { config?: { googleMaps?: { apiKey?: string } } } | undefined)?.config?.googleMaps?.apiKey;
export const nativeMapAvailable = Platform.OS === 'ios' || !!androidKey;

const SRI_LANKA = { latitude: 7.87, longitude: 80.77, latitudeDelta: 3.5, longitudeDelta: 3.5 };

/** Compass bearing (0 = north) from a to b. */
function bearing(a: PathPoint, b: PathPoint): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Heading of the car: from the last point that is a few metres behind the newest one. */
export function headingOf(path: PathPoint[]): number {
  const last = path[path.length - 1];
  for (let i = path.length - 2; i >= 0; i--) {
    const p = path[i];
    const d = Math.hypot((last.lat - p.lat) * 111_320, (last.lng - p.lng) * 111_320 * Math.cos(last.lat * Math.PI / 180));
    if (d > 8) return bearing(p, last);
  }
  return 0;
}

/** Expanding ring — "we are listening for GPS". */
function Radar({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false); }, [p]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + p.value * 1.6 }], opacity: 1 - p.value }));
  return <Animated.View style={[styles.radar, { borderColor: color }, st]} />;
}

function Waiting() {
  return (
    <View style={styles.waiting} pointerEvents="none">
      <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center' }}>
        <Radar color="#60A5FA" />
        <Ionicons name="navigate" size={26} color="#93C5FD" />
      </View>
      <Text style={styles.waitText}>Waiting for the first GPS points…</Text>
    </View>
  );
}

function Sketch({ path, style }: { path: PathPoint[]; style: ViewStyle }) {
  const W = 320, H = 200, M = 26;
  const d = useMemo(() => {
    if (path.length < 2) return null;
    const lats = path.map(p => p.lat), lngs = path.map(p => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const span = Math.max(maxLat - minLat, maxLng - minLng, 0.002);
    const s = Math.min((W - 2 * M) / span, (H - 2 * M) / span);
    const ox = (W - (maxLng - minLng) * s) / 2, oy = (H - (maxLat - minLat) * s) / 2;
    const pts = path.map(p => [ox + (p.lng - minLng) * s, H - (oy + (p.lat - minLat) * s)]);
    return { line: pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '), a: pts[0], b: pts[pts.length - 1], heading: headingOf(path) };
  }, [path]);

  return (
    <View style={[styles.dark, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 9 }, (_, i) => <Path key={`v${i}`} d={`M${(i + 1) * 32},0 V${H}`} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
        {Array.from({ length: 6 }, (_, i) => <Path key={`h${i}`} d={`M0,${(i + 1) * 30} H${W}`} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
        {d && (
          <>
            <Path d={d.line} stroke="rgba(255,38,56,0.25)" strokeWidth={10} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={d.line} stroke={C.red} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={d.a[0]} cy={d.a[1]} r={6} fill="#22C55E" stroke="#fff" strokeWidth={2} />
            <Circle cx={d.b[0]} cy={d.b[1]} r={16} fill="rgba(255,38,56,0.22)" />
            <G transform={`translate(${d.b[0]} ${d.b[1]}) rotate(${d.heading})`}>
              <SvgImage href={CAR} x={-14} y={-14} width={28} height={28} />
            </G>
          </>
        )}
      </Svg>
      {!d && <Waiting />}
    </View>
  );
}

export function RouteMap({ path, height = 190, full, follow = true, onExpand, bottomInset = 0 }: {
  path: PathPoint[]
  height?: number
  /** full-screen mode: draggable, follows the car */
  full?: boolean
  follow?: boolean
  onExpand?: () => void
  /** space covered by a panel at the bottom (full mode), so the car stays visible */
  bottomInset?: number
}) {
  const map = useRef<MapView>(null);
  const coords = useMemo(() => path.map(p => ({ latitude: p.lat, longitude: p.lng })), [path]);
  const last = coords[coords.length - 1];
  const heading = path.length > 1 ? headingOf(path) : 0;
  const style: ViewStyle = full ? { flex: 1 } : { height, borderRadius: 20 };

  useEffect(() => {
    if (!map.current || !coords.length) return;
    if (full && follow) {
      map.current.animateCamera({ center: coords[coords.length - 1], zoom: 16, heading: 0, pitch: 0 }, { duration: 700 });
    } else if (coords.length === 1) {
      map.current.animateCamera({ center: coords[0], zoom: 15 }, { duration: 600 });
    } else {
      const pad = full ? 70 : 34;
      map.current.fitToCoordinates(coords, { edgePadding: { top: pad, right: pad, bottom: pad + bottomInset, left: pad }, animated: true });
    }
  }, [coords, full, follow, bottomInset]);

  const expandBtn = onExpand && (
    <Pressable onPress={onExpand} hitSlop={8} style={({ pressed }) => [styles.expand, pressed && { transform: [{ scale: 0.92 }] }]}>
      <Ionicons name="expand" size={16} color="#0E1525" />
      <Text style={styles.expandText}>Full map</Text>
    </Pressable>
  );

  if (!nativeMapAvailable) {
    return (
      <Pressable onPress={onExpand} disabled={!onExpand} style={[{ overflow: 'hidden' }, style]}>
        <Sketch path={path} style={StyleSheet.absoluteFill as ViewStyle} />
        {expandBtn}
      </Pressable>
    );
  }

  return (
    <View style={[styles.mapWrap, style]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={last ? { ...last, latitudeDelta: 0.02, longitudeDelta: 0.02 } : SRI_LANKA}
        showsUserLocation={!last}
        showsMyLocationButton={false}
        showsCompass={!!full}
        showsTraffic={!!full}
        toolbarEnabled={false}
        scrollEnabled={!!full}
        zoomEnabled={!!full}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={!full ? onExpand : undefined}
        mapPadding={full ? { top: 0, right: 0, bottom: bottomInset, left: 0 } : undefined}
      >
        {coords.length > 1 && <Polyline coordinates={coords} strokeColor="rgba(255,38,56,0.25)" strokeWidth={12} lineCap="round" lineJoin="round" />}
        {coords.length > 1 && <Polyline coordinates={coords} strokeColor={C.red} strokeWidth={5} lineCap="round" lineJoin="round" />}
        {coords.length > 1 && (
          <Marker coordinate={coords[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.startDot} />
          </Marker>
        )}
        {last && (
          <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges>
            <View style={styles.carHalo}>
              <Image source={CAR} alt="" style={{ width: 40, height: 40, transform: [{ rotate: `${heading}deg` }] }} contentFit="contain" />
            </View>
          </Marker>
        )}
      </MapView>
      {!coords.length && (
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>Waiting for the first GPS points…</Text>
        </View>
      )}
      {expandBtn}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { overflow: 'hidden', backgroundColor: '#0B1739' },
  dark: { backgroundColor: '#0B1739' },
  waiting: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitText: { color: '#93C5FD', fontWeight: '700' },
  radar: { position: 'absolute', width: 70, height: 70, borderRadius: 35, borderWidth: 2 },
  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 3, borderColor: '#fff' },
  carHalo: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,38,56,0.18)', borderWidth: 2, borderColor: 'rgba(255,38,56,0.45)', alignItems: 'center', justifyContent: 'center' },
  mapHint: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 8, borderRadius: 12, backgroundColor: 'rgba(11,23,57,0.8)', alignItems: 'center' },
  mapHintText: { color: '#fff', fontWeight: '700' },
  expand: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  expandText: { color: '#0E1525', fontWeight: '800', fontSize: 12 },
});
