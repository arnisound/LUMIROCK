// Régularisation des calques : transforme les détourages approximatifs en formes d'architecte
// (rectangles droits, arcs symétriques, cercles) puis aligne les éléments d'une même rangée / colonne.
import type { Pt, Zone } from '../types';

type Kind = 'rect' | 'arch' | 'ellipse';
interface Shape { kind: Kind; cx: number; top: number; w: number; h: number; ah: number } // pixels ; ah : hauteur de l'arc

const KEEP = new Set(['silhouette', 'exclure', 'mur', 'toit', 'statue', 'tour']);
const ROUND = new Set(['rosace', 'horloge']);

function area(p: Pt[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Largeur du polygone à la hauteur y (somme des segments intérieurs). */
function widthAt(p: Pt[], y: number) {
  const xs: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  xs.sort((a, b) => a - b);
  let w = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) w += xs[i + 1] - xs[i];
  return w;
}

function classify(z: Zone, W: number, H: number): Shape | null {
  if (KEEP.has(z.type) || z.points.length < 3) return null;
  const p = z.points.map(([x, y]) => [x * W, y * H] as Pt);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 || h < 3) return null;
  const cx = (x0 + x1) / 2;
  if (ROUND.has(z.type)) {
    const square = Math.abs(w - h) / Math.max(w, h) < 0.18;
    const d = (w + h) / 2;
    return square ? { kind: 'ellipse', cx, top: (y0 + y1) / 2 - d / 2, w: d, h: d, ah: 0 } : { kind: 'ellipse', cx, top: y0, w, h, ah: 0 };
  }
  const fill = area(p) / (w * h);
  if (fill >= 0.86) return { kind: 'rect', cx, top: y0, w, h, ah: 0 };
  // profil de largeur : un arc se rétrécit vers le haut, la partie basse reste pleine
  const rows = 24;
  const prof = Array.from({ length: rows }, (_, k) => widthAt(p, y0 + ((k + 0.5) / rows) * h) / w);
  const lower = prof.slice(Math.floor(rows * 0.55));
  const lowerFull = lower.reduce((a, b) => a + b, 0) / lower.length > 0.82;
  const k90 = prof.findIndex((v) => v >= 0.9);
  if (lowerFull && k90 > 1 && k90 < rows * 0.65 && prof[0] < 0.75) {
    const ah = Math.min(h * 0.6, Math.max(h * 0.1, ((k90 + 0.5) / rows) * h));
    return { kind: 'arch', cx, top: y0, w, h, ah };
  }
  if (fill >= 0.75) return { kind: 'rect', cx, top: y0, w, h, ah: 0 };
  return null;
}

function toPoints(s: Shape, W: number, H: number): Pt[] {
  const n = (x: number, y: number): Pt => [Math.min(1, Math.max(0, x / W)), Math.min(1, Math.max(0, y / H))];
  const L = s.cx - s.w / 2, R = s.cx + s.w / 2, B = s.top + s.h;
  if (s.kind === 'rect') return [n(L, s.top), n(R, s.top), n(R, B), n(L, B)];
  if (s.kind === 'ellipse') {
    const cy = s.top + s.h / 2;
    return Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return n(s.cx + Math.cos(a) * s.w / 2, cy + Math.sin(a) * s.h / 2);
    });
  }
  const spring = s.top + s.ah;
  const pts: Pt[] = [n(L, B)];
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI - (i / 18) * Math.PI;
    pts.push(n(s.cx + Math.cos(a) * s.w / 2, spring - Math.sin(a) * s.ah));
  }
  pts.push(n(R, B));
  return pts;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Aligne hauts, bas et largeurs dans chaque rangée, et les centres dans chaque colonne. */
function align(shapes: { s: Shape; type: string }[]) {
  const byType = new Map<string, { s: Shape; type: string }[]>();
  for (const e of shapes) if (e.s.kind !== 'ellipse') (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e);
  for (const list of byType.values()) {
    // rangées
    const used = new Set<Shape>();
    const sorted = [...list].sort((a, b) => a.s.top + a.s.h / 2 - (b.s.top + b.s.h / 2));
    for (const e of sorted) {
      if (used.has(e.s)) continue;
      const cy = e.s.top + e.s.h / 2;
      const row = sorted.filter((o) => !used.has(o.s) && Math.abs(o.s.top + o.s.h / 2 - cy) < e.s.h * 0.3 && Math.abs(o.s.h - e.s.h) < e.s.h * 0.25);
      row.forEach((o) => used.add(o.s));
      if (row.length < 2) continue;
      const top = median(row.map((o) => o.s.top)), bot = median(row.map((o) => o.s.top + o.s.h));
      const mw = median(row.map((o) => o.s.w));
      const arches = row.filter((o) => o.s.kind === 'arch');
      const mah = arches.length ? median(arches.map((o) => o.s.ah)) : 0;
      for (const o of row) {
        o.s.top = top;
        o.s.h = bot - top;
        if (Math.abs(o.s.w - mw) < mw * 0.15) o.s.w = mw;
        if (o.s.kind === 'arch' && mah) o.s.ah = Math.min(o.s.h * 0.6, mah);
      }
    }
    // colonnes
    const usedC = new Set<Shape>();
    for (const e of list) {
      if (usedC.has(e.s)) continue;
      const col = list.filter((o) => !usedC.has(o.s) && Math.abs(o.s.cx - e.s.cx) < Math.min(o.s.w, e.s.w) * 0.25);
      col.forEach((o) => usedC.add(o.s));
      if (col.length < 2) continue;
      const mcx = median(col.map((o) => o.s.cx));
      for (const o of col) o.s.cx = mcx;
    }
  }
}

export function regularizeZones(zones: Zone[], W: number, H: number, onlyIds?: Set<string>): { zones: Zone[]; changed: number } {
  const work: { z: Zone; s: Shape | null }[] = zones.map((z) => ({ z, s: !onlyIds || onlyIds.has(z.id) ? classify(z, W, H) : null }));
  align(work.filter((e) => e.s).map((e) => ({ s: e.s!, type: e.z.type })));
  let changed = 0;
  const out = work.map(({ z, s }) => {
    if (!s) return z;
    changed++;
    return { ...z, points: toPoints(s, W, H) };
  });
  return { zones: out, changed };
}
