// Détourage en un clic par IA (SlimSAM, dérivé de Segment Anything, licence Apache 2.0).
// Tout tourne dans le navigateur ; le modèle est téléchargé une seule fois.
import type { Pt } from '../types';

const MODEL = 'Xenova/slimsam-77-uniform';

let loading: Promise<{ model: any; processor: any; T: any }> | null = null;
let cache: { key: string; raw: any; emb: any } | null = null;

async function load(onProgress?: (msg: string, r?: number) => void) {
  if (!loading) {
    loading = (async () => {
      const T = await import('@huggingface/transformers');
      T.env.allowLocalModels = false;
      let device: 'webgpu' | 'wasm' = 'wasm';
      try {
        if (await (navigator as any).gpu?.requestAdapter()) device = 'webgpu';
      } catch {
        device = 'wasm';
      }
      onProgress?.('Chargement du modèle de détourage…', 0);
      const progress_callback = (p: any) => {
        if (p.status === 'progress' && p.total) onProgress?.('Téléchargement du modèle de détourage…', p.loaded / p.total);
      };
      const tryLoad = (d: 'webgpu' | 'wasm') => T.SamModel.from_pretrained(MODEL, { device: d, dtype: 'fp32', progress_callback } as any);
      const model = await (device === 'webgpu' ? tryLoad('webgpu').catch(() => tryLoad('wasm')) : tryLoad('wasm'));
      const processor = await T.AutoProcessor.from_pretrained(MODEL);
      return { model, processor, T };
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Prépare l'analyse d'une image (calcul des « empreintes », une seule fois par façade). */
export async function prepareSegmentation(img: ImageData, key: string, onProgress?: (msg: string, r?: number) => void) {
  const { model, processor, T } = await load(onProgress);
  if (cache?.key === key) return;
  onProgress?.('Analyse de la façade par l’IA…', 1);
  const raw = new T.RawImage(new Uint8ClampedArray(img.data), img.width, img.height, 4).rgb();
  const inputs = await processor(raw);
  const emb = await model.get_image_embeddings(inputs);
  cache = { key, raw, emb };
}

/** Renvoie le contour (coordonnées normalisées) de l'élément cliqué en p (0..1). */
export async function segmentAt(img: ImageData, key: string, p: Pt, onProgress?: (msg: string, r?: number) => void, detail = false): Promise<Pt[] | null> {
  await prepareSegmentation(img, key, onProgress);
  const { model, processor } = await load();
  const W = img.width, H = img.height;
  const inputs = await processor(cache!.raw, { input_points: [[[p[0] * W, p[1] * H]]], input_labels: [[1]] });
  const out = await model({ ...cache!.emb, input_points: inputs.input_points, input_labels: inputs.input_labels });
  const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const m = masks[0]; // [1, 3, H, W]
  const scores: Float32Array = out.iou_scores.data;
  const mh = m.dims[2], mw = m.dims[3];
  // SAM propose 3 masques (détail, élément, ensemble) : on garde le plus grand parmi les plus fiables,
  // sans prendre « toute la façade ». Alt+clic = le détail.
  const areas = [0, 1, 2].map((k) => {
    let a = 0;
    const off = k * mw * mh;
    for (let i = 0; i < mw * mh; i += 7) a += m.data[off + i] ? 1 : 0;
    return (a * 7) / (mw * mh);
  });
  const top = Math.max(...scores);
  let best = 0;
  let pick = detail ? Infinity : -1;
  for (let k = 0; k < 3; k++) {
    if (scores[k] < top - 0.12 || areas[k] > 0.35 || areas[k] <= 0) continue;
    if (detail ? areas[k] < pick : areas[k] > pick) {
      pick = areas[k];
      best = k;
    }
  }
  const data: Uint8Array = m.data.subarray(best * mw * mh, (best + 1) * mw * mh);
  return maskToPolygon(data, mw, mh, p);
}

/** Masque binaire -> polygone simplifié (composante contenant le clic). */
export function maskToPolygon(mask: Uint8Array, W: number, H: number, click: Pt): Pt[] | null {
  // réduction pour un tracé rapide
  const s = Math.min(1, 480 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)), hh = Math.max(8, Math.round(H * s));
  const g = new Uint8Array(w * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = mask[Math.min(H - 1, Math.floor((y + 0.5) / s)) * W + Math.min(W - 1, Math.floor((x + 0.5) / s))] ? 1 : 0;
  // composante connexe contenant le clic (ou la plus proche)
  let sx = Math.min(w - 1, Math.floor(click[0] * w)), sy = Math.min(hh - 1, Math.floor(click[1] * hh));
  if (!g[sy * w + sx]) {
    let bd = Infinity;
    for (let i = 0; i < w * hh; i++)
      if (g[i]) {
        const d = (i % w - sx) ** 2 + (((i / w) | 0) - sy) ** 2;
        if (d < bd) {
          bd = d;
          sx = i % w;
          sy = (i / w) | 0;
        }
      }
    if (bd === Infinity) return null;
  }
  const comp = new Uint8Array(w * hh);
  const st = [sy * w + sx];
  comp[st[0]] = 1;
  while (st.length) {
    const i = st.pop()!;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= hh) continue;
      const j = ny * w + nx;
      if (g[j] && !comp[j]) {
        comp[j] = 1;
        st.push(j);
      }
    }
  }
  // point de départ : premier pixel de la composante (balayage)
  let start = -1;
  for (let i = 0; i < w * hh; i++)
    if (comp[i]) {
      start = i;
      break;
    }
  if (start < 0) return null;
  // suivi de contour (voisinage de Moore)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < hh && comp[y * w + x] === 1;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let cx = start % w, cy = (start / w) | 0;
  const sx0 = cx, sy0 = cy;
  let dir = 6;
  const pts: Pt[] = [];
  for (let iter = 0; iter < w * hh * 2; iter++) {
    pts.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (inside(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx0 && cy === sy0 && pts.length > 2)) break;
  }
  if (pts.length < 3) return null;
  const simple = simplify(pts, 1.1);
  return simple.map(([x, y]) => [(x + 0.5) / w, (y + 0.5) / hh] as Pt);
}

function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
