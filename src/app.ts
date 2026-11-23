// Lumirock — application principale.
import { buildScene, MAX_WORK } from './analysis/maps';
import { fitToWork, rectify } from './analysis/rectify';
import { detectOpenings } from './analysis/detect';
import { AudioAnalysis, analyseAudio, audioFrameAt, decodeAudio } from './audio';
import { CATEGORIES, CATEGORY_COLORS, COMMON_PARAMS, EFFECTS, EFFECT_MAP, ParamDef, TRANSITIONS } from './effects/library';
import { Renderer, SceneMaps, ViewMode, showDuration, trackTimings } from './gl/renderer';
import { SCENARIOS, compose, defaultShow, newClip } from './scenarios';
import { TEMPLATES } from './templates';
import { Clip, Layer, MediaItem, Project, Pt, ZONE_TYPES, ZoneTypeKey, uid, zoneType } from './types';
import { History } from './history';
import { paramAt, removeKey, setKey } from './keys';
import { QuadEditor, Tool, ZoneEditor } from './ui/editors';
import { $, add, clear, fmtTime, h, icon, pickFile, select, slider, toast } from './ui/dom';
import { Stage } from './ui/stage';
import { MAIN_TRACK, Timeline } from './ui/timeline';
import { Preset, loadPresets, savePresets } from './presets';
import { Previews } from './ui/previews';
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
  private mediaRuntime = new Map<string, { image?: ImageBitmap; video?: HTMLVideoElement; used?: number }>();
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
      select: (id) => {
        this.selectedClip = id;
        if (id) this.showTab = 'reglages';
        this.refreshShowUI();
      },
      selectTrack: (tid) => {
        this.timeline.activeTrack = tid;
      },
      reorder: (tid, from, to) => {
        const c = this.trackList(tid);
        const [m] = c.splice(from, 1);
        c.splice(to, 0, m);
        this.refreshShowUI();
        this.scheduleSave();
      },
      resize: (id, d, final) => {
        const c = this.findClip(id)?.clip;
        if (!c) return;
        c.duration = d;
        c.transitionDuration = Math.min(c.transitionDuration, d / 2);
        this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
        this.dirty = true;
        if (final) {
          this.renderSide();
          this.scheduleSave();
        }
      },
      togglePlay: () => this.togglePlay(),
      home: () => this.seek(0),
      addTrack: () => this.addLayer(),
    });
    this.history.onChange = () => this.renderUndo();
    this.renderer.mediaProvider = (id, clip, local) => this.mediaSource(id, clip, local);
    this.stage.onResize = () => {
      this.dirty = true;
    };
    this.buildLayout();
    this.bindKeys();
    const errors = this.renderer.precompileAll(EFFECTS);
    if (errors.length) console.error(errors);
    requestAnimationFrame((t) => this.loop(t));
    this.goto('source');
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
      h('nav', { class: 'steps' },
        ...STEPS.map((s, i) =>
          h('button', { class: `step${this.step === s.id ? ' active' : ''}`, disabled: !can(s.id), onclick: () => this.goto(s.id) },
            h('span', { class: 'num' }, String(i + 1)), s.label),
        ),
      ),
      h('div', { class: 'spacer' }),
      h('div', { class: 'actions' },
        (() => {
          const u = h('button', { class: 'btn icon ghost', title: 'Annuler (Ctrl+Z)', disabled: !this.history.canUndo(), onclick: () => this.undo() }, icon('undo'));
          const r = h('button', { class: 'btn icon ghost', title: 'Rétablir (Ctrl+Maj+Z)', disabled: !this.history.canRedo(), onclick: () => this.redo() }, icon('redo'));
          this.undoBtns = { u, r };
          return h('div', { class: 'undo' }, u, r);
        })(),
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
  private outputWin: Window | null = null;

  openOutput() {
    if (this.outputWin && !this.outputWin.closed) {
      this.outputWin.focus();
      return;
    }
    const w = window.open('', 'lumirock-sortie', 'popup,width=1280,height=720');
    if (!w) {
      toast('La fenêtre a été bloquée : autorisez les fenêtres pop-up pour ce site.', 'err', 6000);
      return;
    }
    w.document.title = 'Lumirock — Sortie projecteur';
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
    const v = w.document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.style.cssText = 'width:100vw;height:100vh;object-fit:contain;background:#000;display:block';
    v.srcObject = this.stage.gl.captureStream(60);
    w.document.body.appendChild(v);
    const hint = w.document.createElement('div');
    hint.textContent = 'Glissez cette fenêtre sur le vidéoprojecteur puis double-cliquez pour le plein écran';
    hint.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);color:#e0a23e;font:14px sans-serif;background:rgba(0,0,0,.7);padding:8px 14px;border-radius:8px;transition:opacity 1s';
    w.document.body.appendChild(hint);
    setTimeout(() => (hint.style.opacity = '0'), 6000);
    w.document.addEventListener('dblclick', () => (w.document.fullscreenElement ? w.document.exitFullscreen() : w.document.documentElement.requestFullscreen()));
    this.outputWin = w;
    if (this.view !== 'projection') {
      this.view = 'projection';
      this.renderViewSwitch();
    }
    this.dirty = true;
    toast('Sortie projecteur ouverte (vue « Projection » activée).', 'ok');
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
    }
    this.renderSide();
    this.renderStageHint();
    requestAnimationFrame(() => this.stage.fit());
    this.dirty = true;
  }

  private renderStageHint() {
    this.stage.root.querySelector('.hero')?.remove();
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
      this.project.show.clips = compose(id, total, this.audio?.analysis ?? null, this.project.show.bpm);
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
      h('p', { class: 'muted' }, 'Les pistes superposées s’ajoutent à la piste principale : par exemple un fond « Course du soleil » et, par-dessus, « Mille bougies » ciblé sur les fenêtres. Utilisez « Pause (noir) » pour espacer les tableaux d’une piste.'),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Piste principale'),
        h('p', { class: 'muted small' }, `${show.clips.length} tableaux`),
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
    const prog = Math.min(1, Math.max(0, (this.time - found.start) / clip.duration));
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
    const advOpen = (clip.params._target ?? 0) !== 0 || Number(clip.params._react ?? 0) > 0 || Number(clip.params._mirror ?? 0) > 0 || Number(clip.params._hue ?? 0) !== 0 || Number(clip.params._sat ?? 1) !== 1;
    add(b, 
      h('div', { class: 'clip-head', style: `--c:${CATEGORY_COLORS[e.category]}` },
        h('div', {}, h('small', {}, `Tableau ${idx + 1} · ${e.category}`), h('b', {}, e.name)),
        h('div', { class: 'row' },
          h('button', { class: 'btn icon', title: 'Déplacer avant', disabled: idx === 0, onclick: () => this.moveClip(clip.id, -1) }, icon('left')),
          h('button', { class: 'btn icon', title: 'Déplacer après', disabled: idx === list.length - 1, onclick: () => this.moveClip(clip.id, 1) }, icon('right')),
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
          if (x !== 'cut' && clip.transitionDuration === 0) clip.transitionDuration = 1.5;
          this.timeline.render();
          changed();
        } }),
        slider({ label: 'Durée de transition (s)', min: 0, max: 6, step: 0.1, value: clip.transitionDuration, onInput: (x) => {
          clip.transitionDuration = Math.min(x, clip.duration / 2);
          this.timeline.render();
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

  private tabAmbiance(b: HTMLElement) {
    const m = this.project.show.master;
    const ch = () => {
      this.dirty = true;
      this.scheduleSave();
    };
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
          { value: 'simulation', label: 'Simulation nuit (pour présenter au client)' },
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
        h('div', { class: 'card-title' }, 'Projeter directement'),
        h('p', { class: 'muted small' }, 'Branchez le vidéoprojecteur, glissez cette fenêtre sur son écran, passez en mode « Projection » puis en plein écran.'),
        h('button', { class: 'btn ghost wide', onclick: () => this.fullscreen() }, icon('expand'), 'Plein écran'),
      ),
    );
  }

  refreshShowUI() {
    this.timeline.setData(this.project.show, this.audio?.analysis ?? null, this.selectedClip);
    if (this.step === 'spectacle' || this.step === 'export') this.renderSide();
    this.dirty = true;
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
      this.project = emptyProject();
      this.project.name = file.name.replace(/\.[^.]+$/, '');
      this.mediaBlobs.clear();
      this.mediaRuntime.clear();
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
    this.project = emptyProject();
    this.project.name = t.name;
    this.project.zones = t.zones;
    this.sourceImage = t.image;
    this.sourceCanvas = imageDataToCanvas(t.image);
    this.sourceBlob = null;
    this.quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.aiDepth = null;
    this.aiDepthBlob = null;
    this.setFacade(t.image);
    this.mediaBlobs.clear();
    this.mediaRuntime.clear();
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
    // la nouvelle piste commence par une pause jusqu'à la position de lecture
    if (this.time > 0.5) l.clips.push({ ...newClip('vide', Math.round(this.time * 10) / 10), transition: 'cut', transitionDuration: 0 });
    layers.push(l);
    this.timeline.activeTrack = l.id;
    this.showTab = 'tableaux';
    this.refreshShowUI();
    this.scheduleSave();
    toast(`${l.name} ajoutée : choisissez un tableau, il s’ajoutera sur cette piste.`, 'ok', 4500);
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
    const clips = sel ? sel.list : this.trackList(this.timeline.activeTrack);
    const i = clips.findIndex((x) => x.id === this.selectedClip);
    clips.splice(i >= 0 ? i + 1 : clips.length, 0, c);
    this.selectedClip = c.id;
    this.seek((this.findClip(c.id)?.start ?? 0) + 0.01);
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
    f.list.splice(f.list.indexOf(f.clip) + 1, 0, copy);
    this.selectedClip = copy.id;
    this.refreshShowUI();
    this.scheduleSave();
  }

  moveClip(id: string, dir: number) {
    const f = this.findClip(id);
    if (!f) return;
    const clips = f.list;
    const i = clips.indexOf(f.clip);
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    [clips[i], clips[j]] = [clips[j], clips[i]];
    this.refreshShowUI();
    this.scheduleSave();
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
      this.mediaRuntime.set(item.id, { image: await createImageBitmap(blob) });
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
    const outputOpen = !!this.outputWin && !this.outputWin.closed;
    if (this.live.on && this.scene) {
      const { w, h: hh } = this.stage.previewSize(outputOpen ? 1920 : 1280);
      this.renderer.resize(w, hh);
      this.renderLiveFrame();
      this.frameNo++;
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
      const common = {
        scene: this.scene, analysis: this.audio?.analysis ?? null, width: W, height: H, fps: o.fps, quality: o.quality, mode: o.mode, onProgress, signal: ctrl.signal, finalQuality: o.final,
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
        const show = { ...this.project.show, clips: [{ ...clip, transition: 'cut' }] };
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

  // ───────────────────────── Projet ─────────────────────────
  private async currentState(): Promise<SavedState> {
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
      this.project = s.project;
      this.quad = s.quad ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
      this.sourceBlob = s.source;
      if (s.source) {
        this.sourceImage = await imageDataFromBlob(s.source);
        this.sourceCanvas = imageDataToCanvas(this.sourceImage);
      }
      this.aiDepth = null;
      this.aiDepthBlob = s.aiDepth;
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
        this.project.width = img.width;
        this.project.height = img.height;
        this.rebuildNow();
      }
      if (s.audio) await this.loadAudio(s.audio.blob, s.audio.name);
      else this.audio = null;
      this.mediaBlobs.clear();
      this.mediaRuntime.clear();
      for (const m of s.media ?? []) this.mediaBlobs.set(m.id, m.blob);
      for (const item of this.project.media ?? []) await this.prepareMedia(item);
      this.history.reset(this.project);
      this.selectedClip = null;
      this.time = 0;
      this.goto(this.facade ? 'spectacle' : 'source');
      toast('Projet restauré.', 'ok');
    } finally {
      this.busy(null);
    }
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
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedClip) this.deleteClip(this.selectedClip);
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
