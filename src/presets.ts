// Préréglages de l'utilisateur : tableaux réglés réutilisables d'un projet à l'autre (stockés dans le navigateur).
import type { Clip, ParamValue } from './types';

export interface Preset {
  id: string;
  name: string;
  effect: string;
  params: Record<string, ParamValue>;
  keys?: Clip['keys'];
}

const KEY = 'lumirock.presets';

export function loadPresets(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function savePresets(p: Preset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

/** Tableau composé : plusieurs tableaux sur plusieurs pistes, réutilisables en bloc. */
export interface Block {
  id: string;
  name: string;
  duration: number;
  items: { track: number; rel: number; clip: Clip }[]; // track : 0 = première piste du bloc
}

const BKEY = 'lumirock.blocks';

export function loadBlocks(): Block[] {
  try {
    return JSON.parse(localStorage.getItem(BKEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveBlocks(b: Block[]) {
  try {
    localStorage.setItem(BKEY, JSON.stringify(b));
  } catch {
    /* stockage indisponible */
  }
}
