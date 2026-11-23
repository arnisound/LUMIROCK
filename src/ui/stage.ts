// Zone d'affichage centrale : canevas WebGL + calque d'édition 2D superposé.
import { h } from './dom';
import type { Pt } from '../types';

export interface StageHandlers {
  down?: (p: Pt, e: PointerEvent) => void;
  move?: (p: Pt, e: PointerEvent) => void;
  up?: (p: Pt, e: PointerEvent) => void;
  dbl?: (p: Pt, e: MouseEvent) => void;
  draw?: (ctx: CanvasRenderingContext2D, w: number, hgt: number) => void;
}

export class Stage {
  root: HTMLElement;
  frame: HTMLElement;
  gl: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  aspect = 16 / 9;
  cssW = 0;
  cssH = 0;
  handlers: StageHandlers = {};
  onResize: (() => void) | null = null;
  private ro: ResizeObserver;

  constructor() {
    this.gl = h('canvas', { class: 'gl' });
    this.overlay = h('canvas', { class: 'overlay' });
    this.frame = h('div', { class: 'stage-frame' }, this.gl, this.overlay);
    this.root = h('div', { class: 'stage' }, this.frame);
    this.octx = this.overlay.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.root);
    const norm = (e: MouseEvent): Pt => {
      const r = this.overlay.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    this.overlay.addEventListener('pointerdown', (e) => {
      this.overlay.setPointerCapture(e.pointerId);
      this.handlers.down?.(norm(e), e);
      this.redraw();
    });
    this.overlay.addEventListener('pointermove', (e) => {
      if (this.handlers.move) {
        this.handlers.move(norm(e), e);
        this.redraw();
      }
    });
    this.overlay.addEventListener('pointerup', (e) => {
      this.handlers.up?.(norm(e), e);
      this.redraw();
    });
    this.overlay.addEventListener('dblclick', (e) => {
      this.handlers.dbl?.(norm(e), e);
      this.redraw();
    });
  }

  setAspect(a: number) {
    if (Math.abs(a - this.aspect) > 1e-6) {
      this.aspect = a;
      this.fit();
    }
  }

  fit() {
    const r = this.root.getBoundingClientRect();
    const pad = 28;
    const aw = Math.max(50, r.width - pad * 2), ah = Math.max(50, r.height - pad * 2);
    let w = aw, hh = aw / this.aspect;
    if (hh > ah) {
      hh = ah;
      w = ah * this.aspect;
    }
    this.cssW = Math.round(w);
    this.cssH = Math.round(hh);
    this.frame.style.width = `${this.cssW}px`;
    this.frame.style.height = `${this.cssH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(this.cssW * dpr);
    this.overlay.height = Math.round(this.cssH * dpr);
    this.onResize?.();
    this.redraw();
  }

  /** Taille conseillée du tampon WebGL pour l'aperçu. */
  previewSize(maxW = 1600) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = this.cssW * dpr, hh = this.cssH * dpr;
    if (w > maxW) {
      hh *= maxW / w;
      w = maxW;
    }
    return { w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(hh)) };
  }

  setMode(m: { gl: boolean; overlay: boolean; cursor?: string }) {
    this.gl.style.visibility = m.gl ? 'visible' : 'hidden';
    this.overlay.style.pointerEvents = m.overlay ? 'auto' : 'none';
    this.overlay.style.cursor = m.cursor ?? 'default';
  }

  redraw() {
    const ctx = this.octx;
    const dpr = this.overlay.width / Math.max(1, this.cssW);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.handlers.draw?.(ctx, this.cssW, this.cssH);
  }
}
