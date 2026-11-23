// Calculateur de vidéoprojection : luminosité nécessaire, nombre de projecteurs, objectif, résolution.

export interface CalcInput {
  width: number; // largeur de la façade (m)
  height: number; // hauteur (m)
  distance: number; // distance projecteur – façade (m)
  ambient: number; // éclairage ambiant sur la façade (lux)
  reflect: number; // réflectance du matériau (0..1)
  contrast: number; // rapport visé lumière projetée / ambiante
  lumensPerUnit: number; // puissance d'un projecteur (lm)
}

export interface CalcResult {
  area: number;
  lux: number; // éclairement à apporter
  lumens: number; // lumens totaux nécessaires
  units: number; // projecteurs nécessaires
  layout: string; // disposition conseillée
  throwRatio: number; // rapport de projection (distance / largeur d'image)
  lens: string;
  pxPerMeter: number;
  advice: string[];
}

export const AMBIENT = [
  { value: 1, label: 'Campagne, nuit noire (≈ 1 lux)' },
  { value: 5, label: 'Village, éclairage public faible (≈ 5 lux)' },
  { value: 15, label: 'Rue de ville éclairée (≈ 15 lux)' },
  { value: 40, label: 'Centre-ville, place très éclairée (≈ 40 lux)' },
  { value: 100, label: 'Façade déjà mise en lumière (≈ 100 lux)' },
];

export const MATERIALS = [
  { value: 0.6, label: 'Pierre très claire, enduit blanc' },
  { value: 0.45, label: 'Pierre calcaire, grès clair' },
  { value: 0.3, label: 'Pierre grise, béton' },
  { value: 0.18, label: 'Brique, pierre sombre' },
];

export const CONTRASTS = [
  { value: 5, label: 'Lisible (contraste 5:1)' },
  { value: 10, label: 'Confortable (10:1)' },
  { value: 20, label: 'Spectaculaire (20:1)' },
];

export const UNITS = [5000, 10000, 15000, 20000, 30000, 40000];

export function computeProjection(c: CalcInput): CalcResult {
  const area = Math.max(1, c.width * c.height);
  // lumière à apporter : contraste × ambiance, corrigée par la réflectance (référence : pierre claire 0,45), plancher 25 lux
  const lux = Math.max(25, c.contrast * Math.max(0.5, c.ambient)) * (0.45 / Math.max(0.08, c.reflect));
  const lumens = (lux * area) / 0.8; // pertes optiques et marge
  const rawUnits = Math.max(1, Math.ceil(lumens / c.lumensPerUnit));
  // disposition : côte à côte si la façade est large, superposés (double empilage) pour gagner en puissance
  const aspect = c.width / Math.max(0.1, c.height);
  let across = aspect > 2.4 && rawUnits >= 2 ? Math.min(4, Math.max(2, Math.round(aspect / 1.6))) : 1;
  across = Math.min(across, rawUnits);
  const stacked = Math.ceil(rawUnits / across);
  const units = across * stacked;
  const imageWidth = c.width / across * (across > 1 ? 1.15 : 1.05); // recouvrement + marge
  const throwRatio = c.distance / imageWidth;
  let lens = 'objectif standard (≈ 1,4 à 2,2:1)';
  if (throwRatio < 0.9) lens = 'objectif ultra-courte focale (≈ 0,4 à 0,8:1)';
  else if (throwRatio < 1.4) lens = 'objectif grand angle (≈ 0,8 à 1,4:1)';
  else if (throwRatio > 4) lens = 'objectif très longue focale (≈ 4 à 8:1)';
  else if (throwRatio > 2.2) lens = 'objectif longue focale (≈ 2,2 à 4:1)';
  const pxPerMeter = (1920 * across) / c.width;
  const advice: string[] = [];
  if (stacked > 1) advice.push(`${stacked} projecteurs superposés par zone : calez-les exactement sur la même image (double empilage) pour additionner leur lumière.`);
  if (across > 1) advice.push(`${across} zones côte à côte : utilisez la sortie multi-projecteurs de Lumirock avec un recouvrement d’environ 12 %.`);
  if (pxPerMeter < 60) advice.push('Résolution faible sur la façade : évitez les textes fins et les détails très petits, ou passez en projecteurs 4K.');
  if (c.ambient >= 40) advice.push('Façade très éclairée : demandez si possible l’extinction de l’éclairage public le temps du spectacle — cela divise la puissance nécessaire.');
  if (c.reflect < 0.25) advice.push('Matériau sombre : privilégiez des tableaux lumineux (blanc, or, couleurs vives) et évitez les ambiances sombres.');
  if (c.distance < 8) advice.push('Distance courte : attention aux ombres du public et aux déformations fortes, prévoyez un calage en grille 5×5.');
  return { area, lux: Math.round(lux), lumens: Math.round(lumens / 100) * 100, units, layout: across > 1 ? `${across} côte à côte × ${stacked} superposé(s)` : stacked > 1 ? `${stacked} superposés` : '1 projecteur', throwRatio: Math.round(throwRatio * 100) / 100, lens, pxPerMeter: Math.round(pxPerMeter), advice };
}
