/**
 * A free map for Android — no Google Maps key, no account, no billing.
 *
 * react-native-maps always draws with Google's SDK on Android, which needs a paid
 * key. Instead, this shows MapLibre GL JS inside a WebView with the free
 * OpenFreeMap tiles (OpenStreetMap data; commercial use allowed, no key, no
 * request limits — https://openfreemap.org). MapLibre adds the required
 * "© OpenMapTiles © OpenStreetMap" credit itself.
 *
 * iPhone keeps the native Apple Maps (also free). Everything the map shows comes
 * in through `state`; the page answers with `ready`, `pin` (a pin was tapped) and
 * `error` (e.g. no internet — the caller then shows its own fallback).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface LatLng { lat: number; lng: number }
export interface MapPin extends LatLng { id: string; color: string; label?: string }

export interface OpenMapState {
  /** the route line */
  line?: LatLng[]
  /** green dot where the route began */
  start?: LatLng | null
  /** the car, turned to `heading` (degrees, 0 = north) */
  car?: (LatLng & { heading: number }) | null
  pins?: MapPin[]
  /** 'follow' = centre on the car; 'fit' = show the whole line / every pin */
  camera?: 'follow' | 'fit'
  /** space covered at the bottom by a panel, so the car stays visible */
  bottomInset?: number
}

const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.1/dist';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
/** No "ready" in this long (no internet, CDN down): tell the caller to fall back. */
const LOAD_TIMEOUT_MS = 15_000;

function html(interactive: boolean, center: LatLng, zoom: number) {
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<style>
  html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#0B1739}
  .car{width:46px;height:46px;border-radius:50%;background:rgba(255,38,56,.18);border:2px solid rgba(255,38,56,.45);display:flex;align-items:center;justify-content:center}
  .start{width:12px;height:12px;border-radius:50%;background:#22C55E;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}
  .pin{width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)}
  .maplibregl-popup-content{font:600 12px/1.35 -apple-system,Roboto,sans-serif;padding:6px 9px;border-radius:10px}
</style></head><body><div id="map"></div>
<script>
  function send(m){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
  window.onerror = function(msg){ send({type:'error', message:String(msg)}); };
</script>
<script src="${MAPLIBRE}/maplibre-gl.js" onerror="send({type:'error',message:'map library did not load'})"></script>
<script>
(function(){
  if (!window.maplibregl) return;
  var map = new maplibregl.Map({
    container:'map', style:'${STYLE}', center:[${center.lng},${center.lat}], zoom:${zoom},
    interactive:${interactive}, attributionControl:{compact:true}, dragRotate:false, pitchWithRotate:false
  });
  map.touchZoomRotate && map.touchZoomRotate.disableRotation && map.touchZoomRotate.disableRotation();
  var ready = false, pending = null, car = null, start = null, pins = {};
  var CAR_SVG = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 2 4.5 20.5 12 16.6l7.5 3.9z" fill="#FF2638" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  function el(cls, color){ var d=document.createElement('div'); d.className=cls; if(color) d.style.background=color; return d; }
  function bounds(points){ var b=new maplibregl.LngLatBounds(); points.forEach(function(p){ b.extend([p.lng,p.lat]); }); return b; }

  function apply(s){
    var line = s.line || [];
    var src = map.getSource('route');
    var data = {type:'Feature', geometry:{type:'LineString', coordinates: line.map(function(p){ return [p.lng,p.lat]; })}};
    if (src) src.setData(data);

    if (s.start) { if(!start) start=new maplibregl.Marker({element:el('start')}).setLngLat([s.start.lng,s.start.lat]).addTo(map); else start.setLngLat([s.start.lng,s.start.lat]); }
    else if (start) { start.remove(); start=null; }

    if (s.car) {
      if (!car) { var c=el('car'); c.innerHTML=CAR_SVG; car=new maplibregl.Marker({element:c, rotationAlignment:'map'}).setLngLat([s.car.lng,s.car.lat]).addTo(map); }
      car.setLngLat([s.car.lng,s.car.lat]); car.setRotation(s.car.heading||0);
    } else if (car) { car.remove(); car=null; }

    var seen = {};
    (s.pins||[]).forEach(function(p){
      seen[p.id]=1;
      var m = pins[p.id];
      if (!m) {
        var d = el('pin', p.color);
        d.addEventListener('click', function(ev){ ev.stopPropagation(); send({type:'pin', id:p.id}); });
        m = new maplibregl.Marker({element:d}).setLngLat([p.lng,p.lat]).addTo(map);
        pins[p.id]=m;
      }
      m.setLngLat([p.lng,p.lat]); m.getElement().style.background=p.color;
      if (p.label) m.setPopup(new maplibregl.Popup({offset:14, closeButton:false}).setText(p.label));
    });
    Object.keys(pins).forEach(function(id){ if(!seen[id]){ pins[id].remove(); delete pins[id]; } });

    var pad = {top:50,right:50,left:50,bottom:76+(s.bottomInset||0)};
    if (s.camera==='follow' && s.car) {
      map.easeTo({center:[s.car.lng,s.car.lat], zoom:Math.max(map.getZoom(),15.5), padding:{top:0,right:0,left:0,bottom:s.bottomInset||0}, duration:700});
    } else {
      var pts = line.length>1 ? line : (s.pins||[]).length ? s.pins : (s.car ? [s.car] : []);
      if (pts.length===1) map.easeTo({center:[pts[0].lng,pts[0].lat], zoom:15, duration:600});
      else if (pts.length>1) map.fitBounds(bounds(pts), {padding:pad, maxZoom:16, duration:600});
    }
  }

  window.__setState = function(s){ if(!ready){ pending=s; return; } apply(s); };

  map.on('load', function(){
    map.addSource('route', {type:'geojson', data:{type:'Feature', geometry:{type:'LineString', coordinates:[]}}});
    map.addLayer({id:'route-halo', type:'line', source:'route', layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':'rgba(255,38,56,0.25)','line-width':12}});
    map.addLayer({id:'route', type:'line', source:'route', layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':'#FF2638','line-width':5}});
    ready = true;
    send({type:'ready'});
    if (pending) { apply(pending); pending=null; }
  });
  map.on('error', function(e){ if(!ready) send({type:'error', message:(e && e.error && e.error.message) || 'map error'}); });
})();
</script></body></html>`;
}

export function OpenMap({ state, style, interactive = true, onPress, onPinPress, onFail, initial }: {
  state: OpenMapState
  style?: StyleProp<ViewStyle>
  /** false = a still picture (card): no pan / zoom; `onPress` taps the whole map */
  interactive?: boolean
  onPress?: () => void
  onPinPress?: (id: string) => void
  /** the map could not load (offline, blocked) — show something else */
  onFail?: () => void
  initial?: LatLng & { zoom?: number }
}) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const failed = useRef(false);
  const first = useRef(initial ?? state.car ?? state.line?.[state.line.length - 1] ?? state.pins?.[0] ?? { lat: 7.87, lng: 80.77 });
  // The page is built once; later changes go in through __setState, so the map never reloads.
  const source = useMemo(() => ({
    html: html(interactive, first.current, initial?.zoom ?? (state.car || state.line?.length ? 14 : 7)),
    baseUrl: 'https://tiles.openfreemap.org/',
  }), [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = () => { if (failed.current) return; failed.current = true; onFail?.(); };

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(fail, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const json = JSON.stringify(state);
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.__setState && window.__setState(${json}); true;`);
  }, [ready, json]);

  function onMessage(e: WebViewMessageEvent) {
    let m: { type?: string; id?: string } = {};
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'pin' && m.id) onPinPress?.(m.id);
    else if (m.type === 'error' && !ready) fail();
  }

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={ref}
        source={source}
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={fail}
        onHttpError={e => { if (e.nativeEvent.url.includes('maplibre-gl')) fail(); }}
        // The credit links (OpenStreetMap, OpenMapTiles) open in the browser, never inside the map.
        onShouldStartLoadWithRequest={r => {
          if (r.url.startsWith('about:') || r.url.startsWith('data:') || r.url === source.baseUrl) return true;
          if (r.isTopFrame === false) return true;
          Linking.openURL(r.url).catch(() => {});
          return false;
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        style={styles.web}
        containerStyle={styles.web}
      />
      {!interactive && onPress ? <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityRole="button" accessibilityLabel="Open the map" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#0B1739' },
  web: { flex: 1, backgroundColor: '#0B1739' },
});
