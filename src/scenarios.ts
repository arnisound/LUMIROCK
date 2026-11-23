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
    id: 'noel', name: 'Noël', description: 'Neige, bougies, or et vitraux, final en feu d’artifice.', palette: ['#ffcf6b', '#ff2f4f'],
    steps: [
      { effect: 'rideau', weight: 0.8, params: { colorA: '#9e0f1f' } },
      { effect: 'texte', weight: 0.7, params: { text: 'Joyeux Noël', colorA: '#ffe08a' }, transition: 'balayage' },
      { effect: 'neige', weight: 1.3 },
      { effect: 'bougies', weight: 1.1, transition: 'cascade' },
      { effect: 'vitrail', weight: 1.0 },
      { effect: 'ombres', weight: 1.0 },
      { effect: 'matiere', weight: 1.0, params: { mat: 0 }, transition: 'montee' },
      { effect: 'aurore', weight: 1.0, params: { colorA: '#3dffb0', colorB: '#ff3d8b' } },
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
      { effect: 'orage', weight: 1.2 },
      { effect: 'ombres', weight: 1.0, params: { colorA: '#ff7a1a', colorB: '#1a0b2e' } },
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
    id: 'saisons', name: 'Les quatre saisons', description: 'Printemps fleuri, été lumineux, automne en feu, hiver enneigé.', palette: ['#ffc46b', '#6fb8ff'],
    steps: [
      { effect: 'allumage', weight: 0.7 },
      { effect: 'lierre', weight: 1.3, transition: 'montee' },
      { effect: 'soleil', weight: 1.2 },
      { effect: 'eau', weight: 1.1 },
      { effect: 'matiere', weight: 0.9, params: { mat: 3 } },
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
export const PALETTE_FX = new Set(['vitrail', 'mosaique', 'aurore', 'portails', 'scan', 'puzzle', 'faisceaux', 'neon', 'vague', 'battement', 'kaleido', 'glitch', 'onde', 'lasers', 'pixels', 'aquarelle', 'matrix', 'egaliseur', 'etincelles', 'texte', 'dessin']);

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
  // positions libres : transitions centrées sur les frontières (chevauchement)
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
  return clips;
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
