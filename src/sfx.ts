// Bruitages synthétisés dans le navigateur (aucun fichier, aucun droit d'auteur) :
// grelots, cloches, tonnerre, pluie, vent, feux d'artifice, applaudissements, chouette, loup…

export interface SfxDef {
  id: string;
  name: string;
  icon: string;
  duration: number;
  build: (ctx: OfflineAudioContext, out: AudioNode) => void;
}

const SR = 32000;

function noise(ctx: BaseAudioContext, dur: number, kind: 'white' | 'brown' = 'white') {
  const n = Math.ceil(dur * ctx.sampleRate);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 1) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** Enveloppe percussive : attaque puis décroissance exponentielle. */
function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number) {
  t = Math.max(0.001, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, f: number, t: number, peak: number, attack: number, decay: number, type: OscillatorType = 'sine') {
  t = Math.max(0.001, t);
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = env(ctx, t, peak, attack, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
  return o;
}

function burst(ctx: BaseAudioContext, out: AudioNode, t: number, peak: number, decay: number, type: BiquadFilterType, f: number, q = 1, kind: 'white' | 'brown' = 'white') {
  t = Math.max(0.001, t);
  const n = noise(ctx, decay + 0.1, kind);
  const fl = filt(ctx, type, f, q);
  const g = env(ctx, t, peak, 0.002, decay);
  n.connect(fl).connect(g).connect(out);
  n.start(t);
}

function bell(ctx: BaseAudioContext, out: AudioNode, base: number, t: number, peak: number, len: number) {
  const parts: [number, number, number][] = [[0.5, 0.5, 1.0], [1, 1, 0.8], [1.19, 0.6, 0.6], [1.5, 0.45, 0.5], [2, 0.5, 0.45], [2.5, 0.25, 0.3], [3.01, 0.2, 0.25], [4.07, 0.12, 0.15]];
  for (const [r, a, d] of parts) tone(ctx, out, base * r * (1 + (Math.random() - 0.5) * 0.002), t, peak * a, 0.004, len * d);
  burst(ctx, out, t, peak * 0.3, 0.05, 'highpass', 3000);
}

export const SFX: SfxDef[] = [
  {
    id: 'grelots', name: 'Grelots de traîneau', icon: '🛷', duration: 5,
    build: (ctx, out) => {
      for (let i = 0; i < 20; i++) {
        const t = i * 0.22 + (Math.random() - 0.5) * 0.02;
        const v = 0.25 * (i % 2 ? 0.7 : 1) * Math.min(1, (20 - i) / 6, (i + 2) / 3);
        for (let k = 0; k < 5; k++) {
          const f = 2200 + Math.random() * 4800;
          tone(ctx, out, f, t + Math.random() * 0.03, v * 0.35, 0.002, 0.12 + Math.random() * 0.15);
        }
        burst(ctx, out, t, v * 0.5, 0.06, 'highpass', 6000);
      }
    },
  },
  {
    id: 'cloches', name: 'Cloches d’église', icon: '🔔', duration: 10,
    build: (ctx, out) => {
      const notes = [196, 247, 220, 196];
      notes.forEach((f, i) => bell(ctx, out, f, i * 1.6, 0.35, 6));
    },
  },
  {
    id: 'carillon', name: 'Carillon magique', icon: '✨', duration: 4,
    build: (ctx, out) => {
      const scale = [1318, 1568, 1760, 2093, 2349, 2637, 3136];
      for (let i = 0; i < 14; i++) tone(ctx, out, scale[Math.floor(Math.random() * scale.length)], i * 0.11 + Math.random() * 0.03, 0.12, 0.003, 1.2);
    },
  },
  {
    id: 'tonnerre', name: 'Coup de tonnerre', icon: '⛈', duration: 7,
    build: (ctx, out) => {
      burst(ctx, out, 0.05, 0.9, 0.35, 'highpass', 1500);
      const n = noise(ctx, 7, 'brown');
      const lp = filt(ctx, 'lowpass', 300, 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(1.6, 0.15);
      let t = 0.15;
      while (t < 6.5) {
        t += 0.15 + Math.random() * 0.35;
        g.gain.linearRampToValueAtTime((0.4 + Math.random() * 1.2) * Math.max(0.05, 1 - t / 7), t);
      }
      g.gain.linearRampToValueAtTime(0, 7);
      n.connect(lp).connect(g).connect(out);
      n.start(0);
    },
  },
  {
    id: 'pluie', name: 'Pluie', icon: '🌧', duration: 10,
    build: (ctx, out) => {
      const n = noise(ctx, 10);
      const f = filt(ctx, 'bandpass', 2500, 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.25, 1.5);
      g.gain.setValueAtTime(0.25, 8.5);
      g.gain.linearRampToValueAtTime(0, 10);
      n.connect(f).connect(g).connect(out);
      n.start(0);
      for (let i = 0; i < 260; i++) {
        const t = 0.5 + Math.random() * 9;
        burst(ctx, out, t, 0.05 + Math.random() * 0.12, 0.02, 'bandpass', 2000 + Math.random() * 5000, 4);
      }
    },
  },
  {
    id: 'vent', name: 'Vent', icon: '🌬', duration: 10,
    build: (ctx, out) => {
      const n = noise(ctx, 10);
      const f = filt(ctx, 'bandpass', 500, 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      for (let t = 0; t <= 10; t += 0.8) {
        f.frequency.linearRampToValueAtTime(300 + Math.random() * 900, t);
        g.gain.linearRampToValueAtTime((0.2 + Math.random() * 0.5) * Math.min(1, t / 1.5, (10 - t) / 1.5), t);
      }
      n.connect(f).connect(g).connect(out);
      n.start(0);
    },
  },
  {
    id: 'feuartifice', name: 'Fusée de feu d’artifice', icon: '🎆', duration: 4.5,
    build: (ctx, out) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(700, 0);
      o.frequency.exponentialRampToValueAtTime(2600, 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.12, 0.2);
      g.gain.linearRampToValueAtTime(0, 1.35);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(1.4);
      burst(ctx, out, 1.4, 1.2, 1.4, 'lowpass', 400, 0.7, 'brown');
      tone(ctx, out, 55, 1.4, 0.9, 0.005, 0.8);
      burst(ctx, out, 1.4, 0.5, 0.2, 'highpass', 800);
      for (let i = 0; i < 60; i++) burst(ctx, out, 1.7 + Math.random() * 2.4, 0.05 + Math.random() * 0.15, 0.015, 'highpass', 3000 + Math.random() * 4000);
    },
  },
  {
    id: 'bouquet', name: 'Bouquet final', icon: '🎇', duration: 9,
    build: (ctx, out) => {
      for (let i = 0; i < 16; i++) {
        const t = 0.2 + i * 0.5 + Math.random() * 0.3;
        burst(ctx, out, t, 0.6 + Math.random() * 0.5, 1.0, 'lowpass', 300 + Math.random() * 300, 0.7, 'brown');
        tone(ctx, out, 45 + Math.random() * 30, t, 0.6, 0.005, 0.6);
        for (let k = 0; k < 8; k++) burst(ctx, out, t + 0.2 + Math.random() * 1.5, 0.04 + Math.random() * 0.1, 0.015, 'highpass', 3500);
      }
    },
  },
  {
    id: 'applaudissements', name: 'Applaudissements', icon: '👏', duration: 7,
    build: (ctx, out) => {
      for (let i = 0; i < 700; i++) {
        const t = Math.random() * 6.5;
        const lvl = Math.min(1, t / 0.6, (7 - t) / 2.5);
        burst(ctx, out, t, (0.05 + Math.random() * 0.08) * lvl, 0.03, 'bandpass', 900 + Math.random() * 1600, 1.5);
      }
    },
  },
  {
    id: 'chouette', name: 'Chouette hulotte', icon: '🦉', duration: 3.5,
    build: (ctx, out) => {
      const hoot = (t: number, d: number, f: number) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * 0.94, t + d);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, 0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.35, t + d * 0.25);
        g.gain.linearRampToValueAtTime(0, t + d);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + d + 0.05);
        burst(ctx, out, t, 0.03, d, 'bandpass', f * 2, 2);
      };
      hoot(0.1, 0.45, 420);
      hoot(1.0, 0.18, 440);
      hoot(1.3, 0.25, 430);
      hoot(1.75, 1.1, 425);
    },
  },
  {
    id: 'loup', name: 'Hurlement de loup', icon: '🐺', duration: 5,
    build: (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(330, 0);
      o.frequency.linearRampToValueAtTime(560, 1.0);
      o.frequency.linearRampToValueAtTime(600, 2.6);
      o.frequency.linearRampToValueAtTime(420, 4.5);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = 7;
      vib.connect(vg).connect(o.frequency);
      const f1 = filt(ctx, 'bandpass', 800, 4), f2 = filt(ctx, 'lowpass', 1800, 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.4, 0.5);
      g.gain.setValueAtTime(0.4, 3.4);
      g.gain.linearRampToValueAtTime(0, 4.7);
      o.connect(f2).connect(f1).connect(g).connect(out);
      o.start(0);
      vib.start(0);
      o.stop(4.8);
      vib.stop(4.8);
    },
  },
  {
    id: 'porte', name: 'Porte qui grince', icon: '🚪', duration: 3,
    build: (ctx, out) => {
      let t = 0.1;
      while (t < 2.6) {
        const f = 700 + Math.sin(t * 3) * 250 + Math.random() * 80;
        burst(ctx, out, t, 0.18, 0.02, 'bandpass', f, 12);
        burst(ctx, out, t, 0.08, 0.02, 'bandpass', f * 2.1, 12);
        t += 0.012 + 0.03 * Math.abs(Math.sin(t * 2.2));
      }
    },
  },
  {
    id: 'vagues', name: 'Vagues', icon: '🌊', duration: 10,
    build: (ctx, out) => {
      const n = noise(ctx, 10);
      const f = filt(ctx, 'lowpass', 600, 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      for (let k = 0; k < 3; k++) {
        const t0 = k * 3.3;
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.01);
        g.gain.linearRampToValueAtTime(0.5, t0 + 1.4);
        f.frequency.linearRampToValueAtTime(2200, t0 + 1.4);
        g.gain.linearRampToValueAtTime(0.08, t0 + 3.2);
        f.frequency.linearRampToValueAtTime(500, t0 + 3.2);
      }
      n.connect(f).connect(g).connect(out);
      n.start(0);
    },
  },
  {
    id: 'oiseaux', name: 'Chant d’oiseaux', icon: '🐦', duration: 7,
    build: (ctx, out) => {
      for (let i = 0; i < 28; i++) {
        const t = Math.random() * 6.5;
        const f0 = 2600 + Math.random() * 2500;
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * (0.6 + Math.random() * 0.9), t + 0.08 + Math.random() * 0.1);
        const g = env(ctx, t, 0.1, 0.01, 0.12);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.3);
      }
    },
  },
  {
    id: 'feu', name: 'Feu qui crépite', icon: '🔥', duration: 8,
    build: (ctx, out) => {
      const n = noise(ctx, 8, 'brown');
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.5, 1);
      g.gain.setValueAtTime(0.5, 7);
      g.gain.linearRampToValueAtTime(0, 8);
      n.connect(filt(ctx, 'lowpass', 500)).connect(g).connect(out);
      n.start(0);
      for (let i = 0; i < 120; i++) burst(ctx, out, 0.3 + Math.random() * 7.4, 0.05 + Math.random() * 0.25, 0.008 + Math.random() * 0.02, 'highpass', 1500 + Math.random() * 3000);
    },
  },
  {
    id: 'coeur', name: 'Battements de cœur', icon: '❤', duration: 5,
    build: (ctx, out) => {
      for (let i = 0; i < 6; i++) {
        const t = 0.1 + i * 0.85;
        tone(ctx, out, 55, t, 0.9, 0.01, 0.18);
        tone(ctx, out, 48, t + 0.22, 0.6, 0.01, 0.2);
      }
    },
  },
  {
    id: 'whoosh', name: 'Souffle (transition)', icon: '💨', duration: 2,
    build: (ctx, out) => {
      const n = noise(ctx, 2);
      const f = filt(ctx, 'bandpass', 300, 1.5);
      f.frequency.setValueAtTime(300, 0);
      f.frequency.exponentialRampToValueAtTime(3500, 0.9);
      f.frequency.exponentialRampToValueAtTime(400, 1.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.7, 0.9);
      g.gain.linearRampToValueAtTime(0, 1.9);
      n.connect(f).connect(g).connect(out);
      n.start(0);
    },
  },
  {
    id: 'gong', name: 'Gong', icon: '🥁', duration: 7,
    build: (ctx, out) => {
      [1, 1.47, 1.94, 2.39, 2.83, 3.65, 4.5].forEach((r, i) => tone(ctx, out, 95 * r, 0.05, 0.4 / (1 + i * 0.4), 0.02, 6 - i * 0.5));
      burst(ctx, out, 0.05, 0.3, 0.3, 'lowpass', 900, 0.7, 'brown');
    },
  },
  {
    id: 'grondement', name: 'Grondement (effondrement)', icon: '🪨', duration: 6,
    build: (ctx, out) => {
      const n = noise(ctx, 6, 'brown');
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1.6, 0.6);
      g.gain.linearRampToValueAtTime(0.9, 3);
      g.gain.linearRampToValueAtTime(0, 6);
      n.connect(filt(ctx, 'lowpass', 180)).connect(g).connect(out);
      n.start(0);
      for (let i = 0; i < 40; i++) burst(ctx, out, 0.3 + Math.random() * 4, 0.1 + Math.random() * 0.3, 0.05, 'bandpass', 300 + Math.random() * 1200, 2, 'brown');
    },
  },
];

export const SFX_MAP = new Map(SFX.map((s) => [s.id, s]));

/** Calcule le bruitage (mono, 32 kHz) avec une légère réverbération. */
export async function renderSfx(id: string): Promise<AudioBuffer> {
  const def = SFX_MAP.get(id);
  if (!def) throw new Error(`Bruitage inconnu : ${id}`);
  const len = def.duration + 0.6;
  const ctx = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 4;
  // petite salle : quelques échos amortis
  const wet = ctx.createGain();
  wet.gain.value = 0.18;
  [0.043, 0.071, 0.113].forEach((d) => {
    const dl = ctx.createDelay(1);
    dl.delayTime.value = d;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    bus.connect(dl).connect(fb).connect(dl);
    dl.connect(wet);
  });
  bus.connect(comp);
  wet.connect(comp);
  comp.connect(ctx.destination);
  def.build(ctx, bus);
  const buf = await ctx.startRendering();
  // niveau homogène : volume moyen visé, sans dépasser la crête
  const d = buf.getChannelData(0);
  let pk = 0, sq = 0;
  for (let i = 0; i < d.length; i++) {
    pk = Math.max(pk, Math.abs(d[i]));
    sq += d[i] * d[i];
  }
  const rms = Math.sqrt(sq / d.length);
  const g = Math.min(0.95 / Math.max(pk, 1e-6), 0.13 / Math.max(rms, 1e-6));
  for (let i = 0; i < d.length; i++) d[i] *= g;
  return buf;
}

/** Encode un AudioBuffer en WAV 16 bits (pour l'enregistrer dans le projet). */
export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    o += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}
