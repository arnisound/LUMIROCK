// Mires de calage : tracé des calques, vraies lignes de la photo, relief, grille, repères,
// étoiles de netteté, gammes de gris et de couleurs — dans la résolution du vidéoprojecteur.
import type { SceneMaps } from '../gl/renderer';
import type { Project } from '../types';
import { zoneType } from '../types';

export interface MireOptions {
  size: 'facade' | 'hd' | 'wuxga' | '4k' | 'custom';
  cw: number;
  ch: number;
  bg: 'noir' | 'blanc' | 'transparent';
  photo: number; // opacité de la photo (0 = absente)
  relief: boolean;
  reliefMode: 'ombrage' | 'altitude' | 'normales';
  reliefColor: string;
  reliefOpacity: number;
  lightAngle: number; // degrés
  edges: boolean;
  edgesColor: string;
  edgesOpacity: number;
  zones: boolean;
  zonesColorMode: 'type' | 'unique';
  zonesColor: string;
  zonesFill: boolean;
  labels: boolean;
  vertices: boolean;
  grid: boolean;
  gridCols: number;
  gridColor: string;
  gridLabels: boolean;
  gridSub: boolean;
  marks: boolean; // repères en croix sur chaque calque
  marksColor: string;
  center: boolean; // croix centrale et cercles concentriques
  frame: boolean; // cadre, équerres et diagonales de l'image projetée
  focus: boolean; // étoiles de netteté
  bars: boolean; // gammes de gris et de couleurs
  info: boolean; // cartouche
  line: number; // épaisseur générale
  realSize?: [number, number]; // taille réelle annoncée dans le cartouche (aperçu réduit)
}

export const MIRE_DEFAULT: MireOptions = {
  size: 'hd', cw: 1920, ch: 1080, bg: 'noir', photo: 0,
  relief: false, reliefMode: 'ombrage', reliefColor: '#4fc3f7', reliefOpacity: 0.8, lightAngle: 135,
  edges: true, edgesColor: '#ffffff', edgesOpacity: 0.55,
  zones: true, zonesColorMode: 'type', zonesColor: '#00ff88', zonesFill: false, labels: true, vertices: false,
  grid: true, gridCols: 16, gridColor: '#3b82f6', gridLabels: true, gridSub: false,
  marks: true, marksColor: '#ff3355', center: true, frame: true, focus: true, bars: false, info: true, line: 1,
};

export const MIRE_PRESETS: { id: string; name: string; desc: string; o: Partial<MireOptions> }[] = [
  { id: 'precis', name: 'Calage précis', desc: 'Fond noir, tracé des calques, lignes réelles, repères et grille', o: { bg: 'noir', photo: 0, relief: false, edges: true, zones: true, grid: true, gridLabels: false, marks: true, center: true, frame: true, focus: true, bars: false, labels: true } },
  { id: 'photo', name: 'Contrôle sur photo', desc: 'La façade en filigrane et le tracé par-dessus', o: { bg: 'noir', photo: 0.55, relief: false, edges: false, zones: true, grid: false, marks: true, center: false, frame: true, focus: false, labels: true } },
  { id: 'relief', name: 'Relief du bâtiment', desc: 'Ombrage du relief en couleur, avec les lignes de l’architecture', o: { bg: 'noir', photo: 0, relief: true, reliefMode: 'ombrage', edges: true, edgesOpacity: 0.4, zones: false, grid: false, marks: false, center: false, frame: true, focus: false, labels: false } },
  { id: 'lignes', name: 'Lignes seules', desc: 'Uniquement les vraies lignes de la façade, idéal pour superposer', o: { bg: 'noir', photo: 0, relief: false, edges: true, edgesOpacity: 1, zones: false, grid: false, marks: false, center: false, frame: false, focus: false, bars: false, info: false, labels: false } },
  { id: 'projecteur', name: 'Réglage projecteur', desc: 'Grille, netteté, gammes de gris et de couleurs', o: { bg: 'noir', photo: 0, relief: false, edges: false, zones: false, grid: true, gridSub: true, gridLabels: true, marks: false, center: true, frame: true, focus: true, bars: true, labels: false } },
  { id: 'blanc', name: 'Fond blanc (impression)', desc: 'Pour imprimer ou annoter', o: { bg: 'blanc', photo: 0, relief: false, edges: true, edgesColor: '#555555', zones: true, grid: true, gridColor: '#9ab', marks: true, center: true, frame: true, focus: false, bars: false } },
];

export function mireSize(o: MireOptions, scene: SceneMaps) {
  if (o.size === 'hd') return [1920, 1080];
  if (o.size === 'wuxga') return [1920, 1200];
  if (o.size === '4k') return [3840, 2160];
  if (o.size === 'custom') return [Math.max(64, Math.min(8192, Math.round(o.cw))), Math.max(64, Math.min(8192, Math.round(o.ch)))];
  const k = Math.max(1, 1920 / scene.width);
  return [Math.round(scene.width * k), Math.round(scene.height * k)];
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Image (taille de la façade) d'une couche calculée pixel par pixel. */
function layerImage(scene: SceneMaps, fn: (i: number) => [number, number, number, number]) {
  const W = scene.width, H = scene.height;
  const img = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b, a] = fn(i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  const c = new OffscreenCanvas(W, H);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

function turbo(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const r = 34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56))));
  const b = 27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66))));
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}

function siemens(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, r: number, fg: string) {
  const n = 36;
  ctx.fillStyle = fg;
  for (let i = 0; i < n; i += 2) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1, r / 40);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function cross(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, r: number, circle = true) {
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  if (circle) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Dessine la mire. `only` limite le dessin à une couche (pour les exports en couches séparées). */
export function drawMire(scene: SceneMaps, project: Project, o: MireOptions, only?: keyof MireOptions): OffscreenCanvas {
  const [CW, CH] = mireSize(o, scene);
  const cv = new OffscreenCanvas(CW, CH);
  const ctx = cv.getContext('2d')!;
  const on = (k: keyof MireOptions) => (only ? only === k : !!o[k]);
  const fgBase = o.bg === 'blanc' ? '#111' : '#fff';
  if (!only && o.bg !== 'transparent') {
    ctx.fillStyle = o.bg === 'blanc' ? '#fff' : '#000';
    ctx.fillRect(0, 0, CW, CH);
  }
  // la façade, centrée sans déformation dans l'image projetée
  const k = Math.min(CW / scene.width, CH / scene.height);
  const FW = scene.width * k, FH = scene.height * k;
  const FX = (CW - FW) / 2, FY = (CH - FH) / 2;
  const lw = (base: number) => Math.max(1, (base * o.line * Math.max(CW, CH)) / 1920);
  const W = scene.width, H = scene.height;

  if ((only ? only === 'photo' : o.photo > 0)) {
    const ph = layerImage(scene, (i) => [scene.albedo[i * 4], scene.albedo[i * 4 + 1], scene.albedo[i * 4 + 2], 255]);
    ctx.globalAlpha = only ? 1 : o.photo;
    ctx.drawImage(ph, FX, FY, FW, FH);
    ctx.globalAlpha = 1;
  }
  if (on('relief')) {
    const [cr, cg, cb] = hexRgb(o.reliefColor);
    const a = (o.lightAngle * Math.PI) / 180;
    const L = [Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.7];
    const im = layerImage(scene, (i) => {
      if (o.reliefMode === 'normales') return [scene.normal[i * 4], scene.normal[i * 4 + 1], scene.normal[i * 4 + 2], 255];
      if (o.reliefMode === 'altitude') {
        const [r, g, b] = turbo(scene.depth[i * 4] / 255);
        return [r, g, b, 255];
      }
      const nx = scene.normal[i * 4] / 127.5 - 1, ny = scene.normal[i * 4 + 1] / 127.5 - 1, nz = scene.normal[i * 4 + 2] / 127.5 - 1;
      const d = Math.max(0, nx * L[0] - ny * L[1] + nz * L[2]);
      const s = Math.pow(d, 1.6) * 1.25;
      return [Math.min(255, cr * s), Math.min(255, cg * s), Math.min(255, cb * s), 255];
    });
    ctx.globalAlpha = only ? 1 : o.reliefOpacity;
    ctx.globalCompositeOperation = o.bg === 'blanc' && !only ? 'multiply' : 'lighter';
    ctx.drawImage(im, FX, FY, FW, FH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  if (on('edges')) {
    const [r, g, b] = hexRgb(o.edgesColor);
    const im = layerImage(scene, (i) => [r, g, b, Math.min(255, scene.edges[i * 4] * 1.4)]);
    ctx.globalAlpha = only ? 1 : o.edgesOpacity;
    ctx.drawImage(im, FX, FY, FW, FH);
    ctx.globalAlpha = 1;
  }
  const P = (x: number, y: number): [number, number] => [FX + x * FW, FY + y * FH];
  if (on('grid')) {
    const cols = Math.max(2, Math.round(o.gridCols));
    const step = FW / cols;
    const rows = Math.max(1, Math.round(FH / step));
    const sy = FH / rows;
    if (o.gridSub) {
      ctx.strokeStyle = o.gridColor + '55';
      ctx.lineWidth = lw(0.6);
      ctx.beginPath();
      for (let i = 0; i < cols * 4; i++) {
        const x = FX + (i * step) / 4;
        ctx.moveTo(x, FY);
        ctx.lineTo(x, FY + FH);
      }
      for (let j = 0; j < rows * 4; j++) {
        const y = FY + (j * sy) / 4;
        ctx.moveTo(FX, y);
        ctx.lineTo(FX + FW, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = o.gridColor;
    ctx.lineWidth = lw(1.2);
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      ctx.moveTo(FX + i * step, FY);
      ctx.lineTo(FX + i * step, FY + FH);
    }
    for (let j = 0; j <= rows; j++) {
      ctx.moveTo(FX, FY + j * sy);
      ctx.lineTo(FX + FW, FY + j * sy);
    }
    ctx.stroke();
    if (o.gridLabels) {
      ctx.fillStyle = o.gridColor;
      ctx.font = `600 ${Math.max(9, Math.round(Math.min(step, sy) * 0.22))}px Inter, sans-serif`;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const lab = `${String.fromCharCode(65 + (j % 26))}${i + 1}`;
        ctx.fillText(lab, FX + i * step + step * 0.08, FY + j * sy + sy * 0.28);
      }
    }
  }
  if (on('zones')) {
    ctx.lineJoin = 'round';
    project.zones.forEach((z) => {
      if (z.type === 'exclure') return;
      const col = o.zonesColorMode === 'type' ? (z.type === 'silhouette' ? fgBase : zoneType(z.type).color) : o.zonesColor;
      ctx.beginPath();
      z.points.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y))));
      ctx.closePath();
      if (o.zonesFill && z.type !== 'silhouette') {
        ctx.fillStyle = col + '33';
        ctx.fill();
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = lw(z.type === 'silhouette' ? 3 : 2);
      ctx.stroke();
      if (o.vertices) {
        ctx.fillStyle = col;
        for (const [x, y] of z.points) {
          ctx.beginPath();
          ctx.arc(...P(x, y), lw(3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    if (o.labels) {
      const fs = Math.max(10, Math.round(Math.min(FW, FH) / 55));
      ctx.font = `700 ${fs}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      project.zones.forEach((z, n) => {
        if (z.type === 'exclure' || z.type === 'silhouette') return;
        const xs = z.points.map((p) => p[0]), ys = z.points.map((p) => p[1]);
        const [x, y] = P((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
        const txt = String(n + 1);
        const tw = ctx.measureText(txt).width + fs * 0.6;
        ctx.fillStyle = o.bg === 'blanc' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - tw / 2, y - fs * 0.7, tw, fs * 1.4);
        ctx.fillStyle = o.zonesColorMode === 'type' ? zoneType(z.type).color : o.zonesColor;
        ctx.fillText(txt, x, y + 1);
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }
  if (on('marks')) {
    ctx.strokeStyle = o.marksColor;
    ctx.lineWidth = lw(1.5);
    for (const z of project.zones) {
      if (z.type === 'exclure' || z.type === 'silhouette') continue;
      const xs = z.points.map((p) => p[0]), ys = z.points.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const [cx, cy] = P((x0 + x1) / 2, (y0 + y1) / 2);
      cross(ctx, cx, cy, Math.max(lw(8), Math.min((x1 - x0) * FW, (y1 - y0) * FH) * 0.18));
      // équerres aux 4 coins du calque
      const t = Math.max(lw(6), Math.min((x1 - x0) * FW, (y1 - y0) * FH) * 0.15);
      for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]] as const) {
        const [X, Y] = P(px, py);
        ctx.beginPath();
        ctx.moveTo(X + sx * t, Y);
        ctx.lineTo(X, Y);
        ctx.lineTo(X, Y + sy * t);
        ctx.stroke();
      }
    }
  }
  if (on('center')) {
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = lw(1.5);
    ctx.beginPath();
    ctx.moveTo(CW / 2, 0);
    ctx.lineTo(CW / 2, CH);
    ctx.moveTo(0, CH / 2);
    ctx.lineTo(CW, CH / 2);
    ctx.stroke();
    for (const f of [0.08, 0.18, 0.3, 0.45]) {
      ctx.beginPath();
      ctx.arc(CW / 2, CH / 2, Math.min(CW, CH) * f, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (on('frame')) {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = lw(2);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, CW - ctx.lineWidth, CH - ctx.lineWidth);
    ctx.strokeStyle = '#00ff8866';
    ctx.lineWidth = lw(1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(CW, CH);
    ctx.moveTo(CW, 0);
    ctx.lineTo(0, CH);
    ctx.stroke();
    // cadre de la façade
    ctx.strokeStyle = '#ffd34d';
    ctx.setLineDash([lw(10), lw(6)]);
    ctx.strokeRect(FX, FY, FW, FH);
    ctx.setLineDash([]);
    // flèches du haut (orientation)
    ctx.fillStyle = '#00ff88';
    const a = Math.min(CW, CH) * 0.03;
    ctx.beginPath();
    ctx.moveTo(CW / 2, a * 0.4);
    ctx.lineTo(CW / 2 - a, a * 1.6);
    ctx.lineTo(CW / 2 + a, a * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.font = `700 ${Math.round(a * 0.8)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('HAUT', CW / 2, a * 2.6);
    ctx.textAlign = 'left';
  }
  if (on('focus')) {
    const r = Math.min(CW, CH) * 0.06;
    const fg = o.bg === 'blanc' ? '#000' : '#fff';
    for (const [x, y] of [[CW / 2, CH / 2], [r * 1.6, r * 1.6], [CW - r * 1.6, r * 1.6], [r * 1.6, CH - r * 1.6], [CW - r * 1.6, CH - r * 1.6]]) siemens(ctx, x, y, r, fg);
  }
  if (on('bars')) {
    const bh = CH * 0.05, bw = CW * 0.4;
    const x0 = (CW - bw) / 2, y0 = CH - bh * 2.6;
    for (let i = 0; i < 11; i++) {
      const v = Math.round((i / 10) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x0 + (i * bw) / 11, y0, bw / 11 + 1, bh);
    }
    ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#ffffff'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x0 + (i * bw) / 7, y0 + bh, bw / 7 + 1, bh);
    });
  }
  if (on('info')) {
    const fs = Math.max(11, Math.round(Math.min(CW, CH) / 60));
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    const lines = [`LUMIROCK — ${project.name || 'Projet'}`, `Image ${o.realSize?.[0] ?? CW} × ${o.realSize?.[1] ?? CH} px · façade ${Math.round(FW * (o.realSize ? o.realSize[0] / CW : 1))} × ${Math.round(FH * (o.realSize ? o.realSize[0] / CW : 1))} px (ratio ${(scene.width / scene.height).toFixed(3)})`, `${project.zones.length} calques · ${new Date().toLocaleDateString('fr-FR')}`];
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs;
    ctx.fillStyle = o.bg === 'blanc' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(fs * 0.6, CH - fs * 4.8, bw, fs * 4.2);
    ctx.fillStyle = o.bg === 'blanc' ? '#222' : '#cfe3ff';
    lines.forEach((l, i) => ctx.fillText(l, fs * 1.1, CH - fs * 3.5 + i * fs * 1.25));
  }
  void W;
  void H;
  return cv;
}

/** Couches séparées (fond transparent) pour les superposer dans MadMapper, Resolume, Millumin… */
export const MIRE_LAYERS: { key: keyof MireOptions; file: string }[] = [
  { key: 'photo', file: 'couche_photo.png' },
  { key: 'relief', file: 'couche_relief.png' },
  { key: 'edges', file: 'couche_lignes_photo.png' },
  { key: 'zones', file: 'couche_trace_calques.png' },
  { key: 'grid', file: 'couche_grille.png' },
  { key: 'marks', file: 'couche_reperes_calques.png' },
  { key: 'center', file: 'couche_centre.png' },
  { key: 'frame', file: 'couche_cadre.png' },
  { key: 'focus', file: 'couche_nettete.png' },
  { key: 'bars', file: 'couche_gammes.png' },
];
