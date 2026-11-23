// Ligne de temps : pistes de tableaux, forme d'onde, tête de lecture.
import { clear, fmtTime, h, icon } from './dom';
import { CATEGORY_COLORS, EFFECT_MAP } from '../effects/library';
import { showDuration, trackTimings } from '../gl/renderer';
import type { AudioAnalysis } from '../audio';
import type { Clip, Show } from '../types';

export const MAIN_TRACK = 'main';

export interface TimelineEvents {
  seek: (t: number) => void;
  select: (id: string | null) => void;
  selectTrack: (trackId: string) => void;
  move: (id: string, trackId: string, start: number, final: boolean) => void;
  trim: (id: string, start: number, duration: number, final: boolean) => void;
  togglePlay: () => void;
  home: () => void;
  addTrack: () => void;
}

interface TrackView {
  id: string;
  name: string;
  clips: Clip[];
  muted?: boolean;
}

export class Timeline {
  root: HTMLElement;
  private scroll: HTMLElement;
  private content: HTMLElement;
  private ruler: HTMLCanvasElement;
  private wave: HTMLCanvasElement;
  private tracks: HTMLElement;
  private head: HTMLElement;
  private timeLbl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private zoomInput: HTMLInputElement;
  extra = h('div', { class: 'tl-extra' });
  pps = 10;
  loop = true;
  snap = true;
  activeTrack = MAIN_TRACK;
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
    this.tracks = h('div', { class: 'tl-tracks' });
    this.head = h('div', { class: 'tl-head' });
    this.content = h('div', { class: 'tl-content' }, this.ruler, this.wave, this.tracks, this.head);
    this.scroll = h('div', { class: 'tl-scroll' }, this.content);
    this.root = h(
      'div',
      { class: 'timeline' },
      h('div', { class: 'tl-bar' },
        h('button', { class: 'btn icon', title: 'Revenir au début', onclick: () => ev.home() }, icon('home')),
        this.playBtn, this.timeLbl, loopBtn,
        h('button', { class: 'btn small', title: 'Ajouter une piste superposée (les lumières s’additionnent)', onclick: () => ev.addTrack() }, icon('plus'), 'Piste'),
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
    this.tracks.addEventListener('pointerdown', (e) => {
      const row = (e.target as HTMLElement).closest('.tl-track') as HTMLElement | null;
      if (row && e.target === row) {
        seekFrom(e);
        ev.selectTrack(row.dataset.track!);
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

  private trackViews(): TrackView[] {
    if (!this.show) return [];
    return [
      { id: MAIN_TRACK, name: 'Piste principale', clips: this.show.clips },
      ...(this.show.layers ?? []).map((l) => ({ id: l.id, name: l.name, clips: l.clips, muted: l.muted })),
    ];
  }

  render() {
    if (!this.show) return;
    const total = showDuration(this.show);
    const len = Math.max(total, this.analysis?.duration ?? 0) + 4;
    const W = Math.max(this.scroll.clientWidth, Math.ceil(len * this.pps) + 16);
    this.content.style.width = `${W}px`;
    const views = this.trackViews();
    this.root.style.height = `${126 + views.length * 78 + (this.analysis ? 0 : -34)}px`;
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
      wc.globalAlpha = 0.35;
      wc.fillStyle = '#fff';
      const bar = (4 * 60) / a.bpm;
      for (let t = a.offset; t < a.duration; t += bar) wc.fillRect(8 + t * this.pps, 0, 1, 34);
      wc.globalAlpha = 1;
    }
    // pistes
    clear(this.tracks);
    for (const view of views) {
      const row = h('div', { class: `tl-track${view.id === this.activeTrack ? ' active' : ''}${view.muted ? ' muted' : ''}`, 'data-track': view.id },
        h('span', { class: 'tl-track-name' }, view.name));
      this.fillTrack(row, view);
      this.tracks.appendChild(row);
    }
    this.setTime(this.time);
  }

  /** Aimantage : temps de la musique, bords des autres tableaux, tête de lecture. */
  private snapTime(t: number, selfId: string) {
    if (!this.snap || !this.show) return t;
    const thr = 9 / this.pps;
    const cands: number[] = [0, this.time];
    const lists = [this.show.clips, ...(this.show.layers ?? []).map((l) => l.clips)];
    for (const list of lists) for (const tm of trackTimings(list)) if (tm.clip.id !== selfId) cands.push(tm.start, tm.end);
    let best = t, bd = thr;
    for (const c of cands) if (Math.abs(c - t) < bd) {
      bd = Math.abs(c - t);
      best = c;
    }
    if (best !== t) return best;
    const bpm = this.analysis?.bpm ?? this.show.bpm;
    const off = this.analysis?.offset ?? 0;
    const beat = 60 / bpm;
    const g = off + Math.round((t - off) / beat) * beat;
    return Math.abs(g - t) < thr ? Math.max(0, g) : t;
  }

  private fillTrack(row: HTMLElement, view: TrackView) {
    const timings = trackTimings(view.clips);
    // zones de transition (chevauchements)
    for (let i = 0; i < timings.length; i++)
      for (let j = i + 1; j < timings.length; j++) {
        const A = timings[i], B = timings[j];
        const o1 = Math.min(A.end, B.end);
        if (B.start < o1 - 0.01) row.appendChild(h('div', { class: 'tl-xfade', style: `left:${8 + B.start * this.pps}px;width:${(o1 - B.start) * this.pps}px`, title: 'Transition (chevauchement)' }));
      }
    timings.forEach((tm) => {
      const e = EFFECT_MAP.get(tm.clip.effect);
      const color = tm.clip.effect === 'vide' ? '#3a4150' : e ? CATEGORY_COLORS[e.category] : '#888';
      const hasKeys = tm.clip.keys && Object.keys(tm.clip.keys).length > 0;
      const left = h('div', { class: 'tl-resize l', title: 'Glisser pour rogner le début' });
      const right = h('div', { class: 'tl-resize', title: 'Glisser pour changer la durée' });
      const el = h(
        'div',
        {
          class: `tl-clip${tm.clip.id === this.selected ? ' sel' : ''}${tm.clip.effect === 'vide' ? ' empty' : ''}`,
          style: `left:${8 + tm.start * this.pps}px;width:${Math.max(6, tm.clip.duration * this.pps - 1)}px;--c:${color}`,
          title: `${e?.name ?? tm.clip.effect} — ${tm.start.toFixed(1)} s → ${tm.end.toFixed(1)} s`,
        },
        h('div', { class: 'tl-clip-name' }, hasKeys ? '◆ ' : '', e?.name ?? tm.clip.effect),
        h('div', { class: 'tl-clip-dur' }, `${tm.clip.duration.toFixed(1)} s`),
        left,
        right,
      );
      // durée (bord droit)
      right.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        right.setPointerCapture(ev.pointerId);
        const x0 = ev.clientX, d0 = tm.clip.duration;
        const calc = (m: PointerEvent) => {
          const end = this.snapTime(tm.start + Math.max(0.5, d0 + (m.clientX - x0) / this.pps), tm.clip.id);
          return Math.round(Math.max(0.5, end - tm.start) * 100) / 100;
        };
        const mv = (m: PointerEvent) => {
          const d = calc(m);
          el.style.width = `${Math.max(6, d * this.pps - 1)}px`;
          this.ev.trim(tm.clip.id, tm.start, d, false);
        };
        right.addEventListener('pointermove', mv);
        right.addEventListener('pointerup', (m) => {
          right.removeEventListener('pointermove', mv);
          this.ev.trim(tm.clip.id, tm.start, calc(m), true);
        }, { once: true });
      });
      // rognage du début (bord gauche) : la fin reste fixe
      left.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        left.setPointerCapture(ev.pointerId);
        const x0 = ev.clientX;
        const calc = (m: PointerEvent): [number, number] => {
          let s = this.snapTime(Math.max(0, tm.start + (m.clientX - x0) / this.pps), tm.clip.id);
          s = Math.min(s, tm.end - 0.5);
          return [Math.round(s * 100) / 100, Math.round((tm.end - s) * 100) / 100];
        };
        const mv = (m: PointerEvent) => {
          const [st, d] = calc(m);
          el.style.left = `${8 + st * this.pps}px`;
          el.style.width = `${Math.max(6, d * this.pps - 1)}px`;
          this.ev.trim(tm.clip.id, st, d, false);
        };
        left.addEventListener('pointermove', mv);
        left.addEventListener('pointerup', (m) => {
          left.removeEventListener('pointermove', mv);
          this.ev.trim(tm.clip.id, ...calc(m), true);
        }, { once: true });
      });
      // déplacement libre (et changement de piste)
      el.addEventListener('pointerdown', (ev) => {
        el.setPointerCapture(ev.pointerId);
        this.ev.selectTrack(view.id);
        el.classList.add('sel');
        const x0 = ev.clientX;
        let moved = false;
        let target: HTMLElement | null = null;
        const startAt = (m: PointerEvent) => {
          let s = Math.max(0, tm.start + (m.clientX - x0) / this.pps);
          const se = this.snapTime(s, tm.clip.id);
          if (se !== s) s = se;
          else {
            const ee = this.snapTime(s + tm.clip.duration, tm.clip.id);
            if (ee !== s + tm.clip.duration) s = ee - tm.clip.duration;
          }
          return Math.round(Math.max(0, s) * 100) / 100;
        };
        const mv = (m: PointerEvent) => {
          if (Math.abs(m.clientX - x0) > 4 || Math.abs(m.clientY - ev.clientY) > 8) moved = true;
          if (!moved) return;
          el.classList.add('dragging');
          el.style.left = `${8 + startAt(m) * this.pps}px`;
          const under = document.elementsFromPoint(m.clientX, m.clientY).find((x) => x.classList.contains('tl-track')) as HTMLElement | undefined;
          target?.classList.remove('drop');
          target = under && under !== row ? under : null;
          target?.classList.add('drop');
          el.style.transform = target ? `translateY(${target.getBoundingClientRect().top - row.getBoundingClientRect().top}px)` : '';
        };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', (m) => {
          el.removeEventListener('pointermove', mv);
          target?.classList.remove('drop');
          if (!moved) {
            const r = this.content.getBoundingClientRect();
            this.selected = tm.clip.id;
            this.ev.seek(Math.max(0, (m.clientX - r.left - 8) / this.pps));
            this.ev.select(tm.clip.id);
            return;
          }
          this.selected = tm.clip.id;
          this.ev.move(tm.clip.id, target?.dataset.track ?? view.id, startAt(m), true);
          this.ev.select(tm.clip.id);
        }, { once: true });
      });
      row.appendChild(el);
    });
  }
}
