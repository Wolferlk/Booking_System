/**
 * Command Center (/view2) — design tokens and motion.
 *
 * The palette follows the Aahaas TV boards (connect.aahaas.com/tv and the
 * Marketing Arena): a deep navy field, glass panels with a hairline and an
 * inner sheen, cyan/violet as the live accents and a strict good/warn/crit
 * trio for state. Everything is a CSS variable so panels never hard-code hex.
 */

export const CC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

.cc-root{
  --bg:#060a16; --bg2:#0a0f1e;
  --glass:rgba(14,22,46,.55); --glass2:rgba(24,36,70,.6);
  --line:rgba(120,160,255,.12); --line2:rgba(120,160,255,.24); --grid:rgba(140,170,255,.07);
  --sheen:inset 0 1px 0 rgba(255,255,255,.08); --drop:0 1.2rem 2.8rem rgba(0,0,0,.35);
  --head:#f2f6ff; --ink:#c9d4ea; --ink2:#8d9bbb; --ink3:#64708f;
  --cyan:#22d3ee; --cyanG:rgba(34,211,238,.45);
  --violet:#c084fc; --violetG:rgba(192,132,252,.4);
  --pink:#ff3d8b; --gold:#ffc857;
  --s1:#0aa3be; --s2:#a070ec; --s3:#c4820c;
  --good:#2ee59d; --goodS:rgba(46,229,157,.12);
  --warn:#ffb547; --warnS:rgba(255,181,71,.12);
  --crit:#ff4d6d; --critS:rgba(255,77,109,.14);
  --r:1.1rem; --rs:.7rem;
  font-family:'Manrope',ui-sans-serif,system-ui,sans-serif;
  color:var(--ink); background:var(--bg);
}
.cc-root *{box-sizing:border-box}
.cc-mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.cc-num{font-variant-numeric:tabular-nums;letter-spacing:-.02em}

.cc-panel{
  position:relative;border-radius:var(--r);border:1px solid var(--line);
  background:linear-gradient(160deg,var(--glass2),var(--glass));
  box-shadow:var(--sheen),var(--drop);backdrop-filter:blur(10px) saturate(140%);
  overflow:hidden;min-height:0;
}
.cc-panel::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(120% 60% at 0% 0%,rgba(34,211,238,.06),transparent 60%)}
.cc-edge::after{content:'';position:absolute;left:0;top:14%;bottom:14%;width:3px;border-radius:3px;background:var(--edge,var(--cyan));box-shadow:0 0 14px var(--edge,var(--cyan))}
.cc-title{display:flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:var(--ink2)}
.cc-title svg{color:var(--edge,var(--cyan))}
.cc-chip{display:inline-flex;align-items:center;gap:.35rem;border-radius:999px;border:1px solid var(--line2);padding:.18rem .6rem;font-size:.7rem;font-weight:700;color:var(--ink)}

@keyframes ccPulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes ccPing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.6);opacity:0}}
@keyframes ccUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes ccIn{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
@keyframes ccFade{from{opacity:0}to{opacity:1}}
@keyframes ccScale{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@keyframes ccSweep{0%{left:-40%}100%{left:140%}}
@keyframes ccMarquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes ccSpin{to{transform:rotate(360deg)}}
@keyframes ccFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes ccBar{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes ccBarX{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes ccDash{to{stroke-dashoffset:-40}}
@keyframes ccRun{0%{left:0;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:100%;opacity:0}}
@keyframes ccGlow{0%,100%{box-shadow:0 0 0 0 var(--cyanG)}50%{box-shadow:0 0 28px 4px var(--cyanG)}}
@keyframes ccProgress{from{width:0}to{width:100%}}
@keyframes ccShrink{from{width:100%}to{width:0}}
@keyframes ccConfetti{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}
@keyframes ccRing{0%,100%{opacity:.4;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}}
@keyframes ccSiren{0%,100%{box-shadow:0 0 30px 4px rgba(255,77,109,.35)}50%{box-shadow:0 0 90px 20px rgba(255,77,109,.8)}}
@keyframes ccKen{0%{transform:scale(1.06)}100%{transform:scale(1.18) translate(-2%,-1%)}}
@keyframes ccOrb{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.05) rotate(4deg)}}
@keyframes ccViewIn{from{opacity:0;transform:translateY(14px) scale(.985);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}

.cc-up{animation:ccUp .6s cubic-bezier(.2,.8,.2,1) both}
.cc-in{animation:ccIn .55s cubic-bezier(.2,.8,.2,1) both}
.cc-view{animation:ccViewIn .8s cubic-bezier(.2,.8,.2,1) both}
.cc-sweep{position:absolute;top:0;bottom:0;width:35%;pointer-events:none;animation:ccSweep 5.5s ease-in-out infinite;
  background:linear-gradient(90deg,transparent,rgba(34,211,238,.07),transparent)}
.cc-dot{width:.5rem;height:.5rem;border-radius:999px;display:inline-block;animation:ccPulse 1.4s ease-in-out infinite}

/* Leaflet on the TV: dark, no chrome. */
.cc-map .leaflet-container{background:#050914;font-family:inherit}
.cc-map .leaflet-control-attribution{background:rgba(6,10,22,.6)!important;color:#64708f!important;font-size:9px}
.cc-map .leaflet-control-attribution a{color:#8d9bbb!important}
.cc-map .leaflet-div-icon{background:transparent;border:0}
.cc-pin{position:relative;transform:translate(-50%,-50%)}
.cc-pin .core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:999px;border:2px solid rgba(255,255,255,.85)}
.cc-pin .ping{position:absolute;left:50%;top:50%;margin:-50% 0 0 -50%;width:100%;height:100%;border-radius:999px;animation:ccPing 2.2s ease-out infinite}
.cc-pin .lbl{position:absolute;left:50%;top:100%;transform:translate(-50%,4px);white-space:nowrap;font-size:10px;font-weight:800;color:#f2f6ff;
  text-shadow:0 1px 4px #000,0 0 8px #000;letter-spacing:.02em}
.cc-arc{stroke-dasharray:6 8;animation:ccDash 1.6s linear infinite}
`

export const COUNTRY: Record<string, { label: string; short: string; hex: string; image: string }> = {
  VIETNAM: { label: 'Vietnam', short: 'VN', hex: '#ff4d6d', image: 'https://images5.alphacoders.com/390/thumb-1920-390620.jpg' },
  SRILANKA: { label: 'Sri Lanka', short: 'LK', hex: '#ffb547', image: 'https://wallpapercat.com/w/full/7/d/5/639844-3000x1686-desktop-hd-sri-lanka-wallpaper.jpg' },
  SINGAPORE: { label: 'Singapore', short: 'SG', hex: '#ff3d8b', image: 'https://www.bookmytaxi.my/wp-content/uploads/2018/01/the-merlion-singapore-wallpaper.jpg' },
  MALAYSIA: { label: 'Malaysia', short: 'MY', hex: '#2ee59d', image: 'https://4kwallpapers.com/images/wallpapers/petronas-towers-kuala-lumpur-malaysia-cityscape-night-3840x2160-2109.jpg' },
  SINGAPORE_MALAYSIA: { label: 'SG & MY', short: 'SG·MY', hex: '#22d3ee', image: 'https://www.bookmytaxi.my/wp-content/uploads/2018/01/the-merlion-singapore-wallpaper.jpg' },
  ALL: { label: 'Multi-Country', short: 'ALL', hex: '#c084fc', image: 'https://images5.alphacoders.com/390/thumb-1920-390620.jpg' },
}
export const countryOf = (c: string | null | undefined) => COUNTRY[c ?? 'ALL'] ?? COUNTRY.ALL
export const COUNTRY_ORDER = ['VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA', 'ALL']

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
