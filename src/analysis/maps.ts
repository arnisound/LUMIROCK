// Calcul des cartes d'analyse de la façade : calques, profondeur, normales, contours.
import { sceneAnims } from '../zoneanim';
import type { SceneMaps } from '../gl/renderer';
import { Pt, Zone, ZONE_TYPES, zoneType } from '../types';

export const MAX_WORK = 1600; // plus grand côté de la résolution de travail

/** Remplit un polygone (coordonnées pixel) en appelant cb pour chaque segment horizontal. */
export function fillPolygon(pts: Pt[], W: number, H: number, cb: (x0: number, x1: number, y: number) => void) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > sy !== yj > sy) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      if (b >= a) cb(a, b, y);
    }
  }
}

/** Flou boîte séparable (n passes ≈ gaussien), en place. */
export function boxBlur(src: Float32Array, W: number, H: number, r: number, passes = 2) {
  r = Math.max(1, Math.round(r));
  const tmp = new Float32Array(src.length);
  const line = new Float32Array(Math.max(W, H));
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[o + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = acc / (2 * r + 1);
        acc += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        line[y] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
      for (let y = 0; y < H; y++) src[y * W + x] = line[y];
    }
  }
  return src;
}

export function luminance(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number) {
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  return L;
}

function toRGBA(gray: Float32Array, scale = 255) {
  const out = new Uint8Array(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(gray[i] * scale)));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export interface ZoneRaster {
  ids: Uint16Array; // id de calque par pixel (0 = aucun)
  mask: Uint8Array; // 1 = projetable
  drawable: Zone[]; // calques indexés (id = index + 1)
}

export function rasterizeZones(zones: Zone[], W: number, H: number): ZoneRaster {
  const ids = new Uint16Array(W * H);
  const mask = new Uint8Array(W * H);
  const sil = zones.filter((z) => z.type === 'silhouette');
  if (sil.length === 0) mask.fill(1);
  const toPx = (z: Zone) => z.points.map(([x, y]) => [x * W, y * H] as Pt);
  for (const z of sil) fillPolygon(toPx(z), W, H, (a, b, y) => mask.fill(1, y * W + a, y * W + b + 1));
  const drawable = zones.filter((z) => z.type !== 'silhouette' && z.type !== 'exclure').slice(0, 255);
  drawable.forEach((z, i) => fillPolygon(toPx(z), W, H, (a, b, y) => ids.fill(i + 1, y * W + a, y * W + b + 1)));
  for (const z of zones.filter((z) => z.type === 'exclure')) fillPolygon(toPx(z), W, H, (a, b, y) => mask.fill(0, y * W + a, y * W + b + 1));
  return { ids, mask, drawable };
}

function polygonCentroid(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    sx += x; sy += y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY, mx: sx / pts.length, my: sy / pts.length };
}

export interface BuildOptions {
  aiDepth?: Float32Array | null; // profondeur IA (W*H, 0..1, 1 = proche)
  lines?: LineStyle;
}

/** Tracé des contours utilisé par les tableaux (néon, dessin, étincelles…) et douceur du relief. */
export interface LineStyle {
  mode: 'calques' | 'photo' | 'mixte'; // lignes dessinées, vraies lignes de la photo autour des calques, ou les deux
  width: number; // épaisseur (0.5 à 3)
  soft: number; // douceur du relief des calques 0..1 (moins d'ombres anguleuses)
}

export const DEFAULT_LINES: LineStyle = { mode: 'mixte', width: 1, soft: 0.35 };

/** Construit toutes les cartes envoyées au moteur de rendu. */
export function buildScene(image: ImageData, zones: Zone[], opts: BuildOptions = {}): SceneMaps {
  const W = image.width, H = image.height, N = W * H;
  const albedo = new Uint8Array(image.data.buffer.slice(0));
  for (let i = 0; i < N; i++) albedo[i * 4 + 3] = 255;
  const { ids, mask, drawable } = rasterizeZones(zones, W, H);

  // ── informations par calque
  const zoneInfo = new Float32Array(256 * 2 * 4);
  const geo = drawable.map((z) => polygonCentroid(z.points));
  const order = drawable.map((_, i) => i).sort((a, b) => geo[a].cx * 0.7 + geo[a].cy * 0.3 - (geo[b].cx * 0.7 + geo[b].cy * 0.3));
  const rank = new Float32Array(drawable.length);
  order.forEach((idx, r) => (rank[idx] = drawable.length > 1 ? r / (drawable.length - 1) : 0));
  drawable.forEach((z, i) => {
    const g = geo[i];
    const id = i + 1;
    zoneInfo.set([g.cx, 1 - g.cy, g.w, g.h], id * 4);
    zoneInfo.set([hashStr(z.id), rank[i], g.w * g.h, zoneType(z.type).id], (256 + id) * 4);
  });

  // ── carte des calques
  const zonesRGBA = new Uint8Array(N * 4);
  const reliefOf = drawable.map((z) => z.relief ?? zoneType(z.type).relief);
  const typeOf = drawable.map((z) => zoneType(z.type).id);
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    zonesRGBA[i * 4] = id;
    zonesRGBA[i * 4 + 1] = id ? typeOf[id - 1] : 0;
    zonesRGBA[i * 4 + 2] = Math.round((id ? reliefOf[id - 1] : 0.5) * 255);
    zonesRGBA[i * 4 + 3] = mask[i] ? 255 : 0;
  }

  // ── profondeur
  const L = luminance(image.data, W, H);
  const base = new Float32Array(N);
  const hasSil = zones.some((z) => z.type === 'silhouette');
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    base[i] = id ? reliefOf[id - 1] : mask[i] || !hasSil ? 0.5 : 0.05;
  }
  const ls = { ...DEFAULT_LINES, ...(opts.lines ?? {}) };
  boxBlur(base, W, H, W * (0.004 + ls.soft * 0.025), 2);
  const Lb = boxBlur(Float32Array.from(L), W, H, W * 0.01, 2);
  const depth = new Float32Array(N);
  let aiDetail: Float32Array | null = null;
  if (opts.aiDepth && opts.aiDepth.length === N) {
    const big = boxBlur(Float32Array.from(opts.aiDepth), W, H, W * 0.05, 2);
    aiDetail = new Float32Array(N);
    for (let i = 0; i < N; i++) aiDetail[i] = opts.aiDepth[i] - big[i];
  }
  for (let i = 0; i < N; i++) {
    let d = base[i] + (L[i] - Lb[i]) * (aiDetail ? 0.12 : 0.3);
    if (aiDetail) d += aiDetail[i] * 1.1;
    depth[i] = Math.max(0, Math.min(1, d));
  }

  // ── normales
  const normal = new Uint8Array(N * 4);
  const s = W / 60;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = depth[y * W + Math.max(0, x - 1)], xr = depth[y * W + Math.min(W - 1, x + 1)];
      const yu = depth[Math.max(0, y - 1) * W + x], yd = depth[Math.min(H - 1, y + 1) * W + x];
      let nx = -((xr - xl) / 2) * s;
      let ny = -((yu - yd) / 2) * s;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      normal[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = 255;
    }
  }

  // ── contours
  const Ls = boxBlur(Float32Array.from(L), W, H, 1, 1);
  const mag = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = Ls[i - W + 1] + 2 * Ls[i + 1] + Ls[i + W + 1] - Ls[i - W - 1] - 2 * Ls[i - 1] - Ls[i + W - 1];
      const gy = Ls[i + W - 1] + 2 * Ls[i + W] + Ls[i + W + 1] - Ls[i - W - 1] - 2 * Ls[i - W] - Ls[i - W + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  const sample: number[] = [];
  for (let i = 0; i < N; i += 97) sample.push(mag[i]);
  sample.sort((a, b) => a - b);
  const p95 = sample[Math.floor(sample.length * 0.95)] || 1;
  const edgeR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = Math.min(1, mag[i] / p95);
    edgeR[i] = v < 0.2 ? 0 : Math.pow((v - 0.2) / 0.8, 1.2);
  }
  // contours des calques : dessinés au canevas
  const outline = new Float32Array(N);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1.2, (W / 650) * ls.width);
  ctx.lineJoin = 'round';
  for (const z of zones) {
    if (z.type === 'exclure') continue;
    ctx.beginPath();
    z.points.forEach(([x, y], k) => (k ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    ctx.closePath();
    ctx.stroke();
  }
  const od = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < N; i++) outline[i] = od[i * 4] / 255;
  if (ls.mode !== 'calques') {
    // vraies lignes de l'architecture, seulement au voisinage des calques : elles épousent la pierre
    const band = boxBlur(Float32Array.from(outline), W, H, W * 0.006, 2);
    for (let i = 0; i < N; i++) {
      const near = Math.min(1, band[i] * 6);
      const photo = Math.min(1, edgeR[i] * 1.6) * near;
      outline[i] = ls.mode === 'photo' ? photo : Math.max(photo, outline[i] * 0.55);
    }
  }
  const glowLines = boxBlur(Float32Array.from(outline), W, H, W * 0.008, 2);
  const openings = new Float32Array(N);
  const openingTypes = new Set(ZONE_TYPES.filter((t) => ['fenetre', 'porte', 'rosace', 'horloge'].includes(t.key)).map((t) => t.id));
  for (let i = 0; i < N; i++) openings[i] = ids[i] && openingTypes.has(typeOf[ids[i] - 1]) ? 1 : 0;
  boxBlur(openings, W, H, W * 0.018, 3);
  const edges = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    edges[i * 4] = Math.round(edgeR[i] * 255);
    edges[i * 4 + 1] = Math.round(outline[i] * 255);
    edges[i * 4 + 2] = Math.round(Math.min(1, openings[i] * 1.6) * 255);
    edges[i * 4 + 3] = Math.round(Math.min(1, glowLines[i] * 3) * 255);
  }

  return { width: W, height: H, albedo, depth: toRGBA(depth), normal, zones: zonesRGBA, edges, zoneInfo, zoneCount: drawable.length, anims: sceneAnims(zones) };
}
