// Spectacles d'exemple complets, prêts à adapter.
import { newClip } from './scenarios';
import type { Show } from './types';
import { uid } from './types';

export interface Example {
  id: string;
  name: string;
  description: string;
  template: string;
  scenario: string;
  duration: number;
  title: string;
  extras?: (show: Show) => void;
}

function layerWith(show: Show, effect: string, start: number, duration: number, params: Record<string, unknown> = {}) {
  const c = newClip(effect, duration);
  Object.assign(c.params, params);
  c.start = start;
  c.fade = 1.5;
  (show.layers ??= []).push({ id: uid('p'), name: `Piste ${show.layers.length + 2}`, clips: [c], opacity: 1, blend: 'add' });
}

export const EXAMPLES: Example[] = [
  {
    id: 'noel', name: 'Noël au village', description: 'Église gothique, neige, bougies, vitraux et feu d’artifice final.', template: 'eglise', scenario: 'noel', duration: 120, title: 'Noël au village',
    extras: (s) => layerWith(s, 'etincelles', 36, 26, { colorA: '#ffd36b', colorB: '#ff6a2b', _target: 22 }),
  },
  {
    id: 'national', name: '14 juillet', description: 'Hôtel de ville tricolore, lasers, drapeau et bouquet final.', template: 'mairie', scenario: 'national', duration: 120, title: '14 juillet',
    extras: (s) => layerWith(s, 'texte', 4, 9, { text: 'Fête nationale', style: 3, font: 3, colorA: '#ffffff', colorB: '#0c1f6b', y: 0.82, size: 0.45 }),
  },
  {
    id: 'patrimoine', name: 'Journées du patrimoine', description: 'Château fort : le monument se dessine, traverse les siècles, s’effondre et renaît.', template: 'chateau', scenario: 'patrimoine', duration: 150, title: 'Journées du patrimoine',
  },
  {
    id: 'halloween', name: 'Nuit d’Halloween', description: 'Château hanté : brume, orage, fantômes, lave et glitch.', template: 'chateau', scenario: 'halloween', duration: 100, title: 'Halloween',
    extras: (s) => layerWith(s, 'personnages', 20, 30, { kind: 1 }),
  },
  {
    id: 'mariage', name: 'Mariage', description: 'Église : rideau, prénoms en lumière, pétales, marbre et feu d’artifice.', template: 'eglise', scenario: 'mariage', duration: 120, title: 'Camille & Sacha',
  },
  {
    id: 'musique', name: 'Fête de la musique', description: 'Hôtel de ville : égaliseur géant, lasers, néons et boule à facettes.', template: 'mairie', scenario: 'musique', duration: 110, title: 'Fête de la musique',
  },
];
