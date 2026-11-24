// Détection automatique des ouvertures (fenêtres, portes) par analyse de zones sombres.
// Sans IA : rapide, gratuite, fonctionne bien sur des photos de jour où les baies sont plus sombres que la pierre.
import { Pt, Zone, uid } from '../types';
import { boxBlur, luminance } from './maps';

export function detectOpenings(img: ImageData, sensitivity = 0.5, bounds: Pt[] | null = null, strict = true): Zone[] {
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
  // filtre de répétition : une vraie fenêtre a presque toujours une « sœur » de même taille,
  // sur la même rangée ou la même colonne (les ombres, arbres et taches n'en ont pas)
  const kept = boxes.filter((a, i) => {
    const aw = a.x1 - a.x0, ah = a.y1 - a.y0, acx = (a.x0 + a.x1) / 2, acy = (a.y0 + a.y1) / 2;
    if (bounds && !inPoly([acx, acy], bounds)) return false;
    const isDoor = a.y1 > 0.85 && ah > 0.12;
    if (isDoor && strict) return true;
    return boxes.some((b, j) => {
      if (i === j) return false;
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      const similar = Math.abs(bw - aw) < 0.3 * Math.max(aw, bw) && Math.abs(bh - ah) < 0.3 * Math.max(ah, bh);
      const aligned = Math.abs((b.y0 + b.y1) / 2 - acy) < 0.35 * ah || Math.abs((b.x0 + b.x1) / 2 - acx) < 0.35 * aw;
      return similar && aligned;
    }) || !strict;
  });
  boxes.length = 0;
  boxes.push(...kept);
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

function inPoly(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ───────────────────────── Recherche des éléments identiques ─────────────────────────
// À partir d'un calque exemple (une fenêtre bien détourée), on cherche dans la photo les endroits
// qui lui ressemblent (corrélation normalisée sur l'image et ses contours), puis on y copie la forme.

function grayAt(img: ImageData, W: number, H: number) {
  const cv = new OffscreenCanvas(img.width, img.height);
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const small = new OffscreenCanvas(W, H);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, W, H);
  const L = luminance(ctx.getImageData(0, 0, W, H).data, W, H);
  // contours (gradient) pour être robuste aux différences d'éclairage
  const G = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      G[i] = Math.hypot(L[i + 1] - L[i - 1], L[i + W] - L[i - W]);
    }
  return { L, G };
}

function integral(a: Float32Array, W: number, H: number) {
  const S = new Float64Array((W + 1) * (H + 1)), Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < W; x++) {
      const v = a[y * W + x];
      rs += v;
      rq += v * v;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs;
      Q[(y + 1) * (W + 1) + x + 1] = Q[y * (W + 1) + x + 1] + rq;
    }
  }
  return { S, Q };
}

/** Corrélation normalisée du gabarit T (tw×th) placé en (x, y) dans A. */
function nccMap(A: Float32Array, W: number, H: number, T: Float32Array, tw: number, th: number, yA = 0, yB = H - th) {
  const { S, Q } = integral(A, W, H);
  const n = tw * th;
  let tm = 0;
  for (let i = 0; i < n; i++) tm += T[i];
  tm /= n;
  let tv = 0;
  const Tc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Tc[i] = T[i] - tm;
    tv += Tc[i] * Tc[i];
  }
  const ts = Math.sqrt(tv) || 1e-6;
  const out = new Float32Array(W * H).fill(-1);
  const W1 = W + 1;
  for (let y = Math.max(0, yA); y <= Math.min(H - th, yB); y++)
    for (let x = 0; x + tw <= W; x++) {
      const a = y * W1 + x, b = a + tw, c = a + th * W1, d = c + tw;
      const sum = S[d] - S[b] - S[c] + S[a];
      const sq = Q[d] - Q[b] - Q[c] + Q[a];
      const varI = sq - (sum * sum) / n;
      if (varI < 1e-6) continue;
      let cr = 0;
      for (let j = 0; j < th; j++) {
        const ro = (y + j) * W + x, to = j * tw;
        for (let i = 0; i < tw; i++) cr += A[ro + i] * Tc[to + i];
      }
      out[y * W + x] = cr / (ts * Math.sqrt(varI));
    }
  return out;
}

function bbox(pts: Pt[]) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function iou(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter || 1);
}

/** Trouve les éléments semblables au calque `ref` et renvoie les nouveaux calques. */
export function findSimilar(img: ImageData, ref: Zone, existing: Zone[], sensitivity = 0.5, scope: 'row' | 'all' = 'row'): Zone[] {
  const rb = bbox(ref.points);
  // résolution adaptée à la taille de l'exemple (au moins ~22 px de large pour le gabarit)
  const want = Math.round(22 / Math.max(0.005, rb.x1 - rb.x0));
  const W = Math.min(img.width, Math.max(360, Math.min(scope === 'row' ? 1400 : 900, want)));
  const H = Math.round((W * img.height) / img.width);
  const { L, G } = grayAt(img, W, H);
  const thr = scope === 'row' ? 0.42 - sensitivity * 0.3 : 0.5 - sensitivity * 0.3;
  const rowY0 = rb.y0 - (rb.y1 - rb.y0) * 0.25, rowY1 = rb.y1 + (rb.y1 - rb.y0) * 0.25;
  type Hit = { x: number; y: number; s: number; score: number };
  const hits: Hit[] = [];
  // apparence (luminosité moyenne et contraste intérieurs) : distingue une fenêtre sombre d'une niche en pierre claire
  const LI = integral(L, W, H);
  const stats = (x: number, y: number, w: number, h: number) => {
    const W1 = W + 1;
    const x0 = Math.max(0, Math.min(W, x)), y0 = Math.max(0, Math.min(H, y)), x1 = Math.max(0, Math.min(W, x + w)), y1 = Math.max(0, Math.min(H, y + h));
    const n = Math.max(1, (x1 - x0) * (y1 - y0));
    const a = y0 * W1 + x0, b = y0 * W1 + x1, c = y1 * W1 + x0, d = y1 * W1 + x1;
    const m = (LI.S[d] - LI.S[b] - LI.S[c] + LI.S[a]) / n;
    const q = (LI.Q[d] - LI.Q[b] - LI.Q[c] + LI.Q[a]) / n;
    return { m, sd: Math.sqrt(Math.max(0, q - m * m)) };
  };
  const refStats = stats(Math.round(rb.x0 * W), Math.round(rb.y0 * H), Math.round((rb.x1 - rb.x0) * W), Math.round((rb.y1 - rb.y0) * H));
  for (const sc of [0.88, 1, 1.12]) {
    const tw = Math.max(5, Math.round((rb.x1 - rb.x0) * W * sc)), th = Math.max(5, Math.round((rb.y1 - rb.y0) * H * sc));
    if (tw >= W - 2 || th >= H - 2) continue;
    // gabarit extrait autour du centre de l'exemple, à l'échelle testée
    const cx = ((rb.x0 + rb.x1) / 2) * W, cy = ((rb.y0 + rb.y1) / 2) * H;
    const ox = Math.round(cx - tw / 2), oy = Math.round(cy - th / 2);
    const TL = new Float32Array(tw * th), TG = new Float32Array(tw * th);
    for (let j = 0; j < th; j++)
      for (let i = 0; i < tw; i++) {
        const sx = Math.min(W - 1, Math.max(0, Math.round(cx + (ox + i - cx) / sc))), sy = Math.min(H - 1, Math.max(0, Math.round(cy + (oy + j - cy) / sc)));
        TL[j * tw + i] = L[sy * W + sx];
        TG[j * tw + i] = G[sy * W + sx];
      }
    const bandA = scope === 'row' ? Math.max(0, Math.floor(rowY0 * H) - 3) : 0;
    const bandB = scope === 'row' ? Math.ceil(rowY1 * H) + 3 : H;
    const m1 = nccMap(L, W, H, TL, tw, th, bandA, bandB);
    const m2 = nccMap(G, W, H, TG, tw, th, bandA, bandB);
    const yA = scope === 'row' ? Math.max(0, Math.floor(rowY0 * H)) : 0;
    const yB = scope === 'row' ? Math.min(H - th, Math.ceil(rowY1 * H) - th) : H - th;
    for (let y = yA; y <= yB; y++)
      for (let x = 0; x + tw <= W; x++) {
        const v = 0.6 * m1[y * W + x] + 0.4 * m2[y * W + x];
        if (v < thr - 0.3) continue;
        // maximum local
        let best = true;
        for (let dy = -2; dy <= 2 && best; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx + tw > W || yy + th > H || (!dx && !dy)) continue;
            if (0.6 * m1[yy * W + xx] + 0.4 * m2[yy * W + xx] > v) {
              best = false;
              break;
            }
          }
        if (best) {
          const st = stats(x, y, tw, th);
          const look = Math.abs(st.m - refStats.m) * 2.2 + Math.abs(st.sd - refStats.sd) * 1.2;
          hits.push({ x: (x + tw / 2) / W, y: (y + th / 2) / H, s: sc, score: v - look });
        }
      }
  }
  hits.sort((a, b) => b.score - a.score);
  const rcx = (rb.x0 + rb.x1) / 2, rcy = (rb.y0 + rb.y1) / 2;
  const rw = rb.x1 - rb.x0, rh = rb.y1 - rb.y0;
  const taken = [...existing.filter((z) => z.type !== 'silhouette' && z.type !== 'exclure').map((z) => bbox(z.points))];
  const out: Zone[] = [];
  // les façades répètent leurs éléments en rangées et en colonnes : un candidat aligné sur
  // l'exemple ou sur un élément déjà trouvé est accepté avec une ressemblance un peu plus faible
  const anchors: { x: number; y: number }[] = [{ x: rcx, y: rcy }];
  // même rangée : bonus fort ; même colonne : bonus faible (souvent un autre type d'élément à l'étage du dessous)
  const bonus = (h: { x: number; y: number }) => anchors.some((a) => Math.abs(a.y - h.y) < rh * 0.22) ? 0.12 : anchors.some((a) => Math.abs(a.x - h.x) < rw * 0.15) ? 0.03 : 0;
  for (let pass = 0; pass < 2; pass++)
  for (const hit of hits) {
    if ((hit as { used?: boolean }).used) continue;
    const need = scope === 'row' ? thr : thr - bonus(hit);
    if (hit.score < need || (pass === 0 && hit.score < thr)) continue;
    const pts = ref.points.map(([x, y]) => [hit.x + (x - rcx) * hit.s, hit.y + (y - rcy) * hit.s] as Pt);
    const bb = bbox(pts);
    if (bb.x0 < 0 || bb.y0 < 0 || bb.x1 > 1 || bb.y1 > 1) continue;
    // deux éléments ne se chevauchent pas : on refuse tout recouvrement notable
    const overlap = (t: typeof bb) => Math.max(0, Math.min(t.x1, bb.x1) - Math.max(t.x0, bb.x0)) * Math.max(0, Math.min(t.y1, bb.y1) - Math.max(t.y0, bb.y0));
    if (taken.some((t) => overlap(t) > 0.12 * Math.min((t.x1 - t.x0) * (t.y1 - t.y0), (bb.x1 - bb.x0) * (bb.y1 - bb.y0)) || iou(t, bb) > 0.2)) continue;
    taken.push(bb);
    (hit as { used?: boolean }).used = true;
    anchors.push({ x: hit.x, y: hit.y });
    out.push({ id: uid(), name: `${ref.name.replace(/\s*\d+$/, '')} ${out.length + 2}`, type: ref.type, points: pts, relief: ref.relief });
    if (out.length >= 150) break;
  }
  return out;
}
