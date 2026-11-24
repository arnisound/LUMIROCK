// Modèle de données central de Lumirock.

export type Pt = [number, number]; // coordonnées normalisées 0..1 (origine en haut à gauche)

export const ZONE_TYPES = [
  { id: 1, key: 'mur', label: 'Mur / pierre', color: '#9aa3ad', relief: 0.5 },
  { id: 2, key: 'fenetre', label: 'Fenêtre', color: '#4fc3f7', relief: 0.25 },
  { id: 3, key: 'porte', label: 'Porte / portail', color: '#ffb74d', relief: 0.2 },
  { id: 4, key: 'rosace', label: 'Rosace', color: '#f06292', relief: 0.3 },
  { id: 5, key: 'colonne', label: 'Colonne / pilier', color: '#aed581', relief: 0.75 },
  { id: 6, key: 'corniche', label: 'Corniche / frise', color: '#fff176', relief: 0.7 },
  { id: 7, key: 'toit', label: 'Toit / pignon', color: '#a1887f', relief: 0.55 },
  { id: 8, key: 'statue', label: 'Statue / ornement', color: '#ce93d8', relief: 0.8 },
  { id: 9, key: 'tour', label: 'Tour / clocher', color: '#80cbc4', relief: 0.6 },
  { id: 10, key: 'horloge', label: 'Horloge', color: '#ffd54f', relief: 0.65 },
  { id: 11, key: 'silhouette', label: 'Silhouette (contour du monument)', color: '#ffffff', relief: 0.5 },
  { id: 12, key: 'exclure', label: 'Exclure (ne rien projeter)', color: '#ef5350', relief: 0 },
] as const;

export type ZoneTypeKey = (typeof ZONE_TYPES)[number]['key'];

export function zoneType(key: ZoneTypeKey) {
  return ZONE_TYPES.find((t) => t.key === key)!;
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneTypeKey;
  points: Pt[];
  relief?: number; // 0..1, surcharge du relief par défaut du type
  anim?: ZoneAnim; // mouvement du calque au fil du spectacle
}

/** Image clé de mouvement d'un calque (temps absolu du spectacle). */
export interface ZoneKey {
  t: number;
  dx: number; // déplacement (fraction de la largeur, vers la droite)
  dy: number; // déplacement (fraction de la hauteur, vers le haut)
  sx: number; // échelle horizontale
  sy: number; // échelle verticale
  rot: number; // rotation (degrés)
}

export interface ZoneAnim {
  pivot: 'c' | 'l' | 'r' | 'b' | 't';
  keys: ZoneKey[];
}

export type ParamValue = number | string | boolean;

export interface Keyframe {
  t: number; // avancement dans le tableau (0..1)
  v: ParamValue;
}

export interface Clip {
  id: string;
  effect: string;
  duration: number; // secondes
  params: Record<string, ParamValue>;
  transition: string; // transition vers le tableau suivant
  transitionDuration: number;
  keys?: Record<string, Keyframe[]>; // images clés par paramètre
  start?: number; // position libre sur la piste (secondes)
  fade?: number; // fondu d'entrée / sortie quand le tableau borde un vide (secondes)
  cut?: { t0: number; p0: number; p1: number }; // morceau d'un tableau coupé : décalage de temps et plage d'avancement
}

export type BlendMode = 'add' | 'screen' | 'max';

/** Piste superposée (les lumières s'additionnent à la piste principale). */
export interface Layer {
  id: string;
  name: string;
  clips: Clip[];
  opacity: number;
  blend: BlendMode;
  muted?: boolean;
}

/** Son placé sur la piste audio (voix off, bruitage). */
export interface SoundClip {
  id: string;
  media: string; // id du fichier audio dans la médiathèque
  start: number; // position dans le spectacle (s)
  offset: number; // début dans le fichier (s)
  duration: number; // durée jouée (s)
  srcDuration: number; // durée totale du fichier (s)
  volume: number; // 0..2
  fadeIn: number;
  fadeOut: number;
}

export interface MediaItem {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
}

export interface Show {
  clips: Clip[]; // piste principale
  layers?: Layer[];
  markers?: { t: number; label?: string }[]; // repères posés sur la musique
  sounds?: SoundClip[]; // voix off et bruitages
  bpm: number;
  master: { brightness: number; bloom: number; relief: number; vignette: number; ambient?: number };
}

export interface Project {
  version: 1;
  name: string;
  width: number; // résolution de travail (façade redressée)
  height: number;
  zones: Zone[];
  show: Show;
  depthSource: 'auto' | 'ia';
  media?: MediaItem[];
  calibration?: { corners: Pt[]; n: number; offsets: Pt[] }; // calage du projecteur (sortie 1)
  calibrations?: ({ corners: Pt[]; n: number; offsets: Pt[] } | null)[]; // sorties 2, 3, 4
  outputs?: { count: number; overlap: number }; // plusieurs vidéoprojecteurs côte à côte
  schedule?: { on: boolean; start: string; end: string; days: number[] }; // programmation horaire (HH:MM, jours 0 = dimanche)
  credits?: { title: string; author: string; license: string; page: string }; // photo de façade sous licence libre
  music?: { title: string; author: string; license: string; page: string }; // musique de la bibliothèque libre
  customFx?: { id: string; name: string; description: string; code: string }[]; // tableaux écrits en code
}

export function uid(prefix = 'z') {
  return prefix + Math.random().toString(36).slice(2, 9);
}
