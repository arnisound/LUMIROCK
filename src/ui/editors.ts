// Éditeurs interactifs : redressement (4 coins) et calques (polygones).
import type { Stage } from './stage';
import { Pt, Zone, ZoneTypeKey, uid, zoneType, ZONE_TYPES } from '../types';

const HANDLE = 9;

// ───────────────────────── Redressement ─────────────────────────
export class QuadEditor {
  quad: Pt[] = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
  private drag = -1;
  private cursor: Pt | null = null;
  onChange: (() => void) | null = null;
  constructor(private stage: Stage, private image: CanvasImageSource & { width: number; height: number }) {}

  attach() {
    const s = this.stage;
    s.setAspect(this.image.width / this.image.height);
    s.setMode({ gl: false, overlay: true, cursor: 'crosshair' });
    s.handlers = {
      down: (p) => {
        this.drag = this.pick(p);
        this.cursor = p;
      },
      move: (p) => {
        this.cursor = p;
        if (this.drag >= 0) {
          this.quad[this.drag] = [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];
          this.onChange?.();
        }
      },
      up: () => {
        this.drag = -1;
      },
      draw: (ctx, w, hh) => this.draw(ctx, w, hh),
    };
    s.redraw();
  }

  private pick(p: Pt) {
    const s = this.stage;
    let best = -1, bd = 26;
    this.quad.forEach(([x, y], i) => {
      const d = Math.hypot((x - p[0]) * s.cssW, (y - p[1]) * s.cssH);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    ctx.drawImage(this.image, 0, 0, w, hh);
    const q = this.quad.map(([x, y]) => [x * w, y * hh]);
    // assombrir l'extérieur
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,12,0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, w, hh);
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
    // grille de perspective
    ctx.strokeStyle = 'rgba(255,190,90,0.35)';
    ctx.lineWidth = 1;
    const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const a = lerp(q[0], q[1], t), b = lerp(q[3], q[2], t);
      const c = lerp(q[0], q[3], t), d = lerp(q[1], q[2], t);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffb547';
    ctx.lineWidth = 2;
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    const labels = ['HG', 'HD', 'BD', 'BG'];
    q.forEach(([x, y], i) => {
      ctx.fillStyle = i === this.drag ? '#fff' : '#ffb547';
      ctx.beginPath();
      ctx.arc(x, y, HANDLE, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], x, y);
    });
    // loupe
    if (this.drag >= 0 && this.cursor) {
      const [cx, cy] = [this.cursor[0] * w, this.cursor[1] * hh];
      const R = 70, Z = 4;
      const ox = cx + (cx > w - 180 ? -110 : 110), oy = cy + (cy < 160 ? 110 : -110);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.clip();
      const sx = (this.cursor[0] * this.image.width) - (R / Z) * (this.image.width / w);
      const sy = (this.cursor[1] * this.image.height) - (R / Z) * (this.image.height / hh);
      ctx.drawImage(this.image, sx, sy, ((2 * R) / Z) * (this.image.width / w), ((2 * R) / Z) * (this.image.height / hh), ox - R, oy - R, 2 * R, 2 * R);
      ctx.strokeStyle = '#ffb547';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox - R, oy); ctx.lineTo(ox + R, oy);
      ctx.moveTo(ox, oy - R); ctx.lineTo(ox, oy + R);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#ffb547';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ───────────────────────── Calques ─────────────────────────
export type Tool = 'select' | 'rect' | 'poly' | 'ellipse' | 'arch' | 'gothic';

function inside(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function shapeFromDrag(tool: Tool, a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const w = x1 - x0, hh = y1 - y0;
  if (tool === 'ellipse') {
    const n = 48;
    return Array.from({ length: n }, (_, i) => [x0 + w / 2 + (Math.cos((i / n) * Math.PI * 2) * w) / 2, y0 + hh / 2 + (Math.sin((i / n) * Math.PI * 2) * hh) / 2] as Pt);
  }
  if (tool === 'arch' || tool === 'gothic') {
    const pts: Pt[] = [[x0, y1]];
    const n = 20;
    const archH = Math.min(hh, tool === 'arch' ? w / 2 * 1.0 : w * 0.85);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let x: number, y: number;
      if (tool === 'arch') {
        const a2 = Math.PI + t * Math.PI;
        x = x0 + w / 2 + (Math.cos(a2) * w) / 2;
        y = y0 + archH + Math.sin(a2) * archH;
      } else {
        // arc brisé : deux arcs qui se rejoignent au sommet
        const side = t < 0.5 ? 0 : 1;
        const u = side === 0 ? t * 2 : (1 - t) * 2; // 0 au pied, 1 au sommet
        const ang = (u * Math.PI) / 3;
        const dx = (1 - Math.cos(ang)) * w;
        x = side === 0 ? x0 + Math.min(dx, w / 2) : x1 - Math.min(dx, w / 2);
        y = y0 + archH - (Math.sin(ang) / Math.sin(Math.PI / 3)) * archH;
      }
      pts.push([x, y]);
    }
    pts.push([x1, y1]);
    return pts;
  }
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export class ZoneEditor {
  zones: Zone[] = [];
  selected: string | null = null;
  tool: Tool = 'select';
  newType: ZoneTypeKey = 'fenetre';
  showLabels = true;
  dim = 0.0;
  onChange: ((final: boolean) => void) | null = null;
  onSelect: ((id: string | null) => void) | null = null;
  private dragStart: Pt | null = null;
  private dragCur: Pt | null = null;
  private dragVertex = -1;
  private dragZone: { start: Pt; orig: Pt[] } | null = null;
  private poly: Pt[] = [];
  private hover: Pt | null = null;

  constructor(private stage: Stage) {}

  attach() {
    const s = this.stage;
    s.setMode({ gl: true, overlay: true, cursor: this.tool === 'select' ? 'default' : 'crosshair' });
    s.handlers = {
      down: (p, e) => this.down(p, e),
      move: (p) => this.move(p),
      up: (p) => this.up(p),
      dbl: (p) => this.dbl(p),
      draw: (ctx, w, hh) => this.draw(ctx, w, hh),
    };
    s.redraw();
  }

  setTool(t: Tool) {
    this.tool = t;
    this.poly = [];
    this.stage.overlay.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.stage.redraw();
  }

  private sel() {
    return this.zones.find((z) => z.id === this.selected) ?? null;
  }

  private px(p: Pt): Pt {
    return [p[0] * this.stage.cssW, p[1] * this.stage.cssH];
  }

  private down(p: Pt, e: PointerEvent) {
    if (this.tool === 'poly') {
      if (this.poly.length >= 3) {
        const [ax, ay] = this.px(this.poly[0]), [bx, by] = this.px(p);
        if (Math.hypot(ax - bx, ay - by) < 12) {
          this.finishPoly();
          return;
        }
      }
      this.poly.push(p);
      return;
    }
    if (this.tool !== 'select') {
      this.dragStart = p;
      this.dragCur = p;
      return;
    }
    const z = this.sel();
    if (z) {
      const [bx, by] = this.px(p);
      const vi = z.points.findIndex((q) => {
        const [x, y] = this.px(q);
        return Math.hypot(x - bx, y - by) < 10;
      });
      if (vi >= 0) {
        this.dragVertex = vi;
        return;
      }
    }
    // sélection du calque le plus haut sous le pointeur (silhouette en dernier recours)
    const hits = this.zones.filter((zz) => inside(p, zz.points));
    const hit = [...hits].reverse().find((zz) => zz.type !== 'silhouette') ?? hits[hits.length - 1];
    if (hit && !e.altKey) {
      this.selected = hit.id;
      this.onSelect?.(hit.id);
      this.dragZone = { start: p, orig: hit.points.map((q) => [...q] as Pt) };
    } else {
      this.selected = null;
      this.onSelect?.(null);
    }
  }

  private move(p: Pt) {
    this.hover = p;
    const z = this.sel();
    if (this.dragVertex >= 0 && z) {
      z.points[this.dragVertex] = [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];
      this.onChange?.(false);
    } else if (this.dragZone && z) {
      const dx = p[0] - this.dragZone.start[0], dy = p[1] - this.dragZone.start[1];
      z.points = this.dragZone.orig.map(([x, y]) => [x + dx, y + dy]);
      this.onChange?.(false);
    } else if (this.dragStart) {
      this.dragCur = p;
    }
  }

  private up(p: Pt) {
    if (this.dragVertex >= 0 || this.dragZone) {
      const moved = this.dragZone ? Math.hypot(p[0] - this.dragZone.start[0], p[1] - this.dragZone.start[1]) > 0.002 : true;
      this.dragVertex = -1;
      this.dragZone = null;
      if (moved) this.onChange?.(true);
      return;
    }
    if (this.dragStart) {
      const a = this.dragStart;
      this.dragStart = null;
      this.dragCur = null;
      if (Math.abs(p[0] - a[0]) * this.stage.cssW < 6 || Math.abs(p[1] - a[1]) * this.stage.cssH < 6) return;
      this.addZone(shapeFromDrag(this.tool, a, p));
    }
  }

  private dbl(p: Pt) {
    if (this.tool === 'poly' && this.poly.length >= 3) {
      this.finishPoly();
      return;
    }
    // double-clic sur un bord du calque sélectionné : ajoute un sommet
    const z = this.sel();
    if (!z || this.tool !== 'select') return;
    const P = this.px(p);
    let best = -1, bd = 10;
    for (let i = 0; i < z.points.length; i++) {
      const A = this.px(z.points[i]), B = this.px(z.points[(i + 1) % z.points.length]);
      const vx = B[0] - A[0], vy = B[1] - A[1];
      const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(A[0] + vx * t - P[0], A[1] + vy * t - P[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      z.points.splice(best + 1, 0, p);
      this.onChange?.(true);
    }
  }

  finishPoly() {
    if (this.poly.length >= 3) this.addZone(this.poly);
    this.poly = [];
  }

  cancel() {
    this.poly = [];
    this.dragStart = null;
    this.stage.redraw();
  }

  private addZone(points: Pt[]) {
    const t = zoneType(this.newType);
    const n = this.zones.filter((z) => z.type === this.newType).length + 1;
    const z: Zone = { id: uid(), name: `${t.label.split(' /')[0].split(' (')[0]} ${n}`, type: this.newType, points };
    if (this.newType === 'silhouette') this.zones.unshift(z);
    else this.zones.push(z);
    this.selected = z.id;
    this.onSelect?.(z.id);
    this.onChange?.(true);
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    if (this.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.dim})`;
      ctx.fillRect(0, 0, w, hh);
    }
    const path = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * hh) : ctx.moveTo(x * w, y * hh)));
      ctx.closePath();
    };
    for (const z of this.zones) {
      const t = ZONE_TYPES.find((x) => x.key === z.type)!;
      const isSel = z.id === this.selected;
      path(z.points);
      if (z.type !== 'silhouette') {
        ctx.fillStyle = t.color + (isSel ? '55' : '26');
        ctx.fill();
      }
      ctx.setLineDash(z.type === 'silhouette' ? [6, 4] : z.type === 'exclure' ? [3, 3] : []);
      ctx.strokeStyle = isSel ? '#ffffff' : t.color;
      ctx.lineWidth = isSel ? 2.2 : 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const z = this.sel();
    if (z) {
      for (const q of z.points) {
        const [x, y] = this.px(q);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(x - 4, y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
      if (this.showLabels) {
        const [x, y] = this.px(z.points[0]);
        ctx.font = '600 12px Inter, sans-serif';
        const tw = ctx.measureText(z.name).width;
        ctx.fillStyle = 'rgba(10,12,18,0.85)';
        ctx.fillRect(x, y - 22, tw + 12, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(z.name, x + 6, y - 9);
      }
    }
    // tracé en cours
    if (this.dragStart && this.dragCur) {
      const pts = shapeFromDrag(this.tool, this.dragStart, this.dragCur);
      path(pts);
      ctx.strokeStyle = zoneType(this.newType).color;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.poly.length) {
      ctx.strokeStyle = zoneType(this.newType).color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * hh) : ctx.moveTo(x * w, y * hh)));
      if (this.hover) ctx.lineTo(this.hover[0] * w, this.hover[1] * hh);
      ctx.stroke();
      for (const q of this.poly) {
        const [x, y] = this.px(q);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
