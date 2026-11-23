// Redressement de perspective (homographie) : 4 coins -> rectangle.
import type { Pt } from '../types';
import { MAX_WORK } from './maps';

/** Résout l'homographie qui envoie src[i] -> dst[i] (4 correspondances). */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // élimination de Gauss avec pivot partiel
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Taille de sortie conseillée pour un quadrilatère (coordonnées pixel). */
export function rectifiedSize(quad: Pt[]) {
  const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const s = Math.min(1, MAX_WORK / Math.max(w, h));
  return { width: Math.max(64, Math.round(w * s)), height: Math.max(64, Math.round(h * s)) };
}

/**
 * Redresse l'image : quad = coins (haut-gauche, haut-droit, bas-droit, bas-gauche) en coordonnées normalisées 0..1.
 */
export function rectify(src: ImageData, quadN: Pt[], aspect?: number): ImageData {
  const SW = src.width, SH = src.height;
  const quad = quadN.map(([x, y]) => [x * SW, y * SH] as Pt);
  let { width: W, height: H } = rectifiedSize(quad);
  if (aspect && aspect > 0.05 && aspect < 20) {
    const long = Math.max(W, H);
    if (aspect >= 1) {
      W = long;
      H = Math.round(long / aspect);
    } else {
      H = long;
      W = Math.round(long * aspect);
    }
  }
  const dstRect: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const h = homography(dstRect, quad);
  const out = new ImageData(W, H);
  const s = src.data, o = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const w = h[6] * X + h[7] * Y + h[8];
      let sx = (h[0] * X + h[1] * Y + h[2]) / w - 0.5;
      let sy = (h[3] * X + h[4] * Y + h[5]) / w - 0.5;
      sx = Math.max(0, Math.min(SW - 1.001, sx));
      sy = Math.max(0, Math.min(SH - 1.001, sy));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      const di = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = s[i00 + c] * (1 - fx) + s[i10 + c] * fx;
        const b = s[i01 + c] * (1 - fx) + s[i11 + c] * fx;
        o[di + c] = a * (1 - fy) + b * fy;
      }
      o[di + 3] = 255;
    }
  }
  return out;
}

/** Redimensionne simplement une image pour la résolution de travail. */
export function fitToWork(img: CanvasImageSource & { width: number; height: number }): ImageData {
  const s = Math.min(1, MAX_WORK / Math.max(img.width, img.height));
  const W = Math.max(16, Math.round(img.width * s));
  const H = Math.max(16, Math.round(img.height * s));
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}
