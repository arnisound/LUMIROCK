// Détection automatique des ouvertures (fenêtres, portes) par analyse de zones sombres.
// Sans IA : rapide, gratuite, fonctionne bien sur des photos de jour où les baies sont plus sombres que la pierre.
import { Zone, uid } from '../types';
import { boxBlur, luminance } from './maps';

export function detectOpenings(img: ImageData, sensitivity = 0.5): Zone[] {
  // travail en basse résolution
  const scale = Math.min(1, 320 / img.width);
  const W = Math.max(32, Math.round(img.width * scale));
  const H = Math.max(32, Math.round(img.height * scale));
  const cv = new OffscreenCanvas(img.width, img.height);
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const small = new OffscreenCanvas(W, H);
  const sctx = small.getContext('2d')!;
  sctx.drawImage(cv, 0, 0, W, H);
  const L = luminance(sctx.getImageData(0, 0, W, H).data, W, H);
  const mean = boxBlur(Float32Array.from(L), W, H, W * 0.06, 2);
  const k = 0.88 - sensitivity * 0.2;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = L[i] < mean[i] * k && L[i] < 0.6 ? 1 : 0;
  // ouverture morphologique légère (érosion puis dilatation)
  const morph = (src: Uint8Array, erode: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = erode ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
            const s = src[yy * W + xx];
            v = erode ? v & s : v | s;
          }
        out[y * W + x] = v;
      }
    return out;
  };
  // fermeture (réunit les carreaux séparés par les meneaux) puis ouverture (retire le bruit)
  let m = dark;
  for (let i = 0; i < 2; i++) m = morph(m, false);
  for (let i = 0; i < 2; i++) m = morph(m, true);
  m = morph(morph(m, true), false);
  // composantes connexes
  const label = new Int32Array(W * H).fill(-1);
  const zones: Zone[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!m[start] || label[start] >= 0) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    stack.push(start);
    label[start] = start;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i / W) | 0;
      area++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const nb = [i - 1, i + 1, i - W, i + W];
      for (const j of nb) {
        if (j < 0 || j >= W * H) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
        if (m[j] && label[j] < 0) {
          label[j] = start;
          stack.push(j);
        }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const fill = area / (bw * bh);
    const frac = area / (W * H);
    const aspect = bw / bh;
    if (frac < 0.0006 || frac > 0.06 || fill < 0.45 || aspect < 0.18 || aspect > 4) continue;
    const x0 = minX / W, x1 = (maxX + 1) / W, y0 = minY / H, y1 = (maxY + 1) / H;
    const isDoor = y1 > 0.85 && bh / H > 0.12;
    zones.push({
      id: uid(),
      name: isDoor ? 'Porte' : 'Fenêtre',
      type: isDoor ? 'porte' : 'fenetre',
      points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    });
  }
  // fusion des rectangles qui se touchent (vitraux, baies jumelées)
  const boxes = zones.map((z) => ({ z, x0: z.points[0][0], y0: z.points[0][1], x1: z.points[2][0], y1: z.points[2][1] }));
  const gap = 0.006;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1) {
          a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
          if (b.z.type === 'porte') a.z.type = 'porte';
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  zones.length = 0;
  for (const b of boxes) {
    b.z.points = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    b.z.name = b.z.type === 'porte' ? 'Porte' : 'Fenêtre';
    zones.push(b.z);
  }
  // nommage
  zones.sort((a, b) => a.points[0][1] - b.points[0][1] || a.points[0][0] - b.points[0][0]);
  zones.forEach((z, i) => (z.name = `${z.name} ${i + 1}`));
  return zones.slice(0, 120);
}
