// Lumirock — application principale.
import { buildScene, MAX_WORK } from './analysis/maps';
import { fitToWork, rectify } from './analysis/rectify';
import { detectOpenings } from './analysis/detect';
import { AudioAnalysis, analyseAudio, audioFrameAt, decodeAudio } from './audio';
import { CATEGORIES, CATEGORY_COLORS, COMMON_PARAMS, EFFECTS, EFFECT_MAP, ParamDef, TRANSITIONS } from './effects/library';
import { Renderer, SceneMaps, ViewMode, freezeStarts, showDuration, trackTimings } from './gl/renderer';
import { PALETTES, PALETTE_FX, SCENARIOS, compose, defaultShow, newClip } from './scenarios';
import { TEMPLATES } from './templates';
import { Clip, Layer, MediaItem, Project, Pt, ZONE_TYPES, ZoneTypeKey, uid, zoneType } from './types';
import { History } from './history';
import { effectiveProgress, paramAt, removeKey, setKey } from './keys';
import { QuadEditor, Tool, ZoneEditor } from './ui/editors';
import { $, add, clear, fmtTime, h, icon, pickFile, select, slider, toast } from './ui/dom';
import { Stage } from './ui/stage';
import { MAIN_TRACK, Timeline } from './ui/timeline';
import { Preset, loadPresets, savePresets } from './presets';
import { Previews } from './ui/previews';
import { TOUR_HOME, TOUR_SHOW, markTour, runTour, tourDone } from './ui/tour';
import { OutputWarp, defaultCalibration, outputSlice } from './output/warp';
import { buildKit, canvasToPng, drawTemplate, zipFiles } from './export/kit';
import { exportClips, exportVideo, videoCodecFor } from './export/video';
import { SavedState, autosave, download, loadAutosave, loadLumirock, saveLumirock } from './export/projectio';

type Step = 'source' | 'redresser' | 'calques' | 'spectacle' | 'export';
type MapView = 'photo' | 'depth' | 'normal' | 'edges';
type ShowTab = 'scenarios' | 'tableaux' | 'reglages' | 'pistes' | 'musique' | 'ambiance';

const STEPS: { id: Step; label: string }[] = [
  { id: 'source', label: 'Monument' },
  { id: 'redresser', label: 'Redressement' },
  { id: 'calques', label: 'Calques' },
  { id: 'spectacle', label: 'Spectacle' },
  { id: 'export', label: 'Export' },
];

function emptyProject(): Project {
  return { version: 1, name: 'Mon spectacle', width: 0, height: 0, zones: [], show: defaultShow(), depthSource: 'auto' };
}

async function imageDataFromBlob(b: Blob, maxSide = 3200): Promise<ImageData> {
  const bmp = await createImageBitmap(b);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * s), H = Math.round(bmp.height * s);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

async function imageDataToBlob(img: ImageData) {
  const cv = new OffscreenCanvas(img.width, img.height);
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return await cv.convertToBlob({ type: 'image/png' });
}

function imageDataToCanvas(img: ImageData) {
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return cv;
}

export class App {
  step: Step = 'source';
  project: Project = emptyProject();
  stage = new Stage();
  renderer: Renderer;
  timeline: Timeline;
  zoneEditor: ZoneEditor;
  quadEditor: QuadEditor | null = null;
  quad: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  realAspect: number | null = null;
  sourceBlob: Blob | null = null;
  sourceImage: ImageData | null = null;
  sourceCanvas: HTMLCanvasElement | null = null;
  facade: ImageData | null = null;
  facadeBlob: Blob | null = null;
  aiDepth: Float32Array | null = null;
  aiDepthBlob: Blob | null = null;
  useAi = true;
  audio: { blob: Blob; name: string; analysis: AudioAnalysis } | null = null;
  scene: SceneMaps | null = null;
  view: ViewMode = 'simulation';
  mapView: MapView = 'photo';
  time = 0;
  playing = false;
  selectedClip: string | null = null;
  showTab: ShowTab = 'scenarios';
  dirty = true;
  private lastFrame = 0;
  private ac: AudioContext | null = null;
  private audioNode: AudioBufferSourceNode | null = null;
  private audioStart = 0;
  private rebuildTimer = 0;
  private saveTimer = 0;
  private exporting: AbortController | null = null;
  private hasAutosave: SavedState | null = null;
  private els!: { header: HTMLElement; side: HTMLElement; tl: HTMLElement; main: HTMLElement; viewSeg: HTMLElement; busy: HTMLElement };
  private exportOpts = { final: true, long: 1920, fps: 30, quality: 'haute' as 'haute' | 'tres-haute', content: 'full' as 'full' | 'clips' | 'selected', audio: true, mode: 'projection' as ViewMode };
  private detectSens = 0.5;
  history = new History();
  previews = new Previews();
  mediaBlobs = new Map<string, Blob>();
  private mediaRuntime = new Map<string, { image?: HTMLCanvasElement; video?: HTMLVideoElement; used?: number }>();
  private frameNo = 0;
  private newScenarioDur = 120;

  constructor(private root: HTMLElement) {
    this.renderer = new Renderer(this.stage.gl);
    this.zoneEditor = new ZoneEditor(this.stage);
    this.zoneEditor.onChange = (final) => {
      this.project.zones = this.zoneEditor.zones;
      if (final) {
        this.scheduleRebuild();
        this.renderSide();
        this.scheduleSave();
        this.stage.redraw();
      }
    };
    this.zoneEditor.onSelect = () => this.renderSide();
    this.zoneEditor.onAi = (p, detail) => this.aiClick(p, detail);
    this.timeline = new Timeline({
      seek: (t) => this.seek(t),
      select: (id, additive) => {
        if (additive && id) {
          if (!this.selectedClip) this.selectedClip = id;
          else if (id === this.selectedClip) {
            const next = [...this.multi][0] ?? null;
            if (next) this.multi.delete(next);
            this.selectedClip = next;
          } else if (this.multi.has(id)) this.multi.delete(id);
          else this.multi.add(id);
        } else {
          this.selectedClip = id;
          this.multi.clear();
          if (id) this.showTab = 'reglages';
        }
        this.refreshShowUI();
      },
      moveMany: (ids, delta) => {
        const fs = ids.map((i) => this.findClip(i)).filter((x): x is NonNullable<typeof x> => !!x);
        const minStart = Math.min(...fs.map((f) => f.start));
        const d = Math.max(-minStart, delta);
        for (const f of fs) f.clip.start = Math.round((f.start + d) * 100) / 100;
        this.refreshShowUI();
        this.scheduleSave();
      },
      selectTrack: (tid) => {
        this.timeline.activeTrack = tid;
      },
      move: (id, tid, start) => {
        const f = this.findClip(id);
        if (!f) return;
        f.clip.start = start;
        const dest = this.trackList(tid);
        if (dest !== f.list) {
          f.list.splice(f.list.indexOf(f.clip), 1);
          dest.push(f.clip);
          this.timeline.activeTrack = tid;
        }
        this.refreshShowUI();
        this.scheduleSave();
      },
      trim: (id, start, d, final) => {
        const c = this.findClip(id)?.clip;
        if (!c) return;
        c.start = start;
        c.duration = d;
        this.dirty = true;
        if (final) {
          this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
          this.renderSide();
          this.scheduleSave();
        }
      },
      togglePlay: () => this.togglePlay(),
      home: () => this.seek(0),
      addTrack: () => this.addLayer(),
      removeMarker: (i) => {
        this.project.show.markers?.splice(i, 1);
        this.refreshShowUI();
        this.scheduleSave();
      },
    });
    this.history.onChange = () => this.renderUndo();
    this.renderer.mediaProvider = (id, clip, local) => this.mediaSource(id, clip, local);
    this.renderer.onNeedRedraw = () => (this.dirty = true);
    this.stage.onResize = () => {
      this.dirty = true;
    };
    this.buildLayout();
    this.bindKeys();
    const errors = this.renderer.precompileAll(EFFECTS);
    if (errors.length) console.error(errors);
    requestAnimationFrame((t) => this.loop(t));
    this.goto('source');
    this.loadLogo();
    if (location.hash.includes('demo=')) this.openDemoFromHash();
    else if (!tourDone('home')) setTimeout(() => runTour(TOUR_HOME, () => markTour('home')), 900);
    loadAutosave().then((s) => {
      if (s && s.facade) {
        this.hasAutosave = s;
        if (this.step === 'source') this.renderSide();
      }
    });
  }

  // ───────────────────────── Mise en page ─────────────────────────
  private buildLayout() {
    const viewSeg = h('div', { class: 'seg view-seg' });
    const header = h('header', { class: 'top' });
    const side = h('aside', { class: 'side' });
    const tl = h('div', { class: 'tl-host' }, this.timeline.root);
    const busy = h('div', { class: 'busy' });
    const main = h('main', { class: 'main' }, this.stage.root, busy);
    this.root.append(header, h('div', { class: 'body' }, side, h('div', { class: 'center' }, main, tl)));
    this.els = { header, side, tl, main, viewSeg, busy };
    this.renderHeader();
    this.renderViewSwitch();
    // glisser-déposer global
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (f.name.endsWith('.lumirock')) this.openProjectFile(f);
      else if (f.type.startsWith('image/')) this.loadPhoto(f);
      else if (f.type.startsWith('audio/')) this.loadAudio(f);
    });
  }

  private renderHeader() {
    const hd = this.els.header;
    clear(hd);
    const can = (s: Step) => (s === 'source' ? true : s === 'redresser' ? !!this.sourceImage : !!this.facade);
    add(hd, 
      h('div', { class: 'brand', onclick: () => this.goto('source') },
        h('img', { class: 'logo-mark', src: `${import.meta.env.BASE_URL}favicon.png`, alt: '' }),
        h('span', { class: 'logo-text' }, h('span', { class: 'logo' }, 'LUMIROCK'), h('span', { class: 'by' }, 'by Arnisound tools')),
      ),
      this.facade || this.slots.length > 1 ? this.facadeSwitcher() : null,
      h('nav', { class: 'steps' },
        ...STEPS.map((s, i) =>
          h('button', { class: `step${this.step === s.id ? ' active' : ''}`, disabled: !can(s.id), onclick: () => this.goto(s.id) },
            h('span', { class: 'num' }, String(i + 1)), s.label),
        ),
      ),
      h('div', { class: 'spacer' }),
      this.project.schedule?.on ? h('button', { class: 'sched-badge', title: 'Programmation active — cliquer pour la gérer', onclick: () => this.goto('export') }, '⏰') : null,
      h('div', { class: 'actions' },
        (() => {
          const u = h('button', { class: 'btn icon ghost', title: 'Annuler (Ctrl+Z)', disabled: !this.history.canUndo(), onclick: () => this.undo() }, icon('undo'));
          const r = h('button', { class: 'btn icon ghost', title: 'Rétablir (Ctrl+Maj+Z)', disabled: !this.history.canRedo(), onclick: () => this.redo() }, icon('redo'));
          this.undoBtns = { u, r };
          return h('div', { class: 'undo' }, u, r);
        })(),
        h('button', { class: 'btn icon ghost help-btn', title: 'Visite guidée', onclick: () => runTour(this.step === 'spectacle' ? TOUR_SHOW : TOUR_HOME) }, icon('help')),
        h('button', { class: 'btn ghost', title: 'Nouveau projet', onclick: () => this.newProject() }, 'Nouveau'),
        h('button', { class: 'btn ghost', title: 'Ouvrir un fichier .lumirock', onclick: async () => {
          const f = await pickFile('.lumirock,application/zip');
          if (f) this.openProjectFile(f);
        } }, icon('folder'), 'Ouvrir'),
        h('button', { class: 'btn ghost', title: 'Enregistrer le projet (Ctrl+S)', disabled: !this.facade, onclick: () => this.saveProjectFile() }, icon('save'), 'Enregistrer'),
      ),
    );
  }

  private viewSwitch() {
    const seg = h('div', { class: 'seg' });
    const opts: { v: ViewMode; l: string; t: string }[] = [
      { v: 'simulation', l: 'Simulation nuit', t: 'Rendu tel que le public le verra sur le monument' },
      { v: 'projection', l: 'Projection', t: 'Image envoyée au vidéoprojecteur' },
      { v: 'jour', l: 'Photo', t: 'Photo de référence' },
    ];
    for (const o of opts)
      seg.append(h('button', { class: this.view === o.v ? 'on' : '', title: o.t, onclick: () => {
        this.view = o.v;
        this.dirty = true;
        this.renderViewSwitch();
      } }, o.l));
    return seg;
  }

  private renderViewSwitch() {
    clear(this.timeline.extra).append(
      this.viewSwitch(),
      h('button', { class: 'btn small', title: 'Mode live : déclencher les tableaux au clavier pendant le spectacle', onclick: () => this.enterLive() }, icon('live'), 'Live'),
      h('button', { class: 'btn icon', title: 'Sortie projecteur : ouvre une 2e fenêtre à glisser sur le vidéoprojecteur', onclick: () => this.openOutput() }, icon('screen')),
      h('button', { class: 'btn icon', title: 'Plein écran (F)', onclick: () => this.fullscreen() }, icon('expand')),
    );
  }

  // ───────────────────────── Mode live ─────────────────────────
  live = {
    on: false,
    cur: null as { clip: Clip; start: number } | null,
    prev: null as { clip: Clip; start: number } | null,
    transStart: 0,
    transDur: 1.5,
    transType: 'fondu',
    master: 1,
    masterTarget: 1,
    blackout: false,
    bpm: 120,
    beatOrigin: 0,
    taps: [] as number[],
  };
  private liveKeys = '1234567890azeryuiopqsdghjklmwxcvn';

  liveClips(): Clip[] {
    const all = [...this.project.show.clips, ...(this.project.show.layers ?? []).flatMap((l) => l.clips)];
    return all.filter((c) => c.effect !== 'vide').slice(0, this.liveKeys.length);
  }

  private liveNow() {
    return performance.now() / 1000;
  }

  enterLive() {
    if (!this.scene) return;
    this.pause();
    this.live.on = true;
    this.live.bpm = this.audio?.analysis.bpm ?? this.project.show.bpm;
    this.live.beatOrigin = this.liveNow();
    this.live.cur = null;
    this.live.prev = null;
    this.els.tl.style.display = 'none';
    this.root.dataset.live = '1';
    this.renderSide();
    requestAnimationFrame(() => this.stage.fit());
    toast('Mode live : touches des pads pour déclencher, Espace = suivant, B = noir, T = tempo, ↑↓ = intensité, Échap pour quitter.', 'info', 7000);
  }

  exitLive() {
    this.live.on = false;
    this.stopAudio();
    delete this.root.dataset.live;
    this.els.tl.style.display = 'block';
    this.renderSide();
    requestAnimationFrame(() => this.stage.fit());
    this.dirty = true;
  }

  liveTrigger(clip: Clip) {
    const now = this.liveNow();
    this.live.prev = this.live.cur;
    this.live.cur = { clip, start: now };
    this.live.transStart = now;
    if (this.live.blackout) this.toggleBlackout();
    this.renderLivePads();
  }

  toggleBlackout() {
    this.live.blackout = !this.live.blackout;
    this.live.masterTarget = this.live.blackout ? 0 : 1;
    this.renderLivePads();
  }

  tapTempo() {
    const now = this.liveNow();
    const taps = (this.live.taps = [...this.live.taps.filter((t) => now - t < 3), now]);
    if (taps.length >= 2) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      this.live.bpm = Math.round(Math.min(200, Math.max(50, 60 / iv)) * 10) / 10;
    }
    this.live.beatOrigin = now;
    this.renderLivePads();
  }

  private livePads: HTMLElement | null = null;

  private sideLive(s: HTMLElement) {
    const L = this.live;
    this.livePads = h('div', { class: 'pads' });
    add(s,
      h('div', { class: 'live-head' }, h('span', { class: 'live-dot' }), h('h2', {}, 'Live'),
        h('button', { class: 'btn ghost', onclick: () => this.exitLive() }, 'Quitter (Échap)')),
      h('p', { class: 'muted small' }, 'Cliquez ou tapez la touche d’un pad pour lancer le tableau, avec un fondu. Les pads reprennent les tableaux de votre spectacle.'),
      this.livePads,
      h('div', { class: 'card' },
        select<string>({ label: 'Transition', value: L.transType, options: TRANSITIONS.filter((t) => t.id !== 'cascade').map((t) => ({ value: t.id, label: t.label })), onChange: (v) => (L.transType = v) }),
        slider({ label: 'Durée du fondu (s)', min: 0, max: 6, step: 0.1, value: L.transDur, onInput: (v) => (L.transDur = v) }),
        slider({ label: 'Intensité générale (↑ ↓)', min: 0, max: 1.5, step: 0.01, value: L.masterTarget, onInput: (v) => (L.masterTarget = v) }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => this.tapTempo() }, 'Tempo (T) · ', h('span', { class: 'live-bpm' }, `${L.bpm} BPM`)),
          h('button', { class: `btn danger${L.blackout ? ' on' : ''}`, onclick: () => this.toggleBlackout() }, 'Noir (B)'),
        ),
        this.audio ? h('button', { class: 'btn ghost wide', onclick: () => {
          if (this.audioNode) this.stopAudio();
          else {
            this.time = 0;
            this.startAudio();
            L.bpm = this.audio!.analysis.bpm;
          }
          this.renderSide();
        } }, icon('music'), this.audioNode ? 'Arrêter la musique' : 'Lancer la musique') : null,
        h('button', { class: 'btn ghost wide', onclick: () => this.openOutput() }, icon('screen'), 'Sortie projecteur (2e fenêtre)'),
        h('button', { class: 'btn ghost wide', onclick: () => this.calibrateOutput() }, 'Caler le projecteur sur le monument'),
      ),
    );
    this.renderLivePads();
  }

  private renderLivePads() {
    const pads = this.livePads;
    if (!pads) return;
    clear(pads);
    this.liveClips().forEach((c, i) => {
      const e = EFFECT_MAP.get(c.effect);
      pads.append(h('button', {
        class: `pad${this.live.cur?.clip.id === c.id ? ' on' : ''}`,
        style: `--c:${e ? CATEGORY_COLORS[e.category] : '#888'}`,
        onclick: () => this.liveTrigger(c),
      }, h('kbd', {}, this.liveKeys[i].toUpperCase()), h('span', {}, e?.name ?? c.effect)));
    });
    const bpmEl = this.els.side.querySelector('.live-bpm');
    if (bpmEl) bpmEl.textContent = `${this.live.bpm} BPM`;
  }

  private renderLiveFrame() {
    const L = this.live;
    const now = this.liveNow();
    L.master += (L.masterTarget - L.master) * 0.12;
    const loc = (x: { clip: Clip; start: number }) => ({ clip: x.clip, local: (now - x.start) % x.clip.duration });
    const m = L.transDur > 0 ? Math.min(1, (now - L.transStart) / L.transDur) : 1;
    const A = L.prev && m < 1 ? loc(L.prev) : null;
    const B = L.cur ? loc(L.cur) : null;
    let frame;
    if (this.audioNode && this.ac && this.audio) frame = audioFrameAt(this.ac.currentTime - this.audioStart, this.audio.analysis, L.bpm);
    else frame = audioFrameAt(now - L.beatOrigin, null, L.bpm);
    const mode = this.view === 'jour' ? 'projection' : this.view;
    this.renderer.renderLive(A, B, A ? m : 1, L.transType, frame, this.project.show, now, mode, L.master);
  }

  // ───────────────────────── Sortie projecteur ─────────────────────────
  private outputs: ({ win: Window; warp: OutputWarp } | null)[] = [];

  private outputConf() {
    return this.project.outputs ?? { count: 1, overlap: 0.12 };
  }

  private calibFor(i: number) {
    return (i === 0 ? this.project.calibration : this.project.calibrations?.[i - 1]) ?? defaultCalibration();
  }

  private setCalibFor(i: number, c: ReturnType<typeof defaultCalibration> | undefined) {
    if (i === 0) this.project.calibration = c;
    else {
      const arr = (this.project.calibrations ??= []);
      while (arr.length < i) arr.push(null);
      arr[i - 1] = c ?? null;
    }
  }

  private outputOpen() {
    return this.outputs.some((o) => o && !o.win.closed);
  }

  /** Met à jour la découpe de toutes les sorties ouvertes (nombre / recouvrement changés). */
  private refreshSlices() {
    const { count, overlap } = this.outputConf();
    this.outputs.forEach((o, i) => {
      if (!o || o.win.closed) return;
      o.warp.slice = outputSlice(i, count, overlap);
      o.warp.label = count > 1 ? `${i + 1} / ${count}` : '';
    });
  }

  /** Ouvre la sortie projecteur i en mode calage. */
  calibrateOutput(i = 0) {
    const o0 = this.outputs[i];
    if (!o0 || o0.win.closed) this.openOutput(i);
    const o = this.outputs[i];
    if (!o || o.win.closed) return;
    o.warp.setCalibrating(true);
    o.win.focus();
    toast('Calage : glissez les points dans la fenêtre projecteur (aide affichée dans la fenêtre).', 'info', 6000);
  }

  resetCalibration(i = 0) {
    this.setCalibFor(i, defaultCalibration());
    this.outputs[i]?.warp.reset();
    this.scheduleSave();
    toast('Calage réinitialisé.', 'ok');
  }

  openOutput(i = 0) {
    const cur = this.outputs[i];
    if (cur && !cur.win.closed) {
      cur.win.focus();
      return;
    }
    const w = window.open('', `lumirock-sortie-${i + 1}`, 'popup,width=1280,height=720');
    if (!w) {
      toast('La fenêtre a été bloquée : autorisez les fenêtres pop-up pour ce site.', 'err', 6000);
      return;
    }
    const { count } = this.outputConf();
    w.document.title = count > 1 ? `Lumirock — Projecteur ${i + 1}` : 'Lumirock — Sortie projecteur';
    w.document.body.replaceChildren();
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
    const v = w.document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    v.srcObject = this.stage.gl.captureStream(60);
    w.document.body.appendChild(v);
    v.play().catch(() => undefined);
    const warp = new OutputWarp(w, v, this.calibFor(i), (c) => {
      this.setCalibFor(i, c);
      this.scheduleSave(false);
    }, () => {
      if (!this.scene) return null;
      const m = drawTemplate(this.scene, this.project, true, Math.max(1, 1600 / this.scene.width));
      const cv = w.document.createElement('canvas');
      cv.width = m.width;
      cv.height = m.height;
      cv.getContext('2d')!.drawImage(m, 0, 0);
      return cv;
    });
    this.outputs[i] = { win: w, warp };
    this.refreshSlices();
    const hint = w.document.createElement('div');
    hint.textContent = `${count > 1 ? `Projecteur ${i + 1} / ${count} — ` : ''}glissez cette fenêtre sur le vidéoprojecteur, double-cliquez pour le plein écran, touche C pour caler l’image sur le monument`;
    hint.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);color:#e0a23e;font:14px sans-serif;background:rgba(0,0,0,.7);padding:8px 14px;border-radius:8px;transition:opacity 1s;z-index:4';
    w.document.body.appendChild(hint);
    setTimeout(() => (hint.style.opacity = '0'), 6000);
    w.document.addEventListener('dblclick', () => (w.document.fullscreenElement ? w.document.exitFullscreen() : w.document.documentElement.requestFullscreen()));
    if (this.view !== 'projection') {
      this.view = 'projection';
      this.renderViewSwitch();
    }
    this.dirty = true;
    toast(count > 1 ? `Projecteur ${i + 1} ouvert.` : 'Sortie projecteur ouverte (vue « Projection » activée).', 'ok');
  }

  // ───────────────────────── Programmation horaire ─────────────────────────
  private scheduleTimer = 0;
  private scheduleBlack = false;
  private scheduleRunning = false;
  private wakeLock: { release: () => Promise<void> } | null = null;

  private schedConf() {
    return this.project.schedule ?? { on: false, start: '21:00', end: '23:30', days: [0, 1, 2, 3, 4, 5, 6] };
  }

  private inScheduleWindow(d = new Date()) {
    const c = this.schedConf();
    const [sh, sm] = c.start.split(':').map(Number), [eh, em] = c.end.split(':').map(Number);
    const now = d.getHours() * 60 + d.getMinutes(), a = sh * 60 + sm, b = eh * 60 + em;
    // plage qui passe minuit : le jour de référence est celui du démarrage
    if (a <= b) return c.days.includes(d.getDay()) && now >= a && now < b;
    if (now >= a) return c.days.includes(d.getDay());
    const prev = (d.getDay() + 6) % 7;
    return now < b && c.days.includes(prev);
  }

  private nextStartLabel() {
    const c = this.schedConf();
    const d = new Date();
    for (let k = 0; k < 8; k++) {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
      const [sh, sm] = c.start.split(':').map(Number);
      day.setHours(sh, sm, 0, 0);
      if (day > d && c.days.includes(day.getDay())) {
        return k === 0 ? `aujourd’hui à ${c.start}` : k === 1 ? `demain à ${c.start}` : `${day.toLocaleDateString('fr-FR', { weekday: 'long' })} à ${c.start}`;
      }
    }
    return '—';
  }

  armSchedule(on: boolean) {
    this.project.schedule = { ...this.schedConf(), on };
    this.scheduleSave();
    clearInterval(this.scheduleTimer);
    this.scheduleBlack = false;
    if (on) {
      // geste utilisateur : on prépare le son et on empêche la mise en veille
      this.ac ??= new AudioContext();
      this.ac.resume();
      (navigator as any).wakeLock?.request('screen').then((l: any) => (this.wakeLock = l)).catch(() => undefined);
      this.scheduleTick();
      this.scheduleTimer = window.setInterval(() => this.scheduleTick(), 1000);
      toast(`Programmation active : ${this.inScheduleWindow() ? 'le spectacle démarre maintenant' : 'prochain démarrage ' + this.nextStartLabel()}. Laissez cet onglet ouvert.`, 'ok', 6000);
    } else {
      this.wakeLock?.release().catch(() => undefined);
      this.wakeLock = null;
      this.scheduleRunning = false;
      this.dirty = true;
    }
    this.renderHeader();
  }

  private scheduleTick() {
    const inside = this.inScheduleWindow();
    if (inside && !this.scheduleRunning) {
      this.scheduleRunning = true;
      this.scheduleBlack = false;
      if (this.live.on) this.exitLive();
      this.timeline.loop = true;
      this.seek(0);
      this.play();
    } else if (!inside && (this.scheduleRunning || !this.scheduleBlack)) {
      this.scheduleRunning = false;
      this.pause();
      this.scheduleBlack = true;
      this.dirty = true;
    }
    const badge = document.querySelector('.sched-badge');
    if (badge) {
      badge.textContent = inside ? `⏰ → ${this.schedConf().end}` : `⏰ ${this.schedConf().start}`;
      (badge as HTMLElement).title = inside ? `Spectacle en cours jusqu’à ${this.schedConf().end}` : `Prochain spectacle ${this.nextStartLabel()}`;
    }
  }

  private scheduleCard() {
    const c = this.schedConf();
    const set = (x: Partial<typeof c>) => {
      this.project.schedule = { ...this.schedConf(), ...x };
      this.scheduleSave();
    };
    const start = h('input', { type: 'time', value: c.start });
    const end = h('input', { type: 'time', value: c.end });
    start.addEventListener('change', () => set({ start: start.value || '21:00' }));
    end.addEventListener('change', () => set({ end: end.value || '23:30' }));
    const days = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const order = [1, 2, 3, 4, 5, 6, 0];
    return h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Programmation (installation de plusieurs soirs)'),
      h('p', { class: 'muted small' }, 'Le spectacle démarre tout seul à l’heure prévue, tourne en boucle, puis la projection passe au noir. Laissez l’ordinateur allumé avec cet onglet et la sortie projecteur ouverts.'),
      h('div', { class: 'row sched-times' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Début'), start),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Fin'), end),
      ),
      h('div', { class: 'days' }, ...order.map((d) => h('button', { class: `day${c.days.includes(d) ? ' on' : ''}`, onclick: (e: Event) => {
        const cur = this.schedConf().days;
        set({ days: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] });
        (e.target as HTMLElement).classList.toggle('on');
      } }, days[d]))),
      c.on
        ? h('button', { class: 'btn danger wide', onclick: () => {
            this.armSchedule(false);
            this.renderSide();
          } }, 'Arrêter la programmation')
        : h('button', { class: 'btn primary wide', onclick: () => {
            this.armSchedule(true);
            this.renderSide();
          } }, '⏰ Activer la programmation'),
    );
  }

  private projectorsCard() {
    const conf = this.outputConf();
    const set = (c: Partial<typeof conf>) => {
      this.project.outputs = { ...conf, ...c };
      this.refreshSlices();
      this.scheduleSave();
    };
    return h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Projeter directement'),
      h('p', { class: 'muted small' }, 'Ouvrez la sortie, glissez-la sur l’écran du vidéoprojecteur, double-cliquez pour le plein écran, puis calez l’image sur le monument : 4 coins pour la perspective, grille 3×3 ou 5×5 pour les façades irrégulières. Le calage est enregistré avec le projet.'),
      select<number>({ label: 'Nombre de vidéoprojecteurs (côte à côte)', value: conf.count, options: [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? '1 projecteur' : `${n} projecteurs, avec fondu des bords` })), onChange: (v) => {
        set({ count: v });
        this.renderSide();
      } }),
      conf.count > 1 ? slider({ label: 'Recouvrement entre projecteurs', min: 0.02, max: 0.35, step: 0.01, value: conf.overlap, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => set({ overlap: v }) }) : null,
      ...Array.from({ length: conf.count }, (_, i) => h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => this.openOutput(i) }, icon('screen'), conf.count > 1 ? `Sortie ${i + 1}` : 'Sortie projecteur'),
        h('button', { class: 'btn primary', onclick: () => this.calibrateOutput(i) }, 'Caler'),
        h('button', { class: 'btn ghost', title: 'Réinitialiser le calage', onclick: () => this.resetCalibration(i) }, '↺'),
      )),
      conf.count > 1 ? h('p', { class: 'muted small' }, 'Chaque bouton ouvre une fenêtre (une par projecteur). Les zones de recouvrement sont fondues automatiquement pour que la jonction soit invisible.') : null,
    );
  }

  goto(step: Step) {
    if (step !== 'spectacle' && step !== 'export' && this.playing) this.pause();
    this.step = step;
    this.renderHeader();
    this.els.tl.style.display = step === 'spectacle' || step === 'export' ? 'block' : 'none';
    this.root.dataset.step = step;
    if (step === 'redresser' && this.sourceCanvas) {
      this.quadEditor = new QuadEditor(this.stage, this.sourceCanvas);
      this.quadEditor.quad = this.quad;
      this.quadEditor.attach();
    } else if (step === 'calques' && this.facade) {
      this.stage.setAspect(this.facade.width / this.facade.height);
      this.zoneEditor.zones = this.project.zones;
      this.zoneEditor.attach();
    } else {
      this.stage.handlers = {};
      this.stage.setMode({ gl: !!this.facade, overlay: false });
      if (this.facade) this.stage.setAspect(this.facade.width / this.facade.height);
      this.stage.redraw();
    }
    if (step === 'spectacle' || step === 'export') {
      this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
      requestAnimationFrame(() => this.timeline.fit());
      this.updateGizmo();
    }
    this.renderSide();
    this.renderStageHint();
    if (step === 'spectacle' && !tourDone('show') && !this.root.dataset.demo && !document.querySelector('.tour')) setTimeout(() => runTour(TOUR_SHOW, () => markTour('show')), 700);
    requestAnimationFrame(() => this.stage.fit());
    this.dirty = true;
  }

  private renderStageHint() {
    this.stage.root.querySelector('.hero')?.remove();
    this.stage.frame.style.visibility = this.step === 'source' && !this.facade ? 'hidden' : '';
    if (this.step === 'source' && !this.facade) {
      this.stage.root.append(
        h('div', { class: 'hero' },
          h('img', { class: 'hero-logo', src: `${import.meta.env.BASE_URL}logo.webp`, alt: 'Lumirock' }),
          h('div', { class: 'hero-title' }, 'Faites parler les pierres.'),
          h('p', {}, 'Lumirock transforme la photo d’un monument en spectacle de video mapping, prêt à projeter — directement dans votre navigateur, sans rien installer.'),
          h('ol', {},
            h('li', {}, h('b', {}, 'Monument'), ' — importez une photo de façade, ou choisissez un modèle.'),
            h('li', {}, h('b', {}, 'Redressement'), ' — 4 clics pour mettre la façade bien de face.'),
            h('li', {}, h('b', {}, 'Calques'), ' — détourez fenêtres, rosace, colonnes (détection automatique incluse).'),
            h('li', {}, h('b', {}, 'Spectacle'), ` — composez avec ${EFFECTS.length} tableaux, des scénarios et votre musique.`),
            h('li', {}, h('b', {}, 'Export'), ' — vidéo MP4 et kit pro pour Resolume, MadMapper, Modulo Pi, After Effects, DaVinci.'),
          ),
        ),
      );
    }
  }

  // ───────────────────────── Panneau latéral ─────────────────────────
  renderSide() {
    this.previews.stop();
    const s = clear(this.els.side);
    if (this.live.on) this.sideLive(s);
    else if (this.step === 'source') this.sideSource(s);
    else if (this.step === 'redresser') this.sideRectify(s);
    else if (this.step === 'calques') this.sideLayers(s);
    else if (this.step === 'spectacle') this.sideShow(s);
    else this.sideExport(s);
  }

  private sideSource(s: HTMLElement) {
    const drop = h('div', { class: 'dropzone', onclick: async () => {
      const f = await pickFile('image/*');
      if (f) this.loadPhoto(f);
    } },
      icon('upload'),
      h('div', { class: 'dz-title' }, 'Importer une photo de façade'),
      h('div', { class: 'dz-sub' }, 'Glissez-déposez ou cliquez · JPG, PNG, WEBP'),
    );
    add(s, 
      h('h2', {}, 'Votre monument'),
      drop,
      h('ul', { class: 'tips' },
        h('li', {}, 'Prenez la photo le plus en face possible, de jour, sans voitures ni arbres devant.'),
        h('li', {}, 'Plus la photo est grande, plus les calques seront précis.'),
      ),
      this.hasAutosave ? h('button', { class: 'btn primary wide', onclick: () => this.restore(this.hasAutosave!) }, 'Reprendre le projet en cours') : null,
      h('h3', {}, 'Ou partez d’un monument modèle'),
      h('div', { class: 'templates' },
        ...TEMPLATES.map((t) => {
          const thumb = h('div', { class: 'tpl-thumb' });
          this.thumbFor(t.id).then((url) => (thumb.style.backgroundImage = `url(${url})`));
          return h('button', { class: 'tpl', onclick: () => this.loadTemplate(t.id) }, thumb,
            h('div', { class: 'tpl-info' }, h('b', {}, t.name), h('span', {}, t.description)));
        }),
      ),
      h('button', { class: 'btn ghost wide', onclick: async () => {
        const f = await pickFile('.lumirock,application/zip');
        if (f) this.openProjectFile(f);
      } }, icon('folder'), 'Ouvrir un projet .lumirock'),
    );
  }

  private thumbCache = new Map<string, Promise<string>>();
  private thumbFor(id: string) {
    if (!this.thumbCache.has(id)) {
      this.thumbCache.set(id, new Promise((res) => {
        setTimeout(async () => {
          const t = TEMPLATES.find((x) => x.id === id)!.build();
          const cv = new OffscreenCanvas(240, Math.round((240 * t.image.height) / t.image.width));
          const big = new OffscreenCanvas(t.image.width, t.image.height);
          big.getContext('2d')!.putImageData(t.image, 0, 0);
          const ctx = cv.getContext('2d')!;
          ctx.filter = 'brightness(0.35) saturate(0.7)';
          ctx.drawImage(big, 0, 0, cv.width, cv.height);
          ctx.filter = 'none';
          // petit effet lumineux sur les contours des calques
          ctx.strokeStyle = 'rgba(224,162,62,0.9)';
          ctx.lineWidth = 1.2;
          ctx.shadowColor = '#e0a23e';
          ctx.shadowBlur = 6;
          for (const z of t.zones) {
            ctx.beginPath();
            z.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * cv.width, y * cv.height) : ctx.moveTo(x * cv.width, y * cv.height)));
            ctx.closePath();
            ctx.stroke();
          }
          const blob = await cv.convertToBlob({ type: 'image/png' });
          res(URL.createObjectURL(blob));
        }, 50);
      }));
    }
    return this.thumbCache.get(id)!;
  }

  private sideRectify(s: HTMLElement) {
    const ratio = h('input', { type: 'text', placeholder: 'ex. 24 × 30', value: this.realAspect ? String(this.realAspect) : '' });
    add(s, 
      h('h2', {}, 'Redresser la façade'),
      h('p', { class: 'muted' }, 'Faites glisser les 4 poignées sur les angles de la façade. Une loupe apparaît pour viser précisément. L’image sera « mise à plat », comme vue parfaitement de face.'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Dimensions réelles (facultatif, largeur × hauteur)'), ratio),
      h('p', { class: 'muted small' }, 'Si vous connaissez la taille réelle de la façade (en mètres), les proportions seront exactes. Sinon, elles sont estimées.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => {
          this.quad.splice(0, 4, [0, 0], [1, 0], [1, 1], [0, 1]);
          this.stage.redraw();
        } }, 'Image entière'),
        h('button', { class: 'btn ghost', onclick: () => {
          this.quad.splice(0, 4, [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]);
          this.stage.redraw();
        } }, 'Réinitialiser'),
      ),
      h('button', { class: 'btn primary wide', onclick: () => {
        const m = ratio.value.replace(',', '.').match(/([\d.]+)\s*[x×*\/ ]\s*([\d.]+)/);
        this.realAspect = m ? Number(m[1]) / Number(m[2]) : null;
        this.applyRectify();
      } }, 'Redresser et continuer'),
      h('button', { class: 'btn ghost wide', onclick: () => this.applyRectify(true) }, 'Ma photo est déjà bien de face'),
    );
  }

  private sideLayers(s: HTMLElement) {
    const z = this.zoneEditor;
    const tools: { t: Tool; ic: Parameters<typeof icon>[0]; l: string; k: string }[] = [
      { t: 'ia', ic: 'wand', l: 'Détourage IA : cliquez sur un élément (Alt+clic = un détail plus petit)', k: 'W' },
      { t: 'select', ic: 'cursor', l: 'Sélection / déplacer', k: 'V' },
      { t: 'rect', ic: 'rect', l: 'Rectangle', k: 'R' },
      { t: 'arch', ic: 'arch', l: 'Arc en plein cintre', k: 'A' },
      { t: 'gothic', ic: 'gothic', l: 'Arc brisé (gothique)', k: 'G' },
      { t: 'ellipse', ic: 'ellipse', l: 'Ellipse / rosace', k: 'E' },
      { t: 'poly', ic: 'poly', l: 'Polygone libre (double-clic pour fermer)', k: 'P' },
    ];
    const toolbar = h('div', { class: 'toolbar' },
      ...tools.map((t) => h('button', { class: `btn icon${z.tool === t.t ? ' on' : ''}`, title: `${t.l} (${t.k})`, onclick: () => {
        z.setTool(t.t);
        this.renderSide();
      } }, icon(t.ic))),
    );
    const typeSel = select<ZoneTypeKey>({
      label: 'Type des nouveaux calques', value: z.newType,
      options: ZONE_TYPES.map((t) => ({ value: t.key as ZoneTypeKey, label: t.label })),
      onChange: (v) => (z.newType = v),
    });
    const mapSeg = h('div', { class: 'seg small' },
      ...([['photo', 'Photo'], ['depth', 'Profondeur'], ['normal', 'Relief'], ['edges', 'Contours']] as [MapView, string][]).map(([v, l]) =>
        h('button', { class: this.mapView === v ? 'on' : '', onclick: () => {
          this.mapView = v;
          this.dirty = true;
          this.renderSide();
        } }, l)),
    );
    const sel = z.zones.find((x) => x.id === z.selected);
    const selPanel = sel
      ? h('div', { class: 'card' },
          h('div', { class: 'card-title' }, 'Calque sélectionné'),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nom'),
            h('input', { type: 'text', value: sel.name, oninput: (e: Event) => {
              sel.name = (e.target as HTMLInputElement).value;
              this.scheduleSave();
            } })),
          select<ZoneTypeKey>({ label: 'Type', value: sel.type, options: ZONE_TYPES.map((t) => ({ value: t.key as ZoneTypeKey, label: t.label })), onChange: (v) => {
            sel.type = v;
            this.zoneEditor.onChange?.(true);
          } }),
          slider({ label: 'Relief (avancée)', min: 0, max: 1, step: 0.01, value: sel.relief ?? zoneType(sel.type).relief, onInput: (v) => {
            sel.relief = v;
            this.scheduleRebuild();
          } }),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => {
              const copy = { ...sel, id: uid(), name: sel.name + ' (copie)', points: sel.points.map(([x, y]) => [x + 0.02, y] as Pt) };
              z.zones.push(copy);
              z.selected = copy.id;
              this.zoneEditor.onChange?.(true);
            } }, icon('copy'), 'Dupliquer'),
            h('button', { class: 'btn ghost', onclick: () => {
              const c = { ...sel, id: uid(), name: sel.name + ' (miroir)', points: sel.points.map(([x, y]) => [1 - x, y] as Pt).reverse() };
              z.zones.push(c);
              z.selected = c.id;
              this.zoneEditor.onChange?.(true);
            } }, 'Miroir'),
            h('button', { class: 'btn danger', onclick: () => this.deleteZone(sel.id) }, icon('trash')),
          ),
          h('p', { class: 'muted small' }, 'Glissez les carrés blancs pour ajuster. Double-clic sur un bord pour ajouter un point. « Miroir » crée le calque symétrique.'),
        )
      : null;
    const list = h('div', { class: 'zone-list' },
      ...z.zones.map((zz) => {
        const t = zoneType(zz.type);
        return h('div', { class: `zone-item${zz.id === z.selected ? ' sel' : ''}`, onclick: () => {
          z.selected = zz.id;
          this.renderSide();
          this.stage.redraw();
        } }, h('span', { class: 'dot', style: `background:${t.color}` }), h('span', { class: 'zn' }, zz.name), h('span', { class: 'zt' }, t.label.split(' (')[0]));
      }),
    );
    const aiBtn = h('button', { class: 'btn ghost wide', onclick: () => this.runAiDepth(aiBtn) }, icon('magic'), this.aiDepth ? 'Profondeur IA calculée ✓ (recalculer)' : 'Calculer la profondeur par IA');
    add(s, 
      h('h2', {}, 'Calques de la façade'),
      h('p', { class: 'muted' }, 'Chaque calque est un élément animable : fenêtres, portes, rosace, colonnes… Plus ils sont précis, plus le spectacle est bluffant.'),
      toolbar,
      typeSel,
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Assistants'),
        slider({ label: 'Sensibilité de la détection', min: 0, max: 1, step: 0.05, value: this.detectSens, onInput: (v) => (this.detectSens = v) }),
        h('button', { class: 'btn ghost wide', onclick: () => this.autoDetect() }, icon('magic'), 'Détecter fenêtres et portes'),
        aiBtn,
        this.aiDepth ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.useAi, onchange: (e: Event) => {
          this.useAi = (e.target as HTMLInputElement).checked;
          this.scheduleRebuild();
        } }), 'Utiliser la profondeur IA') : null,
        h('p', { class: 'muted small' }, 'L’IA (Depth Anything V2) tourne dans votre navigateur : rien n’est envoyé sur Internet. Premier lancement : ~25 Mo à télécharger.'),
      ),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Affichage'), mapSeg),
      selPanel,
      h('h3', {}, `${z.zones.length} calque${z.zones.length > 1 ? 's' : ''}`),
      list,
      h('button', { class: 'btn primary wide', onclick: () => this.goto('spectacle') }, 'Continuer vers le spectacle'),
    );
  }

  private sideShow(s: HTMLElement) {
    const tabs: { id: ShowTab; l: string }[] = [
      { id: 'scenarios', l: 'Scénarios' },
      { id: 'tableaux', l: 'Tableaux' },
      { id: 'reglages', l: 'Réglages' },
      { id: 'pistes', l: 'Pistes' },
      { id: 'musique', l: 'Musique' },
      { id: 'ambiance', l: 'Ambiance' },
    ];
    add(s, h('div', { class: 'tabs' }, ...tabs.map((t) => h('button', { class: this.showTab === t.id ? 'on' : '', onclick: () => {
      this.showTab = t.id;
      this.renderSide();
    } }, t.l))));
    const body = h('div', { class: 'tab-body' });
    add(s, body);
    if (this.showTab === 'scenarios') this.tabScenarios(body);
    else if (this.showTab === 'tableaux') this.tabLibrary(body);
    else if (this.showTab === 'reglages') this.tabClip(body);
    else if (this.showTab === 'pistes') this.tabTracks(body);
    else if (this.showTab === 'musique') this.tabMusic(body);
    else this.tabAmbiance(body);
  }

  private tabScenarios(b: HTMLElement) {
    const dur = this.audio ? Math.round(this.audio.analysis.duration) : this.newScenarioDur;
    const durInput = h('input', { type: 'number', min: '20', max: '1200', step: '5', value: String(dur), disabled: !!this.audio });
    durInput.addEventListener('change', () => (this.newScenarioDur = Number(durInput.value) || 120));
    const run = (id: string) => {
      const total = this.audio ? this.audio.analysis.duration : Number(durInput.value) || 120;
      this.project.show.clips = compose(id, total, this.audio?.analysis ?? null, this.project.show.bpm, (this.project.show.markers ?? []).map((m) => m.t));
      this.selectedClip = null;
      this.seek(0);
      this.refreshShowUI();
      this.timeline.fit();
      this.scheduleSave();
      toast('Spectacle composé ! Lancez la lecture avec Espace.', 'ok');
    };
    add(b, 
      h('p', { class: 'muted' }, 'Un scénario compose automatiquement un spectacle complet : introduction, montée, apogée et final. Vous pourrez ensuite tout modifier.'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, this.audio ? 'Durée (calée sur la musique)' : 'Durée du spectacle (secondes)'), durInput),
      h('div', { class: 'scenarios' },
        ...SCENARIOS.map((sc) => h('button', { class: 'scenario', onclick: () => run(sc.id) },
          h('span', { class: 'sc-colors', style: `background:linear-gradient(135deg, ${sc.palette[0]}, ${sc.palette[1]})` }),
          h('span', { class: 'sc-text' }, h('b', {}, sc.name), h('span', {}, sc.description)))),
        h('button', { class: 'scenario surprise', onclick: () => run('surprise') },
          h('span', { class: 'sc-colors dice' }, icon('dice')),
          h('span', { class: 'sc-text' }, h('b', {}, 'Surprends-moi'), h('span', {}, 'Une composition aléatoire mais cohérente, pour trouver des idées.'))),
      ),
    );
  }

  private tabTracks(b: HTMLElement) {
    const show = this.project.show;
    const layers = show.layers ?? [];
    const changed = () => {
      this.timeline.render();
      this.dirty = true;
      this.scheduleSave();
    };
    add(b,
      h('p', { class: 'muted' }, 'Placez les tableaux librement : un espace vide = noir, deux tableaux qui se chevauchent = transition. Glissez un tableau sur une autre piste pour le superposer (les lumières s’additionnent).'),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Piste principale'),
        h('p', { class: 'muted small' }, `${show.clips.length} tableaux`),
        h('button', { class: 'btn ghost wide', onclick: () => this.closeGaps(MAIN_TRACK) }, 'Supprimer les vides'),
        h('button', { class: 'btn ghost wide', onclick: () => {
          this.timeline.activeTrack = MAIN_TRACK;
          this.showTab = 'tableaux';
          this.refreshShowUI();
        } }, icon('plus'), 'Ajouter un tableau sur cette piste')),
      ...layers.map((l) => h('div', { class: 'card' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nom'), h('input', { type: 'text', value: l.name, oninput: (e: Event) => {
          l.name = (e.target as HTMLInputElement).value;
          changed();
        } })),
        slider({ label: 'Opacité', min: 0, max: 1.5, step: 0.01, value: l.opacity, onInput: (v) => {
          l.opacity = v;
          changed();
        } }),
        select<string>({ label: 'Mélange', value: l.blend, options: [
          { value: 'add', label: 'Addition (lumières qui s’ajoutent)' },
          { value: 'screen', label: 'Superposition douce' },
          { value: 'max', label: 'Le plus lumineux' },
        ], onChange: (v) => {
          l.blend = v as Layer['blend'];
          changed();
        } }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!l.muted, onchange: (e: Event) => {
          l.muted = (e.target as HTMLInputElement).checked;
          changed();
        } }), 'Masquer cette piste'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => {
            this.timeline.activeTrack = l.id;
            this.showTab = 'tableaux';
            this.refreshShowUI();
          } }, icon('plus'), 'Ajouter un tableau'),
          h('button', { class: 'btn ghost', title: 'Supprimer les vides de cette piste', onclick: () => this.closeGaps(l.id) }, 'Resserrer'),
          h('button', { class: 'btn danger', title: 'Supprimer la piste', onclick: () => this.deleteLayer(l.id) }, icon('trash')),
        ),
      )),
      h('button', { class: 'btn primary wide', onclick: () => this.addLayer() }, icon('plus'), 'Nouvelle piste superposée'),
    );
  }

  private mediaLibrary() {
    const items = this.project.media ?? [];
    return h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Vos images et vidéos'),
      items.length ? h('div', { class: 'media-list' }, ...items.map((m) => h('div', { class: 'media-item' },
        h('span', {}, m.kind === 'video' ? '🎬' : '🖼'),
        h('span', { class: 'zn' }, m.name),
        h('button', { class: 'btn small', title: 'Ajouter un tableau avec ce média', onclick: () => this.addClip('media', { media: m.id }) }, icon('plus')),
        h('button', { class: 'btn small danger', title: 'Retirer du projet', onclick: () => this.removeMedia(m.id) }, '×'),
      ))) : h('p', { class: 'muted small' }, 'Logo, blason, photos d’archives, vidéos… Placez-les sur toute la façade ou dans chaque fenêtre.'),
      h('button', { class: 'btn ghost wide', onclick: async () => {
        const id = await this.importMedia();
        if (id) this.addClip('media', { media: id });
      } }, icon('upload'), 'Importer une image ou une vidéo'),
    );
  }

  private tabLibrary(b: HTMLElement) {
    const layer = this.project.show.layers?.find((l) => l.id === this.timeline.activeTrack);
    add(b, h('p', { class: 'muted' }, 'Cliquez sur un tableau pour l’ajouter après le tableau sélectionné', layer ? h('b', {}, ` (piste « ${layer.name} »)`) : '', '. Survolez une vignette pour la voir bouger.'));
    const presets = loadPresets();
    add(b, h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('star'), ' Mes préréglages'),
      presets.length
        ? h('div', { class: 'media-list' }, ...presets.map((pr) => h('div', { class: 'media-item' },
            h('span', { class: 'dot', style: `background:${CATEGORY_COLORS[EFFECT_MAP.get(pr.effect)?.category ?? 'Lumière']}` }),
            h('span', { class: 'zn', title: EFFECT_MAP.get(pr.effect)?.name }, pr.name),
            h('button', { class: 'btn small', title: 'Ajouter au spectacle', onclick: () => this.addClip(pr.effect, pr.params, pr.keys) }, icon('plus')),
            h('button', { class: 'btn small danger', title: 'Supprimer le préréglage', onclick: () => {
              savePresets(loadPresets().filter((x) => x.id !== pr.id));
              this.renderSide();
            } }, '×'))))
        : h('p', { class: 'muted small' }, 'Réglez un tableau à votre goût puis, dans « Réglages », cliquez sur « Enregistrer comme préréglage ». Vos préréglages restent dans ce navigateur, d’un projet à l’autre.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', disabled: !presets.length, onclick: () => download(new Blob([JSON.stringify(loadPresets(), null, 2)], { type: 'application/json' }), 'lumirock_prereglages.json') }, icon('download'), 'Exporter'),
        h('button', { class: 'btn ghost', onclick: async () => {
          const f = await pickFile('.json,application/json');
          if (!f) return;
          try {
            const add = JSON.parse(await f.text()) as Preset[];
            const cur = loadPresets();
            for (const x of add) if (EFFECT_MAP.has(x.effect) && !cur.some((c) => c.id === x.id)) cur.push(x);
            savePresets(cur);
            this.renderSide();
            toast(`${add.length} préréglage(s) importé(s).`, 'ok');
          } catch {
            toast('Fichier de préréglages illisible.', 'err');
          }
        } }, icon('upload'), 'Importer'),
      ),
    ));
    add(b, this.mediaLibrary());
    for (const cat of CATEGORIES) {
      add(b, h('h3', { class: 'cat', style: `--c:${CATEGORY_COLORS[cat]}` }, cat));
      add(b, h('div', { class: 'fx-grid' },
        ...EFFECTS.filter((e) => e.category === cat).map((e) => {
          const cv = h('canvas', { class: 'fx-prev', width: 160, height: 100 });
          this.previews.register(e.id, cv);
          return h('button', {
            class: 'fx', style: `--c:${CATEGORY_COLORS[cat]}`, title: e.description, onclick: () => this.addClip(e.id),
            onmouseenter: () => this.previews.hover(e.id), onmouseleave: () => this.previews.hover(null),
          }, cv, h('b', {}, e.name), h('span', {}, e.description), h('i', { class: `mood ${e.mood}` }, e.mood));
        }),
      ));
    }
    this.previews.start(this.scene);
  }

  private tabClip(b: HTMLElement) {
    const found = this.findClip(this.selectedClip);
    if (!found) {
      add(b, h('p', { class: 'muted' }, 'Sélectionnez un tableau dans la ligne de temps pour régler ses paramètres.'));
      return;
    }
    const clip = found.clip;
    const list = found.list;
    const e = EFFECT_MAP.get(clip.effect)!;
    const idx = list.indexOf(clip);
    const prog = effectiveProgress(clip, this.time - found.start);
    const changed = () => {
      this.dirty = true;
      this.scheduleSave();
    };
    const fxSel = select<string>({ label: 'Effet', value: clip.effect, options: EFFECTS.map((x) => ({ value: x.id, label: `${x.category} · ${x.name}` })), onChange: (v) => {
      const keep = { ...clip.params };
      const fresh = newClip(v, clip.duration);
      clip.effect = v;
      clip.params = { ...fresh.params };
      clip.keys = undefined;
      for (const k of ['colorA', 'colorB', 'intensity', '_target', '_targetBg', '_react', '_mirror', '_hue', '_sat']) if (k in keep && k in clip.params) clip.params[k] = keep[k];
      this.refreshShowUI();
      changed();
    } });
    const hasKeys = (k: string) => !!clip.keys?.[k]?.length;
    const setVal = (k: string, v: number | string) => {
      if (hasKeys(k)) setKey(clip, k, prog, v);
      else clip.params[k] = v;
      changed();
    };
    const keyUI = (p: ParamDef, el: HTMLElement) => {
      if (p.type !== 'range' && p.type !== 'color') return el;
      const btn = h('button', { class: `kf-btn${hasKeys(p.key) ? ' on' : ''}`, title: `Image clé à ${Math.round(prog * 100)} % du tableau (placez la tête de lecture, puis réglez)`, onclick: (ev: Event) => {
        ev.preventDefault();
        setKey(clip, p.key, prog, paramAt(clip, p.key, prog, p.default));
        this.refreshShowUI();
        changed();
      } }, '◆');
      const chips = hasKeys(p.key)
        ? h('div', { class: 'kf-chips' }, ...clip.keys![p.key].map((k, i) => h('span', { class: 'kf-chip' },
            h('button', { class: 'kf-go', title: 'Aller à cette image clé', onclick: () => this.seek(found.start + k.t * clip.duration + 0.001) },
              p.type === 'color' ? h('i', { class: 'kf-sw', style: `background:${k.v}` }) : null, `${Math.round(k.t * 100)} %${p.type === 'range' ? ' · ' + Number(k.v).toFixed(2) : ''}`),
            h('button', { class: 'kf-x', title: 'Supprimer', onclick: () => {
              removeKey(clip, p.key, i);
              this.refreshShowUI();
              changed();
            } }, '×'))))
        : null;
      return h('div', { class: 'kf-wrap' }, el, btn, chips);
    };
    const control = (p: ParamDef): HTMLElement => {
      const v = paramAt(clip, p.key, prog, p.default);
      if (p.type === 'range') return keyUI(p, slider({ label: p.label, min: p.min!, max: p.max!, step: p.step!, value: Number(v), onInput: (x) => setVal(p.key, x) }));
      if (p.type === 'color') {
        const inp = h('input', { type: 'color', value: String(v) });
        inp.addEventListener('input', () => setVal(p.key, inp.value));
        return keyUI(p, h('label', { class: 'field color' }, h('span', { class: 'lbl' }, p.label), inp));
      }
      if (p.type === 'select') return select<number>({ label: p.label, value: Number(v), options: p.options!, onChange: (x) => {
        clip.params[p.key] = x;
        changed();
      } });
      if (p.type === 'toggle') return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!v, onchange: (ev: Event) => {
        clip.params[p.key] = (ev.target as HTMLInputElement).checked;
        changed();
      } }), p.label);
      if (p.type === 'media') {
        const items = this.project.media ?? [];
        return h('div', { class: 'field' },
          h('span', { class: 'lbl' }, p.label),
          items.length
            ? select<string>({ value: String(v), options: [{ value: '', label: '— choisir —' }, ...items.map((m) => ({ value: m.id, label: `${m.kind === 'video' ? '🎬' : '🖼'} ${m.name}` }))], onChange: (x) => {
                clip.params.media = x;
                changed();
              } })
            : h('p', { class: 'muted small' }, 'Aucun média dans le projet.'),
          h('button', { class: 'btn ghost', onclick: async () => {
            const id = await this.importMedia();
            if (id) {
              clip.params.media = id;
              changed();
              this.renderSide();
            }
          } }, icon('upload'), 'Importer une image ou une vidéo'),
        );
      }
      const ta = h('textarea', { rows: 2 }, String(v));
      ta.addEventListener('input', () => {
        clip.params[p.key] = ta.value;
        changed();
      });
      return h('label', { class: 'field' }, h('span', { class: 'lbl' }, p.label), ta);
    };
    const controls = e.params.map(control);
    const advanced = COMMON_PARAMS.map(control);
    const advOpen = (clip.params._target ?? 0) !== 0 || Number(clip.params._react ?? 0) > 0 || Number(clip.params._reactBand ?? 0) > 0 || Number(clip.params._mirror ?? 0) > 0 || Number(clip.params._hue ?? 0) !== 0 || Number(clip.params._sat ?? 1) !== 1;
    add(b, 
      h('div', { class: 'clip-head', style: `--c:${CATEGORY_COLORS[e.category]}` },
        h('div', {}, h('small', {}, `Tableau ${idx + 1} · ${e.category}`), h('b', {}, e.name)),
        h('div', { class: 'row' },
          h('button', { class: 'btn icon', title: 'Avancer d’un temps', disabled: found.start <= 0, onclick: () => this.moveClip(clip.id, -1) }, icon('left')),
          h('button', { class: 'btn icon', title: 'Reculer d’un temps', onclick: () => this.moveClip(clip.id, 1) }, icon('right')),
          h('button', { class: 'btn icon', title: 'Enregistrer comme préréglage', onclick: () => {
            const name = prompt('Nom du préréglage :', `${e.name} perso`);
            if (!name) return;
            savePresets([...loadPresets(), { id: uid('pr'), name, effect: clip.effect, params: structuredClone(clip.params), keys: clip.keys ? structuredClone(clip.keys) : undefined }]);
            toast(`Préréglage « ${name} » enregistré (onglet Tableaux).`, 'ok');
          } }, icon('star')),
          h('button', { class: 'btn icon', title: 'Dupliquer', onclick: () => this.duplicateClip(clip.id) }, icon('copy')),
          h('button', { class: 'btn icon danger', title: 'Supprimer (Suppr)', onclick: () => this.deleteClip(clip.id) }, icon('trash')),
        ),
      ),
      h('p', { class: 'muted small' }, e.description),
      clip.effect === 'media' ? h('p', { class: 'muted small' }, 'Sur l’image : glissez le média pour le déplacer, tirez un coin pour l’agrandir, la pastille ronde pour le tourner. Double-clic pour recentrer.') : null,
      h('p', { class: 'muted small kf-help' }, `◆ = image clé à la position de lecture (${Math.round(prog * 100)} % du tableau) : le réglage évoluera dans le temps.`),
      fxSel,
      slider({ label: 'Durée (s)', min: 1, max: 60, step: 0.5, value: clip.duration, onInput: (x) => {
        clip.duration = x;
        clip.transitionDuration = Math.min(clip.transitionDuration, x / 2);
        this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
        changed();
      } }),
      ...controls,
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Transition vers le tableau suivant'),
        select<string>({ value: clip.transition, options: TRANSITIONS.map((t) => ({ value: t.id, label: t.label })), onChange: (x) => {
          clip.transition = x;
          this.timeline.render();
          changed();
        } }),
        (() => {
          const end = found.start + clip.duration;
          const next = trackTimings(list).find((t) => t.clip !== clip && t.start > found.start && t.start <= end + 0.05);
          if (!next) return h('p', { class: 'muted small' }, 'Faites chevaucher le tableau suivant sur la ligne de temps pour créer la transition (la zone hachurée).');
          return slider({ label: 'Durée de la transition (chevauchement, s)', min: 0, max: Math.min(8, clip.duration, next.clip.duration), step: 0.1, value: Math.max(0, end - next.start), onInput: (x) => {
            next.clip.start = Math.round((end - x) * 100) / 100;
            this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
            changed();
          } });
        })(),
        slider({ label: 'Fondu quand le tableau borde un vide (s)', min: 0, max: 4, step: 0.1, value: clip.fade ?? 0.6, onInput: (x) => {
          clip.fade = x;
          changed();
        } }),
      ),
      h('details', { class: 'card adv', open: advOpen },
        h('summary', { class: 'card-title' }, 'Options avancées'),
        h('p', { class: 'muted small' }, 'Limiter le tableau à certains calques, le faire réagir à la musique, le rendre symétrique ou changer ses couleurs.'),
        ...advanced,
      ),
    );
  }

  private tabMusic(b: HTMLElement) {
    const show = this.project.show;
    if (!this.audio) {
      add(b, 
        h('div', { class: 'dropzone small', onclick: async () => {
          const f = await pickFile('audio/*');
          if (f) this.loadAudio(f);
        } }, icon('music'), h('div', { class: 'dz-title' }, 'Importer une musique'), h('div', { class: 'dz-sub' }, 'MP3, WAV, OGG, M4A… analysée dans le navigateur')),
        h('p', { class: 'muted small' }, 'Le tempo et les temps forts sont détectés automatiquement : les effets pulsent sur le rythme et les tableaux se calent sur les mesures.'),
        h('p', { class: 'muted small' }, 'Musiques libres de droits : Free Music Archive, ccMixter, Musopen (vérifiez toujours la licence et les conditions de diffusion publique).'),
        slider({ label: 'Tempo sans musique (BPM)', min: 60, max: 180, step: 1, value: show.bpm, onInput: (v) => {
          show.bpm = v;
          this.dirty = true;
          this.scheduleSave();
        } }),
      );
      return;
    }
    const a = this.audio.analysis;
    add(b, 
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, icon('music'), ' ', this.audio.name),
        h('div', { class: 'kv' }, h('span', {}, 'Durée'), h('b', {}, fmtTime(a.duration))),
        h('div', { class: 'kv' }, h('span', {}, 'Parties détectées'), h('b', {}, String(a.sections.length + 1))),
        slider({ label: 'Tempo détecté (BPM)', min: 60, max: 200, step: 0.5, value: a.bpm, onInput: (v) => {
          a.bpm = v;
          this.timeline.render();
          this.dirty = true;
        } }),
        slider({ label: 'Décalage du premier temps (s)', min: 0, max: 60 / a.bpm, step: 0.01, value: a.offset, onInput: (v) => {
          a.offset = v;
          this.timeline.render();
          this.dirty = true;
        } }),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Bandes de fréquences'),
        h('div', { class: 'meters' },
          ...['Basses', 'Médiums', 'Aigus'].map((l) => h('div', { class: 'meter' }, h('div', { class: 'meter-bar' }, h('i', {})), h('span', {}, l)))),
        h('p', { class: 'muted small' }, 'Dans « Réglages › Options avancées », chaque tableau peut réagir aux basses, aux médiums ou aux aigus — par exemple le portail qui pulse sur la grosse caisse et les fenêtres qui scintillent sur les cymbales. Essayez aussi le tableau « Égaliseur ».'),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, icon('flag'), ' Repères'),
        h('p', { class: 'muted small' }, 'Lancez la lecture et appuyez sur M à chaque changement important (couplet, refrain, final). Les scénarios se caleront sur ces repères, et les tableaux s’y aimantent.'),
        (this.project.show.markers ?? []).length
          ? h('div', { class: 'kf-chips' }, ...(this.project.show.markers ?? []).map((m, i) => h('span', { class: 'kf-chip' },
              h('button', { class: 'kf-go', onclick: () => this.seek(m.t) }, `${m.label ?? i + 1} · ${fmtTime(m.t)}`),
              h('button', { class: 'kf-x', onclick: () => {
                this.project.show.markers!.splice(i, 1);
                this.refreshShowUI();
                this.scheduleSave();
              } }, '×'))))
          : null,
        (this.project.show.markers ?? []).length ? h('button', { class: 'btn ghost wide', onclick: () => {
          this.project.show.markers = [];
          this.refreshShowUI();
          this.scheduleSave();
        } }, 'Effacer tous les repères') : null,
      ),
      h('button', { class: 'btn primary wide', onclick: () => this.snapToMusic() }, 'Caler la durée des tableaux sur la musique'),
      h('button', { class: 'btn ghost wide', onclick: () => {
        this.showTab = 'scenarios';
        this.renderSide();
      } }, 'Recomposer un scénario sur cette musique'),
      h('button', { class: 'btn danger wide', onclick: () => {
        this.pause();
        this.audio = null;
        this.refreshShowUI();
        this.scheduleSave();
      } }, icon('trash'), 'Retirer la musique'),
    );
  }

  private palAll = false;
  private customPal: [string, string] = ['#e0a23e', '#3d7fff'];

  /** Applique deux couleurs aux tableaux (sélection, sinon tout le spectacle). */
  applyPalette(colors: [string, string]) {
    const ids = new Set(this.selectedIds());
    const all = [...this.project.show.clips, ...(this.project.show.layers ?? []).flatMap((l) => l.clips)];
    let n = 0;
    for (const c of all) {
      if (ids.size && !ids.has(c.id)) continue;
      if (!this.palAll && !ids.size && !PALETTE_FX.has(c.effect)) continue;
      const e = EFFECT_MAP.get(c.effect);
      if (!e) continue;
      let touched = false;
      if (e.params.some((p) => p.key === 'colorA')) {
        c.params.colorA = colors[0];
        if (c.keys) delete c.keys.colorA;
        touched = true;
      }
      if (e.params.some((p) => p.key === 'colorB')) {
        c.params.colorB = colors[1];
        if (c.keys) delete c.keys.colorB;
        touched = true;
      }
      if (touched) n++;
    }
    this.refreshShowUI();
    this.scheduleSave();
    toast(n ? `Palette appliquée à ${n} tableau(x)${ids.size ? ' sélectionné(s)' : ''}.` : 'Aucun tableau coloré concerné.', n ? 'ok' : 'info');
  }

  private paletteCard() {
    const sel = this.selectedIds().length;
    const a = h('input', { type: 'color', value: this.customPal[0] });
    const b = h('input', { type: 'color', value: this.customPal[1] });
    a.addEventListener('input', () => (this.customPal[0] = a.value));
    b.addEventListener('input', () => (this.customPal[1] = b.value));
    return h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Palette de couleurs'),
      h('p', { class: 'muted small' }, sel ? `S’applique aux ${sel} tableau(x) sélectionné(s).` : 'S’applique à tout le spectacle (sélectionnez des tableaux pour limiter).'),
      h('div', { class: 'palettes' }, ...PALETTES.map((pl) => h('button', { class: 'pal', title: pl.name, onclick: () => this.applyPalette(pl.colors) },
        h('span', { class: 'pal-sw', style: `background:linear-gradient(135deg, ${pl.colors[0]} 0 50%, ${pl.colors[1]} 50% 100%)` }), h('span', {}, pl.name)))),
      h('div', { class: 'row pal-custom' }, a, b, h('button', { class: 'btn ghost', onclick: () => this.applyPalette([...this.customPal]) }, 'Appliquer mes couleurs')),
      sel ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.palAll, onchange: (e: Event) => (this.palAll = (e.target as HTMLInputElement).checked) }), 'Inclure les tableaux aux couleurs naturelles (neige, feu, eau, soleil…)'),
    );
  }

  private tabAmbiance(b: HTMLElement) {
    const m = this.project.show.master;
    const ch = () => {
      this.dirty = true;
      this.scheduleSave();
    };
    add(b, this.paletteCard());
    add(b, 
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nom du projet'), h('input', { type: 'text', value: this.project.name, oninput: (e: Event) => {
        this.project.name = (e.target as HTMLInputElement).value;
        this.scheduleSave();
      } })),
      slider({ label: 'Luminosité générale', min: 0.2, max: 2, step: 0.01, value: m.brightness, onInput: (v) => ((m.brightness = v), ch()) }),
      slider({ label: 'Halo lumineux (bloom)', min: 0, max: 2, step: 0.01, value: m.bloom, onInput: (v) => ((m.bloom = v), ch()) }),
      slider({ label: 'Profondeur des reliefs et ombres', min: 0, max: 1.5, step: 0.01, value: m.relief, onInput: (v) => ((m.relief = v), ch()) }),
      slider({ label: 'Vignettage', min: 0, max: 1, step: 0.01, value: m.vignette, onInput: (v) => ((m.vignette = v), ch()) }),
      slider({ label: 'Lumière ambiante (simulation de nuit)', min: 0, max: 0.4, step: 0.01, value: m.ambient ?? 0.06, onInput: (v) => ((m.ambient = v), ch()) }),
      h('p', { class: 'muted small' }, 'Astuce : sur une façade claire, baissez la luminosité ; sur une pierre sombre, augmentez-la.'),
      h('button', { class: 'btn ghost wide', onclick: () => this.fullscreen() }, icon('expand'), 'Plein écran (projeter depuis le navigateur)'),
    );
  }

  private sideExport(s: HTMLElement) {
    const o = this.exportOpts;
    const aspect = this.scene ? this.scene.width / this.scene.height : 16 / 9;
    const dims = (long: number) => {
      let w: number, hh: number;
      if (aspect >= 1) {
        w = long;
        hh = Math.round(long / aspect / 2) * 2;
      } else {
        hh = long;
        w = Math.round((long * aspect) / 2) * 2;
      }
      return { w, h: hh };
    };
    const d = dims(o.long);
    const codecInfo = h('span', { class: 'muted small' }, '');
    videoCodecFor(d.w, d.h).then((c) => (codecInfo.textContent = c ? `Encodeur : ${c.toUpperCase()} (MP4)` : '⚠ Résolution non prise en charge par cet encodeur, réduisez-la.'));
    const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }), h('span', { class: 'pl' }, ''));
    const total = showDuration(this.project.show);
    add(s, 
      h('h2', {}, 'Exporter'),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Vidéo pour la projection'),
        select<number>({ label: 'Résolution', value: o.long, options: [1280, 1920, 2560, 3840].map((l) => {
          const x = dims(l);
          return { value: l, label: `${x.w} × ${x.h} px` };
        }), onChange: (v) => {
          o.long = v;
          this.renderSide();
        } }),
        select<number>({ label: 'Images par seconde', value: o.fps, options: [25, 30, 50, 60].map((f) => ({ value: f, label: `${f} i/s` })), onChange: (v) => (o.fps = v) }),
        select<string>({ label: 'Qualité', value: o.quality, options: [{ value: 'haute', label: 'Haute' }, { value: 'tres-haute', label: 'Très haute (fichier plus lourd)' }], onChange: (v) => (o.quality = v as typeof o.quality) }),
        select<string>({ label: 'Contenu', value: o.content, options: [
          { value: 'full', label: `Spectacle complet (${fmtTime(total)})` },
          { value: 'clips', label: 'Un fichier par tableau (zip, pour le direct)' },
          { value: 'selected', label: 'Tableau sélectionné uniquement' },
        ], onChange: (v) => (o.content = v as typeof o.content) }),
        select<string>({ label: 'Image', value: o.mode, options: [
          { value: 'projection', label: 'Projection (à envoyer au vidéoprojecteur)' },
          { value: 'simulation', label: 'Simulation nuit' },
          { value: 'presentation', label: 'Présentation client (simulation + titre + signature)' },
        ], onChange: (v) => (o.mode = v as ViewMode) }),
        h('label', { class: 'check', title: 'Ombres deux fois plus fines et rendu suréchantillonné : plus beau, environ 2× plus long' }, h('input', { type: 'checkbox', checked: o.final, onchange: (e: Event) => (o.final = (e.target as HTMLInputElement).checked) }), 'Qualité finale (plus fin, plus long)'),
        this.audio ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.audio, onchange: (e: Event) => (o.audio = (e.target as HTMLInputElement).checked) }), 'Inclure la musique') : null,
        codecInfo,
        h('button', { class: 'btn primary wide', onclick: () => this.runVideoExport(progress) }, icon('download'), 'Exporter la vidéo'),
        progress,
        h('p', { class: 'muted small' }, 'Pour Resolume / MadMapper / Modulo Pi : convertissez ensuite en HAP avec Shutter Encoder (gratuit) pour une lecture parfaitement fluide.'),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Kit pro (After Effects, DaVinci, mapping)'),
        h('ul', { class: 'tips' },
          h('li', {}, 'Façade redressée, profondeur, normales, contours'),
          h('li', {}, 'Un masque PNG par calque + contours vectoriels SVG'),
          h('li', {}, 'Gabarits de calage (dont un à projeter sur fond noir)'),
          h('li', {}, 'Guide d’utilisation pour chaque logiciel'),
        ),
        h('button', { class: 'btn ghost wide', onclick: () => this.runKitExport(progress) }, icon('download'), 'Télécharger le kit pro (.zip)'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => this.exportTemplate(true) }, 'Gabarit noir'),
          h('button', { class: 'btn ghost', onclick: () => this.exportTemplate(false) }, 'Gabarit photo'),
          h('button', { class: 'btn ghost', title: 'Capture de l’image affichée', onclick: () => this.snapshot() }, icon('camera')),
        ),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Présenter au client'),
        h('p', { class: 'muted small' }, 'Lance le spectacle en simulation de nuit, en plein écran, avec le titre du projet : idéal en rendez-vous.'),
        h('button', { class: 'btn primary wide', onclick: () => this.present() }, icon('play'), 'Mode présentation'),
        h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Lien de démonstration gratuit : enregistrez le projet (.lumirock), déposez-le dans un dépôt GitHub public, puis collez ici le lien « Raw » du fichier.'),
        (() => {
          const inp = h('input', { type: 'text', placeholder: 'https://raw.githubusercontent.com/…/projet.lumirock' });
          const out = h('input', { type: 'text', readonly: true, placeholder: 'Le lien à envoyer apparaîtra ici' });
          inp.addEventListener('input', () => {
            out.value = inp.value.trim() ? `${location.origin}${location.pathname}#demo=${encodeURIComponent(inp.value.trim())}` : '';
          });
          return h('div', {},
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Lien du fichier .lumirock'), inp),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Lien à envoyer au client'), out),
            h('button', { class: 'btn ghost wide', onclick: () => {
              if (!out.value) return;
              navigator.clipboard?.writeText(out.value).then(() => toast('Lien copié.', 'ok'), () => out.select());
            } }, icon('copy'), 'Copier le lien'),
          );
        })(),
      ),
      this.projectorsCard(),
      this.scheduleCard(),
    );
  }

  refreshShowUI() {
    this.timeline.multi = this.multi;
    this.renderEditTools();
    this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
    if (this.step === 'spectacle' || this.step === 'export') this.renderSide();
    this.updateGizmo();
    this.dirty = true;
  }

  // ───────────────────────── Manipulation des médias sur l'image ─────────────────────────
  private gizmoDrag: { mode: 'move' | 'scale' | 'rotate'; p0: Pt; v0: Record<string, number>; d0: number; a0: number } | null = null;

  private mediaClip() {
    if (this.live.on || (this.step !== 'spectacle' && this.step !== 'export')) return null;
    const f = this.findClip(this.selectedClip);
    if (!f || f.clip.effect !== 'media' || Number(f.clip.params.fit ?? 0) > 0.5) return null;
    if (this.time < f.start - 0.01 || this.time > f.start + f.clip.duration + 0.01) return null;
    return f;
  }

  private mediaAspect(id: string) {
    const r = this.mediaRuntime.get(id);
    if (r?.image) return r.image.width / r.image.height;
    if (r?.video?.videoWidth) return r.video.videoWidth / r.video.videoHeight;
    return 16 / 9;
  }

  /** Coins du média (coordonnées 0..1 de l'écran, origine en haut à gauche) et centre. */
  private gizmoGeom() {
    const f = this.mediaClip();
    if (!f || !this.scene) return null;
    const prog = effectiveProgress(f.clip, this.time - f.start);
    const v = (k: string, d: number) => Number(paramAt(f.clip, k, prog, d));
    const boxA = this.scene.width / this.scene.height;
    const ma = this.mediaAspect(String(f.clip.params.media));
    const wide = ma > boxA;
    let sw: number, sh: number;
    if (v('cover', 0) < 0.5) [sw, sh] = wide ? [1, boxA / ma] : [ma / boxA, 1];
    else [sw, sh] = wide ? [ma / boxA, 1] : [1, boxA / ma];
    const sc = Math.max(0.01, v('scale', 1));
    sw *= sc;
    sh *= sc;
    const cx = 0.5 + v('posX', 0) * 0.5, cy = 0.5 + v('posY', 0) * 0.5;
    const a = (v('rot', 0) * Math.PI) / 180;
    const corners = ([[0, 0], [1, 0], [1, 1], [0, 1]] as Pt[]).map(([mx, my]) => {
      const dx = (mx - 0.5) * sw * boxA, dy = (my - 0.5) * sh;
      const qx = Math.cos(a) * dx + Math.sin(a) * dy, qy = -Math.sin(a) * dx + Math.cos(a) * dy;
      return [cx + qx / boxA, 1 - (cy + qy)] as Pt;
    });
    // poignée de rotation : au-dessus du milieu du bord haut de l'image du média
    const top: Pt = [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2];
    return { f, prog, corners, center: [cx, 1 - cy] as Pt, top, v };
  }

  private setMediaParam(key: string, value: number) {
    const g = this.gizmoGeom();
    if (!g) return;
    const clip = g.f.clip;
    if (clip.keys?.[key]?.length) setKey(clip, key, g.prog, value);
    else clip.params[key] = Math.round(value * 1000) / 1000;
    this.dirty = true;
  }

  updateGizmo() {
    const on = !!this.mediaClip();
    if (this.step !== 'spectacle' && this.step !== 'export') return;
    if (!on) {
      this.stage.handlers = {};
      this.stage.setMode({ gl: !!this.facade, overlay: false });
      this.stage.redraw();
      return;
    }
    const s = this.stage;
    s.setMode({ gl: true, overlay: true, cursor: 'move' });
    const px = (p: Pt): Pt => [p[0] * s.cssW, p[1] * s.cssH];
    s.handlers = {
      down: (p) => {
        const g = this.gizmoGeom();
        if (!g) return;
        const P = px(p);
        const C = px(g.center);
        const near = (q: Pt) => Math.hypot(px(q)[0] - P[0], px(q)[1] - P[1]) < 14;
        const v0 = { posX: g.v('posX', 0), posY: g.v('posY', 0), scale: g.v('scale', 1), rot: g.v('rot', 0) };
        const T = px(g.top);
        const dirx = T[0] - C[0], diry = T[1] - C[1], dl = Math.hypot(dirx, diry) || 1;
        const knob: Pt = [(T[0] + (dirx / dl) * 26) / s.cssW, (T[1] + (diry / dl) * 26) / s.cssH];
        let mode: 'move' | 'scale' | 'rotate' = 'move';
        if (near(knob)) mode = 'rotate';
        else if (g.corners.some(near)) mode = 'scale';
        this.gizmoDrag = { mode, p0: p, v0, d0: Math.hypot(P[0] - C[0], P[1] - C[1]) || 1, a0: Math.atan2(P[1] - C[1], P[0] - C[0]) };
      },
      move: (p) => {
        const d = this.gizmoDrag;
        if (!d) return;
        const g = this.gizmoGeom();
        if (!g) return;
        const P = px(p), C = px(g.center);
        if (d.mode === 'move') {
          this.setMediaParam('posX', d.v0.posX + (p[0] - d.p0[0]) * 2);
          this.setMediaParam('posY', d.v0.posY - (p[1] - d.p0[1]) * 2);
        } else if (d.mode === 'scale') {
          this.setMediaParam('scale', Math.max(0.05, Math.min(4, (d.v0.scale * Math.hypot(P[0] - C[0], P[1] - C[1])) / d.d0)));
        } else {
          let r = d.v0.rot - ((Math.atan2(P[1] - C[1], P[0] - C[0]) - d.a0) * 180) / Math.PI;
          r = ((r + 540) % 360) - 180;
          this.setMediaParam('rot', Math.round(r));
        }
      },
      up: () => {
        if (this.gizmoDrag) {
          this.gizmoDrag = null;
          this.renderSide();
          this.scheduleSave();
        }
      },
      dbl: () => {
        // double-clic : recentrer et remettre à l'échelle 1
        this.setMediaParam('posX', 0);
        this.setMediaParam('posY', 0);
        this.setMediaParam('scale', 1);
        this.setMediaParam('rot', 0);
        this.renderSide();
        this.scheduleSave();
      },
      draw: (ctx, w, hh) => {
        const g = this.gizmoGeom();
        if (!g) return;
        const P = g.corners.map(([x, y]) => [x * w, y * hh]);
        ctx.save();
        ctx.strokeStyle = '#e0a23e';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, y] of P) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#000';
          ctx.fillRect(x - 5, y - 5, 10, 10);
          ctx.strokeRect(x - 5, y - 5, 10, 10);
        }
        const C = [g.center[0] * w, g.center[1] * hh];
        const T = [g.top[0] * w, g.top[1] * hh];
        const dx = T[0] - C[0], dy = T[1] - C[1], dl = Math.hypot(dx, dy) || 1;
        const K = [T[0] + (dx / dl) * 26, T[1] + (dy / dl) * 26];
        ctx.strokeStyle = '#e0a23e';
        ctx.beginPath();
        ctx.moveTo(T[0], T[1]);
        ctx.lineTo(K[0], K[1]);
        ctx.stroke();
        ctx.fillStyle = '#e0a23e';
        ctx.beginPath();
        ctx.arc(K[0], K[1], 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(C[0], C[1], 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    };
    s.redraw();
  }

  // ───────────────────────── Actions ─────────────────────────
  private busy(msg: string | null) {
    const b = this.els.busy;
    b.textContent = msg ?? '';
    b.classList.toggle('on', !!msg);
  }

  async loadPhoto(file: File) {
    try {
      this.busy('Chargement de la photo…');
      this.sourceBlob = file;
      this.sourceImage = await imageDataFromBlob(file);
      this.sourceCanvas = imageDataToCanvas(this.sourceImage);
      this.quad = [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]];
      const media = this.project.media;
      this.project = emptyProject();
      this.project.name = file.name.replace(/\.[^.]+$/, '');
      this.project.media = media;
      this.history.reset(this.project);
      this.facade = null;
      this.aiDepth = null;
      this.aiDepthBlob = null;
      this.goto('redresser');
    } catch (e) {
      toast('Impossible de lire cette image.', 'err');
      console.error(e);
    } finally {
      this.busy(null);
    }
  }

  loadTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id)!.build();
    const media = this.project.media;
    this.project = emptyProject();
    this.project.name = t.name;
    this.project.zones = t.zones;
    this.sourceImage = t.image;
    this.sourceCanvas = imageDataToCanvas(t.image);
    this.sourceBlob = null;
    this.quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.aiDepth = null;
    this.aiDepthBlob = null;
    this.project.media = media;
    this.setFacade(t.image);
    this.history.reset(this.project);
    this.selectedClip = null;
    this.time = 0;
    this.goto('spectacle');
    toast(`${t.name} chargé avec ${t.zones.length} calques. Appuyez sur Espace pour lancer le spectacle !`, 'ok', 5000);
  }

  private setFacade(img: ImageData) {
    this.facade = img;
    this.facadeVersion++;
    this.facadeBlob = null;
    this.project.width = img.width;
    this.project.height = img.height;
    this.rebuildNow();
    this.scheduleSave();
  }

  applyRectify(skip = false) {
    if (!this.sourceImage) return;
    this.busy('Redressement de la façade…');
    setTimeout(() => {
      const img = skip ? fitToWork(this.sourceCanvas!) : rectify(this.sourceImage!, this.quad, this.realAspect ?? undefined);
      if (skip) this.quad.splice(0, 4, [0, 0], [1, 0], [1, 1], [0, 1]);
      this.aiDepth = null;
      this.aiDepthBlob = null;
      this.setFacade(img);
      this.busy(null);
      this.goto('calques');
      if (this.project.zones.length === 0) toast('Astuce : cliquez sur « Détecter fenêtres et portes » pour démarrer vite.', 'info', 6000);
    }, 30);
  }

  private facadeVersion = 0;
  private aiBusy = false;

  async aiClick(p: Pt, detail = false) {
    if (!this.facade || this.aiBusy) return;
    this.aiBusy = true;
    try {
      const { segmentAt } = await import('./analysis/aisegment');
      this.busy('Détourage IA…');
      const pts = await segmentAt(this.facade, `f${this.facadeVersion}`, p, (msg, r) => this.busy(r !== undefined && r < 1 ? `${msg} ${Math.round(r * 100)} %` : msg), detail);
      if (!pts || pts.length < 3) {
        toast('Rien de net trouvé à cet endroit : essayez un peu plus au centre de l’élément.', 'err');
        return;
      }
      this.zoneEditor.addZone(pts);
      toast('Élément détouré par l’IA. Choisissez son type à gauche si besoin.', 'ok', 2500);
    } catch (e) {
      console.error(e);
      toast('Le détourage IA a échoué (connexion ou navigateur).', 'err', 6000);
    } finally {
      this.busy(null);
      this.aiBusy = false;
    }
  }

  autoDetect() {
    if (!this.facade) return;
    const found = detectOpenings(this.facade, this.detectSens);
    if (!found.length) {
      toast('Aucune ouverture détectée. Augmentez la sensibilité ou dessinez les calques à la main.', 'err');
      return;
    }
    this.project.zones.push(...found);
    this.zoneEditor.zones = this.project.zones;
    this.zoneEditor.onChange?.(true);
    toast(`${found.length} ouvertures détectées. Vérifiez-les et corrigez si besoin.`, 'ok');
  }

  async runAiDepth(btn: HTMLButtonElement) {
    if (!this.facade) return;
    btn.disabled = true;
    try {
      const { estimateDepth } = await import('./analysis/aidepth');
      const d = await estimateDepth(this.facade, (msg, r) => this.busy(r !== undefined && r < 1 ? `${msg} ${Math.round(r * 100)} %` : msg));
      this.aiDepth = d;
      const rgba = new Uint8ClampedArray(d.length * 4);
      for (let i = 0; i < d.length; i++) {
        const v = Math.round(d[i] * 255);
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      this.aiDepthBlob = await imageDataToBlob(new ImageData(rgba, this.facade.width, this.facade.height));
      this.useAi = true;
      this.mapView = 'depth';
      this.rebuildNow();
      this.scheduleSave();
      toast('Profondeur calculée par IA ✓', 'ok');
    } catch (e) {
      console.error(e);
      toast('Le calcul IA a échoué (connexion ou navigateur). La profondeur automatique reste utilisée.', 'err', 6000);
    } finally {
      this.busy(null);
      btn.disabled = false;
      this.renderSide();
    }
  }

  deleteZone(id: string) {
    this.project.zones = this.project.zones.filter((z) => z.id !== id);
    this.zoneEditor.zones = this.project.zones;
    this.zoneEditor.selected = null;
    this.zoneEditor.onChange?.(true);
    this.stage.redraw();
  }

  // ── pistes
  trackList(tid: string): Clip[] {
    if (tid === MAIN_TRACK) return this.project.show.clips;
    return this.project.show.layers?.find((l) => l.id === tid)?.clips ?? this.project.show.clips;
  }

  findClip(id: string | null): { clip: Clip; list: Clip[]; track: string; start: number } | null {
    if (!id) return null;
    const tracks: [string, Clip[]][] = [[MAIN_TRACK, this.project.show.clips], ...(this.project.show.layers ?? []).map((l) => [l.id, l.clips] as [string, Clip[]])];
    for (const [track, list] of tracks) {
      const tm = trackTimings(list).find((t) => t.clip.id === id);
      if (tm) return { clip: tm.clip, list, track, start: tm.start };
    }
    return null;
  }

  addLayer() {
    const layers = (this.project.show.layers ??= []);
    const l: Layer = { id: uid('p'), name: `Piste ${layers.length + 2}`, clips: [], opacity: 1, blend: 'add' };
    layers.push(l);
    this.timeline.activeTrack = l.id;
    this.showTab = 'tableaux';
    this.refreshShowUI();
    this.scheduleSave();
    toast(`${l.name} ajoutée : choisissez un tableau, il se placera à la tête de lecture sur cette piste.`, 'ok', 4500);
  }

  deleteLayer(id: string) {
    this.project.show.layers = (this.project.show.layers ?? []).filter((l) => l.id !== id);
    if (this.timeline.activeTrack === id) this.timeline.activeTrack = MAIN_TRACK;
    this.selectedClip = null;
    this.refreshShowUI();
    this.scheduleSave();
  }

  addClip(effect: string, params?: Record<string, unknown>, keys?: Clip['keys']) {
    const c = newClip(effect);
    if (params) Object.assign(c.params, structuredClone(params));
    if (keys) c.keys = structuredClone(keys);
    const sel = this.findClip(this.selectedClip);
    if (sel) {
      // juste après le tableau sélectionné : les suivants de la piste sont décalés
      const at = sel.start + sel.clip.duration;
      for (const x of sel.list) if (x !== sel.clip && (x.start ?? 0) >= at - 0.01) x.start = (x.start ?? 0) + c.duration;
      c.start = at;
      sel.list.push(c);
    } else {
      // à la tête de lecture, sur une piste libre à cet endroit (sinon nouvelle piste)
      const t0 = Math.round(this.time * 100) / 100;
      c.start = t0;
      const free = (list: Clip[]) => !trackTimings(list).some((t) => t.start < t0 + c.duration - 0.01 && t.end > t0 + 0.01);
      const order = [this.timeline.activeTrack, MAIN_TRACK, ...(this.project.show.layers ?? []).map((l) => l.id)];
      let tid = order.find((id) => free(this.trackList(id)));
      if (!tid) {
        const layers = (this.project.show.layers ??= []);
        const l: Layer = { id: uid('p'), name: `Piste ${layers.length + 2}`, clips: [], opacity: 1, blend: 'add' };
        layers.push(l);
        tid = l.id;
      }
      this.timeline.activeTrack = tid;
      this.trackList(tid).push(c);
    }
    this.selectedClip = c.id;
    this.seek((c.start ?? 0) + 0.01);
    this.refreshShowUI();
    this.scheduleSave();
    toast(`« ${EFFECT_MAP.get(effect)!.name} » ajouté.`, 'ok', 2000);
  }

  deleteClip(id: string) {
    const f = this.findClip(id);
    if (!f) return;
    f.list.splice(f.list.indexOf(f.clip), 1);
    this.selectedClip = null;
    this.refreshShowUI();
    this.scheduleSave();
  }

  duplicateClip(id: string) {
    const f = this.findClip(id);
    if (!f) return;
    const copy: Clip = { ...structuredClone(f.clip), id: uid('c') };
    const at = f.start + f.clip.duration;
    for (const x of f.list) if ((x.start ?? 0) >= at - 0.01) x.start = (x.start ?? 0) + copy.duration;
    copy.start = at;
    f.list.push(copy);
    this.selectedClip = copy.id;
    this.refreshShowUI();
    this.scheduleSave();
  }

  /** Décale un tableau d'un temps (selon le tempo). */
  moveClip(id: string, dir: number) {
    const f = this.findClip(id);
    if (!f) return;
    const beat = 60 / (this.audio?.analysis.bpm ?? this.project.show.bpm);
    f.clip.start = Math.max(0, Math.round((f.start + dir * beat) * 100) / 100);
    this.refreshShowUI();
    this.scheduleSave();
  }

  /** Supprime les vides d'une piste (garde les chevauchements). */
  closeGaps(tid: string) {
    const list = this.trackList(tid);
    const tms = trackTimings(list);
    let end = 0;
    for (const tm of tms) {
      const s = tm.start > end ? end : tm.start;
      const shift = tm.start - s;
      tm.clip.start = Math.round(s * 100) / 100;
      end = Math.max(end, tm.end - shift);
    }
    this.refreshShowUI();
    this.scheduleSave();
    toast('Vides supprimés.', 'ok', 2000);
  }

  // ── montage : sélection multiple, presse-papiers, coupe
  multi = new Set<string>();
  private clipboard: { track: string; clip: Clip; rel: number }[] = [];

  selectedIds() {
    return [this.selectedClip, ...this.multi].filter((x): x is string => !!x && !!this.findClip(x));
  }

  copySelection(silent = false) {
    const fs = this.selectedIds().map((i) => this.findClip(i)!);
    if (!fs.length) return false;
    const t0 = Math.min(...fs.map((f) => f.start));
    this.clipboard = fs.map((f) => ({ track: f.track, clip: structuredClone(f.clip), rel: f.start - t0 }));
    if (!silent) toast(`${fs.length} tableau(x) copié(s).`, 'ok', 1800);
    return true;
  }

  paste(at = this.time) {
    if (!this.clipboard.length) return;
    this.multi.clear();
    let first: string | null = null;
    for (const item of this.clipboard) {
      const c: Clip = { ...structuredClone(item.clip), id: uid('c'), start: Math.round((at + item.rel) * 100) / 100 };
      const exists = item.track === MAIN_TRACK || this.project.show.layers?.some((l) => l.id === item.track);
      this.trackList(exists ? item.track : this.timeline.activeTrack).push(c);
      if (!first) first = c.id;
      else this.multi.add(c.id);
    }
    this.selectedClip = first;
    this.refreshShowUI();
    this.scheduleSave();
  }

  deleteSelection() {
    for (const id of this.selectedIds()) {
      const f = this.findClip(id);
      if (f) f.list.splice(f.list.indexOf(f.clip), 1);
    }
    this.selectedClip = null;
    this.multi.clear();
    this.refreshShowUI();
    this.scheduleSave();
  }

  duplicateSelection() {
    const fs = this.selectedIds().map((i) => this.findClip(i)!);
    if (!fs.length) return;
    this.copySelection(true);
    this.paste(Math.max(...fs.map((f) => f.start + f.clip.duration)));
  }

  /** Coupe en deux, à la tête de lecture, les tableaux sélectionnés (ou celui sous la tête sur la piste active). */
  splitAtPlayhead() {
    const t = this.time;
    let fs = this.selectedIds().map((i) => this.findClip(i)!).filter((f) => t > f.start + 0.05 && t < f.start + f.clip.duration - 0.05);
    if (!fs.length) {
      const list = this.trackList(this.timeline.activeTrack);
      const tm = trackTimings(list).filter((x) => t > x.start + 0.05 && t < x.end - 0.05).pop();
      const f = tm ? this.findClip(tm.clip.id) : null;
      fs = f ? [f] : [];
    }
    if (!fs.length) {
      toast('Placez la tête de lecture sur un tableau pour le couper.', 'info');
      return;
    }
    let lastB: string | null = null;
    for (const f of fs) {
      const c = f.clip;
      const cut = c.cut ?? { t0: 0, p0: 0, p1: 1 };
      const d1 = t - f.start;
      const r = d1 / c.duration;
      const pm = cut.p0 + r * (cut.p1 - cut.p0);
      const B: Clip = { ...structuredClone(c), id: uid('c'), start: Math.round(t * 100) / 100, duration: Math.round((c.duration - d1) * 100) / 100, cut: { t0: cut.t0 + d1, p0: pm, p1: cut.p1 } };
      c.duration = Math.round(d1 * 100) / 100;
      c.cut = { t0: cut.t0, p0: cut.p0, p1: pm };
      f.list.push(B);
      lastB = B.id;
    }
    this.selectedClip = lastB;
    this.multi.clear();
    this.refreshShowUI();
    this.scheduleSave();
    toast(fs.length > 1 ? `${fs.length} tableaux coupés.` : 'Tableau coupé en deux.', 'ok', 1800);
  }

  selectAllOnTrack() {
    const list = this.trackList(this.timeline.activeTrack);
    if (!list.length) return;
    this.selectedClip = list[0].id;
    this.multi = new Set(list.slice(1).map((c) => c.id));
    this.timeline.multi = this.multi;
    this.refreshShowUI();
  }

  addMarker() {
    const ms = (this.project.show.markers ??= []);
    const t = Math.round(this.time * 100) / 100;
    if (ms.some((m) => Math.abs(m.t - t) < 0.2)) return;
    ms.push({ t });
    ms.sort((a, b) => a.t - b.t);
    ms.forEach((m, i) => (m.label = m.label && !/^\d+$/.test(m.label) ? m.label : String(i + 1)));
    this.timeline.render();
    this.scheduleSave();
    if (!this.playing) toast(`Repère posé à ${fmtTime(t)}. Pendant la lecture, appuyez sur M au rythme de la musique.`, 'ok', 2500);
  }

  private renderEditTools() {
    const sel = this.selectedIds().length;
    clear(this.timeline.tools).append(
      h('button', { class: 'btn icon', title: 'Poser un repère (M) — pendant la lecture pour marquer refrains, couplets…', onclick: () => this.addMarker() }, icon('flag')),
      h('button', { class: 'btn icon', title: 'Couper à la tête de lecture (S)', onclick: () => this.splitAtPlayhead() }, icon('scissors')),
      h('button', { class: 'btn icon', title: 'Copier (Ctrl+C)', disabled: !sel, onclick: () => this.copySelection() }, icon('copy')),
      h('button', { class: 'btn icon', title: 'Coller à la tête de lecture (Ctrl+V)', disabled: !this.clipboard.length, onclick: () => this.paste() }, icon('paste')),
      h('button', { class: 'btn icon', title: 'Supprimer la sélection (Suppr)', disabled: !sel, onclick: () => this.deleteSelection() }, icon('trash')),
    );
  }

  // ── annuler / rétablir
  undo() {
    const st = this.history.undo(this.project);
    if (st) this.applySnapshot(st);
  }

  redo() {
    const st = this.history.redo();
    if (st) this.applySnapshot(st);
  }

  private applySnapshot(st: Partial<Project>) {
    const zonesChanged = JSON.stringify(st.zones) !== JSON.stringify(this.project.zones);
    Object.assign(this.project, st);
    this.zoneEditor.zones = this.project.zones;
    if (this.zoneEditor.selected && !this.project.zones.some((z) => z.id === this.zoneEditor.selected)) this.zoneEditor.selected = null;
    if (this.selectedClip && !this.findClip(this.selectedClip)) this.selectedClip = null;
    for (const id of [...this.multi]) if (!this.findClip(id)) this.multi.delete(id);
    if (zonesChanged) this.rebuildNow();
    this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
    this.renderSide();
    this.stage.redraw();
    this.dirty = true;
    this.scheduleSave(false);
  }

  private undoBtns: { u: HTMLButtonElement; r: HTMLButtonElement } | null = null;
  private renderUndo() {
    if (!this.undoBtns) return;
    this.undoBtns.u.disabled = !this.history.canUndo();
    this.undoBtns.r.disabled = !this.history.canRedo();
  }

  // ── médias importés
  async importMedia(): Promise<string | null> {
    const f = await pickFile('image/*,video/*');
    if (!f) return null;
    const kind: MediaItem['kind'] = f.type.startsWith('video/') ? 'video' : 'image';
    const item: MediaItem = { id: uid('m'), name: f.name, kind };
    (this.project.media ??= []).push(item);
    this.mediaBlobs.set(item.id, f);
    await this.prepareMedia(item);
    this.scheduleSave();
    toast(`${kind === 'video' ? 'Vidéo' : 'Image'} « ${f.name} » ajoutée à la médiathèque.`, 'ok');
    return item.id;
  }

  private async prepareMedia(item: MediaItem) {
    const blob = this.mediaBlobs.get(item.id);
    if (!blob) return;
    if (item.kind === 'image') {
      // passage par un canevas : WebGL ignore le retournement vertical pour les ImageBitmap
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * k));
      cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
      bmp.close();
      this.mediaRuntime.set(item.id, { image: cv });
    } else {
      const v = document.createElement('video');
      v.src = URL.createObjectURL(blob);
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      await new Promise<void>((res) => {
        v.onloadeddata = () => res();
        v.onerror = () => res();
        setTimeout(res, 8000);
      });
      this.mediaRuntime.set(item.id, { video: v });
    }
  }

  removeMedia(id: string) {
    this.project.media = (this.project.media ?? []).filter((m) => m.id !== id);
    const r = this.mediaRuntime.get(id);
    r?.video?.pause();
    this.mediaRuntime.delete(id);
    this.mediaBlobs.delete(id);
    this.renderer.forgetMedia(id);
    this.renderSide();
    this.dirty = true;
    this.scheduleSave();
  }

  /** Source d'image pour le moteur : image fixe, ou vidéo calée sur le temps du tableau. */
  private mediaSource(id: string, _clip: Clip, local: number) {
    const r = this.mediaRuntime.get(id);
    if (!r) return null;
    if (r.image) return { source: r.image as TexImageSource, dynamic: false };
    const v = r.video;
    if (!v || v.readyState < 2) return null;
    r.used = this.frameNo;
    const dur = v.duration || 1;
    const target = ((Math.max(0, local) % dur) + dur) % dur;
    if ((this.playing || this.live.on) && !this.exportingFrames) {
      if (v.paused) v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (!this.exportingFrames && Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
    return { source: v as TexImageSource, dynamic: true };
  }

  private exportingFrames = false;

  /** Cale précisément les vidéos actives avant le rendu d'une image d'export. */
  private async syncVideosAt(t: number, show = this.project.show) {
    const waits: Promise<void>[] = [];
    const tracks = [show.clips, ...(show.layers ?? []).map((l) => l.clips)];
    for (const list of tracks) {
      for (const tm of trackTimings(list)) {
        if (tm.clip.effect !== 'media') continue;
        if (t < tm.start - 3 || t > tm.end + 3) continue;
        const v = this.mediaRuntime.get(String(tm.clip.params.media))?.video;
        if (!v) continue;
        const dur = v.duration || 1;
        const target = ((Math.max(0, t - tm.start) % dur) + dur) % dur;
        if (Math.abs(v.currentTime - target) < 0.005) continue;
        waits.push(new Promise((res) => {
          const done = () => res();
          v.addEventListener('seeked', done, { once: true });
          setTimeout(done, 1500);
          v.currentTime = target;
        }));
      }
    }
    await Promise.all(waits);
  }

  snapToMusic() {
    if (!this.audio) return;
    const a = this.audio.analysis;
    const bar = (4 * 60) / a.bpm;
    const clips = this.project.show.clips;
    if (!clips.length) return;
    const cur = showDuration(this.project.show);
    const k = a.duration / cur;
    let t = 0;
    clips.forEach((c, i) => {
      let d = Math.max(bar * 2, Math.round((c.duration * k) / bar) * bar);
      if (i === clips.length - 1) d = Math.max(bar, a.duration - t);
      c.duration = Math.round(d * 100) / 100;
      c.transitionDuration = Math.min(c.transitionDuration, c.duration / 2);
      t += c.duration;
    });
    // enchaînement exact sur les mesures, transitions centrées sur les barres
    let at = 0;
    for (const c of clips) {
      const td = c.transition !== 'cut' ? Math.min(c.transitionDuration, c.duration / 2) : 0;
      c.start = Math.max(0, Math.round((at - (at > 0 ? td / 2 : 0)) * 100) / 100);
      at += c.duration;
      c.duration = Math.round((c.duration + td / 2) * 100) / 100;
    }
    this.refreshShowUI();
    this.scheduleSave();
    toast('Tableaux calés sur les mesures de la musique.', 'ok');
  }

  async loadAudio(file: Blob, name?: string) {
    try {
      this.busy('Analyse de la musique (tempo, temps forts)…');
      const buf = await decodeAudio(file);
      await new Promise((r) => setTimeout(r, 20));
      const analysis = analyseAudio(buf);
      this.audio = { blob: file, name: name ?? (file as File).name ?? 'musique', analysis };
      this.pause();
      this.showTab = 'musique';
      this.refreshShowUI();
      this.timeline.fit();
      this.scheduleSave();
      toast(`Musique analysée : ${analysis.bpm} BPM, ${fmtTime(analysis.duration)}.`, 'ok');
    } catch (e) {
      console.error(e);
      toast('Impossible de décoder ce fichier audio.', 'err');
    } finally {
      this.busy(null);
    }
  }

  // ───────────────────────── Scène et rendu ─────────────────────────
  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuildNow(), 250);
  }

  private worker: Worker | null = null;
  private workerReq = 0;

  rebuildNow() {
    if (!this.facade) return;
    const aiDepth = this.useAi ? this.aiDepth : null;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./analysis/scene.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; scene?: SceneMaps; error?: string }>) => {
          if (e.data.id !== this.workerReq) return;
          if (e.data.scene) this.applyScene(e.data.scene);
          else console.error(e.data.error);
        };
      } catch {
        this.worker = null;
      }
    }
    if (this.worker) {
      const id = ++this.workerReq;
      this.worker.postMessage({ id, image: this.facade, zones: JSON.parse(JSON.stringify(this.project.zones)), aiDepth });
    } else {
      this.applyScene(buildScene(this.facade, this.project.zones, { aiDepth }));
    }
  }

  private applyScene(scene: SceneMaps) {
    this.scene = scene;
    this.renderer.setScene(scene);
    this.dirty = true;
  }

  private loop(now: number) {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (this.playing) {
      const total = showDuration(this.project.show);
      if (this.audioNode && this.ac) this.time = this.ac.currentTime - this.audioStart;
      else this.time += dt;
      if (this.time >= total) {
        if (this.timeline.loop && total > 0) this.seek(0);
        else {
          this.time = total;
          this.pause();
        }
      }
      this.timeline.setTime(this.time, true);
      this.dirty = true;
    }
    const outputOpen = this.outputOpen();
    if (this.live.on && this.scene) {
      const { w, h: hh } = this.stage.previewSize(outputOpen ? 1920 : 1280);
      this.renderer.resize(w, hh);
      this.renderLiveFrame();
      this.frameNo++;
    } else if (this.scheduleBlack && this.project.schedule?.on && this.scene) {
      if (this.dirty) {
        this.renderer.blackout();
        this.dirty = false;
      }
    } else if (this.dirty && this.scene && this.facade) {
      const { w, h: hh } = this.stage.previewSize(outputOpen ? 1920 : this.playing ? 1280 : 1600);
      this.renderer.resize(w, hh);
      if (this.step === 'calques') {
        if (this.mapView === 'photo') this.renderer.showMap('albedo');
        else this.renderer.showMap(this.mapView);
      } else if (this.step === 'spectacle' || this.step === 'export' || this.step === 'source') {
        const mode = this.step === 'source' ? 'jour' : this.view;
        this.renderer.render(this.project.show, this.time, audioFrameAt(this.time, this.audio?.analysis ?? null, this.project.show.bpm), mode);
      }
      this.dirty = false;
      if (this.gizmoDrag || this.mediaClip()) this.stage.redraw();
      const meters = this.els.side.querySelectorAll('.meter-bar i') as NodeListOf<HTMLElement>;
      if (meters.length === 3) {
        const fr = audioFrameAt(this.time, this.audio?.analysis ?? null, this.project.show.bpm);
        [fr.bass, fr.mid, fr.high].forEach((v, i) => (meters[i].style.height = `${Math.round((v ?? 0) * 100)}%`));
      }
      this.frameNo++;
      for (const r of this.mediaRuntime.values()) if (r.video && !r.video.paused && (r.used ?? -1) < this.frameNo - 2) r.video.pause();
    }
    if (!this.playing && [...this.mediaRuntime.values()].some((r) => r.video && r.video.seeking)) this.dirty = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.scene || showDuration(this.project.show) <= 0) return;
    if (this.time >= showDuration(this.project.show) - 0.05) this.time = 0;
    this.playing = true;
    this.startAudio();
    this.timeline.setPlaying(true);
  }

  pause() {
    this.playing = false;
    this.stopAudio();
    this.timeline.setPlaying(false);
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    if (this.playing) {
      this.stopAudio();
      this.startAudio();
    }
    this.timeline.setTime(this.time);
    this.dirty = true;
    this.updateGizmo();
  }

  private startAudio() {
    if (!this.audio) return;
    this.ac ??= new AudioContext();
    this.ac.resume();
    const n = this.ac.createBufferSource();
    n.buffer = this.audio.analysis.buffer;
    n.connect(this.ac.destination);
    const off = Math.min(this.time, this.audio.analysis.duration - 0.01);
    if (off < this.audio.analysis.duration) n.start(0, Math.max(0, off));
    this.audioStart = this.ac.currentTime - this.time;
    this.audioNode = n;
  }

  private stopAudio() {
    try {
      this.audioNode?.stop();
    } catch {
      /* déjà arrêté */
    }
    this.audioNode = null;
  }

  fullscreen() {
    const el = this.stage.frame;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().then(() => setTimeout(() => this.stage.fit(), 100));
  }

  // ───────────────────────── Export ─────────────────────────
  private async runVideoExport(progress: HTMLElement) {
    if (!this.scene) return;
    if (this.exporting) {
      this.exporting.abort();
      return;
    }
    const o = this.exportOpts;
    const aspect = this.scene.width / this.scene.height;
    const W = aspect >= 1 ? o.long : Math.round((o.long * aspect) / 2) * 2;
    const H = aspect >= 1 ? Math.round(o.long / aspect / 2) * 2 : o.long;
    const bar = progress.querySelector('.bar') as HTMLElement;
    const lbl = progress.querySelector('.pl') as HTMLElement;
    progress.classList.add('on');
    const ctrl = new AbortController();
    this.exporting = ctrl;
    this.pause();
    const btn = progress.previousElementSibling as HTMLButtonElement | null;
    const btnLabel = btn?.innerHTML;
    if (btn) btn.textContent = 'Annuler l’export';
    const onProgress = (r: number, m: string) => {
      bar.style.width = `${(r * 100).toFixed(1)}%`;
      lbl.textContent = `${Math.round(r * 100)} % — ${m}`;
    };
    const t0 = performance.now();
    const base = (this.project.name || 'lumirock').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\d-]+/g, '_');
    try {
      this.exportingFrames = true;
      const present = (o.mode as string) === 'presentation';
      const common = {
        decorate: present ? (ctx: CanvasRenderingContext2D, w: number, hh: number, t: number) => this.drawPresentation(ctx, w, hh, t) : undefined,
        scene: this.scene, analysis: this.audio?.analysis ?? null, width: W, height: H, fps: o.fps, quality: o.quality, mode: (present ? 'simulation' : o.mode) as ViewMode, onProgress, signal: ctrl.signal, finalQuality: o.final,
        mediaProvider: (id: string, clip: Clip, local: number) => this.mediaSource(id, clip, local),
        prepareFrame: (t: number, show: typeof this.project.show) => this.syncVideosAt(t, show),
      };
      if (o.content === 'clips') {
        const files: Record<string, Uint8Array> = {};
        await exportClips({ ...common, show: this.project.show, withAudio: false }, async (name, blob) => {
          files[name] = new Uint8Array(await blob.arrayBuffer());
        });
        download(zipFiles(files), `${base}_tableaux_${W}x${H}.zip`);
      } else if (o.content === 'selected') {
        const clip = this.findClip(this.selectedClip)?.clip ?? this.project.show.clips[0];
        const show = { ...this.project.show, layers: [], clips: [{ ...clip, start: 0, fade: 0, transition: 'cut' }] };
        const { blob } = await exportVideo({ ...common, show, t0: 0, t1: clip.duration, withAudio: false, fade: false });
        download(blob, `${base}_${clip.effect}_${W}x${H}.mp4`);
      } else {
        const { blob } = await exportVideo({ ...common, show: this.project.show, t0: 0, t1: showDuration(this.project.show), withAudio: o.audio, fade: true });
        download(blob, `${base}_${W}x${H}_${o.fps}fps.mp4`);
      }
      toast(`Export terminé en ${Math.round((performance.now() - t0) / 1000)} s.`, 'ok', 5000);
      lbl.textContent = 'Terminé ✓';
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast('Export annulé.', 'info');
      else {
        console.error(e);
        toast(`Échec de l’export : ${(e as Error).message}`, 'err', 8000);
      }
      lbl.textContent = '';
      bar.style.width = '0%';
    } finally {
      this.exportingFrames = false;
      this.exporting = null;
      if (btn && btnLabel) btn.innerHTML = btnLabel;
    }
  }

  private async runKitExport(progress: HTMLElement) {
    if (!this.scene) return;
    const bar = progress.querySelector('.bar') as HTMLElement;
    const lbl = progress.querySelector('.pl') as HTMLElement;
    progress.classList.add('on');
    try {
      const blob = await buildKit(this.scene, this.project, (r, m) => {
        bar.style.width = `${r * 100}%`;
        lbl.textContent = m;
      });
      download(blob, `${(this.project.name || 'lumirock').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\d-]+/g, '_')}_kit_pro.zip`);
      lbl.textContent = 'Kit téléchargé ✓';
    } catch (e) {
      console.error(e);
      toast('Échec de la création du kit.', 'err');
    }
  }

  private async exportTemplate(black: boolean) {
    if (!this.scene) return;
    const png = await canvasToPng(drawTemplate(this.scene, this.project, black, Math.max(1, 1920 / this.scene.width)));
    download(new Blob([png as BlobPart], { type: 'image/png' }), `gabarit_${black ? 'noir' : 'photo'}.png`);
  }

  private snapshot() {
    this.dirty = true;
    this.loop(performance.now());
    this.stage.gl.toBlob((b) => b && download(b, `lumirock_${fmtTime(this.time).replace(/[:.]/g, '-')}.png`), 'image/png');
  }

  // ───────────────────────── Présentation client ─────────────────────────
  private logoImg: HTMLImageElement | null = null;

  private loadLogo() {
    if (this.logoImg) return;
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}logo-512.png`;
    this.logoImg = img;
  }

  /** Habillage de la vidéo de présentation : carton titre puis signature discrète. */
  drawPresentation(ctx: CanvasRenderingContext2D, w: number, hh: number, t: number) {
    const s = Math.min(w, hh) / 1080;
    const intro = Math.max(0, 1 - Math.max(0, t - 3) / 1.2);
    if (intro > 0) {
      ctx.fillStyle = `rgba(5,6,10,${0.72 * intro})`;
      ctx.fillRect(0, 0, w, hh);
      ctx.globalAlpha = intro;
      const L = 220 * s;
      if (this.logoImg?.complete) ctx.drawImage(this.logoImg, w / 2 - L / 2, hh / 2 - L - 40 * s, L, L);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${64 * s}px Cinzel, Georgia, serif`;
      ctx.fillText(this.project.name || 'Spectacle', w / 2, hh / 2 + 50 * s);
      ctx.fillStyle = '#e0a23e';
      ctx.font = `500 ${28 * s}px Inter, sans-serif`;
      ctx.fillText('Projet de video mapping — simulation', w / 2, hh / 2 + 100 * s);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'right';
    ctx.font = `600 ${20 * s}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('LUMIROCK · by Arnisound tools', w - 24 * s, hh - 24 * s);
    ctx.textAlign = 'left';
    ctx.fillText(this.project.name || '', 24 * s, hh - 24 * s);
  }

  /** Mode présentation : plein écran, simulation de nuit, titre. */
  present() {
    if (!this.scene) return;
    this.loadLogo();
    this.view = 'simulation';
    this.renderViewSwitch();
    this.seek(0);
    const frame = this.stage.frame;
    frame.querySelector('.present-title')?.remove();
    const title = h('div', { class: 'present-title' },
      h('img', { src: `${import.meta.env.BASE_URL}logo-512.png`, alt: '' }),
      h('div', { class: 'pt-name' }, this.project.name || 'Spectacle'),
      h('div', { class: 'pt-sub' }, 'Projet de video mapping — simulation'));
    frame.appendChild(title);
    setTimeout(() => title.classList.add('out'), 3500);
    setTimeout(() => title.remove(), 5000);
    frame.requestFullscreen?.().catch(() => undefined).finally(() => setTimeout(() => this.stage.fit(), 120));
    this.play();
  }

  /** Ouverture d'un lien de démonstration (#demo=URL du fichier .lumirock). */
  private async openDemoFromHash() {
    const m = location.hash.match(/demo=([^&]+)/);
    if (!m) return;
    const url = decodeURIComponent(m[1]);
    try {
      this.busy('Chargement de la démonstration…');
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      await this.restore(await loadLumirock(await r.blob()));
      this.root.dataset.demo = '1';
      this.goto('spectacle');
      const go = h('button', { class: 'demo-start' },
        h('img', { src: `${import.meta.env.BASE_URL}logo-512.png`, alt: '' }),
        h('b', {}, this.project.name || 'Spectacle'),
        h('span', {}, '▶ Lancer la présentation'));
      go.addEventListener('click', () => {
        go.remove();
        this.present();
      });
      document.body.appendChild(go);
    } catch (e) {
      console.error(e);
      toast('Impossible de charger la démonstration (lien invalide ou fichier inaccessible).', 'err', 8000);
    } finally {
      this.busy(null);
    }
  }

  // ───────────────────────── Projet ─────────────────────────
  private async currentState(): Promise<SavedState> {
    const main = await this.facadeState();
    main.others = this.slots.filter((x, i) => i !== this.activeSlot && x.state).map((x) => x.state!);
    return main;
  }

  private async facadeState(): Promise<SavedState> {
    if (this.facade && !this.facadeBlob) this.facadeBlob = await imageDataToBlob(this.facade);
    if (!this.sourceBlob && this.sourceImage) this.sourceBlob = await imageDataToBlob(this.sourceImage);
    return {
      project: this.project,
      quad: this.quad,
      source: this.sourceBlob,
      facade: this.facadeBlob,
      aiDepth: this.aiDepthBlob,
      audio: this.audio ? { blob: this.audio.blob, name: this.audio.name } : null,
      media: (this.project.media ?? []).filter((m) => this.mediaBlobs.has(m.id)).map((m) => ({ id: m.id, blob: this.mediaBlobs.get(m.id)! })),
    };
  }

  scheduleSave(commitHistory = true) {
    if (commitHistory) this.history.commit(this.project);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(async () => {
      if (!this.facade) return;
      autosave(await this.currentState());
    }, 1500);
  }

  async saveProjectFile() {
    if (!this.facade) return;
    const blob = await saveLumirock(await this.currentState());
    download(blob, `${(this.project.name || 'projet').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\d-]+/g, '_')}.lumirock`);
    toast('Projet enregistré.', 'ok');
  }

  async openProjectFile(f: Blob) {
    try {
      this.busy('Ouverture du projet…');
      await this.restore(await loadLumirock(f));
    } catch (e) {
      console.error(e);
      toast('Fichier de projet illisible.', 'err');
    } finally {
      this.busy(null);
    }
  }

  async restore(s: SavedState) {
    this.busy('Restauration du projet…');
    try {
      this.pause();
      await this.restoreFacade(s, false);
      if (s.audio) await this.loadAudio(s.audio.blob, s.audio.name);
      else this.audio = null;
      this.mediaBlobs.clear();
      this.mediaRuntime.clear();
      for (const m of s.media ?? []) this.mediaBlobs.set(m.id, m.blob);
      for (const item of this.project.media ?? []) await this.prepareMedia(item);
      this.slots = [{ name: this.project.name, state: null }, ...(s.others ?? []).map((o) => ({ name: o.project.name, state: o }))];
      this.activeSlot = 0;
      this.history.reset(this.project);
      this.selectedClip = null;
      this.time = 0;
      this.goto(this.facade ? 'spectacle' : 'source');
      toast(this.slots.length > 1 ? `Projet restauré (${this.slots.length} façades).` : 'Projet restauré.', 'ok');
    } finally {
      this.busy(null);
    }
  }

  // ───────────────────────── Plusieurs façades ─────────────────────────
  slots: { name: string; state: SavedState | null }[] = [{ name: 'Façade 1', state: null }];
  activeSlot = 0;

  /** Charge les données d'une façade (sans toucher à la musique ni aux médias). */
  private async restoreFacade(s: SavedState | null, full = true) {
    const media = this.project.media;
    if (!s) {
      this.project = emptyProject();
      this.facade = null;
      this.scene = null;
      this.sourceImage = null;
      this.sourceCanvas = null;
      this.sourceBlob = null;
      this.facadeBlob = null;
      this.aiDepth = null;
      this.aiDepthBlob = null;
      this.quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
    } else {
      this.project = structuredClone(s.project);
      if (this.project.schedule?.on) {
        // la programmation doit être réactivée à la main (lecture du son et anti-veille)
        this.project.schedule.on = false;
        setTimeout(() => toast('Ce projet avait une programmation horaire : réactivez-la dans Export.', 'info', 6000), 500);
      }
      freezeStarts(this.project.show.clips);
      for (const l of this.project.show.layers ?? []) freezeStarts(l.clips);
      this.quad = s.quad ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
      this.sourceBlob = s.source;
      this.sourceImage = null;
      this.sourceCanvas = null;
      if (s.source) {
        this.sourceImage = await imageDataFromBlob(s.source);
        this.sourceCanvas = imageDataToCanvas(this.sourceImage);
      }
      this.aiDepth = null;
      this.aiDepthBlob = s.aiDepth;
      this.facade = null;
      this.scene = null;
      if (s.facade) {
        const img = await imageDataFromBlob(s.facade, MAX_WORK * 2);
        if (s.aiDepth) {
          const d = await imageDataFromBlob(s.aiDepth, MAX_WORK * 2);
          if (d.width === img.width && d.height === img.height) {
            this.aiDepth = new Float32Array(d.width * d.height);
            for (let i = 0; i < this.aiDepth.length; i++) this.aiDepth[i] = d.data[i * 4] / 255;
          }
        }
        this.facadeBlob = s.facade;
        this.facade = img;
        this.facadeVersion++;
        this.project.width = img.width;
        this.project.height = img.height;
        this.rebuildNow();
      }
    }
    if (full) {
      // la médiathèque est commune à toutes les façades
      const all = [...(media ?? [])];
      for (const m of this.project.media ?? []) if (!all.some((x) => x.id === m.id)) all.push(m);
      this.project.media = all;
      this.history.reset(this.project);
      this.selectedClip = null;
      this.time = 0;
      this.zoneEditor.zones = this.project.zones;
      this.zoneEditor.selected = null;
      this.goto(this.facade ? 'spectacle' : 'source');
    }
  }

  async switchFacade(i: number) {
    if (i === this.activeSlot || !this.slots[i]) return;
    this.pause();
    this.busy('Changement de façade…');
    try {
      this.slots[this.activeSlot] = { name: this.project.name, state: this.facade ? await this.facadeState() : null };
      this.activeSlot = i;
      await this.restoreFacade(this.slots[i].state);
      if (!this.slots[i].state) this.project.name = this.slots[i].name;
    } finally {
      this.busy(null);
    }
  }

  async addFacade() {
    this.pause();
    this.slots[this.activeSlot] = { name: this.project.name, state: this.facade ? await this.facadeState() : null };
    const name = `Façade ${this.slots.length + 1}`;
    this.slots.push({ name, state: null });
    this.activeSlot = this.slots.length - 1;
    await this.restoreFacade(null);
    this.project.name = name;
    this.renderHeader();
    toast(`${name} ajoutée : importez sa photo ou choisissez un modèle.`, 'ok', 4500);
  }

  async removeFacade() {
    if (this.slots.length < 2 || !confirm(`Supprimer la façade « ${this.project.name} » de ce projet ?`)) return;
    this.slots.splice(this.activeSlot, 1);
    this.activeSlot = 0;
    await this.restoreFacade(this.slots[0].state);
    this.scheduleSave();
  }

  private facadeSwitcher() {
    const names = this.slots.map((x, i) => (i === this.activeSlot ? this.project.name || x.name : x.name));
    const sel = h('select', { class: 'facade-sel', title: 'Façades du projet' },
      ...names.map((n, i) => h('option', { value: String(i), selected: i === this.activeSlot }, `🏛 ${n}`)),
      h('option', { value: 'add' }, '＋ Ajouter une façade'),
      this.slots.length > 1 ? h('option', { value: 'del' }, '✕ Supprimer cette façade') : null,
    );
    sel.addEventListener('change', () => {
      const v = sel.value;
      sel.value = String(this.activeSlot);
      if (v === 'add') this.addFacade();
      else if (v === 'del') this.removeFacade();
      else this.switchFacade(Number(v));
    });
    return sel;
  }

  newProject() {
    if (this.facade && !confirm('Commencer un nouveau projet ? Pensez à enregistrer le projet actuel.')) return;
    this.pause();
    this.project = emptyProject();
    this.facade = null;
    this.scene = null;
    this.sourceImage = null;
    this.sourceCanvas = null;
    this.sourceBlob = null;
    this.audio = null;
    this.aiDepth = null;
    this.aiDepthBlob = null;
    this.selectedClip = null;
    this.time = 0;
    this.mediaBlobs.clear();
    this.mediaRuntime.clear();
    this.slots = [{ name: 'Façade 1', state: null }];
    this.activeSlot = 0;
    this.history.reset(this.project);
    this.goto('source');
  }

  // ───────────────────────── Clavier ─────────────────────────
  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (this.live.on && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        const idx = this.liveKeys.indexOf(k);
        const clips = this.liveClips();
        if (e.key === 'Escape') this.exitLive();
        else if (k === 'b' && idx < 0) this.toggleBlackout();
        else if (idx >= 0 && idx < clips.length) this.liveTrigger(clips[idx]);
        else if (k === 't' && idx < 0) this.tapTempo();
        else if (e.code === 'Space') {
          e.preventDefault();
          const cur = clips.findIndex((c) => c.id === this.live.cur?.clip.id);
          if (clips.length) this.liveTrigger(clips[(cur + 1) % clips.length]);
        } else if (e.key === 'ArrowUp') this.live.masterTarget = Math.min(1.5, this.live.masterTarget + 0.1);
        else if (e.key === 'ArrowDown') this.live.masterTarget = Math.max(0, this.live.masterTarget - 0.1);
        else if (k === 'f' && idx < 0) this.fullscreen();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveProjectFile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
        return;
      }
      if (this.step === 'spectacle' || this.step === 'export') {
        if (e.code === 'Space') {
          e.preventDefault();
          this.togglePlay();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') this.copySelection();
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
          if (this.copySelection(true)) this.deleteSelection();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') this.paste();
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          this.duplicateSelection();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          this.selectAllOnTrack();
        } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) this.splitAtPlayhead();
        else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) this.addMarker();
        else if (e.key === 'Escape') {
          this.selectedClip = null;
          this.multi.clear();
          this.refreshShowUI();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedClip) this.deleteSelection();
        else if (e.key === 'Home') this.seek(0);
        else if (e.key === 'f') this.fullscreen();
      } else if (this.step === 'calques') {
        const z = this.zoneEditor;
        const map: Record<string, Tool> = { v: 'select', r: 'rect', p: 'poly', e: 'ellipse', a: 'arch', g: 'gothic', w: 'ia' };
        if (map[e.key.toLowerCase()]) {
          z.setTool(map[e.key.toLowerCase()]);
          this.renderSide();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && z.selected) this.deleteZone(z.selected);
        else if (e.key === 'Escape') z.cancel();
        else if (e.key === 'Enter') {
          z.finishPoly();
          this.stage.redraw();
        }
      }
    });
  }
}

export function start() {
  const root = $('#app');
  (window as any).lumirock = new App(root);
}
