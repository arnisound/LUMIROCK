// Scénarios prêts à l'emploi et composition automatique d'un spectacle.
import { AudioAnalysis, energyAt } from './audio';
import { EFFECTS, EFFECT_MAP, defaultParams } from './effects/library';
import { Clip, ParamValue, Show, uid } from './types';

interface Step {
  effect: string;
  weight?: number;
  params?: Record<string, ParamValue>;
  transition?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  palette: [string, string];
  steps: Step[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'musique', name: 'Fête de la musique', description: 'Lasers, égaliseur, néons et pixels qui battent au rythme.', palette: ['#2bd9ff', '#ff2bd6'],
    steps: [
      { effect: 'scan', weight: 0.7 },
      { effect: 'egaliseur', weight: 1.1, params: { mode: 0 } },
      { effect: 'lasers', weight: 1.0, transition: 'flash' },
      { effect: 'battement', weight: 0.8 },
      { effect: 'neon', weight: 0.9, params: { rainbow: true } },
      { effect: 'onde', weight: 0.9 },
      { effect: 'egaliseur', weight: 1.0, params: { mode: 1 }, transition: 'pixels' },
      { effect: 'matrix', weight: 0.8 },
      { effect: 'objets3d', weight: 1.0, params: { shape: 3 }, transition: 'iris' },
      { effect: 'feuxartifice', weight: 1.0, transition: 'flash' },
    ],
  },
  {
    id: 'noel', name: 'Noël', description: 'Neige, bougies, or et vitraux, final en feu d’artifice.', palette: ['#ffcf6b', '#ff2f4f'],
    steps: [
      { effect: 'rideau', weight: 0.8, params: { colorA: '#9e0f1f' } },
      { effect: 'texte', weight: 0.7, params: { text: 'Joyeux Noël', colorA: '#ffe08a' }, transition: 'balayage' },
      { effect: 'neige', weight: 1.3 },
      { effect: 'bougies', weight: 1.1, transition: 'cascade' },
      { effect: 'avent', weight: 1.1 },
      { effect: 'vitrail', weight: 1.0 },
      { effect: 'ombres', weight: 1.0 },
      { effect: 'matiere', weight: 1.0, params: { mat: 0 }, transition: 'montee' },
      { effect: 'aurore', weight: 1.0, params: { colorA: '#3dffb0', colorB: '#ff3d8b' } },
      { effect: 'traineau', weight: 1.1 },
      { effect: 'etoiles', weight: 1.0, transition: 'iris' },
      { effect: 'feuxartifice', weight: 1.1, transition: 'flash' },
      { effect: 'allumage', weight: 0.7, params: { colorA: '#ffe3b0' } },
    ],
  },
  {
    id: 'patrimoine', name: 'Patrimoine', description: 'Le monument se dessine, traverse les siècles, s’effondre et renaît.', palette: ['#ffd9a0', '#7fa6ff'],
    steps: [
      { effect: 'dessin', weight: 1.2 },
      { effect: 'soleil', weight: 1.2, transition: 'montee' },
      { effect: 'cinema', weight: 0.9, transition: 'volets' },
      { effect: 'relief', weight: 1.0 },
      { effect: 'extrusion', weight: 1.0, transition: 'dissolution' },
      { effect: 'faisceaux', weight: 0.9 },
      { effect: 'effondrement', weight: 1.3, transition: 'noir' },
      { effect: 'lierre', weight: 1.0 },
      { effect: 'vitrail', weight: 0.9, transition: 'cascade' },
      { effect: 'texte', weight: 0.7, params: { text: 'Notre patrimoine', style: 1 } },
      { effect: 'allumage', weight: 0.7 },
    ],
  },
  {
    id: 'halloween', name: 'Halloween', description: 'Orage, ombres inquiétantes, flammes et glitchs.', palette: ['#ff7a1a', '#8a2be2'],
    steps: [
      { effect: 'brume', weight: 1.0 },
      { effect: 'citrouilles', weight: 1.0 },
      { effect: 'orage', weight: 1.2 },
      { effect: 'ombres', weight: 1.0, params: { colorA: '#ff7a1a', colorB: '#1a0b2e' } },
      { effect: 'sorciere', weight: 1.1 },
      { effect: 'faisceaux', weight: 1.0, params: { colorA: '#ff7a1a', colorB: '#8a2be2' } },
      { effect: 'extrusion', weight: 0.9, params: { colorA: '#ffd2a8', tint: 0.4 } },
      { effect: 'glitch', weight: 0.6, transition: 'cut' },
      { effect: 'effondrement', weight: 1.2, params: { colorA: '#ff4a00' }, transition: 'flash' },
      { effect: 'lave', weight: 1.0 },
      { effect: 'sable', weight: 1.0, transition: 'tourbillon' },
      { effect: 'neon', weight: 0.9 },
      { effect: 'texte', weight: 0.7, params: { text: 'Halloween', colorA: '#ff7a1a', colorB: '#14051f' } },
    ],
  },
  {
    id: 'national', name: 'Fête nationale', description: 'Bleu, blanc, rouge, rythmes puissants et feux d’artifice.', palette: ['#2453ff', '#ff2b3b'],
    steps: [
      { effect: 'scan', weight: 0.8, params: { colorA: '#ffffff', colorB: '#2453ff' } },
      { effect: 'dessin', weight: 1.0, params: { colorA: '#7fa0ff', colorB: '#ffffff' } },
      { effect: 'vague', weight: 1.0 },
      { effect: 'battement', weight: 0.8, params: { colorA: '#ffffff', colorB: '#ff2b3b' }, transition: 'flash' },
      { effect: 'extrusion', weight: 0.9 },
      { effect: 'neon', weight: 0.8, params: { colorA: '#2453ff', colorB: '#ff2b3b' } },
      { effect: 'lasers', weight: 0.9, params: { colorA: '#2453ff', colorB: '#ff2b3b' } },
      { effect: 'drapeau', weight: 1.0, transition: 'volets' },
      { effect: 'feuxartifice', weight: 1.4, transition: 'flash' },
      { effect: 'texte', weight: 0.7, params: { text: 'Vive la fête !', colorA: '#ffffff', colorB: '#0c1f6b' } },
    ],
  },
  {
    id: 'nouvelan', name: 'Réveillon du Nouvel An', description: 'Ciel étoilé, décompte géant, feux d’artifice et vœux.', palette: ['#ffd36b', '#7a5cff'],
    steps: [
      { effect: 'etoiles', weight: 1.0 },
      { effect: 'texte', weight: 0.8, params: { text: 'Bonne soirée', colorA: '#ffe08a' }, transition: 'iris' },
      { effect: 'neon', weight: 0.8 },
      { effect: 'poursuite', weight: 0.8, params: { colorA: '#ffd36b', colorB: '#7a5cff' } },
      { effect: 'decompte', weight: 1.1, params: { text: 'Bonne année !' }, transition: 'cut' },
      { effect: 'feuxartifice', weight: 1.4, transition: 'flash' },
      { effect: 'texte', weight: 0.8, params: { text: 'Meilleurs vœux', colorA: '#ffe08a', style: 4 } },
    ],
  },
  {
    id: 'saisons', name: 'Les quatre saisons', description: 'Printemps fleuri, été lumineux, automne en feu, hiver enneigé.', palette: ['#ffc46b', '#6fb8ff'],
    steps: [
      { effect: 'allumage', weight: 0.7 },
      { effect: 'fleurs', weight: 1.2, transition: 'montee' },
      { effect: 'lapin', weight: 0.9 },
      { effect: 'soleil', weight: 1.0 },
      { effect: 'surf', weight: 1.1 },
      { effect: 'feuilles', weight: 1.2, transition: 'dissolution' },
      { effect: 'feu', weight: 0.9, params: { colorA: '#ff8a1a' }, transition: 'dissolution' },
      { effect: 'neige', weight: 1.3 },
      { effect: 'aurore', weight: 1.0 },
    ],
  },
  {
    id: 'mariage', name: 'Mariage / célébration', description: 'Rideau, prénoms en lumière, fleurs, marbre et feu d’artifice.', palette: ['#ffd1e0', '#ffd58a'],
    steps: [
      { effect: 'rideau', weight: 0.8, params: { colorA: '#8c1036' } },
      { effect: 'texte', weight: 0.8, params: { text: 'Camille & Sacha', colorA: '#ffe6ef' } },
      { effect: 'petales', weight: 1.1, transition: 'iris' },
      { effect: 'coeurs', weight: 1.0 },
      { effect: 'lierre', weight: 1.1, params: { colorB: '#ff8ab8' } },
      { effect: 'matiere', weight: 1.0, params: { mat: 1 } },
      { effect: 'vitrail', weight: 1.0, params: { colorA: '#ff6fa8', colorB: '#ffd36b' } },
      { effect: 'aquarelle', weight: 1.0, params: { colorA: '#ff8ab8', colorB: '#ffd36b' } },
      { effect: 'kaleido', weight: 0.8, params: { colorA: '#ff8ab8', colorB: '#ffd36b' } },
      { effect: 'feuxartifice', weight: 1.2, transition: 'flash' },
    ],
  },
];

// Effets dont les couleurs sont « libres » : la palette du scénario s'y applique.
// Les autres (neige, eau, feu, soleil…) gardent leurs couleurs naturelles.
export const PALETTE_FX = new Set(['vitrail', 'mosaique', 'aurore', 'portails', 'scan', 'puzzle', 'faisceaux', 'neon', 'vague', 'battement', 'kaleido', 'glitch', 'onde', 'lasers', 'pixels', 'aquarelle', 'matrix', 'egaliseur', 'etincelles', 'texte', 'dessin', 'poursuite', 'alternance', 'balayage', 'pulsation']);

/** Palettes d'ambiance applicables en un clic. */
export const PALETTES: { name: string; colors: [string, string] }[] = [
  { name: 'Noël', colors: ['#ffcf6b', '#e0263f'] },
  { name: 'Halloween', colors: ['#ff7a1a', '#8a2be2'] },
  { name: 'Tricolore', colors: ['#2453ff', '#ff2b3b'] },
  { name: 'Océan', colors: ['#20d3ff', '#1a3cff'] },
  { name: 'Coucher de soleil', colors: ['#ffb347', '#ff3d7f'] },
  { name: 'Néon', colors: ['#ff2bd6', '#2bd9ff'] },
  { name: 'Or & ivoire', colors: ['#ffd27a', '#fff3dc'] },
  { name: 'Printemps', colors: ['#7ce36b', '#ff8ab8'] },
  { name: 'Glace', colors: ['#bfe8ff', '#7a8cff'] },
  { name: 'Braise', colors: ['#ff5a1f', '#ffd36b'] },
  { name: 'Forêt', colors: ['#2fbf4a', '#d9ff7a'] },
  { name: 'Royal', colors: ['#6a3cff', '#ffcf4a'] },
];

function makeClip(effect: string, duration: number, params: Record<string, ParamValue> = {}, transition = 'fondu'): Clip {
  return {
    start: 0,
    id: uid('c'),
    effect,
    duration,
    params: { ...defaultParams(effect), ...params },
    transition,
    transitionDuration: transition === 'cut' ? 0 : Math.min(2.5, duration * 0.25),
  };
}

export function newClip(effect: string, duration?: number) {
  const e = EFFECT_MAP.get(effect)!;
  return makeClip(effect, duration ?? e.defaultDuration);
}

/** Arrondit une durée à un nombre entier de mesures (4 temps). */
function toBars(d: number, bpm: number) {
  const bar = (4 * 60) / bpm;
  return Math.max(bar * 2, Math.round(d / bar) * bar);
}

/** Compose un spectacle complet à partir d'un scénario, calé sur la musique si elle est fournie. */
export function compose(scenarioId: string, total: number, analysis: AudioAnalysis | null, bpm: number, markers: number[] = []): Clip[] {
  const beatsPerMin = analysis?.bpm ?? bpm;
  const sc = scenarioId === 'surprise' ? surprise() : SCENARIOS.find((s) => s.id === scenarioId)!;
  const weights = sc.steps.map((s) => s.weight ?? 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const clips: Clip[] = [];
  sc.steps.forEach((step, i) => {
    const e = EFFECT_MAP.get(step.effect);
    if (!e) return;
    let d = (weights[i] / wsum) * total;
    // calage sur un marqueur posé par l'utilisateur (prioritaire), sinon sur une section musicale proche
    const target = t + d;
    const mk = markers.filter((m) => m > t + 1).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    if (mk !== undefined && Math.abs(mk - target) < d * 0.6 && i < sc.steps.length - 1) d = mk - t;
    else {
      if (analysis) {
        const near = analysis.sections.find((s) => Math.abs(s - target) < d * 0.3);
        if (near && i < sc.steps.length - 1) d = near - t;
      }
      d = toBars(d, beatsPerMin);
    }
    if (i === sc.steps.length - 1) d = Math.max(total - t, (4 * 60) / beatsPerMin);
    const params: Record<string, ParamValue> = {};
    const hasCol = e.params.some((p) => p.key === 'colorA');
    if (hasCol && PALETTE_FX.has(e.id) && !step.params?.colorA && sc.palette) {
      params.colorA = sc.palette[0];
      if (e.params.some((p) => p.key === 'colorB')) params.colorB = sc.palette[1];
    }
    // intensité adaptée à l'énergie de la musique
    if (analysis) {
      const en = energyAt(analysis, t, t + d);
      params.intensity = Math.round((0.75 + en * 0.45) * 100) / 100;
    }
    clips.push(makeClip(step.effect, Math.round(d * 100) / 100, { ...params, ...step.params }, step.transition ?? 'fondu'));
    t += d;
  });
  placeCentered(clips);
  return clips;
}

/** Positions libres : transitions centrées sur les frontières (chevauchement). */
function placeCentered(clips: Clip[]) {
  let at = 0;
  clips.forEach((c, i) => {
    const td = c.transition !== 'cut' ? c.transitionDuration : 0;
    const prev = clips[i - 1];
    const ptd = prev && prev.transition !== 'cut' ? prev.transitionDuration : 0;
    c.start = Math.max(0, Math.round((at - ptd / 2) * 100) / 100);
    const base = c.duration;
    c.duration = Math.round((base + ptd / 2 + (i < clips.length - 1 ? td / 2 : 0)) * 100) / 100;
    at += base;
  });
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function surprise(): Scenario {
  const byMood = (m: string) => EFFECTS.filter((e) => e.mood === m && !['texte', 'media', 'vide'].includes(e.id));
  const calme = byMood('calme'), moyen = byMood('moyen'), fort = byMood('fort');
  const used = new Set<string>();
  const take = (arr: typeof EFFECTS) => {
    const free = arr.filter((e) => !used.has(e.id));
    const e = pick(free.length ? free : arr);
    used.add(e.id);
    return e.id;
  };
  const hue = Math.random();
  const hsl = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const transitions = ['fondu', 'balayage', 'montee', 'dissolution', 'cascade', 'flash', 'iris', 'volets', 'pixels', 'tourbillon'];
  const steps: Step[] = [
    { effect: take(calme) },
    { effect: take(calme), transition: pick(transitions) },
    { effect: take(moyen), transition: pick(transitions) },
    { effect: take(moyen), transition: pick(transitions) },
    { effect: take(fort), transition: pick(transitions) },
    { effect: take(fort), transition: pick(transitions) },
    { effect: take(moyen), transition: pick(transitions) },
    { effect: take(calme) },
  ];
  return { id: 'surprise', name: 'Surprise', description: '', palette: [hsl(hue, 0.9, 0.6), hsl((hue + 0.45) % 1, 0.9, 0.55)], steps };
}

export function defaultShow(): Show {
  return {
    clips: compose('patrimoine', 90, null, 110),
    bpm: 110,
    master: { brightness: 1, bloom: 0.7, relief: 0.6, vignette: 0 },
  };
}

export interface MontageOptions {
  pool: string[]; // tableaux autorisés (vide = tous)
  style: 'doux' | 'equilibre' | 'nerveux';
  accents: boolean; // flashs sur les temps forts (piste superposée)
  palette?: [string, string];
}

/** Montage automatique : découpe la musique en parties (repères, sections), puis en plans de quelques mesures
 *  selon l'énergie, choisit un tableau adapté à chaque plan et place des accents sur les grosses frappes. */
export function autoMontage(a: AudioAnalysis, markers: number[], o: MontageOptions): { clips: Clip[]; accents: Clip[] } {
  const beat = 60 / a.bpm, bar = beat * 4;
  const total = a.duration;
  const snap = (t: number) => Math.max(0, a.offset + Math.round((t - a.offset) / bar) * bar);
  // frontières de parties : repères en priorité, puis sections détectées
  const raw = [...markers, ...a.sections].filter((t) => t > bar * 2 && t < total - bar * 2).map(snap).sort((x, y) => x - y);
  const bounds = [0];
  for (const t of raw) if (t - bounds[bounds.length - 1] >= bar * 2) bounds.push(t);
  bounds.push(total);
  const styleK = o.style === 'doux' ? 2 : o.style === 'nerveux' ? 0.5 : 1;
  const usable = EFFECTS.filter((e) => !['texte', 'media', 'vide', 'calqueanime', 'personnages'].includes(e.id) && !e.id.startsWith('custom:'));
  const pool = o.pool.length ? usable.filter((e) => o.pool.includes(e.id)) : usable.filter((e) => e.id !== 'strobe');
  const all = pool.length ? pool : usable;
  const recent: string[] = [];
  const choose = (en: number) => {
    const mood = en > 0.62 ? 'fort' : en < 0.35 ? 'calme' : 'moyen';
    let c = all.filter((e) => e.mood === mood && !recent.includes(e.id));
    if (!c.length) c = all.filter((e) => !recent.includes(e.id));
    if (!c.length) c = all;
    const e = pick(c);
    recent.push(e.id);
    if (recent.length > Math.min(4, all.length - 1)) recent.shift();
    return e;
  };
  const clips: Clip[] = [];
  let prevEn = 0;
  for (let s = 0; s < bounds.length - 1; s++) {
    const s0 = bounds[s], s1 = bounds[s + 1];
    const en = energyAt(a, s0, s1);
    // longueur des plans : longue au calme, courte quand ça cogne
    const bars = Math.max(1, Math.round((en > 0.7 ? 2 : en > 0.45 ? 4 : 8) * styleK));
    const n = Math.max(1, Math.round((s1 - s0) / (bars * bar)));
    for (let k = 0; k < n; k++) {
      const t0 = s0 + ((s1 - s0) * k) / n;
      const t1 = s0 + ((s1 - s0) * (k + 1)) / n;
      const e = choose(energyAt(a, t0, t1));
      const params: Record<string, ParamValue> = { intensity: Math.round((0.75 + energyAt(a, t0, t1) * 0.45) * 100) / 100 };
      if (o.palette && PALETTE_FX.has(e.id)) {
        params.colorA = o.palette[0];
        if (e.params.some((p) => p.key === 'colorB')) params.colorB = o.palette[1];
      }
      // transitions : coupe franche sur une montée d'énergie, flash à l'entrée d'une partie forte, fondu sinon
      const first = k === 0 && s > 0;
      const tr = first && en - prevEn > 0.2 ? 'flash' : en > 0.65 || o.style === 'nerveux' ? 'cut' : first ? 'fondu' : pick(['fondu', 'fondu', 'balayage', 'dissolution']);
      if (clips.length) {
        const pc = clips[clips.length - 1];
        pc.transition = tr;
        pc.transitionDuration = tr === 'cut' ? 0 : tr === 'flash' ? beat : Math.min(bar, (t1 - t0) * 0.3);
      }
      const c = makeClip(e.id, Math.round((t1 - t0) * 100) / 100, params, 'fondu');
      clips.push(c);
    }
    prevEn = en;
  }
  if (clips.length) clips[clips.length - 1].transitionDuration = Math.min(2.5, clips[clips.length - 1].duration * 0.25);
  placeCentered(clips);
  // accents : un flash d'un temps sur les mesures où les basses frappent le plus fort
  const accents: Clip[] = [];
  if (o.accents && a.bands3.length) {
    const rate = a.bands3.length / 3 / a.duration;
    const scores: { t: number; v: number }[] = [];
    for (let t = a.offset; t < total - beat; t += bar) {
      let m = 0;
      for (let i = Math.floor(t * rate); i < Math.floor((t + beat * 0.5) * rate); i++) m = Math.max(m, a.bands3[i * 3] ?? 0);
      scores.push({ t, v: m * (0.4 + energyAt(a, t, t + bar)) });
    }
    const sorted = scores.map((x) => x.v).sort((x, y) => x - y);
    const thr = sorted[Math.floor(sorted.length * 0.8)] ?? 1;
    for (const sc of scores) {
      if (sc.v < thr || sc.v <= 0) continue;
      const c = makeClip('strobe', Math.round(beat * 100) / 100, { rate: 0, duty: 0.6, colorA: o.palette?.[0] ?? '#ffffff' }, 'cut');
      c.start = Math.round(sc.t * 100) / 100;
      c.transitionDuration = 0;
      c.fade = 0;
      accents.push(c);
    }
  }
  return { clips, accents };
}
