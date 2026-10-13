export function greetingKey(): 'goodMorning' | 'goodAfternoon' | 'goodEvening' {
  const h = new Date().getHours();
  return h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening';
}

export function fmtDay(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, opts);
}

export function fmtRange(a: string, b: string) {
  return a === b ? fmtDay(a) : `${fmtDay(a)} → ${fmtDay(b)}`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function firstName(n: string) {
  const parts = n.trim().split(/\s+/);
  // Sri Lankan names often lead with long family names; the last word is what people are called.
  const pick = parts.length > 2 ? parts[parts.length - 1] : parts[0];
  return pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase();
}

export function routeOf(m: { from: string | null; to: string | null; location: string }) {
  const from = m.from || m.location;
  return m.to && m.to !== from ? `${from} → ${m.to}` : from;
}
