// Images clés : animation des paramètres d'un tableau au cours du temps.
import type { Clip, Keyframe, ParamValue } from './types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: number[]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
const ease = (x: number) => x * x * (3 - 2 * x);

/** Valeur d'un paramètre à l'avancement p (0..1) du tableau, en tenant compte des images clés. */
export function paramAt(clip: Clip, key: string, p: number, fallback: ParamValue): ParamValue {
  const ks = clip.keys?.[key];
  const base = clip.params[key] ?? fallback;
  if (!ks || ks.length === 0) return base;
  if (p <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (p >= last.t) return last.v;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t < p) i++;
  const a = ks[i], b = ks[i + 1];
  const u = ease((p - a.t) / Math.max(1e-6, b.t - a.t));
  if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * u;
  if (typeof a.v === 'string' && typeof b.v === 'string' && a.v.startsWith('#') && b.v.startsWith('#')) {
    const ca = hexToRgb(a.v), cb = hexToRgb(b.v);
    return rgbToHex(ca.map((c, k) => c + (cb[k] - c) * u));
  }
  return u < 0.5 ? a.v : b.v;
}

/** Ajoute ou remplace une image clé à l'avancement p. */
export function setKey(clip: Clip, key: string, p: number, v: ParamValue) {
  clip.keys ??= {};
  const ks = (clip.keys[key] ??= []);
  p = Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000;
  const near = ks.find((k) => Math.abs(k.t - p) < 0.02);
  if (near) near.v = v;
  else ks.push({ t: p, v } as Keyframe);
  ks.sort((a, b) => a.t - b.t);
}

export function removeKey(clip: Clip, key: string, index: number) {
  const ks = clip.keys?.[key];
  if (!ks) return;
  ks.splice(index, 1);
  if (ks.length === 0) delete clip.keys![key];
}
