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
