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
  music?: { file: string; title: string; author: string; page: string }; // extrait CC BY 3.0 dans public/music
  sounds?: { sfx: string; at: number | string; offset?: number; volume?: number }[]; // at : secondes, id d'un tableau, ou 'fin'
}

const J = (file: string, id: number, title: string, author: string) => ({ file, title, author, page: `https://www.jamendo.com/track/${id}` });

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
    music: J('noel.mp3', 693405, 'Best Christmas Yet (Instrumental)', 'Stellar Art Wars Free'),
    sounds: [{ sfx: 'cloches', at: 0.3, volume: 0.7 }, { sfx: 'carillon', at: 'texte', volume: 0.8 }, { sfx: 'grelots', at: 'traineau', offset: 0.5, volume: 0.9 }, { sfx: 'feuartifice', at: 'feuxartifice', volume: 0.8 }, { sfx: 'bouquet', at: 'fin', offset: -10, volume: 0.7 }],
  },
  {
    id: 'national', name: '14 juillet', description: 'Hôtel de ville tricolore, lasers, drapeau et bouquet final.', template: 'mairie', scenario: 'national', duration: 120, title: '14 juillet',
    extras: (s) => layerWith(s, 'texte', 4, 9, { text: 'Fête nationale', style: 3, font: 3, colorA: '#ffffff', colorB: '#0c1f6b', y: 0.82, size: 0.45 }),
    music: J('national.mp3', 682365, 'The age of the Empire', 'zero-project'),
    sounds: [{ sfx: 'whoosh', at: 'lasers', offset: -0.8, volume: 0.6 }, { sfx: 'feuartifice', at: 'feuxartifice', volume: 0.9 }, { sfx: 'bouquet', at: 'feuxartifice', offset: 4, volume: 0.9 }, { sfx: 'applaudissements', at: 'fin', offset: -6, volume: 0.8 }],
  },
  {
    id: 'patrimoine', name: 'Journées du patrimoine', description: 'Château fort : le monument se dessine, traverse les siècles, s’effondre et renaît.', template: 'chateau', scenario: 'patrimoine', duration: 150, title: 'Journées du patrimoine',
    music: J('patrimoine.mp3', 682398, 'The ride of the Dark Knight', 'zero-project'),
    sounds: [{ sfx: 'gong', at: 0.5, volume: 0.6 }, { sfx: 'grondement', at: 'effondrement', offset: 0.3, volume: 0.9 }, { sfx: 'cloches', at: 'fin', offset: -12, volume: 0.6 }],
  },
  {
    id: 'halloween', name: 'Nuit d’Halloween', description: 'Château hanté : brume, orage, fantômes, lave et glitch.', template: 'chateau', scenario: 'halloween', duration: 100, title: 'Halloween',
    extras: (s) => layerWith(s, 'personnages', 20, 30, { kind: 1 }),
    music: J('halloween.mp3', 1476517, 'Creepy Doll', 'Alexander Blu'),
    sounds: [{ sfx: 'vent', at: 0, volume: 0.6 }, { sfx: 'chouette', at: 'brume', offset: 2, volume: 0.8 }, { sfx: 'porte', at: 'citrouilles', volume: 0.8 }, { sfx: 'loup', at: 'sorciere', offset: 1, volume: 0.7 }, { sfx: 'tonnerre', at: 'orage', offset: 0.5, volume: 1 }, { sfx: 'grondement', at: 'effondrement', volume: 0.8 }],
  },
  {
    id: 'mariage', name: 'Mariage', description: 'Église : rideau, prénoms en lumière, pétales, marbre et feu d’artifice.', template: 'eglise', scenario: 'mariage', duration: 120, title: 'Camille & Sacha',
    music: J('mariage.mp3', 2229204, 'Once upon a time', 'zero-project'),
    sounds: [{ sfx: 'cloches', at: 0.5, volume: 0.6 }, { sfx: 'coeur', at: 'coeurs', volume: 0.7 }, { sfx: 'feuartifice', at: 'feuxartifice', volume: 0.8 }, { sfx: 'applaudissements', at: 'fin', offset: -7, volume: 0.9 }],
  },
  {
    id: 'musique', name: 'Fête de la musique', description: 'Hôtel de ville : égaliseur géant, lasers, néons et boule à facettes.', template: 'mairie', scenario: 'musique', duration: 110, title: 'Fête de la musique',
    music: J('musique.mp3', 1293487, 'Party Girl', 'enry'),
    sounds: [{ sfx: 'applaudissements', at: 0, volume: 0.6 }, { sfx: 'applaudissements', at: 'fin', offset: -6, volume: 0.9 }],
  },
  {
    id: 'nouvelan', name: 'Réveillon du Nouvel An', description: 'Hôtel de ville : ciel étoilé, décompte géant de 10 à 0, bouquet de feux d’artifice et vœux.', template: 'mairie', scenario: 'nouvelan', duration: 95, title: 'Bonne année !',
    music: J('nouvelan.mp3', 1971553, 'frozen xmas', 'Arthur Ment'),
    sounds: [{ sfx: 'carillon', at: 0.5, volume: 0.7 }, { sfx: 'whoosh', at: 'decompte', offset: -1, volume: 0.6 }, { sfx: 'bouquet', at: 'decompte', offset: 10, volume: 1 }, { sfx: 'applaudissements', at: 'decompte', offset: 10.5, volume: 0.8 }],
  },
];
