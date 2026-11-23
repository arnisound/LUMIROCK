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
  return { buffer, duration: buffer.duration, peaks, energy, bpm: Math.round(bestBpm * 10) / 10, offset: bestOff / RATE, sections };
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
  return { beat: x < 0 ? 0 : beat, beatPhase, beatIndex: Math.max(0, beatIndex), energy };
}

export function energyAt(analysis: AudioAnalysis, t0: number, t1: number) {
  const a = Math.max(0, Math.floor(t0 * RATE)), b = Math.min(analysis.energy.length, Math.ceil(t1 * RATE));
  let s = 0;
  for (let i = a; i < b; i++) s += analysis.energy[i];
  return b > a ? s / (b - a) : 0;
}
