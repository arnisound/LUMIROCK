// Musique : décodage, forme d'onde, énergie, détection du tempo et des temps forts.
import type { AudioFrame } from './gl/renderer';

export interface AudioAnalysis {
  buffer: AudioBuffer;
  duration: number;
  peaks: Float32Array; // forme d'onde réduite (1 valeur par 1/100 s)
  energy: Float32Array; // énergie lissée normalisée, 100 valeurs / s
  bpm: number;
  offset: number; // instant du premier temps (s)
  sections: number[]; // instants des changements de partie détectés (s)
  spectrum: Float32Array; // BANDS valeurs par image d'analyse (SPEC_RATE images / s), 0..1
  bands3: Float32Array; // basses, médiums, aigus par image (SPEC_RATE / s), 0..1
}

export const BANDS = 16;
const SPEC_RATE = 30;
const FFT = 2048;

/** FFT radix-2 en place (réel + imaginaire). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Spectre en 16 bandes logarithmiques (40 Hz – 16 kHz) + basses / médiums / aigus. */
function computeSpectrum(mono: Float32Array, sr: number) {
  const hop = sr / SPEC_RATE;
  const frames = Math.max(1, Math.floor(mono.length / hop));
  const spec = new Float32Array(frames * BANDS);
  const b3 = new Float32Array(frames * 3);
  const win = new Float32Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const edges = Array.from({ length: BANDS + 1 }, (_, k) => 40 * Math.pow(16000 / 40, k / BANDS));
  const binOf = (f: number) => Math.max(1, Math.min(FFT / 2 - 1, Math.round((f * FFT) / sr)));
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  for (let f = 0; f < frames; f++) {
    const c = Math.floor(f * hop);
    for (let i = 0; i < FFT; i++) {
      re[i] = (mono[c - FFT / 2 + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let lo = 0, mi = 0, hi = 0;
    for (let k = 0; k < BANDS; k++) {
      const a = binOf(edges[k]), b = Math.max(a + 1, binOf(edges[k + 1]));
      let e = 0;
      for (let j = a; j < b; j++) e += re[j] * re[j] + im[j] * im[j];
      const v = Math.log10(1 + e / (b - a));
      spec[f * BANDS + k] = v;
      if (edges[k + 1] <= 220) lo += v;
      else if (edges[k] >= 2200) hi += v;
      else mi += v;
    }
    b3[f * 3] = lo;
    b3[f * 3 + 1] = mi;
    b3[f * 3 + 2] = hi;
  }
  // normalisation par bande (centile 97) puis lissage « crête rapide, retombée douce »
  const norm = (arr: Float32Array, stride: number) => {
    for (let k = 0; k < stride; k++) {
      const vals: number[] = [];
      for (let f = 0; f < frames; f += 2) vals.push(arr[f * stride + k]);
      vals.sort((x, y) => x - y);
      const lo = vals[Math.floor(vals.length * 0.1)] ?? 0;
      const hi = vals[Math.floor(vals.length * 0.97)] || 1;
      let prev = 0;
      for (let f = 0; f < frames; f++) {
        const v = Math.min(1, Math.max(0, (arr[f * stride + k] - lo) / Math.max(1e-6, hi - lo)));
        prev = v > prev ? v : prev * 0.82 + v * 0.18;
        arr[f * stride + k] = prev;
      }
    }
  };
  norm(spec, BANDS);
  norm(b3, 3);
  return { spec, b3 };
}

const RATE = 100; // échantillons d'analyse par seconde

export async function decodeAudio(file: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  return await ctx.decodeAudioData(await file.arrayBuffer());
}

export function analyseAudio(buffer: AudioBuffer): AudioAnalysis {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const hop = Math.round(sr / RATE);
  const frames = Math.ceil(n / hop);
  const peaks = new Float32Array(frames);
  const rms = new Float32Array(frames);
  // énergie basse fréquence (filtre passe-bas simple) pour la détection des temps
  const low = new Float32Array(frames);
  let lp = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  for (let f = 0; f < frames; f++) {
    let pk = 0, s = 0, sl = 0;
    const end = Math.min(n, (f + 1) * hop);
    for (let i = f * hop; i < end; i++) {
      let v = 0;
      for (const c of ch) v += c[i];
      v /= ch.length;
      lp += alpha * (v - lp);
      pk = Math.max(pk, Math.abs(v));
      s += v * v;
      sl += lp * lp;
    }
    const len = Math.max(1, end - f * hop);
    peaks[f] = pk;
    rms[f] = Math.sqrt(s / len);
    low[f] = Math.sqrt(sl / len);
  }
  // enveloppe d'attaques (flux d'énergie positif)
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, low[f] - low[f - 1]) + 0.5 * Math.max(0, rms[f] - rms[f - 1]);
  // tempo par autocorrélation entre 70 et 180 BPM (retard fractionnaire interpolé)
  const maxF = Math.min(frames, RATE * 90);
  const at = (x: number) => {
    const i = Math.floor(x), f = x - i;
    return (onset[i] ?? 0) * (1 - f) + (onset[i + 1] ?? 0) * f;
  };
  const scoreFor = (bpm: number) => {
    const lag = (60 / bpm) * RATE;
    let score = 0;
    for (let f = 0; f + lag * 4 < maxF; f++) score += onset[f] * (at(f + lag) + 0.6 * at(f + lag * 2) + 0.4 * at(f + lag * 4));
    // léger biais vers 90–140 BPM
    return score * (1 + 0.15 * Math.exp(-Math.pow((bpm - 118) / 30, 2)));
  };
  let bestBpm = 120, bestScore = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const sc = scoreFor(bpm);
    if (sc > bestScore) {
      bestScore = sc;
      bestBpm = bpm;
    }
  }
  for (let bpm = bestBpm - 0.5; bpm <= bestBpm + 0.5; bpm += 0.05) {
    const sc = scoreFor(bpm);
    if (sc > bestScore) {
      bestScore = sc;
      bestBpm = bpm;
    }
  }
  // phase : décalage qui maximise l'énergie des attaques sur la grille
  const period = (60 / bestBpm) * RATE;
  let bestOff = 0, bestPhase = -Infinity;
  for (let o = 0; o < period; o++) {
    let s = 0;
    for (let t = o; t < maxF; t += period) s += onset[Math.floor(t)];
    if (s > bestPhase) {
      bestPhase = s;
      bestOff = o;
    }
  }
  // énergie lissée et normalisée
  const energy = new Float32Array(frames);
  let e = 0;
  let maxE = 1e-6;
  for (let f = 0; f < frames; f++) {
    e += (rms[f] - e) * 0.05;
    energy[f] = e;
    maxE = Math.max(maxE, e);
  }
  for (let f = 0; f < frames; f++) energy[f] /= maxE;
  // changements de partie : variation forte de l'énergie moyenne sur 4 s
  const sections: number[] = [];
  const win = RATE * 4;
  let last = -Infinity;
  for (let f = win; f < frames - win; f += RATE / 2) {
    let a = 0, b = 0;
    for (let k = 0; k < win; k++) {
      a += energy[f - win + k];
      b += energy[f + k];
    }
    const diff = Math.abs(b - a) / win;
    if (diff > 0.18 && f / RATE - last > 8) {
      sections.push(f / RATE);
      last = f / RATE;
    }
  }
  const mono = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  const { spec, b3 } = computeSpectrum(mono, sr);
  return { buffer, duration: buffer.duration, peaks, energy, bpm: Math.round(bestBpm * 10) / 10, offset: bestOff / RATE, sections, spectrum: spec, bands3: b3 };
}

/** Informations rythmiques à l'instant t (avec ou sans musique). */
export function audioFrameAt(t: number, analysis: AudioAnalysis | null, bpm: number): AudioFrame {
  const b = analysis ? analysis.bpm : bpm;
  const off = analysis ? analysis.offset : 0;
  const period = 60 / b;
  const x = (t - off) / period;
  const beatIndex = Math.floor(x);
  const beatPhase = x - beatIndex;
  const beat = Math.exp(-beatPhase * 5.5);
  let energy = 0.55 + 0.15 * Math.sin(t * 0.3);
  if (analysis) {
    const f = Math.min(analysis.energy.length - 1, Math.max(0, Math.floor(t * RATE)));
    energy = analysis.energy[f] ?? 0;
  }
  const spec = new Float32Array(BANDS);
  let bass: number, mid: number, high: number;
  if (analysis?.spectrum) {
    const fr = Math.min(analysis.spectrum.length / BANDS - 1, Math.max(0, Math.floor(t * SPEC_RATE)));
    spec.set(analysis.spectrum.subarray(fr * BANDS, fr * BANDS + BANDS));
    bass = analysis.bands3[fr * 3];
    mid = analysis.bands3[fr * 3 + 1];
    high = analysis.bands3[fr * 3 + 2];
  } else {
    // sans musique : spectre synthétique calé sur le tempo
    const b = x < 0 ? 0 : beat;
    bass = b;
    mid = 0.45 + 0.3 * Math.sin(t * 2.1) * Math.sin(t * 0.7);
    high = Math.max(0, Math.exp(-((x * 2) % 1) * 7) * 0.8 + 0.15 * Math.sin(t * 9));
    for (let k = 0; k < BANDS; k++) spec[k] = Math.max(0, Math.min(1, (k < 4 ? bass : k < 10 ? mid : high) * (0.7 + 0.3 * Math.sin(t * 3 + k * 1.7))));
  }
  return { beat: x < 0 ? 0 : beat, beatPhase, beatIndex: Math.max(0, beatIndex), energy, bass, mid, high, spec };
}

export function energyAt(analysis: AudioAnalysis, t0: number, t1: number) {
  const a = Math.max(0, Math.floor(t0 * RATE)), b = Math.min(analysis.energy.length, Math.ceil(t1 * RATE));
  let s = 0;
  for (let i = a; i < b; i++) s += analysis.energy[i];
  return b > a ? s / (b - a) : 0;
}
