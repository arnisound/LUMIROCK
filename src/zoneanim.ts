// Calques animés dans le temps : déplacement, échelle et rotation d'un calque au fil du spectacle
// (une porte qui s'ouvre, une fenêtre qui grandit…). Appliqué dans les shaders par transformation inverse.
import type { Zone, ZoneAnim, ZoneKey } from './types';

export const MAX_ANIM = 8;

export const PIVOTS: { value: ZoneAnim['pivot']; label: string }[] = [
  { value: 'c', label: 'Centre' },
  { value: 'l', label: 'Bord gauche (charnière)' },
  { value: 'r', label: 'Bord droit (charnière)' },
  { value: 'b', label: 'Bas' },
  { value: 't', label: 'Haut' },
];

export const IDENTITY: Omit<ZoneKey, 't'> = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };

const ease = (x: number) => x * x * (3 - 2 * x);

/** Transformation du calque à l'instant t (secondes du spectacle). */
export function zoneTransformAt(a: ZoneAnim, t: number): Omit<ZoneKey, 't'> {
  const k = [...a.keys].sort((x, y) => x.t - y.t);
  if (!k.length) return IDENTITY;
  if (t <= k[0].t) return k[0];
  const last = k[k.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (k[i + 1].t < t) i++;
  const A = k[i], B = k[i + 1];
  const u = ease((t - A.t) / Math.max(1e-6, B.t - A.t));
  const m = (p: number, q: number) => p + (q - p) * u;
  return { dx: m(A.dx, B.dx), dy: m(A.dy, B.dy), sx: m(A.sx, B.sx), sy: m(A.sy, B.sy), rot: m(A.rot, B.rot) };
}

export interface SceneAnim { id: number; anim: ZoneAnim; box: [number, number, number, number] } // id raster, boîte uv (x0, y0, x1, y1)

/** Calques animés tels qu'ils figurent dans la carte des calques (id = rang parmi les calques dessinables + 1). */
export function sceneAnims(zones: Zone[]): SceneAnim[] {
  const drawable = zones.filter((z) => z.type !== 'silhouette' && z.type !== 'exclure').slice(0, 255);
  const out: SceneAnim[] = [];
  drawable.forEach((z, i) => {
    if (!z.anim || !z.anim.keys.length || out.length >= MAX_ANIM) return;
    const xs = z.points.map((p) => p[0]), ys = z.points.map((p) => 1 - p[1]);
    out.push({ id: i + 1, anim: z.anim, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  });
  return out;
}

export interface AnimUniforms { count: number; ids: Float32Array; inv: Float32Array; fwd: Float32Array; scale: Float32Array }

/** Matrices (mat3, colonnes) envoyées au shader pour l'instant t. */
export function animUniforms(list: SceneAnim[] | undefined, t: number, aspect: number): AnimUniforms {
  const u: AnimUniforms = { count: 0, ids: new Float32Array(MAX_ANIM), inv: new Float32Array(9 * MAX_ANIM), fwd: new Float32Array(9 * MAX_ANIM), scale: new Float32Array(2 * MAX_ANIM) };
  for (const s of list ?? []) {
    if (u.count >= MAX_ANIM) break;
    const k = zoneTransformAt(s.anim, t);
    const [x0, y0, x1, y1] = s.box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pv = s.anim.pivot;
    const P = [pv === 'l' ? x0 : pv === 'r' ? x1 : cx, pv === 'b' ? y0 : pv === 't' ? y1 : cy];
    const sx = Math.abs(k.sx) < 0.002 ? 0.002 * Math.sign(k.sx || 1) : k.sx;
    const sy = Math.abs(k.sy) < 0.002 ? 0.002 * Math.sign(k.sy || 1) : k.sy;
    const r = (k.rot * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    // M = A⁻¹ R S A, avec A = diag(aspect, 1) pour tourner sans déformer
    const a = c * sx, b = (-sn * sy) / aspect, cc = sn * sx * aspect, d = c * sy;
    const tx = P[0] + k.dx - (a * P[0] + b * P[1]);
    const ty = P[1] + k.dy - (cc * P[0] + d * P[1]);
    const det = a * d - b * cc;
    const ia = d / det, ib = -b / det, ic = -cc / det, id = a / det;
    const itx = -(ia * tx + ib * ty), ity = -(ic * tx + id * ty);
    const o = u.count * 9;
    u.fwd.set([a, cc, 0, b, d, 0, tx, ty, 1], o);
    u.inv.set([ia, ic, 0, ib, id, 0, itx, ity, 1], o);
    u.ids[u.count] = s.id;
    u.scale.set([Math.abs(sx), Math.abs(sy)], u.count * 2);
    u.count++;
  }
  return u;
}
