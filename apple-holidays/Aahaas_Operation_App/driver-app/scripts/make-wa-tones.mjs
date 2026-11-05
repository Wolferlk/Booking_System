// Synthesises the WhatsApp alert tones into assets/sounds/*.wav (16-bit mono PCM).
// Run once after changing a tone: node scripts/make-wa-tones.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

/** A struck note: partials [ratio, gain], exponential decay, 4 ms attack. */
function note(buf, start, freq, { partials = [[1, 1]], decay = 0.3, gain = 1, sweep = 0 } = {}) {
  const from = Math.floor(start * RATE);
  for (let i = 0; from + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
    if (t > 0.01 && env < 1e-4) break; // past the attack and inaudible
    const f = freq * (1 + sweep * Math.min(1, t / 0.06));
    let s = 0;
    for (const [ratio, g] of partials) s += g * Math.sin(2 * Math.PI * f * ratio * t);
    buf[from + i] += s * env * gain;
  }
}

function render(seconds, draw) {
  const buf = new Float64Array(Math.ceil(seconds * RATE));
  draw(buf);
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fade = Math.floor(0.03 * RATE);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36); pcm.writeUInt32LE(buf.length * 2, 40);
  buf.forEach((v, i) => {
    const tail = Math.min(1, (buf.length - i) / fade);
    pcm.writeInt16LE(Math.round((v / peak) * 0.8 * tail * 32767), 44 + i * 2);
  });
  return pcm;
}

const BELL = [[1, 1], [2, 0.3], [3, 0.12]];
const TONES = {
  // Two rising bell notes — the house tone.
  chime: render(0.9, b => { note(b, 0, 659.25, { partials: BELL, decay: 0.3 }); note(b, 0.12, 987.77, { partials: BELL, decay: 0.35 }); }),
  // Two water-drop pops.
  pop: render(0.3, b => { note(b, 0, 420, { decay: 0.05, sweep: 1.8 }); note(b, 0.09, 620, { decay: 0.045, sweep: 1.6, gain: 0.7 }); }),
  // One clear bell with inharmonic overtones.
  ding: render(1.2, b => note(b, 0, 1318.5, { partials: [[1, 1], [2.76, 0.25], [5.4, 0.08]], decay: 0.5 })),
  // C–E–G wooden arpeggio.
  marimba: render(0.75, b => [523.25, 659.25, 783.99].forEach((f, i) => note(b, i * 0.09, f, { partials: [[1, 1], [4, 0.2]], decay: 0.16 }))),
  // Soft single ping, for busy desks.
  ping: render(0.6, b => note(b, 0, 880, { partials: [[1, 1], [2, 0.08]], decay: 0.18, gain: 0.8 })),
  // Double-double beep for "a guest has been waiting".
  urgent: render(0.75, b => [0, 0.11, 0.38, 0.49].forEach((s, i) => note(b, s, i % 2 ? 1318.5 : 1046.5, { partials: [[1, 1], [3, 0.15]], decay: 0.06 }))),
};

mkdirSync(OUT, { recursive: true });
for (const [name, wav] of Object.entries(TONES)) {
  writeFileSync(join(OUT, `wa-${name}.wav`), wav);
  console.log(`assets/sounds/wa-${name}.wav  ${(wav.length / 1024).toFixed(1)} KB`);
}
