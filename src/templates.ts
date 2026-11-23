// Monuments modèles générés procéduralement, avec leurs calques déjà préparés.
// Ils permettent de tester Lumirock sans photo, et servent de « calques prédéfinis ».
import { Pt, Zone, ZoneTypeKey, uid } from './types';

type Poly = Pt[];
type Ctx = OffscreenCanvasRenderingContext2D;

export interface TemplateResult {
  name: string;
  image: ImageData;
  zones: Zone[];
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build: () => TemplateResult;
}

// ───────────── géométrie ─────────────
const rectP = (x: number, y: number, w: number, h: number): Poly => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function circleP(cx: number, cy: number, r: number, n = 64): Poly {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as Pt);
}
/** Arc brisé (gothique) : x,y = coin haut-gauche de la boîte, apex en haut. */
function pointedArchP(x: number, y: number, w: number, h: number, n = 20): Poly {
  const r = w; // rayon des deux arcs = largeur (arc équilatéral)
  const springY = y + Math.min(h, w * 0.866);
  const pts: Poly = [[x, y + h], [x, springY]];
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * (Math.PI / 3);
    pts.push([x + w - Math.cos(a) * r, springY - Math.sin(a) * r * ((springY - y) / (r * 0.866))]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const a = (i / n) * (Math.PI / 3);
    pts.push([x + Math.cos(a) * r, springY - Math.sin(a) * r * ((springY - y) / (r * 0.866))]);
  }
  pts.push([x + w, springY], [x + w, y + h]);
  return pts;
}
/** Arc en plein cintre : x,y = coin haut-gauche de la boîte. */
function roundArchP(x: number, y: number, w: number, h: number, n = 24): Poly {
  const r = w / 2;
  const pts: Poly = [[x, y + h], [x, y + r]];
  for (let i = 1; i < n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push([x + r + Math.cos(a) * r, y + r + Math.sin(a) * r]);
  }
  pts.push([x + w, y + r], [x + w, y + h]);
  return pts;
}

function path(ctx: Ctx, p: Poly) {
  ctx.beginPath();
  p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}
function bbox(p: Poly) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ───────────── rendu « pierre » ─────────────
class Painter {
  ctx: Ctx;
  cv: OffscreenCanvas;
  zones: Zone[] = [];
  constructor(public W: number, public H: number) {
    this.cv = new OffscreenCanvas(W, H);
    this.ctx = this.cv.getContext('2d')!;
  }
  zone(name: string, type: ZoneTypeKey, p: Poly) {
    this.zones.push({ id: uid(), name, type, points: p.map(([x, y]) => [x / this.W, y / this.H] as Pt) });
  }
  sky(top: string, bottom: string) {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.W, this.H);
  }
  ground(y: number) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, y, 0, this.H);
    g.addColorStop(0, '#8c8780');
    g.addColorStop(1, '#6e6a64');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.W, this.H - y);
    ctx.strokeStyle = 'rgba(40,35,30,0.25)';
    ctx.lineWidth = 1.5;
    for (let yy = y + 14; yy < this.H; yy += 18 + (yy - y) * 0.08) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(this.W, yy);
      ctx.stroke();
    }
  }
  /** Mur en pierre de taille, avec joints. */
  wall(p: Poly, color: string, course = 34, joint = 'rgba(70,58,40,0.28)') {
    const ctx = this.ctx;
    ctx.save();
    path(ctx, p);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.clip();
    const b = bbox(p);
    ctx.strokeStyle = joint;
    ctx.lineWidth = 1.6;
    let row = 0;
    for (let y = b.y1; y > b.y0 - course; y -= course, row++) {
      ctx.beginPath();
      ctx.moveTo(b.x0, y);
      ctx.lineTo(b.x1, y);
      ctx.stroke();
      const bw = course * (2 + (row % 3) * 0.25);
      for (let x = b.x0 + ((row % 2) * bw) / 2; x < b.x1; x += bw) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - course);
        ctx.stroke();
      }
    }
    // variations de teinte par pierre
    for (let i = 0; i < ((b.x1 - b.x0) * (b.y1 - b.y0)) / 2500; i++) {
      const x = b.x0 + Math.random() * (b.x1 - b.x0);
      const y = b.y0 + Math.random() * (b.y1 - b.y0);
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,245,220,0.06)' : 'rgba(60,45,25,0.06)';
      ctx.fillRect(x - course, y - course / 2, course * 2, course);
    }
    ctx.restore();
  }
  /** Volume en saillie : ombre portée + face éclairée. */
  raised(p: Poly, color: string, depth = 8) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(20,15,10,0.45)';
    ctx.shadowBlur = depth * 1.6;
    ctx.shadowOffsetX = depth * 0.6;
    ctx.shadowOffsetY = depth * 0.8;
    path(ctx, p);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.save();
    path(ctx, p);
    ctx.clip();
    const b = bbox(p);
    const g = ctx.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
    g.addColorStop(0, 'rgba(255,250,235,0.18)');
    g.addColorStop(1, 'rgba(40,30,20,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
  }
  /** Ouverture en creux (fenêtre, porte). */
  recess(p: Poly, inner = '#1b1a1f', frame = 'rgba(40,30,20,0.55)') {
    const ctx = this.ctx;
    const b = bbox(p);
    ctx.save();
    path(ctx, p);
    const g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
    g.addColorStop(0, inner);
    g.addColorStop(1, shade(inner, 18));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // ombre intérieure (ébrasement)
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.25;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    path(ctx, p);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = frame;
    path(ctx, p);
    ctx.stroke();
  }
  glass(p: Poly, mullions = 1, transoms = 3) {
    const ctx = this.ctx;
    const b = bbox(p);
    this.recess(p, '#232a35');
    ctx.save();
    path(ctx, p);
    ctx.clip();
    const g = ctx.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
    g.addColorStop(0, 'rgba(160,185,210,0.28)');
    g.addColorStop(0.5, 'rgba(60,75,95,0.1)');
    g.addColorStop(1, 'rgba(160,185,210,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.strokeStyle = 'rgba(205,195,170,0.85)';
    ctx.lineWidth = Math.max(2, (b.x1 - b.x0) * 0.04);
    for (let i = 1; i <= mullions; i++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / (mullions + 1);
      ctx.beginPath();
      ctx.moveTo(x, b.y0);
      ctx.lineTo(x, b.y1);
      ctx.stroke();
    }
    for (let i = 1; i <= transoms; i++) {
      const y = b.y0 + ((b.y1 - b.y0) * i) / (transoms + 1);
      ctx.beginPath();
      ctx.moveTo(b.x0, y);
      ctx.lineTo(b.x1, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  door(p: Poly, wood = '#4a2f1f') {
    const ctx = this.ctx;
    const b = bbox(p);
    this.recess(p, '#120d0b');
    const inset = (b.x1 - b.x0) * 0.08;
    const inner = p.map(([x, y]) => [x + (x < (b.x0 + b.x1) / 2 ? inset : -inset), y < b.y1 - 1 ? y + inset : y] as Pt);
    ctx.save();
    path(ctx, inner);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let x = b.x0; x < b.x1; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, b.y0);
      ctx.lineTo(x, b.y1);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo((b.x0 + b.x1) / 2, b.y0);
    ctx.lineTo((b.x0 + b.x1) / 2, b.y1);
    ctx.stroke();
    ctx.fillStyle = '#20150e';
    for (const fy of [0.35, 0.75]) ctx.fillRect(b.x0, b.y0 + (b.y1 - b.y0) * fy, b.x1 - b.x0, 6);
    ctx.restore();
  }
  roof(p: Poly, color = '#5b6270') {
    const ctx = this.ctx;
    const b = bbox(p);
    ctx.save();
    path(ctx, p);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.2;
    for (let y = b.y0; y < b.y1; y += 10) {
      ctx.beginPath();
      ctx.moveTo(b.x0, y);
      ctx.lineTo(b.x1, y);
      ctx.stroke();
      for (let x = b.x0 + ((y / 10) % 2) * 7; x < b.x1; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
      }
    }
    const g = ctx.createLinearGradient(b.x0, 0, b.x1, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
  }
  rosace(cx: number, cy: number, r: number) {
    const ctx = this.ctx;
    this.raised(circleP(cx, cy, r * 1.12), '#c4b593', 10);
    this.recess(circleP(cx, cy, r), '#1d2233');
    ctx.save();
    path(ctx, circleP(cx, cy, r));
    ctx.clip();
    ctx.strokeStyle = '#cbbd9b';
    ctx.lineWidth = r * 0.035;
    const petals = 12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a + Math.PI / petals) * r * 0.66, cy + Math.sin(a + Math.PI / petals) * r * 0.66, r * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a + Math.PI / petals) * r * 0.9, cy + Math.sin(a + Math.PI / petals) * r * 0.9, r * 0.09, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#cbbd9b';
    ctx.fill();
    ctx.restore();
  }
  statue(x: number, y: number, w: number, h: number, color = '#bfb092') {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.12, w * 0.17, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y + h * 0.22);
    ctx.lineTo(x + w * 0.72, y + h * 0.22);
    ctx.lineTo(x + w * 0.85, y + h);
    ctx.lineTo(x + w * 0.15, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  /** Patine globale : bruit, salissures verticales, grain. */
  weather() {
    const { W, H, ctx } = this;
    const layer = (cell: number, alpha: number, mode: GlobalCompositeOperation) => {
      const w = Math.max(2, Math.ceil(W / cell)), h = Math.max(2, Math.ceil(H / cell));
      const n = new OffscreenCanvas(w, h);
      const nctx = n.getContext('2d')!;
      const id = nctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = Math.random() * 255;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = 255;
      }
      nctx.putImageData(id, 0, 0);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = mode;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(n, 0, 0, W, H);
      ctx.restore();
    };
    layer(90, 0.22, 'overlay');
    layer(24, 0.18, 'overlay');
    layer(6, 0.12, 'overlay');
    layer(1.5, 0.08, 'overlay');
    // coulures
    ctx.save();
    for (let i = 0; i < W / 9; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H * 0.8;
      const len = 40 + Math.random() * 220;
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(50,40,30,0.08)');
      g.addColorStop(1, 'rgba(50,40,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2 + Math.random() * 6, len);
    }
    ctx.restore();
    // lumière de fin de journée douce
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(255,240,210,0.08)');
    g.addColorStop(1, 'rgba(20,25,40,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  result(name: string): TemplateResult {
    this.weather();
    return { name, image: this.ctx.getImageData(0, 0, this.W, this.H), zones: this.zones };
  }
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ───────────── Église gothique ─────────────
function eglise(): TemplateResult {
  const W = 1400, H = 1700, P = new Painter(W, H);
  const stone = '#cdbf9f', stone2 = '#c2b393';
  P.sky('#b9c6d3', '#e8edf1');
  P.ground(1600);
  const silhouette: Poly = [[110, 1600], [110, 330], [275, 70], [440, 330], [440, 560], [700, 360], [960, 560], [960, 330], [1125, 70], [1290, 330], [1290, 1600]];
  P.zone('Silhouette', 'silhouette', silhouette);
  // nef + pignon
  const nef: Poly = [[440, 1600], [440, 560], [700, 360], [960, 560], [960, 1600]];
  P.wall(nef, stone);
  P.zone('Pignon', 'toit', [[440, 560], [700, 360], [960, 560]]);
  P.raised([[430, 572], [700, 346], [970, 572], [970, 590], [700, 366], [430, 590]], '#d6c9aa', 6);
  // tours
  for (const [side, x0] of [['gauche', 110], ['droite', 960]] as const) {
    const x1 = x0 + 330, cx = (x0 + x1) / 2;
    P.wall(rectP(x0, 330, 330, 1270), stone2);
    P.roof([[x0 + 10, 330], [cx, 70], [x1 - 10, 330]], '#6a6e76');
    P.raised(rectP(x0 - 6, 318, 342, 24), '#d8ccae', 6);
    P.zone(`Tour ${side}`, 'tour', [[x0, 1600], [x0, 330], [cx, 70], [x1, 330], [x1, 1600]]);
    P.zone(`Flèche ${side}`, 'toit', [[x0 + 10, 330], [cx, 70], [x1 - 10, 330]]);
    // abat-sons du beffroi
    for (const dx of [-62, 12]) {
      const p = pointedArchP(cx + dx, 400, 50, 290);
      P.glass(p, 0, 6);
      P.zone(`Beffroi ${side} ${dx < 0 ? 'G' : 'D'}`, 'fenetre', p);
    }
    const lw = pointedArchP(cx - 35, 790, 70, 190);
    P.glass(lw, 1, 3);
    P.zone(`Fenêtre tour ${side}`, 'fenetre', lw);
    // portail latéral
    const pl = pointedArchP(cx - 85, 1260, 170, 340);
    P.raised(pointedArchP(cx - 110, 1225, 220, 375), '#d3c6a7', 8);
    P.door(pl);
    P.zone(`Portail ${side}`, 'porte', pl);
  }
  // contreforts
  for (const x of [100, 425, 945, 1270]) {
    const p = rectP(x, 340, 30, 1260);
    P.raised(p, '#d4c7a8', 7);
    P.zone(`Contrefort ${x < 700 ? 'G' : 'D'}${x < 200 || x > 1200 ? ' ext.' : ''}`, 'colonne', p);
  }
  // rosace
  P.rosace(700, 760, 165);
  P.zone('Rosace', 'rosace', circleP(700, 760, 185));
  // galerie des rois
  const band = rectP(110, 965, 1180, 95);
  P.raised(band, '#d2c4a4', 6);
  P.zone('Galerie des rois', 'corniche', band);
  for (let i = 0; i < 9; i++) {
    const x = 150 + i * 125;
    const niche = roundArchP(x, 975, 70, 78);
    P.recess(niche, '#3a3328');
    P.statue(x + 8, 982, 54, 72);
    P.zone(`Roi ${i + 1}`, 'statue', niche);
  }
  // portail central
  const arch3 = pointedArchP(520, 1100, 360, 500);
  P.raised(arch3, '#d6c9aa', 10);
  const arch2 = pointedArchP(550, 1135, 300, 465);
  P.raised(arch2, '#cbbd9c', 6);
  P.zone('Voussures du portail', 'statue', arch3);
  const tymp = pointedArchP(580, 1170, 240, 175);
  P.recess(tymp, '#6d6150');
  for (let i = 0; i < 5; i++) P.statue(600 + i * 42, 1225, 34, 95, '#b5a689');
  P.zone('Tympan', 'statue', tymp);
  const door = rectP(590, 1345, 220, 255);
  P.door(door);
  P.zone('Grand portail', 'porte', door);
  // trumeau
  const trumeau = rectP(690, 1345, 20, 255);
  P.raised(trumeau, '#d0c2a2', 4);
  return P.result('Église gothique');
}

// ───────────── Hôtel de ville ─────────────
function mairie(): TemplateResult {
  const W = 1800, H = 1150, P = new Painter(W, H);
  const stone = '#d8ccb4';
  P.sky('#aebfd0', '#e9eef2');
  P.ground(1050);
  const sil: Poly = [[100, 1050], [100, 330], [150, 200], [690, 200], [690, 300], [900, 120], [1110, 300], [1110, 200], [1650, 200], [1700, 330], [1700, 1050]];
  P.zone('Silhouette', 'silhouette', sil);
  // toit mansardé
  P.roof([[100, 330], [150, 200], [1650, 200], [1700, 330]], '#58606d');
  P.zone('Toit mansardé', 'toit', [[100, 330], [150, 200], [1650, 200], [1700, 330]]);
  for (let i = 0; i < 8; i++) {
    const x = i < 4 ? 210 + i * 125 : 1110 + (i - 4) * 125 + 40;
    const d = roundArchP(x, 225, 56, 90);
    P.raised(roundArchP(x - 10, 215, 76, 105), '#e0d6c2', 5);
    P.glass(d, 1, 1);
    P.zone(`Lucarne ${i + 1}`, 'fenetre', d);
  }
  P.wall(rectP(100, 330, 1600, 720), stone, 30);
  // avant-corps central
  P.raised(rectP(690, 300, 420, 750), '#e0d5be', 9);
  P.wall(rectP(700, 310, 400, 740), '#dcd0b8', 30);
  P.zone('Avant-corps', 'mur', rectP(690, 300, 420, 750));
  const fronton: Poly = [[670, 310], [900, 120], [1130, 310]];
  P.raised(fronton, '#e3d9c4', 8);
  P.recess([[720, 292], [900, 148], [1080, 292]], '#bfb39a');
  P.zone('Fronton', 'toit', fronton);
  P.raised(circleP(900, 225, 56), '#efe6d2', 6);
  P.recess(circleP(900, 225, 46), '#f3efe6', 'rgba(60,50,30,0.8)');
  const ctx = P.ctx;
  ctx.strokeStyle = '#2b2620';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(900, 225);
  ctx.lineTo(900, 190);
  ctx.moveTo(900, 225);
  ctx.lineTo(925, 235);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillStyle = '#2b2620';
    ctx.fillRect(900 + Math.cos(a) * 38 - 2, 225 + Math.sin(a) * 38 - 2, 4, 4);
  }
  P.zone('Horloge', 'horloge', circleP(900, 225, 56));
  // corniches
  for (const [y, h, name] of [[318, 22, 'Entablement'], [600, 20, 'Bandeau 1er étage'], [822, 20, 'Bandeau rez-de-chaussée']] as const) {
    const p = rectP(92, y, 1616, h);
    P.raised(p, '#e6dcc8', 6);
    P.zone(name, 'corniche', p);
  }
  // colonnes de l'avant-corps
  for (const x of [705, 800, 970, 1065]) {
    const p = rectP(x, 345, 30, 700);
    P.raised(p, '#ece3cf', 7);
    P.raised(rectP(x - 6, 345, 42, 16), '#efe7d4', 3);
    P.zone(`Colonne ${x}`, 'colonne', p);
  }
  // fenêtres
  const bays = [180, 305, 430, 555, 1185, 1310, 1435, 1560];
  bays.forEach((x, i) => {
    const w1 = rectP(x, 400, 70, 150);
    P.raised(rectP(x - 10, 390, 90, 170), '#e8dfcc', 5);
    P.glass(w1, 1, 2);
    P.zone(`Fenêtre 2e ${i + 1}`, 'fenetre', w1);
    const w2 = rectP(x, 650, 70, 150);
    P.raised([[x - 18, 645], [x + 35, 615], [x + 88, 645]], '#ece3cf', 4);
    P.glass(w2, 1, 3);
    P.zone(`Fenêtre 1er ${i + 1}`, 'fenetre', w2);
    const w3 = roundArchP(x, 870, 70, 150);
    P.glass(w3, 1, 2);
    P.zone(`Fenêtre RdC ${i + 1}`, 'fenetre', w3);
  });
  for (const x of [870, 1000]) {
    const p = rectP(x - 30, 400, 60, 150);
    P.glass(p, 1, 2);
    P.zone(`Fenêtre centrale haute ${x}`, 'fenetre', p);
  }
  const balc = roundArchP(855, 630, 90, 175);
  P.glass(balc, 1, 3);
  P.zone('Porte-fenêtre du balcon', 'fenetre', balc);
  const bal = rectP(830, 790, 140, 22);
  P.raised(bal, '#efe6d2', 6);
  P.zone('Balcon', 'corniche', bal);
  const door = roundArchP(845, 860, 110, 190);
  P.raised(roundArchP(830, 848, 140, 202), '#e6dcc8', 6);
  P.door(door, '#3d2a1c');
  P.zone('Porte d’honneur', 'porte', door);
  return P.result('Hôtel de ville');
}

// ───────────── Château fort ─────────────
function chateau(): TemplateResult {
  const W = 1800, H = 1200, P = new Painter(W, H);
  const stone = '#b9b2a3';
  P.sky('#a9b8c9', '#e2e8ee');
  P.ground(1100);
  const sil: Poly = [[150, 1100], [150, 380], [350, 80], [550, 380], [550, 460], [720, 460], [720, 300], [1080, 300], [1080, 460], [1250, 460], [1250, 380], [1450, 80], [1650, 380], [1650, 1100]];
  P.zone('Silhouette', 'silhouette', sil);
  // courtine
  P.wall(rectP(550, 520, 700, 580), stone, 38);
  P.zone('Courtine', 'mur', rectP(550, 520, 700, 580));
  for (let x = 550; x < 1250; x += 70) {
    const m = rectP(x, 460, 40, 62);
    P.wall(m, stone, 31);
  }
  const mach = rectP(550, 520, 700, 50);
  P.raised(mach, '#c6bfb1', 6);
  P.zone('Mâchicoulis', 'corniche', mach);
  // tours
  for (const [side, x0] of [['gauche', 150], ['droite', 1250]] as const) {
    const cx = x0 + 200;
    P.wall(rectP(x0, 380, 400, 720), '#b3ac9c', 38);
    const ctx = P.ctx;
    const g = ctx.createLinearGradient(x0, 0, x0 + 400, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 380, 400, 720);
    P.roof([[x0 - 20, 380], [cx, 80], [x0 + 420, 380]], '#4f5763');
    P.zone(`Toit tour ${side}`, 'toit', [[x0 - 20, 380], [cx, 80], [x0 + 420, 380]]);
    P.zone(`Tour ${side}`, 'tour', rectP(x0, 380, 400, 720));
    const band = rectP(x0 - 8, 380, 416, 40);
    P.raised(band, '#c3bcad', 5);
    for (const y of [520, 860]) {
      const s = rectP(cx - 8, y, 16, 110);
      P.recess(s, '#141210');
      P.zone(`Meurtrière ${side} ${y}`, 'fenetre', s);
    }
    const w = roundArchP(cx - 40, 660, 80, 130);
    P.glass(w, 1, 2);
    P.zone(`Fenêtre tour ${side}`, 'fenetre', w);
  }
  // châtelet
  P.wall(rectP(720, 360, 360, 740), '#bfb8a9', 38);
  for (let x = 720; x < 1080; x += 72) P.wall(rectP(x, 300, 42, 62), '#bfb8a9', 31);
  P.zone('Châtelet', 'tour', rectP(720, 300, 360, 800));
  const gate = roundArchP(800, 760, 200, 340);
  P.raised(roundArchP(780, 740, 240, 360), '#cbc4b5', 8);
  P.recess(gate, '#0e0c0b');
  const ctx = P.ctx;
  ctx.save();
  ctx.strokeStyle = '#3a3027';
  ctx.lineWidth = 6;
  for (let x = 815; x < 1000; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 790);
    ctx.lineTo(x, 1000);
    ctx.stroke();
  }
  for (let y = 820; y < 1000; y += 30) {
    ctx.beginPath();
    ctx.moveTo(805, y);
    ctx.lineTo(995, y);
    ctx.stroke();
  }
  ctx.restore();
  P.zone('Porte fortifiée', 'porte', gate);
  for (const x of [790, 950]) {
    const w = roundArchP(x, 450, 60, 110);
    P.glass(w, 1, 1);
    P.zone(`Baie du châtelet ${x}`, 'fenetre', w);
  }
  // blason
  const shield: Poly = [[860, 590], [940, 590], [940, 650], [900, 700], [860, 650]];
  P.raised(shield, '#9c2f2f', 5);
  ctx.fillStyle = '#d9b44a';
  ctx.beginPath();
  ctx.arc(900, 635, 18, 0, Math.PI * 2);
  ctx.fill();
  P.zone('Blason', 'statue', shield);
  return P.result('Château fort');
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'eglise', name: 'Église gothique', description: 'Deux tours, rosace, galerie des rois et grand portail.', build: eglise },
  { id: 'mairie', name: 'Hôtel de ville', description: 'Façade classique, fronton à horloge, colonnes et toit mansardé.', build: mairie },
  { id: 'chateau', name: 'Château fort', description: 'Tours rondes, courtine crénelée, châtelet et herse.', build: chateau },
];
