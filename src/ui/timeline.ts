// Ligne de temps : tableaux, forme d'onde, tête de lecture.
import { clear, fmtTime, h, icon } from './dom';
import { CATEGORY_COLORS, EFFECT_MAP } from '../effects/library';
import { computeTimings, showDuration } from '../gl/renderer';
import type { AudioAnalysis } from '../audio';
import type { Show } from '../types';

export interface TimelineEvents {
  seek: (t: number) => void;
  select: (id: string | null) => void;
  reorder: (from: number, to: number) => void;
  resize: (id: string, duration: number, final: boolean) => void;
  togglePlay: () => void;
  home: () => void;
}

export class Timeline {
  root: HTMLElement;
  private scroll: HTMLElement;
  private content: HTMLElement;
  private ruler: HTMLCanvasElement;
  private wave: HTMLCanvasElement;
  private track: HTMLElement;
  private head: HTMLElement;
  private timeLbl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private zoomInput: HTMLInputElement;
  extra = h('div', { class: 'tl-extra' });
  pps = 10;
  loop = true;
  snap = true;
  private show: Show | null = null;
  private analysis: AudioAnalysis | null = null;
  private selected: string | null = null;
  private time = 0;

  constructor(private ev: TimelineEvents) {
    this.playBtn = h('button', { class: 'btn icon big', title: 'Lecture / pause (Espace)', onclick: () => ev.togglePlay() }, icon('play'));
    this.timeLbl = h('span', { class: 'tl-time' }, '0:00.0');
    this.zoomInput = h('input', { type: 'range', min: '3', max: '60', step: '1', value: String(this.pps), title: 'Zoom' });
    this.zoomInput.addEventListener('input', () => {
      this.pps = Number(this.zoomInput.value);
      this.render();
    });
    const loopBtn = h('button', { class: 'btn icon toggle on', title: 'Lecture en boucle', onclick: () => {
      this.loop = !this.loop;
      loopBtn.classList.toggle('on', this.loop);
    } }, icon('loop'));
    const snapBtn = h('button', { class: 'btn small toggle on', title: 'Aimanter les durées sur les temps de la musique', onclick: () => {
      this.snap = !this.snap;
      snapBtn.classList.toggle('on', this.snap);
    } }, 'Aimant');
    this.ruler = h('canvas', { class: 'tl-ruler', height: 22 });
    this.wave = h('canvas', { class: 'tl-wave', height: 34 });
    this.track = h('div', { class: 'tl-track' });
    this.head = h('div', { class: 'tl-head' });
    this.content = h('div', { class: 'tl-content' }, this.ruler, this.wave, this.track, this.head);
    this.scroll = h('div', { class: 'tl-scroll' }, this.content);
    this.root = h(
      'div',
      { class: 'timeline' },
      h('div', { class: 'tl-bar' },
        h('button', { class: 'btn icon', title: 'Revenir au début', onclick: () => ev.home() }, icon('home')),
        this.playBtn, this.timeLbl, loopBtn,
        h('div', { class: 'spacer' }),
        this.extra,
        snapBtn,
        h('label', { class: 'zoom' }, 'Zoom', this.zoomInput),
      ),
      this.scroll,
    );
    const seekFrom = (e: PointerEvent) => {
      const r = this.content.getBoundingClientRect();
      ev.seek(Math.max(0, (e.clientX - r.left - 8) / this.pps));
    };
    for (const el of [this.ruler, this.wave]) {
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        seekFrom(e);
        const mv = (m: PointerEvent) => seekFrom(m);
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true });
      });
    }
    this.track.addEventListener('pointerdown', (e) => {
      if (e.target === this.track) {
        seekFrom(e);
        ev.select(null);
      }
    });
  }

  setData(show: Show, analysis: AudioAnalysis | null, selected: string | null) {
    this.show = show;
    this.analysis = analysis;
    this.selected = selected;
    this.render();
  }

  /** Ajuste le zoom pour voir tout le spectacle. */
  fit() {
    if (!this.show) return;
    const len = Math.max(showDuration(this.show), this.analysis?.duration ?? 0) + 2;
    const w = this.scroll.clientWidth || 900;
    this.pps = Math.max(3, Math.min(60, Math.floor((w - 24) / len)));
    this.zoomInput.value = String(this.pps);
    this.render();
  }

  setPlaying(p: boolean) {
    clear(this.playBtn).appendChild(icon(p ? 'pause' : 'play'));
  }

  setTime(t: number, follow = false) {
    this.time = t;
    this.head.style.transform = `translateX(${8 + t * this.pps}px)`;
    const total = this.show ? showDuration(this.show) : 0;
    this.timeLbl.textContent = `${fmtTime(t)} / ${fmtTime(total)}`;
    if (follow) {
      const x = 8 + t * this.pps;
      const sl = this.scroll.scrollLeft, w = this.scroll.clientWidth;
      if (x < sl + 40 || x > sl + w - 60) this.scroll.scrollLeft = x - w * 0.3;
    }
  }

  render() {
    if (!this.show) return;
    const show = this.show;
    const total = showDuration(show);
    const len = Math.max(total, this.analysis?.duration ?? 0) + 4;
    const W = Math.max(this.scroll.clientWidth, Math.ceil(len * this.pps) + 16);
    this.content.style.width = `${W}px`;
    // règle
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ruler.width = W * dpr;
    this.ruler.style.width = `${W}px`;
    const rc = this.ruler.getContext('2d')!;
    rc.scale(dpr, dpr);
    rc.clearRect(0, 0, W, 22);
    rc.fillStyle = '#7d879b';
    rc.strokeStyle = '#3a4252';
    rc.font = '10px Inter, sans-serif';
    const major = this.pps > 30 ? 1 : this.pps > 12 ? 5 : this.pps > 5 ? 10 : 30;
    for (let s = 0; s <= len; s += major / (major === 1 ? 1 : 5)) {
      const x = 8 + s * this.pps;
      const isMajor = Math.abs(s / major - Math.round(s / major)) < 1e-6;
      rc.beginPath();
      rc.moveTo(x + 0.5, isMajor ? 8 : 15);
      rc.lineTo(x + 0.5, 22);
      rc.stroke();
      if (isMajor) rc.fillText(fmtTime(s).replace('.0', ''), x + 3, 10);
    }
    // forme d'onde
    this.wave.style.display = this.analysis ? 'block' : 'none';
    if (this.analysis) {
      const a = this.analysis;
      this.wave.width = W * dpr;
      this.wave.style.width = `${W}px`;
      const wc = this.wave.getContext('2d')!;
      wc.scale(dpr, dpr);
      wc.clearRect(0, 0, W, 34);
      const g = wc.createLinearGradient(0, 0, 0, 34);
      g.addColorStop(0, '#e0a23e');
      g.addColorStop(1, '#b9741f');
      wc.fillStyle = g;
      const perPx = 100 / this.pps;
      for (let x = 0; x < a.duration * this.pps; x++) {
        let m = 0;
        const i0 = Math.floor(x * perPx), i1 = Math.min(a.peaks.length, Math.floor((x + 1) * perPx) + 1);
        for (let i = i0; i < i1; i++) m = Math.max(m, a.peaks[i]);
        const hh = Math.max(1, m * 30);
        wc.globalAlpha = 0.75;
        wc.fillRect(8 + x, 17 - hh / 2, 1, hh);
      }
      // temps forts (mesures)
      wc.globalAlpha = 0.35;
      wc.fillStyle = '#fff';
      const bar = (4 * 60) / a.bpm;
      for (let t = a.offset; t < a.duration; t += bar) wc.fillRect(8 + t * this.pps, 0, 1, 34);
      wc.globalAlpha = 1;
    }
    // tableaux
    clear(this.track);
    const timings = computeTimings(show);
    timings.forEach((tm, idx) => {
      const e = EFFECT_MAP.get(tm.clip.effect);
      const color = e ? CATEGORY_COLORS[e.category] : '#888';
      const handle = h('div', { class: 'tl-resize', title: 'Glisser pour changer la durée' });
      const el = h(
        'div',
        {
          class: `tl-clip${tm.clip.id === this.selected ? ' sel' : ''}`,
          style: `left:${8 + tm.start * this.pps}px;width:${Math.max(4, tm.clip.duration * this.pps - 2)}px;--c:${color}`,
          title: `${e?.name ?? tm.clip.effect} — ${tm.clip.duration.toFixed(1)} s`,
        },
        h('div', { class: 'tl-clip-name' }, e?.name ?? tm.clip.effect),
        h('div', { class: 'tl-clip-dur' }, `${tm.clip.duration.toFixed(1)} s`),
        tm.clip.transition !== 'cut' && idx < timings.length - 1 ? h('div', { class: 'tl-trans', style: `width:${tm.clip.transitionDuration * this.pps}px` }) : null,
        handle,
      );
      // redimensionnement
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const x0 = e.clientX, d0 = tm.clip.duration;
        const beat = 60 / (this.analysis?.bpm ?? show.bpm);
        const calc = (m: PointerEvent) => {
          let d = Math.max(1, d0 + (m.clientX - x0) / this.pps);
          if (this.snap) d = Math.max(beat, Math.round(d / beat) * beat);
          return Math.round(d * 100) / 100;
        };
        const mv = (m: PointerEvent) => this.ev.resize(tm.clip.id, calc(m), false);
        handle.addEventListener('pointermove', mv);
        handle.addEventListener('pointerup', (m) => {
          handle.removeEventListener('pointermove', mv);
          this.ev.resize(tm.clip.id, calc(m), true);
        }, { once: true });
      });
      // sélection + déplacement
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.ev.select(tm.clip.id);
        const x0 = e.clientX;
        let moved = false;
        const mv = (m: PointerEvent) => {
          const dx = m.clientX - x0;
          if (Math.abs(dx) > 5) moved = true;
          if (moved) {
            el.style.transform = `translateX(${dx}px)`;
            el.classList.add('dragging');
          }
        };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', (m) => {
          el.removeEventListener('pointermove', mv);
          if (!moved) {
            const r = this.content.getBoundingClientRect();
            this.ev.seek(Math.max(0, (m.clientX - r.left - 8) / this.pps));
            return;
          }
          const r = this.content.getBoundingClientRect();
          const tx = (m.clientX - r.left - 8) / this.pps;
          let to = timings.findIndex((x) => tx < (x.start + x.end) / 2);
          if (to < 0) to = timings.length - 1;
          else if (to > idx) to -= 1;
          this.ev.reorder(idx, to);
        }, { once: true });
      });
      this.track.appendChild(el);
    });
    this.setTime(this.time);
  }
}
