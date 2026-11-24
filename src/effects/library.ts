// Bibliothèque de « tableaux » de Lumirock.
// Chaque effet renvoie la LUMIÈRE à projeter sur la façade (pas l'image vue) :
// la simulation de nuit calcule ensuite « façade × (ambiance + lumière projetée) ».

export type ParamType = 'range' | 'color' | 'text' | 'select' | 'toggle' | 'media';
export type UniformSlot = 'uIntensity' | 'uSpeed' | 'uColA' | 'uColB' | 'uParamA' | 'uParamB' | 'uParamC' | 'uParamD' | 'uParamE' | 'uParamF' | 'uParamG' | 'aux'
  | 'uTarget' | 'uTargetBg' | 'uReact' | 'uReactBand' | 'uMirror' | 'uHue' | 'uSat';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  slot: UniformSlot;
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
  options?: { value: number; label: string }[];
}

export type Category = 'Lumière' | 'Console lumière' | 'Saisons et fêtes' | 'Architecture' | 'Matières' | 'Nature' | 'Graphique' | 'Illusions' | 'Mes tableaux';
export type Mood = 'calme' | 'moyen' | 'fort';

export interface EffectDef {
  id: string;
  name: string;
  category: Category;
  description: string;
  mood: Mood;
  tags: string[]; // scénarios dans lesquels l'effet est pertinent
  params: ParamDef[];
  glsl: string;
  defaultDuration: number;
  /** Texte calculé à chaque instant (décompte, minuteur) ; une ligne commençant par « ~ » est écrite en petit. */
  dynText?: (params: Record<string, number | string | boolean>, t: number, dur: number) => string;
}

const I = (d = 1): ParamDef => ({ key: 'intensity', label: 'Intensité', type: 'range', slot: 'uIntensity', min: 0, max: 2, step: 0.01, default: d });
const S = (d = 1): ParamDef => ({ key: 'speed', label: 'Vitesse', type: 'range', slot: 'uSpeed', min: 0.1, max: 3, step: 0.01, default: d });
const CA = (d: string, label = 'Couleur principale'): ParamDef => ({ key: 'colorA', label, type: 'color', slot: 'uColA', default: d });
const CB = (d: string, label = 'Couleur secondaire'): ParamDef => ({ key: 'colorB', label, type: 'color', slot: 'uColB', default: d });
const R = (key: string, label: string, slot: UniformSlot, d: number, min = 0, max = 1, step = 0.01): ParamDef => ({ key, label, type: 'range', slot, min, max, step, default: d });
const SEL = (key: string, label: string, slot: UniformSlot, options: string[], d = 0): ParamDef => ({
  key, label, type: 'select', slot, default: d, options: options.map((l, i) => ({ value: i, label: l })),
});
const TOG = (key: string, label: string, slot: UniformSlot, d = false): ParamDef => ({ key, label, type: 'toggle', slot, default: d });

const HELPERS = `
// --- outils « console lumière » : chaque calque est un « projecteur », classé de gauche à droite
float stepClock(float rate) { return (uBeatIndex + uBeatPhase) * rate; }
float rateOf(float sel) { return sel < 0.5 ? 1.0 : sel < 1.5 ? 2.0 : sel < 2.5 ? 0.25 : 4.0; }
// rang 0..1 du calque (ou d'une bande verticale si pas de calque)
float unitRank(vec2 uv, out float count) {
  int id = zoneId(uv);
  if (id > 0 && uZoneCount > 1.5) { count = uZoneCount; return zoneMeta(id).y; }
  count = 12.0;
  return floor(uv.x * 12.0) / 11.0;
}
float unitX(vec2 uv) { int id = zoneId(uv); return id > 0 ? zoneGeom(id).x : uv.x; }
float unitHash(vec2 uv) { int id = zoneId(uv); return id > 0 ? zoneMeta(id).x : hash11(floor(uv.x * 12.0) + 7.0); }
vec3 stoneLit(vec2 uv) { return vec3(0.45 + 0.9 * lum(albedo(uv))); }
`;

const SDF = `
// --- formes vectorielles (silhouettes)
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float dot2(vec2 v) { return dot(v, v); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdEll(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float sg = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), sg * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), sg * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), sg * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float fillD(float d, float px) { return smoothstep(px, -px, d); }
// ciel projeté sur la façade, avec lune
vec3 skyMoon(vec2 uv, vec2 pa, vec3 sky, vec3 moon, vec2 mc, float mr) {
  vec3 c = sky * (0.3 + 0.7 * uv.y);
  float md = length(pa - mc);
  float disc = smoothstep(mr, mr - 0.004, md);
  c += moon * (disc * (1.25 - 0.35 * fbm((pa - mc) * 14.0)) + exp(-max(md - mr, 0.0) * 9.0) * 0.35 * (1.0 - disc));
  return c;
}
// paillettes scintillantes
float twinkle(vec2 pa, float scale, float dens) {
  vec2 g = floor(pa * scale), f = fract(pa * scale) - 0.5;
  float h = hash21(g);
  if (h > dens) return 0.0;
  vec2 o = (hash22(g + 3.1) - 0.5) * 0.6;
  float d = length(f - o);
  return smoothstep(0.12, 0.0, d) * (0.5 + 0.5 * sin(uT * (3.0 + h * 9.0) + h * 40.0));
}
`;

export const EFFECTS: EffectDef[] = [
  // ───────────────────────────── LUMIÈRE ─────────────────────────────
  {
    id: 'allumage', name: 'Allumage', category: 'Lumière', mood: 'calme', defaultDuration: 8,
    description: 'La façade se révèle doucement dans une lumière blanche, depuis le sol.',
    tags: ['patrimoine', 'noel', 'mariage', 'saisons', 'national', 'halloween', 'intro'],
    params: [I(), S(), CA('#fff4e0', 'Teinte'), SEL('dir', 'Direction', 'uParamA', ['Depuis le bas', 'Depuis le centre', 'Depuis la gauche']), R('grain', 'Scintillement', 'uParamB', 0.3)],
    glsl: `
vec3 effect(vec2 uv) {
  float f;
  if (uParamA < 0.5) f = uv.y;
  else if (uParamA < 1.5) f = length(asp(uv) - asp(vec2(0.5, 0.35))) / max(uAspect, 1.0) * 1.2;
  else f = uv.x;
  f += (fbm(asp(uv) * 6.0) - 0.5) * 0.15;
  float p = uP * 1.35 * uSpeed;
  float on = sstep(f - 0.02, f + 0.12, p);
  float edge = sstep(0.12, 0.0, abs(p - f - 0.03)) * (1.0 - sstep(0.9, 1.0, uP));
  float sparkle = pow(hash21(floor(uv * uRes / 3.0) + floor(uT * 12.0)), 30.0) * uParamB * 3.0;
  vec3 L = normalize(vec3(-0.4, 0.6, 0.8));
  float d = 0.55 + 0.45 * diffuseAt(uv, L);
  return uColA * (on * d + edge * 1.8 + sparkle * edge);
}`,
  },
  {
    id: 'soleil', name: 'Course du soleil', category: 'Lumière', mood: 'calme', defaultDuration: 14,
    description: 'Un soleil virtuel traverse le ciel : les ombres tournent sur la façade, du matin au soir.',
    tags: ['patrimoine', 'saisons', 'mariage'],
    params: [I(), CA('#ffb070', 'Lumière du soir'), CB('#7fa6ff', 'Ciel (ambiance)'), R('shadow', 'Ombres', 'uParamA', 0.85), R('height', 'Hauteur du soleil', 'uParamB', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float a = mix(-0.1, 1.1, uP) * PI;
  float elev = sin(a);
  vec3 L = normalize(vec3(-cos(a), 0.15 + elev * 0.85, 0.25 + uParamB * 0.7));
  float d = diffuseAt(uv, L);
  float sh = mix(1.0, shadowAt(uv, L), uParamA);
  vec3 sun = mix(uColA, vec3(1.0, 0.97, 0.92), sat(elev * 1.4));
  float power = sat(elev * 2.2 + 0.25);
  return uColB * 0.1 + sun * d * sh * 1.3 * power;
}`,
  },
  {
    id: 'faisceaux', name: 'Faisceaux fantômes', category: 'Lumière', mood: 'moyen', defaultDuration: 12,
    description: 'Deux projecteurs virtuels balaient la façade comme des lampes torches, avec ombres portées.',
    tags: ['halloween', 'patrimoine', 'national'],
    params: [I(), S(), CA('#ffffff', 'Faisceau 1'), CB('#6ec3ff', 'Faisceau 2'), R('size', 'Taille des faisceaux', 'uParamA', 0.4)],
    glsl: `
vec3 spot(vec2 uv, vec2 sp, vec3 col, float r) {
  vec2 d = asp(sp) - asp(uv);
  float dist = length(d);
  vec3 L = normalize(vec3(d, 0.12 + r));
  float fall = exp(-dist * dist / (r * r));
  return col * fall * (0.2 + diffuseAt(uv, L) * 1.3) * mix(1.0, shadowAt(uv, L), 0.85);
}
vec3 effect(vec2 uv) {
  float t = uT * 0.35 * uSpeed;
  vec2 s1 = vec2(0.5 + 0.4 * sin(t * 1.3), 0.5 + 0.32 * sin(t * 0.9 + 1.0));
  vec2 s2 = vec2(0.5 + 0.4 * sin(t * 1.1 + 2.5), 0.45 + 0.32 * cos(t * 0.7));
  float r = 0.1 + uParamA * 0.3;
  return spot(uv, s1, uColA, r) + spot(uv, s2, uColB, r) * 0.9 + 0.015;
}`,
  },
  {
    id: 'orage', name: 'Orage', category: 'Lumière', mood: 'fort', defaultDuration: 12,
    description: 'Nuit d’orage : éclairs qui révèlent la façade par flashs, pluie battante.',
    tags: ['halloween', 'patrimoine'],
    params: [I(), S(), CA('#dfe8ff', 'Couleur des éclairs'), R('beat', 'Éclairs sur le rythme', 'uParamA', 0.6), R('rain', 'Pluie', 'uParamB', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  float slot = floor(t * 1.6);
  float r = hash11(slot + uSeed * 13.0);
  float local = fract(t * 1.6);
  float flash = r > 0.5 ? exp(-local * 8.0) * (0.55 + 0.45 * sin(local * 70.0)) : 0.0;
  flash = max(flash, uBeat * uParamA);
  float lx = hash11(slot * 3.1) * 2.0 - 1.0;
  vec3 L = normalize(vec3(lx, 0.9, 0.45));
  float d = diffuseAt(uv, L) * shadowAt(uv, L);
  vec3 c = vec3(0.02, 0.035, 0.07) + uColA * flash * (0.25 + 1.6 * d);
  // pluie
  float x = uv.x * uAspect * 140.0 + uv.y * 10.0;
  float col = floor(x);
  float rnd = hash11(col + 3.7);
  float y = fract(uv.y * 2.5 + t * (1.6 + rnd * 1.4) + rnd * 9.0);
  float streak = step(0.8, rnd) * sstep(0.0, 0.03, y) * sstep(0.22, 0.0, y) * sstep(0.5, 0.1, abs(fract(x) - 0.5));
  c += vec3(0.5, 0.6, 0.8) * streak * uParamB * (0.25 + flash);
  return c;
}`,
  },
  {
    id: 'bougies', name: 'Mille bougies', category: 'Lumière', mood: 'calme', defaultDuration: 12,
    description: 'Chaque fenêtre, porte et rosace s’allume d’une lueur chaude et vacillante.',
    tags: ['noel', 'mariage', 'patrimoine', 'saisons'],
    params: [I(), S(), CA('#ffaa44', 'Flamme'), CB('#2a3a66', 'Nuit'), R('halo', 'Halo sur la pierre', 'uParamA', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  float glob = 0.8 + 0.2 * fbm(vec2(uT * 2.0 * uSpeed, 3.0));
  vec3 c = uColB * 0.06 * (0.6 + 0.4 * uv.y);
  c += uColA * glowOpen(uv) * uParamA * 0.55 * glob * sstep(0.0, 0.3, uP);
  if (id > 0 && isOpening(ty)) {
    vec4 m = zoneMeta(id);
    vec4 g = zoneGeom(id);
    float on = sstep(m.x * 0.5, m.x * 0.5 + 0.08, uP);
    float fl = 0.7 + 0.3 * fbm(vec2(uT * 4.0 * uSpeed + float(id) * 7.3, float(id)));
    float yLocal = sat((uv.y - (g.y - g.w * 0.5)) / max(g.w, 1e-3));
    vec3 warm = mix(uColA * 1.3, vec3(1.0, 0.85, 0.6), 0.25);
    c = mix(c, warm * fl * (1.25 - yLocal * 0.6), on);
  }
  return c;
}`,
  },
  // ─────────────────────────── ARCHITECTURE ───────────────────────────
  {
    id: 'dessin', name: 'Dessin d’architecte', category: 'Architecture', mood: 'calme', defaultDuration: 14,
    description: 'Les contours du monument se tracent comme sur un plan, puis la façade se remplit de lumière.',
    tags: ['patrimoine', 'intro', 'national', 'mariage'],
    params: [I(), CA('#8fd3ff', 'Trait des calques'), CB('#ffffff', 'Trait de la pierre'), R('details', 'Détails de la pierre', 'uParamA', 0.7), R('fill', 'Remplissage final', 'uParamB', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float ez = edgeZone(uv);
  float ei = edgeImg(uv);
  // id de calque le plus proche (le trait est sur la frontière)
  int id = zoneId(uv);
  if (id == 0) {
    vec2 px = 2.0 / uZoneRes;
    id = max(max(zoneId(uv + vec2(px.x, 0)), zoneId(uv - vec2(px.x, 0))), max(zoneId(uv + vec2(0, px.y)), zoneId(uv - vec2(0, px.y))));
  }
  float reveal = 0.0, head = 0.0;
  if (id > 0) {
    vec4 g = zoneGeom(id);
    vec4 m = zoneMeta(id);
    vec2 d = asp(uv) - asp(g.xy);
    float ang = (atan(d.y, d.x) + PI) / TAU;
    float lp = sat((uP * 1.7 - m.y * 0.75) / 0.35);
    reveal = step(ang, lp);
    head = sstep(0.04, 0.0, abs(ang - lp)) * step(lp, 0.999) * step(0.001, lp);
  }
  float f = uv.y * 0.75 + fbm(asp(uv) * 5.0) * 0.3;
  float ri = sstep(f, f + 0.05, uP * 1.5 - 0.15);
  float hi = sstep(0.05, 0.0, abs(uP * 1.5 - 0.15 - f));
  vec3 c = uColA * ez * (reveal * 1.4 + head * 3.0);
  c += uColB * ei * uParamA * (ri * 0.9 + hi * 2.0);
  c += uColA * glowLines(uv) * 0.25 * reveal;
  float fill = sstep(0.72, 1.0, uP) * uParamB;
  c += vec3(1.0, 0.97, 0.9) * fill * (0.4 + 0.6 * diffuseAt(uv, normalize(vec3(-0.3, 0.5, 1.0))));
  return c;
}`,
  },
  {
    id: 'extrusion', name: 'Pierres vivantes', category: 'Architecture', mood: 'moyen', defaultDuration: 12,
    description: 'Les pierres sortent et rentrent du mur en vagues, avec ombres portées en trompe-l’œil.',
    tags: ['patrimoine', 'halloween', 'national', 'saisons'],
    params: [I(), S(), CA('#ffffff', 'Lumière'), R('size', 'Taille des pierres', 'uParamA', 0.4), R('tint', 'Teinte', 'uParamB', 0.0), R('beat', 'Sur le rythme', 'uParamC', 0.5)],
    glsl: `
float rows() { return 10.0 + (1.0 - uParamA) * 26.0; }
vec2 brickCell(vec2 uv, out vec2 f) {
  float R = rows();
  float y = uv.y * R;
  float row = floor(y);
  float x = uv.x * R * uAspect / 2.2 + mod(row, 2.0) * 0.5;
  vec2 cell = vec2(floor(x), row);
  f = vec2(fract(x), fract(y));
  return cell;
}
float brickH(vec2 cell) {
  float rnd = hash21(cell + uSeed);
  float w = pow(0.5 + 0.5 * sin(uT * 1.4 * uSpeed - cell.x * 0.35 - cell.y * 0.22 + rnd * 1.5), 5.0);
  float b = step(0.82, hash21(cell + floor(uBeatIndex))) * uBeat * uParamC;
  return sat(w + b) * sstep(0.0, 0.12, uP) * (1.0 - sstep(0.9, 1.0, uP));
}
vec3 effect(vec2 uv) {
  vec2 f;
  vec2 cell = brickCell(uv, f);
  float h = brickH(cell);
  vec2 dir = vec2(0.6, -0.8);
  float shadow = 0.0;
  float R = rows();
  for (int k = 1; k <= 7; k++) {
    vec2 q = uv - dir * float(k) * (0.18 / R) / vec2(uAspect, 1.0) * 1.0;
    vec2 fq;
    vec2 cq = brickCell(q, fq);
    if (cq != cell) {
      float hq = brickH(cq);
      if (hq * 1.3 > float(k) / 7.0 && hq > h + 0.05) { shadow = max(shadow, 0.75 * (hq - h)); }
    }
  }
  float gap = 0.035 + 0.02 * (1.0 - h);
  float mortar = sstep(0.0, gap, f.x) * sstep(0.0, gap, 1.0 - f.x) * sstep(0.0, gap * 1.8, f.y) * sstep(0.0, gap * 1.8, 1.0 - f.y);
  float bev = 0.1 + 0.08 * h;
  float hiEdge = sstep(bev, 0.0, 1.0 - f.y) + sstep(bev * 0.5, 0.0, f.x);
  float loEdge = sstep(bev, 0.0, f.y) + sstep(bev * 0.5, 0.0, 1.0 - f.x);
  float face = 0.42 + 0.58 * h;
  face += hiEdge * 0.35 * h - loEdge * 0.3 * h;
  face *= 1.0 - shadow;
  face *= mortar;
  vec3 col = mix(uColA, uColA * vec3(1.0, 0.75, 0.45), uParamB);
  return col * max(face, 0.0) * (0.85 + 0.15 * hash21(cell));
}`,
  },
  {
    id: 'effondrement', name: 'Effondrement', category: 'Architecture', mood: 'fort', defaultDuration: 14,
    description: 'La façade se fissure, s’écroule bloc par bloc, puis se reconstruit pierre par pierre.',
    tags: ['halloween', 'patrimoine', 'national'],
    params: [I(), CA('#ff7a2e', 'Fissures'), R('size', 'Taille des blocs', 'uParamA', 0.4), R('gravity', 'Gravité', 'uParamB', 0.5)],
    glsl: `
float RR() { return 8.0 + (1.0 - uParamA) * 18.0; }
float BW() { return 1.9 / (RR() * uAspect); }
float startFall(vec2 cell) { return 0.17 + hash21(cell + 4.0) * 0.18 + (cell.y / RR()) * 0.12; }
float landTime(vec2 cell) { return 0.62 + hash21(cell + 9.0) * 0.1 + (cell.y / RR()) * 0.2; }
vec3 effect(vec2 uv) {
  float R = RR();
  float bw = BW();
  float g = 2.0 + uParamB * 6.0;
  float t = uP;
  float secs = uDur;
  vec3 light = vec3(1.0, 0.96, 0.9);
  if (t < 0.6) {
    // effondrement : le pixel reçoit le contenu d'un bloc situé plus haut
    for (int k = 0; k < 14; k++) {
      float row = floor(uv.y * R) + float(k);
      if (row >= R) break;
      float off = mod(row, 2.0) * 0.5;
      // chute
      for (int s = -1; s <= 1; s++) {
        float cx = floor(uv.x / bw + off) + float(s);
        vec2 cell = vec2(cx, row);
        float ft = max(t - startFall(cell), 0.0) * secs;
        float dy = 0.5 * g * ft * ft * 0.08;
        float dx = (hash21(cell) - 0.5) * ft * 0.05;
        vec2 src = uv + vec2(-dx, dy);
        float sr = floor(src.y * R);
        float scx = floor(src.x / bw + off);
        if (sr == row && scx == cx) {
          vec2 f = vec2(fract(src.x / bw + off), fract(src.y * R));
          float gap = ft > 0.0 ? 0.06 : 0.0;
          if (f.x > gap && f.x < 1.0 - gap && f.y > gap * 1.5 && f.y < 1.0 - gap * 1.5) {
            float shade = 0.75 + 0.25 * hash21(cell + 1.0);
            vec3 c = albedo(src) * 1.6 * light * shade * maskAt(src);
            // fissures avant la chute
            vec3 vo = voronoi(asp(src) * 9.0);
            float crack = sstep(0.03, 0.0, vo.y) * sstep(0.05, 0.16, t) * step(ft, 0.0);
            return c * (1.0 - crack) + uColA * crack * 2.5;
          }
        }
      }
    }
    return vec3(0.0);
  }
  // reconstruction : les blocs tombent du ciel jusqu'à leur place
  for (int k = 0; k < 14; k++) {
    float row = floor(uv.y * R) - float(k);
    if (row < 0.0) break;
    float off = mod(row, 2.0) * 0.5;
    float cx = floor(uv.x / bw + off);
    vec2 cell = vec2(cx, row);
    float lt = landTime(cell);
    float rem = max(lt - t, 0.0) * secs;
    float dy = 0.5 * g * rem * rem * 0.08;
    vec2 src = uv - vec2(0.0, dy);
    if (floor(src.y * R) == row && floor(src.x / bw + off) == cx && src.y > 0.0) {
      vec2 f = vec2(fract(src.x / bw + off), fract(src.y * R));
      float gap = rem > 0.0 ? 0.05 : 0.0;
      if (f.x > gap && f.x < 1.0 - gap && f.y > gap && f.y < 1.0 - gap) {
        float flash = rem <= 0.0 ? exp(-(t - lt) * secs * 3.0) : 0.0;
        return albedo(src) * 1.6 * light * maskAt(src) + vec3(1.0, 0.9, 0.7) * flash * 0.8;
      }
    }
  }
  return vec3(0.0);
}`,
  },
  {
    id: 'relief', name: 'Relief vivant 3D', category: 'Architecture', mood: 'moyen', defaultDuration: 12,
    description: 'Une caméra virtuelle bouge devant la façade : parallaxe, respiration et lumière qui tourne.',
    tags: ['patrimoine', 'mariage', 'saisons', 'noel'],
    params: [I(), S(), CA('#ffffff', 'Lumière'), R('depth', 'Amplitude 3D', 'uParamA', 0.6), R('breath', 'Respiration', 'uParamB', 0.4)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  vec2 o = vec2(sin(t * 0.55), cos(t * 0.37) * 0.6) * 0.03 * uParamA;
  vec2 c = vec2(0.5, 0.4);
  float br = sin(t * 1.2) * 0.012 * uParamB + uBeat * 0.006 * uParamB;
  // parallaxe avec recherche d'intersection
  vec2 p = uv;
  float hPrev = 0.0;
  for (int i = 0; i < 20; i++) {
    float h = depthAt(p);
    vec2 target = uv - o * (h - 0.5) - (uv - c) * br * h;
    p = mix(p, target, 0.6);
    hPrev = h;
  }
  vec3 L = normalize(vec3(cos(t * 0.4) * 0.8, 0.6, 0.7));
  float d = 0.35 + 0.9 * diffuseAt(p, L);
  return albedo(p) * 1.5 * uColA * d * maskAt(p) * (0.9 + hPrev * 0.2);
}`,
  },
  {
    id: 'puzzle', name: 'Puzzle', category: 'Architecture', mood: 'moyen', defaultDuration: 10,
    description: 'La façade se découpe en carreaux qui pivotent un à un comme des panneaux, puis se recomposent.',
    tags: ['national', 'mariage', 'saisons'],
    params: [I(), S(), CA('#ffffff', 'Face avant'), CB('#ff3d7f', 'Face arrière'), R('size', 'Taille', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float n = 6.0 + (1.0 - uParamA) * 18.0;
  vec2 g = vec2(n * uAspect, n);
  vec2 cell = floor(uv * g);
  vec2 f = fract(uv * g);
  float delay = hash21(cell) * 0.35 + (cell.x / g.x) * 0.3;
  float ph = sat((uP * uSpeed * 1.4 - delay) / 0.35);
  float ang = ph * TAU;
  float cs = cos(ang);
  float w = abs(cs);
  float x = (f.x - 0.5) / max(w, 0.001) + 0.5;
  if (x < 0.0 || x > 1.0) return vec3(0.0);
  vec2 src = (cell + vec2(x, f.y)) / g;
  float shade = 0.55 + 0.45 * w;
  vec3 front = albedo(src) * 1.6 * uColA;
  vec3 back = uColB * (0.6 + 0.4 * lum(albedo(src)));
  return (cs > 0.0 ? front : back) * shade * sstep(0.0, 0.03, f.y) * sstep(1.0, 0.97, f.y);
}`,
  },
  {
    id: 'scan', name: 'Scan laser', category: 'Architecture', mood: 'fort', defaultDuration: 10,
    description: 'Un faisceau laser balaie le monument et en révèle la structure numérique.',
    tags: ['national', 'intro', 'halloween'],
    params: [I(), S(), CA('#00ffd0', 'Laser'), CB('#2f6bff', 'Structure'), R('grid', 'Grille', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed * 0.35;
  float pos = 0.5 + 0.55 * sin(t * PI);
  float d = abs(uv.y - pos);
  float line = exp(-d * 260.0) * 2.5 + exp(-d * 40.0) * 0.4;
  float trail = sstep(0.35, 0.0, d);
  float e = max(edgeZone(uv), edgeImg(uv) * 0.7);
  vec2 gp = asp(uv) * (20.0 + uParamA * 40.0);
  vec2 gf = abs(fract(gp) - 0.5);
  float grid = sstep(0.47, 0.5, max(gf.x, gf.y)) * uParamA * depthAt(uv);
  vec3 c = uColA * line + uColB * (e * 1.6 + grid * 0.6) * trail;
  c += uColB * glowLines(uv) * 0.25 * trail;
  return c;
}`,
  },
  // ───────────────────────────── MATIÈRES ─────────────────────────────
  {
    id: 'vitrail', name: 'Vitrail', category: 'Matières', mood: 'calme', defaultDuration: 12,
    description: 'Les ouvertures (ou toute la façade) deviennent un vitrail coloré traversé par la lumière.',
    tags: ['noel', 'patrimoine', 'mariage'],
    params: [I(), S(), CA('#2050ff', 'Couleur 1'), CB('#ff3040', 'Couleur 2'), R('cells', 'Taille des verres', 'uParamA', 0.5), TOG('all', 'Toute la façade', 'uParamB', false)],
    glsl: `
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  bool inside = uParamB > 0.5 || (id > 0 && (isOpening(ty) || ty == T_HORLOGE));
  vec3 ambient = mix(uColA, uColB, fbm(asp(uv) * 2.0 + uT * 0.05)) * 0.12;
  if (!inside) return ambient * (0.4 + 0.6 * glowOpen(uv) * 2.0);
  float sc = 8.0 + (1.0 - uParamA) * 30.0;
  vec3 v = voronoi(asp(uv) * sc);
  float r = v.z;
  vec3 pal[5] = vec3[5](uColA, uColB, vec3(1.0, 0.8, 0.2), vec3(0.2, 0.8, 0.4), vec3(0.7, 0.3, 1.0));
  vec3 glass = pal[int(r * 4.99)];
  float lead = sstep(0.025, 0.06, v.y);
  float shimmer = 0.75 + 0.25 * sin(uT * 1.5 * uSpeed + r * 20.0);
  float appear = sstep(r * 0.6, r * 0.6 + 0.1, uP * 1.3);
  float glow = 1.0 + uBeat * 0.4;
  return mix(ambient, glass * 1.5 * shimmer * glow, appear) * lead;
}`,
  },
  {
    id: 'matiere', name: 'Transmutation', category: 'Matières', mood: 'moyen', defaultDuration: 12,
    description: 'La pierre se transforme en or, marbre, glace ou cuivre, avec reflets qui glissent.',
    tags: ['noel', 'mariage', 'patrimoine', 'saisons'],
    params: [I(), S(), SEL('mat', 'Matière', 'uParamC', ['Or', 'Marbre', 'Glace', 'Cuivre oxydé'], 0), R('shine', 'Brillance', 'uParamA', 0.7)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  vec3 n = normalAt(uv);
  n = normalize(vec3(n.xy * (0.5 + uRelief * 1.5), n.z));
  vec3 L = normalize(vec3(sin(t * 0.6) * 0.9, 0.5 + 0.3 * cos(t * 0.4), 0.7));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0, 0, 1)), 0.0), 24.0) * uParamA * 2.5;
  float a = lum(albedo(uv));
  vec3 base;
  int m = int(uParamC + 0.5);
  if (m == 0) base = vec3(1.0, 0.72, 0.28) * (0.35 + 0.8 * a);
  else if (m == 1) {
    float v = abs(sin(asp(uv).x * 5.0 + fbm(asp(uv) * 3.5) * 7.0));
    base = vec3(0.95, 0.93, 0.9) * (0.8 + 0.2 * a) * (0.55 + 0.45 * sstep(0.0, 0.25, v));
  } else if (m == 2) {
    vec3 vo = voronoi(asp(uv) * 7.0);
    base = vec3(0.6, 0.85, 1.0) * (0.5 + 0.5 * a) + vec3(0.8, 0.95, 1.0) * sstep(0.04, 0.0, vo.y) * 0.8;
  } else base = mix(vec3(0.85, 0.45, 0.25), vec3(0.25, 0.75, 0.65), sstep(0.4, 0.7, fbm(asp(uv) * 5.0))) * (0.4 + 0.7 * a);
  vec3 matc = base * (0.25 + diff * 1.0) + vec3(1.0, 0.95, 0.85) * spec;
  float f = uv.y + (fbm(asp(uv) * 4.0) - 0.5) * 0.3;
  float tr = sstep(f - 0.05, f + 0.05, uP * 1.5 - 0.1);
  float front = sstep(0.06, 0.0, abs(uP * 1.5 - 0.1 - f));
  vec3 plain = vec3(0.9) * (0.3 + 0.7 * diff);
  return mix(plain * 0.6, matc, tr) + vec3(1.0, 0.9, 0.6) * front * 1.5;
}`,
  },
  {
    id: 'mosaique', name: 'Mosaïque', category: 'Matières', mood: 'moyen', defaultDuration: 10,
    description: 'La façade se transforme en mosaïque de tesselles colorées qui scintillent.',
    tags: ['mariage', 'saisons', 'noel'],
    params: [I(), S(), CA('#ffcc33', 'Couleur 1'), CB('#2bb3ff', 'Couleur 2'), R('size', 'Taille des tesselles', 'uParamA', 0.4)],
    glsl: `
vec3 effect(vec2 uv) {
  float n = 30.0 + (1.0 - uParamA) * 90.0;
  vec2 g = vec2(n * uAspect, n);
  vec2 cell = floor(uv * g);
  vec2 f = fract(uv * g);
  vec2 cuv = (cell + 0.5) / g;
  float a = lum(albedo(cuv));
  float r = hash21(cell);
  vec3 col = mix(uColA, uColB, sstep(0.3, 0.7, fbm(cell * 0.08 + uT * 0.1 * uSpeed)));
  col = mix(col, vec3(1.0), sstep(0.7, 1.0, a));
  float tw = 0.7 + 0.3 * sin(uT * 3.0 * uSpeed + r * 30.0) + uBeat * 0.3 * step(0.7, r);
  float grout = sstep(0.0, 0.08, f.x) * sstep(1.0, 0.92, f.x) * sstep(0.0, 0.08, f.y) * sstep(1.0, 0.92, f.y);
  float appear = sstep(r * 0.5, r * 0.5 + 0.1, uP * 1.6);
  return col * (0.4 + 0.9 * a) * tw * grout * appear;
}`,
  },
  // ────────────────────────────── NATURE ──────────────────────────────
  {
    id: 'eau', name: 'Montée des eaux', category: 'Nature', mood: 'moyen', defaultDuration: 14,
    description: 'L’eau monte et remplit la façade comme un aquarium, avec reflets et caustiques, puis redescend.',
    tags: ['saisons', 'patrimoine', 'mariage'],
    params: [I(), S(), CA('#1e88ff', 'Eau'), CB('#bfe8ff', 'Reflets'), R('level', 'Niveau maximal', 'uParamA', 0.85)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  float rise = sstep(0.0, 0.45, uP) * (1.0 - sstep(0.75, 1.0, uP));
  float level = mix(-0.05, uParamA, rise);
  float wave = 0.012 * sin(uv.x * uAspect * 14.0 + t * 2.0) + 0.007 * sin(uv.x * uAspect * 31.0 - t * 3.1);
  float surf = level + wave;
  vec3 v = voronoi(asp(uv) * 9.0 + vec2(t * 0.25, t * 0.15));
  float caust = pow(sat(1.0 - v.y * 9.0), 3.0);
  if (uv.y < surf) {
    vec2 r = vec2(fbm(uv * 10.0 + t * 0.5), fbm(uv * 10.0 - t * 0.4)) - 0.5;
    vec3 a = albedo(uv + r * 0.012);
    float depthW = sat((surf - uv.y) * 2.0);
    vec3 c = uColA * (0.35 + 0.8 * lum(a)) * (1.0 - depthW * 0.5) + uColB * caust * (0.9 - depthW * 0.5);
    float bubbles = step(0.985, hash21(floor(asp(uv) * 90.0 + vec2(0.0, -t * 12.0))));
    c += uColB * bubbles * 0.6;
    float foam = sstep(0.012, 0.0, surf - uv.y);
    return c + vec3(1.0) * foam * 1.4;
  }
  float above = sat(1.0 - (uv.y - surf) * 4.0);
  return uColB * 0.08 + uColB * caust * above * 0.45 * rise;
}`,
  },
  {
    id: 'feu', name: 'Embrasement', category: 'Nature', mood: 'fort', defaultDuration: 10,
    description: 'Des flammes montent des fondations et lèchent la façade, braises et lueurs vacillantes.',
    tags: ['halloween', 'national', 'patrimoine'],
    params: [I(), S(), CA('#ff5a1f', 'Flammes'), R('height', 'Hauteur', 'uParamA', 0.55), R('embers', 'Braises', 'uParamB', 0.6)],
    glsl: `
vec3 fireCol(float v) {
  return vec3(1.6 * v, 1.4 * v * v, 1.2 * v * v * v * v) * 1.3;
}
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  float grow = sstep(0.0, 0.25, uP) * (1.0 - sstep(0.85, 1.0, uP));
  float h = (0.12 + uParamA * 0.8) * grow * (1.0 + uBeat * 0.15);
  vec2 p = vec2(asp(uv).x * 3.5, uv.y * 2.5 - t * 1.6);
  float n = fbm(p) * 0.7 + fbm(p * 2.3 + 4.0) * 0.3;
  float v = sat(1.0 - uv.y / max(h, 0.001) + (n - 0.5) * 1.3);
  v = pow(v, 1.4);
  vec3 c = fireCol(v) * mix(vec3(1.0), uColA / max(max(uColA.r, uColA.g), 0.01), 0.35);
  // braises
  vec2 q = asp(uv) * 40.0 + vec2(sin(uv.y * 8.0 + t) * 2.0, -t * 9.0);
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5 - (hash22(cell) - 0.5) * 0.6;
  float e = step(0.93, hash21(cell)) * sstep(0.12, 0.0, length(f)) * sat(1.0 - uv.y / max(h * 1.6, 0.001));
  c += vec3(1.0, 0.55, 0.15) * e * uParamB * 2.0;
  // lueur sur la pierre
  float fl = 0.75 + 0.25 * vnoise(vec2(t * 8.0, 1.0));
  vec3 L = normalize(vec3(0.0, -1.0, 0.6));
  c += uColA * 0.45 * fl * grow * sat(1.2 - uv.y / max(h * 2.2, 0.001)) * (0.3 + diffuseAt(uv, L));
  return c;
}`,
  },
  {
    id: 'neige', name: 'Nuit de neige', category: 'Nature', mood: 'calme', defaultDuration: 14,
    description: 'La neige tombe et s’accumule sur les corniches et les rebords, sous un clair de lune.',
    tags: ['noel', 'saisons'],
    params: [I(), S(), CA('#ffffff', 'Neige'), CB('#5c7cff', 'Clair de lune'), R('density', 'Densité', 'uParamA', 0.6), R('accum', 'Accumulation', 'uParamB', 0.8)],
    glsl: `
float flakes(vec2 uv, float scale, float spd, float seed) {
  vec2 p = asp(uv) * scale + vec2(sin(uT * 0.4 + seed + uv.y * 3.0) * 0.6, uT * spd * uSpeed);
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5 - (hash22(cell + seed) - 0.5) * 0.7;
  float on = step(1.0 - uParamA * 0.6, hash21(cell + seed * 3.0));
  return on * sstep(0.12, 0.0, length(f));
}
vec3 effect(vec2 uv) {
  vec3 L = normalize(vec3(-0.4, 0.8, 0.6));
  vec3 c = uColB * (0.08 + 0.4 * diffuseAt(uv, L));
  // accumulation sur les rebords : surfaces dont le dessus est plus proche que le dessus voisin
  float d0 = depthAt(uv);
  float d1 = depthAt(uv + vec2(0.0, 0.012));
  float ledge = sstep(0.01, 0.05, d0 - d1);
  vec3 n = normalAt(uv);
  float up = sstep(0.1, 0.5, n.y);
  float acc = sat(max(ledge, up * 0.7) * (0.6 + 0.4 * fbm(asp(uv) * 30.0))) * sstep(0.1, 0.8, uP) * uParamB;
  acc = max(acc, sstep(0.75, 1.0, uP) * uParamB * 0.12);
  c = mix(c, uColA * 1.1, acc);
  float s = flakes(uv, 30.0, 0.35, 1.0) + flakes(uv, 18.0, 0.55, 7.0) * 1.2 + flakes(uv, 10.0, 0.8, 13.0) * 1.4;
  return c + uColA * s;
}`,
  },
  {
    id: 'lierre', name: 'Jardin suspendu', category: 'Nature', mood: 'calme', defaultDuration: 14,
    description: 'Lierre et fleurs poussent le long des colonnes et recouvrent peu à peu la façade.',
    tags: ['saisons', 'mariage', 'patrimoine'],
    params: [I(), S(), CA('#2fbf4a', 'Feuillage'), CB('#ff6fae', 'Fleurs'), R('cover', 'Couverture', 'uParamA', 0.75)],
    glsl: `
vec3 effect(vec2 uv) {
  float g = uv.y * 0.9 + fbm(asp(uv) * 3.0) * 0.45 - glowLines(uv) * 0.25;
  float grown = uP * (0.6 + uParamA * 1.0) * uSpeed;
  float m = sstep(g, g - 0.06, grown - 0.1);
  vec3 v = voronoi(asp(uv) * 55.0);
  float leaf = sstep(0.42, 0.18, v.x);
  float density = sat(0.35 + glowLines(uv) * 1.5 + glowOpen(uv) * 0.8);
  float on = step(1.0 - density * uParamA, hash11(v.z * 91.0));
  vec3 lc = uColA * (0.45 + 0.75 * hash11(v.z * 17.0)) * (0.8 + 0.2 * sin(uT * 2.0 + v.z * 30.0));
  float fl = step(0.93, hash11(v.z * 51.0)) * sstep(0.3, 0.1, v.x);
  float bloom = sstep(0.4, 0.9, uP);
  vec3 c = vec3(0.02, 0.05, 0.03);
  c += lc * leaf * on * m;
  c += uColB * 1.6 * fl * m * bloom * (1.0 + uBeat * 0.3);
  float vine = sstep(0.012, 0.0, abs(fbm(asp(uv) * 6.0 + 2.0) - 0.5)) * m;
  c += uColA * 0.6 * vine;
  return c;
}`,
  },
  {
    id: 'aurore', name: 'Aurore boréale', category: 'Nature', mood: 'calme', defaultDuration: 14,
    description: 'Des voiles de lumière ondulent sur la façade comme une aurore boréale.',
    tags: ['noel', 'saisons', 'mariage'],
    params: [I(), S(), CA('#28ffb0', 'Couleur 1'), CB('#a040ff', 'Couleur 2'), R('waves', 'Ondulation', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed * 0.25;
  vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.35 + fi * 0.18 + 0.12 * sin(uv.x * uAspect * (2.0 + uParamA * 3.0) + t * (1.0 + fi * 0.3) + fi * 2.0) + (fbm(vec2(uv.x * 3.0 + t, fi)) - 0.5) * 0.25;
    float band = exp(-pow((uv.y - y) * 6.0, 2.0)) * (0.5 + 0.5 * fbm(vec2(uv.x * 25.0, t * 2.0 + fi)));
    float curtain = sstep(0.0, 0.25, y + 0.2 - uv.y) * exp(-(y - uv.y) * 3.0) * 0.4 * step(uv.y, y);
    c += mix(uColA, uColB, fi / 2.0 + 0.2 * sin(t + uv.x * 3.0)) * (band + curtain);
  }
  c *= 0.6 + 0.4 * lum(albedo(uv)) * 1.5;
  return c * (0.9 + uBeat * 0.2) * sstep(0.0, 0.15, uP);
}`,
  },
  // ───────────────────────────── GRAPHIQUE ─────────────────────────────
  {
    id: 'neon', name: 'Squelette néon', category: 'Graphique', mood: 'fort', defaultDuration: 10,
    description: 'Seules les arêtes du monument restent, en néon qui pulse sur la musique.',
    tags: ['national', 'halloween', 'intro'],
    params: [I(), S(), CA('#ff2bd6', 'Couleur 1'), CB('#2bd9ff', 'Couleur 2'), TOG('rainbow', 'Arc-en-ciel', 'uParamB', false), R('details', 'Détails de la pierre', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  int id = zoneId(uv);
  float e = edgeZone(uv) * 1.4 + edgeImg(uv) * uParamA;
  float g = glowLines(uv) * 0.5;
  vec3 col = uParamB > 0.5 ? hsv(uv.y * 0.4 + uv.x * 0.2 - t * 0.12 + float(id) * 0.07, 0.85, 1.0)
                           : mix(uColA, uColB, 0.5 + 0.5 * sin(uv.x * 6.0 + uv.y * 3.0 - t * 1.5));
  float pulse = 0.55 + 0.45 * uBeat + 0.15 * sin(t * 3.0);
  float flick = step(0.04, hash11(floor(t * 20.0) + float(id)));
  return col * (e * 1.8 + g) * pulse * flick * sstep(0.0, 0.08, uP);
}`,
  },
  {
    id: 'vague', name: 'Vague de couleurs', category: 'Graphique', mood: 'moyen', defaultDuration: 10,
    description: 'Les éléments s’illuminent tour à tour : une vague de couleur parcourt fenêtres et colonnes.',
    tags: ['national', 'mariage', 'saisons', 'noel'],
    params: [I(), S(), CA('#ff3355', 'Couleur 1'), CB('#3366ff', 'Couleur 2'), R('freq', 'Nombre de vagues', 'uParamA', 0.4), R('beat', 'Flash sur le rythme', 'uParamB', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  float t = uT * uSpeed;
  float k = 1.0 + uParamA * 4.0;
  vec3 c;
  if (id > 0) {
    vec4 m = zoneMeta(id);
    float w = pow(0.5 + 0.5 * cos(TAU * (m.y * k - t * 0.35)), 4.0);
    vec3 col = mix(uColA, uColB, 0.5 + 0.5 * sin(m.y * 7.0 + t * 0.6));
    float bf = step(0.65, hash11(float(id) * 1.7 + uBeatIndex)) * uBeat * uParamB;
    c = col * (w + bf) * (0.45 + 0.75 * lum(albedo(uv)) * 1.4);
  } else {
    float w = pow(0.5 + 0.5 * cos(TAU * (uv.x * k - t * 0.35)), 6.0);
    c = mix(uColB, uColA, uv.y) * 0.12 * (0.5 + w);
  }
  c += mix(uColA, uColB, uv.x) * edgeZone(uv) * 0.5;
  return c;
}`,
  },
  {
    id: 'battement', name: 'Battements', category: 'Graphique', mood: 'fort', defaultDuration: 8,
    description: 'Les calques s’allument par paquets sur chaque temps de la musique.',
    tags: ['national', 'mariage', 'halloween'],
    params: [I(), CA('#ffffff', 'Couleur 1'), CB('#ffb300', 'Couleur 2'), R('amount', 'Proportion allumée', 'uParamA', 0.35)],
    glsl: `
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  float bi = uBeatIndex;
  vec3 c = vec3(0.0);
  if (id > 0) {
    float on = step(1.0 - uParamA, hash11(float(id) * 3.3 + bi * 7.1));
    vec3 col = mod(bi, 2.0) < 1.0 ? uColA : uColB;
    c = col * on * (0.25 + 0.75 * uBeat) * (0.5 + lum(albedo(uv)));
  }
  float down = mod(bi, 4.0) < 1.0 ? uBeat : 0.0;
  c += uColA * (edgeZone(uv) * 1.5 + glowLines(uv) * 0.4) * (0.2 + down);
  return c;
}`,
  },
  {
    id: 'kaleido', name: 'Kaléidoscope', category: 'Graphique', mood: 'fort', defaultDuration: 10,
    description: 'Un kaléidoscope géant tourne au centre de la façade, sculpté par la pierre.',
    tags: ['national', 'mariage', 'saisons'],
    params: [I(), S(), CA('#ff4fd8', 'Couleur 1'), CB('#ffd43b', 'Couleur 2'), R('segments', 'Segments', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  vec2 p = asp(uv) - asp(vec2(0.5, 0.5));
  float r = length(p);
  float a = atan(p.y, p.x) + t * 0.15;
  float seg = floor(3.0 + uParamA * 9.0);
  float sa = TAU / seg;
  a = mod(a, sa);
  a = abs(a - sa * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  float pat = fbm(q * 6.0 - vec2(t * 0.3, 0.0));
  vec3 v = voronoi(q * 9.0 + t * 0.2);
  float rings = 0.5 + 0.5 * sin(r * 30.0 - t * 2.0 + uBeat * 2.0);
  vec3 col = mix(uColA, uColB, pat) * (0.4 + rings * 0.8) + mix(uColB, uColA, v.z) * sstep(0.05, 0.0, v.y) * 1.2;
  float stone = 0.35 + 0.9 * lum(albedo(uv));
  return col * stone * sstep(0.0, 0.1, uP) * sstep(1.2, 0.2, r * (1.3 - uP * 0.3));
}`,
  },
  {
    id: 'glitch', name: 'Glitch numérique', category: 'Graphique', mood: 'fort', defaultDuration: 6,
    description: 'Le monument « bugue » : décalages, séparation RVB et bandes, synchronisés au rythme.',
    tags: ['halloween', 'national'],
    params: [I(), S(), CA('#ff0055', 'Couleur 1'), CB('#00e5ff', 'Couleur 2'), R('amount', 'Intensité du glitch', 'uParamA', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = floor(uT * 12.0 * uSpeed);
  float band = floor(uv.y * (10.0 + hash11(t) * 30.0));
  float glitchOn = step(0.55, hash11(band + t * 3.0)) * (uParamA + uBeat * 0.6);
  float sh = (hash11(band * 7.0 + t) - 0.5) * 0.12 * glitchOn;
  vec2 u2 = vec2(uv.x + sh, uv.y);
  float rgb = 0.008 * (1.0 + uBeat * 2.0) * uParamA;
  vec3 c;
  c.r = lum(albedo(u2 + vec2(rgb, 0.0)));
  c.g = lum(albedo(u2));
  c.b = lum(albedo(u2 - vec2(rgb, 0.0)));
  c *= 1.5;
  c = mix(c, c * mix(uColA, uColB, hash11(band)), glitchOn * 0.8);
  float scan = 0.85 + 0.15 * sin(uv.y * uRes.y * 1.5);
  float blockN = step(0.97, hash21(floor(uv * vec2(18.0, 30.0)) + t)) * uParamA;
  return c * scan + mix(uColA, uColB, hash11(t)) * blockN * 1.5;
}`,
  },
  {
    id: 'feuxartifice', name: 'Feux d’artifice', category: 'Graphique', mood: 'fort', defaultDuration: 12,
    description: 'Des bouquets explosent devant la façade et l’illuminent de leurs couleurs.',
    tags: ['national', 'noel', 'mariage'],
    params: [I(), S(), R('count', 'Nombre de bouquets', 'uParamA', 0.6), R('sat', 'Saturation', 'uParamB', 0.9)],
    glsl: `
vec3 effect(vec2 uv) {
  vec3 c = vec3(0.0);
  vec2 pa = asp(uv);
  int N = 2 + int(uParamA * 4.0);
  for (int i = 0; i < 6; i++) {
    if (i >= N) break;
    float fi = float(i);
    float P = 2.6;
    float tt = uT * uSpeed + fi * P / float(N);
    float cyc = floor(tt / P);
    float lt = mod(tt, P);
    vec2 center = vec2(0.12 + hash21(vec2(cyc, fi)) * 0.76, 0.5 + hash21(vec2(fi, cyc + 3.0)) * 0.42);
    vec3 col = hsv(hash21(vec2(cyc * 1.3, fi * 2.1)), uParamB, 1.0);
    vec2 cp = asp(center);
    float flash = exp(-lt * 3.5);
    // lueur sur la façade
    vec2 d = cp - pa;
    float dist = length(d);
    vec3 L = normalize(vec3(d, 0.25));
    c += col * flash * 0.5 * exp(-dist * 2.0) * (0.3 + diffuseAt(uv, L));
    // étincelles
    float rad = lt * 0.16 * (1.0 - lt * 0.12);
    for (int k = 0; k < 18; k++) {
      float fk = float(k);
      float ang = fk / 18.0 * TAU + hash11(cyc + fi) * 3.0;
      vec2 pp = cp + vec2(cos(ang), sin(ang)) * rad * (0.8 + 0.4 * hash11(fk + cyc)) - vec2(0.0, lt * lt * 0.02);
      float dd = length(pa - pp);
      c += col * 0.00035 / (dd * dd + 0.00008) * exp(-lt * 1.4);
    }
  }
  return c;
}`,
  },
  // ───────────────────────────── ILLUSIONS ─────────────────────────────
  {
    id: 'portails', name: 'Fenêtres sur l’ailleurs', category: 'Illusions', mood: 'calme', defaultDuration: 12,
    description: 'Les ouvertures donnent sur un autre monde : l’espace, l’océan ou un ciel d’été.',
    tags: ['saisons', 'mariage', 'noel', 'halloween'],
    params: [I(), S(), SEL('world', 'Monde', 'uParamC', ['Espace', 'Océan', 'Ciel d’été'], 0), CA('#7a5cff', 'Couleur 1'), CB('#ff5ca8', 'Couleur 2')],
    glsl: `
vec3 world(vec2 uv) {
  float t = uT * uSpeed;
  int w = int(uParamC + 0.5);
  vec2 p = asp(uv);
  if (w == 0) {
    vec3 c = mix(uColA, uColB, fbm(p * 2.5 + t * 0.03)) * fbm(p * 4.0 - t * 0.02) * 0.9;
    for (int i = 0; i < 3; i++) {
      float s = 40.0 + float(i) * 50.0;
      vec2 q = p * s + vec2(t * (0.5 + float(i)), 0.0);
      vec2 cell = floor(q);
      vec2 f = fract(q) - hash22(cell);
      float st = step(0.92, hash21(cell + float(i))) * sstep(0.08, 0.0, length(f));
      c += vec3(1.0) * st * (0.6 + 0.4 * sin(t * 4.0 + hash21(cell) * 40.0));
    }
    return c;
  } else if (w == 1) {
    vec3 v = voronoi(p * 8.0 + vec2(t * 0.2, t * 0.1));
    float caust = pow(sat(1.0 - v.y * 7.0), 3.0);
    return mix(vec3(0.0, 0.15, 0.35), vec3(0.0, 0.6, 0.8), uv.y) + vec3(0.7, 0.95, 1.0) * caust * 0.8;
  }
  float cl = sstep(0.45, 0.8, fbm(p * 3.0 + vec2(t * 0.06, 0.0)));
  return mix(mix(vec3(0.25, 0.55, 1.0), vec3(0.7, 0.85, 1.0), uv.y * 0.6), vec3(1.0), cl);
}
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  float open = 0.0;
  if (id > 0 && (isOpening(ty) || ty == T_HORLOGE)) {
    vec4 m = zoneMeta(id);
    open = sstep(m.x * 0.4, m.x * 0.4 + 0.15, uP * 1.3);
  }
  vec3 rim = mix(uColA, uColB, uv.x) * glowOpen(uv) * 0.8 * sstep(0.0, 0.2, uP);
  return mix(rim + vec3(0.01), world(uv) * 1.3, open);
}`,
  },
  {
    id: 'rideau', name: 'Lever de rideau', category: 'Illusions', mood: 'calme', defaultDuration: 10,
    description: 'Un rideau de théâtre rouge s’ouvre et révèle la façade sous les projecteurs.',
    tags: ['intro', 'mariage', 'noel', 'patrimoine'],
    params: [I(), CA('#b3001b', 'Velours'), CB('#ffd27a', 'Projecteurs'), TOG('close', 'Refermer à la fin', 'uParamA', false)],
    glsl: `
vec3 curtain(float x, float yy, float open) {
  // x : 0 au bord extérieur -> 1 au centre de la scène
  float folds = 0.6 + 0.4 * sin(x * (40.0 + open * 30.0) + sin(yy * 3.0) * 0.5);
  folds = pow(folds, 1.5);
  return uColA * (0.35 + 0.9 * folds) * (0.75 + 0.25 * yy);
}
vec3 effect(vec2 uv) {
  float open = sstep(0.12, 0.6, uP);
  if (uParamA > 0.5) open *= 1.0 - sstep(0.82, 1.0, uP);
  float half_ = 0.5 * (1.0 - open) + 0.06 * open;
  float sway = 0.01 * sin(uT * 1.5) * (1.0 - open);
  vec3 L1 = normalize(vec3(-0.6, 0.6, 0.6));
  vec3 L2 = normalize(vec3(0.6, 0.6, 0.6));
  vec3 stage = uColB * (0.25 + 0.6 * diffuseAt(uv, L1) + 0.6 * diffuseAt(uv, L2)) * open;
  float edgeL = half_ + sway + (1.0 - uv.y) * 0.04 * open;
  float edgeR = 1.0 - half_ + sway - (1.0 - uv.y) * 0.04 * open;
  vec3 c = stage;
  if (uv.x < edgeL) c = curtain(uv.x / max(edgeL, 0.01), uv.y, open) * sstep(edgeL, edgeL - 0.01, uv.x);
  if (uv.x > edgeR) c = curtain((1.0 - uv.x) / max(1.0 - edgeR, 0.01), uv.y, open);
  float val = sstep(0.9, 0.92, uv.y);
  if (val > 0.0) c = mix(c, uColA * (0.5 + 0.5 * sin(uv.x * uAspect * 50.0)) * 0.9 + vec3(0.9, 0.7, 0.2) * sstep(0.005, 0.0, abs(uv.y - 0.905)), val);
  return c;
}`,
  },
  {
    id: 'texte', name: 'Texte animé', category: 'Illusions', mood: 'calme', defaultDuration: 8,
    description: 'Un message en lumière : écrit, gravé, tapé à la machine, lettres qui tombent, néon ou contour (nom de la commune, date, vœux…).',
    tags: ['intro', 'noel', 'mariage', 'national', 'patrimoine'],
    params: [
      { key: 'text', label: 'Texte', type: 'text', slot: 'aux', default: 'Joyeux Noël' },
      SEL('font', 'Police', 'aux', ['Classique (Cinzel)', 'Gothique', 'Manuscrite', 'Affiche', 'Moderne'], 0),
      I(), CA('#ffe08a', 'Couleur du texte'), CB('#1b2a55', 'Fond / 2e couleur'),
      SEL('style', 'Animation', 'uParamC', ['Écrit en lumière', 'Gravé dans la pierre', 'Machine à écrire', 'Lettres qui tombent', 'Néon qui clignote', 'Contour lumineux'], 0),
      R('y', 'Position verticale', 'uParamA', 0.5), R('size', 'Taille', 'uParamB', 0.5),
    ],
    glsl: `
float txt(vec2 uv) { return texture(uAux, uv).r; }
// index de la lettre (0 = aucune) : rapport vert / rouge de la texture
int letterAt(vec2 uv) {
  vec4 t = texture(uAux, uv);
  if (t.r < 0.25) return -1;
  return int(t.g / t.r * 255.0 + 0.5) - 1;
}
float glowAt(vec2 uv, float spread) {
  vec2 px = 1.5 / uRes;
  float g = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) g += txt(uv + vec2(float(i), float(j)) * px * spread);
  return g / 49.0;
}
vec3 effect(vec2 uv) {
  int style = int(uParamC + 0.5);
  float a = txt(uv);
  vec2 px = 1.5 / uRes;
  vec3 bg = uColB * (0.25 + 0.4 * diffuseAt(uv, normalize(vec3(-0.3, 0.6, 0.8))));
  float n = max(uLetterCount, 1.0);
  if (style == 0) {
    float glow = glowAt(uv, 3.0);
    float sweep = uP * 1.6 - 0.2;
    float rev = sstep(uv.x - 0.02, uv.x + 0.02, sweep);
    float head = sstep(0.03, 0.0, abs(sweep - uv.x));
    return bg + uColA * (a * 1.6 + glow * 1.2) * rev + vec3(1.0) * a * head * 2.0;
  }
  if (style == 1) {
    float sweep = uP * 1.6 - 0.2;
    float rev = sstep(uv.x - 0.02, uv.x + 0.02, sweep);
    float gx = txt(uv + vec2(px.x, 0.0)) - txt(uv - vec2(px.x, 0.0));
    float gy = txt(uv + vec2(0.0, px.y)) - txt(uv - vec2(0.0, px.y));
    float emb = (gx * -0.7 + gy * 0.7);
    vec3 lit = vec3(1.0, 0.95, 0.85) * (0.6 + 0.3 * diffuseAt(uv, normalize(vec3(-0.5, 0.5, 0.8))));
    return max(lit * (1.0 - a * 0.65 * rev) + vec3(1.0) * max(emb, 0.0) * 2.0 * rev - vec3(0.6) * max(-emb, 0.0) * rev, 0.0);
  }
  if (style == 2) {
    // machine à écrire : une lettre après l'autre, curseur qui clignote
    float shown = uP * 1.35 * n;
    int k = letterAt(uv);
    float vis = k >= 0 ? step(float(k) + 1.0, shown + 0.999) : 0.0;
    float fresh = k >= 0 ? sstep(1.2, 0.0, shown - float(k)) : 0.0;
    vec3 c = bg + uColA * a * vis * (1.4 + fresh * 1.5) + uColA * glowAt(uv, 2.0) * vis * 0.6;
    int cur = int(clamp(floor(shown), 0.0, n - 1.0));
    vec4 bx = uLetters[cur];
    float cx = shown >= n ? bx.z + 0.004 : bx.x - 0.004;
    float bar = step(abs(uv.x - cx), 0.0025) * step(bx.y, uv.y) * step(uv.y, bx.w) * step(0.5, fract(uT * 1.8));
    return c + uColA * bar * 1.8;
  }
  if (style == 3) {
    // lettres qui tombent du ciel et rebondissent
    vec3 c = bg;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= uLetterCount) break;
      float t0 = float(i) / n * 0.55;
      float l = sat((uP * 1.25 - t0) / 0.28);
      float b = 1.0 - l;
      float bounce = abs(sin(l * PI * 2.5)) * (1.0 - l) * 0.08;
      float off = b * b * 0.9 + bounce;
      vec2 q = uv - vec2(0.0, off);
      vec4 bx = uLetters[i];
      if (q.x < bx.x || q.x > bx.z || q.y < bx.y || q.y > bx.w) continue;
      if (letterAt(q) != i) continue;
      float land = sstep(0.12, 0.0, abs(l - 1.0)) * sstep(0.0, 0.05, l);
      c += uColA * txt(q) * (1.3 + land * 1.5) * sstep(0.0, 0.05, l);
    }
    return c;
  }
  if (style == 4) {
    // néon : halo, grésillement, lettres qui s'éteignent
    int k = letterAt(uv);
    float on = 1.0;
    float fr = floor(uT * 14.0);
    if (k >= 0) on = step(0.12, hash11(fr * 0.37 + float(k) * 7.1)) * sstep(float(k) / n * 0.5, float(k) / n * 0.5 + 0.05, uP);
    float glow = glowAt(uv, 4.0) * sstep(0.0, 0.1, uP);
    float buzz = 0.85 + 0.15 * sin(uT * 120.0);
    return bg * 0.5 + uColA * a * 1.8 * on * buzz + uColA * glow * 1.4 * buzz + uColB * glowAt(uv, 9.0) * 0.6;
  }
  // contour lumineux
  float gx = txt(uv + vec2(px.x, 0.0)) - txt(uv - vec2(px.x, 0.0));
  float gy = txt(uv + vec2(0.0, px.y)) - txt(uv - vec2(0.0, px.y));
  float edge = sat(length(vec2(gx, gy)) * 2.5);
  float sweep = uP * 1.5 - 0.15;
  float rev = sstep(uv.x + 0.03, uv.x - 0.03, sweep) ;
  rev = 1.0 - rev;
  float head = sstep(0.025, 0.0, abs(sweep - uv.x));
  float fill = sstep(0.75, 1.0, uP);
  return bg + uColA * edge * 1.8 * step(uv.x, sweep) + vec3(1.0) * edge * head * 2.5 + uColB * a * fill * 0.9 + uColA * glowAt(uv, 3.0) * 0.4 * step(uv.x, sweep);
}`,
  },
  {
    id: 'ombres', name: 'Théâtre d’ombres', category: 'Illusions', mood: 'calme', defaultDuration: 12,
    description: 'Des silhouettes passent derrière les fenêtres éclairées, comme un théâtre d’ombres chinoises.',
    tags: ['noel', 'halloween', 'patrimoine'],
    params: [I(), S(), CA('#ffb347', 'Lumière intérieure'), CB('#15204a', 'Nuit')],
    glsl: `
float figure(vec2 p, float kind) {
  // silhouettes simples : corps + tête, bras qui bougent
  float d = length((p - vec2(0.0, 0.55)) * vec2(1.0, 0.9)) - 0.16;
  vec2 b = p - vec2(0.0, 0.05);
  float body = max(abs(b.x) - 0.17 + b.y * 0.12, abs(b.y - 0.1) - 0.32);
  d = min(d, body);
  if (kind > 0.5) {
    vec2 h = p - vec2(0.0, 0.78);
    d = min(d, max(abs(h.x) - 0.05 + h.y * 0.3, abs(h.y) - 0.15));
  }
  return d;
}
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  vec3 c = uColB * 0.08 + uColA * glowOpen(uv) * 0.3;
  if (id > 0 && (ty == T_FENETRE || ty == T_PORTE)) {
    vec4 g = zoneGeom(id);
    vec4 m = zoneMeta(id);
    vec2 local = (uv - (g.xy - g.zw * 0.5)) / max(g.zw, vec2(1e-3));
    float on = sstep(m.x * 0.3, m.x * 0.3 + 0.08, uP);
    vec3 inside = uColA * (0.9 + 0.1 * sin(uT * 3.0 + float(id)));
    float t = uT * uSpeed * 0.15 + m.x * 10.0;
    float x = fract(t) * 1.8 - 0.4;
    float bob = abs(sin(uT * 4.0 * uSpeed + m.x * 6.0)) * 0.04;
    vec2 fp = vec2((local.x - x) * g.z / max(g.w, 1e-3) * 1.4, local.y - bob) * 1.8;
    float sil = sstep(0.02, -0.02, figure(fp, step(0.5, m.x)));
    sil *= step(0.25, hash11(floor(t) + float(id)));
    c = mix(c, inside * (1.0 - sil * 0.95), on);
  }
  return c;
}`,
  },
  // ─────────────────────────── NOUVEAUX TABLEAUX ───────────────────────────
  {
    id: 'lave', name: 'Coulée de lave', category: 'Nature', mood: 'fort', defaultDuration: 12,
    description: 'La pierre se fend : des fissures de lave incandescente se propagent depuis le sol.',
    tags: ['halloween', 'patrimoine', 'national'],
    params: [I(), S(), CA('#ff4a00', 'Lueur'), R('plates', 'Taille des plaques', 'uParamA', 0.4), R('width', 'Largeur des fissures', 'uParamB', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  vec3 v = voronoi(asp(uv) * (14.0 - uParamA * 9.0));
  float spread = sstep(0.0, 0.6, uP) * (1.0 - sstep(0.85, 1.0, uP) * 0.7);
  float reach = fbm(asp(uv) * 3.0) * 0.6 + uv.y * 0.7;
  float on = sstep(reach - 0.08, reach, spread * 1.6);
  float crack = sstep(0.03 + 0.05 * uParamB, 0.0, v.y) * on;
  float flow = fbm(asp(uv) * 8.0 + vec2(0.0, -t * 0.6));
  vec3 hot = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.85, 0.35), flow);
  float pulse = 0.8 + 0.2 * sin(t * 2.0 + v.z * 10.0) + uBeat * 0.3;
  vec3 rock = vec3(0.1, 0.06, 0.05) * (0.5 + lum(albedo(uv))) * on + albedo(uv) * 0.3 * (1.0 - on);
  vec3 glow = uColA * sstep(0.22, 0.0, v.y) * on * 0.45;
  return rock + hot * crack * 2.0 * pulse + glow;
}`,
  },
  {
    id: 'brume', name: 'Brume mystérieuse', category: 'Nature', mood: 'calme', defaultDuration: 14,
    description: 'Un brouillard lumineux glisse sur la façade, éclairé par une lune qui tourne.',
    tags: ['halloween', 'patrimoine', 'saisons'],
    params: [I(), S(), CA('#b9c8ff', 'Brume'), CB('#4c5f9e', 'Clair de lune'), R('low', 'Brume au ras du sol', 'uParamA', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed * 0.15;
  vec2 p = asp(uv) * 2.0;
  float f = fbm(p + vec2(t, 0.0) + fbm(p * 1.5 - vec2(0.0, t)) * 1.5);
  float dens = sstep(0.35, 0.85, f) * (1.0 - uv.y * uParamA);
  vec3 L = normalize(vec3(sin(uT * 0.3) * 0.7, 0.5, 0.6));
  vec3 lit = uColB * (0.08 + 0.55 * diffuseAt(uv, L) * shadowAt(uv, L));
  return lit + uColA * dens * 0.9 * sstep(0.0, 0.15, uP);
}`,
  },
  {
    id: 'petales', name: 'Pluie de pétales', category: 'Nature', mood: 'calme', defaultDuration: 12,
    description: 'Des pétales tourbillonnent et tombent doucement devant la façade éclairée.',
    tags: ['mariage', 'saisons'],
    params: [I(), S(), CA('#ff7fb0', 'Pétales'), CB('#ffd9a0', 'Lumière'), R('density', 'Densité', 'uParamA', 0.6)],
    glsl: `
float petal(vec2 uv, float scale, float seed) {
  vec2 p = asp(uv) * scale + vec2(sin(uT * 0.7 + seed + uv.y * 4.0) * 0.5, uT * uSpeed * (0.5 + seed * 0.08));
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5 - (hash22(cell + seed) - 0.5) * 0.5;
  float on = step(1.0 - uParamA * 0.5, hash21(cell + seed * 7.0));
  float a = uT * (hash21(cell) - 0.5) * 6.0 + hash21(cell) * 6.0;
  f = mat2(cos(a), -sin(a), sin(a), cos(a)) * f;
  return on * sstep(0.17, 0.12, length(f * vec2(1.0, 2.2)));
}
vec3 effect(vec2 uv) {
  vec3 base = uColB * (0.15 + 0.35 * diffuseAt(uv, normalize(vec3(-0.4, 0.6, 0.8))));
  float pt = petal(uv, 22.0, 1.0) * 0.7 + petal(uv, 13.0, 5.0) + petal(uv, 8.0, 9.0) * 1.2;
  return base + uColA * pt * 1.3;
}`,
  },
  {
    id: 'sable', name: 'Désintégration', category: 'Architecture', mood: 'fort', defaultDuration: 12,
    description: 'La façade se désagrège en grains emportés par le vent, puis se reconstitue.',
    tags: ['halloween', 'patrimoine', 'national'],
    params: [I(), CA('#ffb46b', 'Lisière'), R('speed2', 'Vitesse des grains', 'uParamA', 0.5), R('wind', 'Vent vers le haut', 'uParamB', 0.3)],
    glsl: `
float tdis(vec2 o) { return 0.08 + (fbm(asp(o) * 4.0) * 0.55 + o.x * 0.45) * 0.75; }
vec3 effect(vec2 uv) {
  float t = (uP < 0.5 ? uP * 2.0 : (1.0 - uP) * 2.0) * 1.15;
  float sp = 0.5 + uParamA;
  float td = tdis(uv);
  vec3 c = t < td ? albedo(uv) * 1.5 : vec3(0.0);
  c += uColA * sstep(0.025, 0.0, abs(t - td)) * 1.6;
  vec2 w = normalize(vec2(1.0, 0.2 + uParamB));
  for (int k = 1; k <= 14; k++) {
    float s = float(k) * 0.022;
    vec2 o = uv - w * s * vec2(1.0 / uAspect, 1.0);
    float age = (t - tdis(o)) * sp;
    if (age > 0.0 && abs(age - s) < 0.02) {
      float gr = step(0.55, hash21(floor(o * uZoneRes * 0.5)));
      c += albedo(o) * 1.4 * gr * max(0.0, 1.0 - s * 2.2);
    }
  }
  return c;
}`,
  },
  {
    id: 'aquarelle', name: 'Aquarelle', category: 'Matières', mood: 'calme', defaultDuration: 12,
    description: 'La façade se peint à l’aquarelle : les pigments se diffusent sur la pierre.',
    tags: ['mariage', 'saisons', 'patrimoine'],
    params: [I(), CA('#3f8cff', 'Pigment 1'), CB('#ff7a59', 'Pigment 2'), R('rainbow', 'Couleurs libres', 'uParamA', 0.3)],
    glsl: `
vec3 effect(vec2 uv) {
  vec2 p = asp(uv);
  float n = fbm(p * 3.0);
  float front = uP * 1.4 - 0.1;
  float reveal = sstep(n - 0.08, n + 0.04, front);
  float edge = sstep(0.05, 0.0, abs(front - n));
  vec3 pig = mix(uColA, uColB, sstep(0.3, 0.7, fbm(p * 2.0 + 7.0)));
  pig = mix(pig, hsv(fbm(p * 1.5 + uT * 0.02), 0.6, 1.0), uParamA);
  float paper = 0.85 + 0.15 * fbm(p * 9.0 + 3.0);
  vec3 c = pig * (0.4 + 0.9 * lum(albedo(uv))) * paper * reveal;
  c += pig * edge * 0.7;
  c += vec3(1.0) * edgeImg(uv) * 0.3 * reveal;
  return c;
}`,
  },
  {
    id: 'matrix', name: 'Pluie numérique', category: 'Graphique', mood: 'fort', defaultDuration: 10,
    description: 'Des colonnes de signes lumineux ruissellent sur le monument, façon code informatique.',
    tags: ['halloween', 'national'],
    params: [I(), S(), CA('#3dff7a', 'Signes'), R('cols', 'Nombre de colonnes', 'uParamA', 0.4), R('lines', 'Contours visibles', 'uParamB', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  float cols = 30.0 + uParamA * 70.0;
  vec2 g = vec2(cols, cols / uAspect * 1.5);
  vec2 cell = floor(uv * g);
  vec2 f = fract(uv * g);
  float spd = (0.5 + hash11(cell.x) * 1.5) * uSpeed;
  float head = fract(-uT * spd * 0.25 + hash11(cell.x * 7.3));
  float d = uv.y - head;
  if (d < 0.0) d += 1.0;
  float trail = exp(-d * 6.0);
  float seg = step(0.15, f.x) * step(f.x, 0.85) * step(0.1, f.y) * step(f.y, 0.9);
  float pattern = step(0.45, hash21(floor(f * vec2(3.0, 5.0)) + cell * 1.7 + floor(uT * 5.0 + hash11(cell.y) * 9.0)));
  float v = seg * pattern * trail;
  float headGlow = exp(-d * 90.0) * seg * pattern;
  vec3 c = uColA * v * 1.4 + vec3(0.85, 1.0, 0.9) * headGlow * 1.6;
  c += uColA * 0.05 * lum(albedo(uv)) + uColA * edgeZone(uv) * 0.3 * uParamB;
  return c * sstep(0.0, 0.08, uP);
}`,
  },
  {
    id: 'onde', name: 'Onde de choc', category: 'Graphique', mood: 'moyen', defaultDuration: 10,
    description: 'Des ondes circulaires se propagent et font vibrer la pierre, plus fort sur les temps.',
    tags: ['national', 'mariage', 'halloween'],
    params: [I(), S(), CA('#5ec8ff', 'Couleur 1'), CB('#ff5ec4', 'Couleur 2'), R('center', 'Hauteur du centre', 'uParamA', 0.4), R('beat', 'Ondes sur le rythme', 'uParamB', 0.7)],
    glsl: `
vec3 effect(vec2 uv) {
  vec2 ctr = vec2(0.5, 0.2 + uParamA * 0.6);
  vec2 d = asp(uv) - asp(ctr);
  float r = length(d);
  float t = uT * uSpeed;
  float wave = 0.0;
  vec2 disp = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = fract(t * 0.35 + float(i) * 0.25);
    float R = ph * 1.6;
    float w = exp(-pow((r - R) * 14.0, 2.0)) * (1.0 - ph);
    wave += w;
    disp += normalize(d + 1e-5) * w * 0.012;
  }
  wave += uBeat * exp(-pow((r - uBeatPhase * 1.2) * 12.0, 2.0)) * uParamB;
  vec2 su = uv - disp / vec2(uAspect, 1.0);
  vec3 base = albedo(su) * (0.35 + 0.5 * diffuseAt(su, normalize(vec3(-0.3, 0.6, 0.8))));
  return base * 0.55 + mix(uColA, uColB, 0.5 + 0.5 * sin(r * 10.0 - t)) * min(wave, 1.5) * 1.1;
}`,
  },
  {
    id: 'lasers', name: 'Show laser', category: 'Graphique', mood: 'fort', defaultDuration: 10,
    description: 'Des faisceaux laser partent du sol et balaient la façade au rythme de la musique.',
    tags: ['national', 'mariage', 'halloween'],
    params: [I(), S(), CA('#00ffcc', 'Laser 1'), CB('#ff2bd6', 'Laser 2'), R('count', 'Nombre de lasers', 'uParamA', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  vec3 c = vec3(0.0);
  vec2 p = asp(uv);
  int N = 3 + int(uParamA * 5.0);
  for (int i = 0; i < 8; i++) {
    if (i >= N) break;
    float fi = float(i);
    vec2 o = vec2((fi + 0.5) / float(N) * uAspect, -0.05);
    float ang = PI * 0.5 + sin(uT * uSpeed * (0.6 + fi * 0.13) + fi * 1.7) * 0.9;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 rel = p - o;
    float along = dot(rel, dir);
    float perp = abs(rel.x * dir.y - rel.y * dir.x);
    float beam = step(0.0, along) * (exp(-perp * 400.0) * 1.5 + exp(-perp * 60.0) * 0.25);
    c += (mod(fi, 2.0) < 1.0 ? uColA : uColB) * beam * (0.6 + 0.6 * uBeat);
  }
  c += (uColA + uColB) * 0.05 * edgeZone(uv);
  return c * sstep(0.0, 0.05, uP);
}`,
  },
  {
    id: 'pixels', name: 'Pixellisation', category: 'Graphique', mood: 'moyen', defaultDuration: 10,
    description: 'Le monument se décompose en gros pixels colorés qui clignotent, puis se recompose.',
    tags: ['national', 'mariage'],
    params: [I(), CA('#ffcc00', 'Couleur 1'), CB('#00a8ff', 'Couleur 2'), R('size', 'Taille des pixels', 'uParamA', 0.5), R('color', 'Couleurs', 'uParamB', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float k = 0.5 - 0.5 * cos(uP * TAU);
  float n = mix(220.0, 8.0 + (1.0 - uParamA) * 22.0, k);
  vec2 g = vec2(n * uAspect, n);
  vec2 cell = floor(uv * g);
  vec2 cuv = (cell + 0.5) / g;
  vec3 a = albedo(cuv);
  vec3 col = mix(a * 1.5, mix(uColA, uColB, hash21(cell + floor(uBeatIndex))) * (0.4 + lum(a)), k * uParamB);
  vec2 f = fract(uv * g);
  float grid = mix(1.0, sstep(0.0, 0.07, f.x) * sstep(0.0, 0.07, f.y), k);
  return col * grid * (1.0 + uBeat * 0.3 * k);
}`,
  },
  {
    id: 'drapeau', name: 'Drapeau', category: 'Graphique', mood: 'moyen', defaultDuration: 10,
    description: 'Un drapeau flotte sur toute la façade, sculpté par le relief de la pierre.',
    tags: ['national'],
    params: [I(), S(), CA('#1f3fd6', 'Bande 1'), CB('#e8262f', 'Bande 3'), SEL('dir', 'Bandes', 'uParamC', ['Verticales', 'Horizontales'], 0)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  vec2 q = uv;
  q.x += sin(uv.y * 5.0 + t * 2.5) * 0.015;
  q.y += sin(uv.x * 7.0 + t * 3.0) * 0.012;
  float x = uParamC < 0.5 ? q.x : 1.0 - q.y;
  vec3 col = x < 1.0 / 3.0 ? uColA : x < 2.0 / 3.0 ? vec3(1.0) : uColB;
  float shade = 0.7 + 0.3 * sin(uv.x * 9.0 - t * 2.5 + uv.y * 4.0);
  float reveal = sstep(uv.x - 0.05, uv.x + 0.05, uP * 3.0);
  return col * shade * (0.45 + 0.75 * lum(albedo(uv))) * reveal;
}`,
  },
  {
    id: 'cinema', name: 'Vieux film', category: 'Illusions', mood: 'calme', defaultDuration: 10,
    description: 'La façade apparaît comme dans un film d’archive : sépia, grain, rayures et scintillement.',
    tags: ['patrimoine', 'mariage'],
    params: [I(), R('shake', 'Tremblement', 'uParamA', 0.5), R('vignette', 'Vignettage', 'uParamB', 0.6)],
    glsl: `
vec3 effect(vec2 uv) {
  float fr = floor(uT * 18.0);
  vec2 j = (vec2(hash11(fr), hash11(fr + 3.0)) - 0.5) * 0.006 * uParamA;
  float l = lum(albedo(uv + j));
  vec3 sep = vec3(l * 1.1, l * 0.95, l * 0.72);
  float flick = 0.85 + 0.15 * hash11(fr * 1.7);
  float grain = (hash21(floor(uv * uRes) + fr) - 0.5) * 0.22;
  float sx = hash11(fr * 0.37);
  float scratch = step(0.6, hash11(fr * 5.1)) * sstep(0.002, 0.0, abs(uv.x - sx));
  vec2 d = uv - 0.5;
  float vig = max(0.0, 1.0 - dot(d, d) * 2.2 * uParamB);
  return (sep * 1.5 * flick + grain) * vig + vec3(0.9) * scratch * 0.6;
}`,
  },
  {
    id: 'etoiles', name: 'Constellations', category: 'Illusions', mood: 'calme', defaultDuration: 14,
    description: 'La façade devient un ciel étoilé : les étoiles s’allument et se relient en constellations.',
    tags: ['noel', 'mariage', 'saisons'],
    params: [I(), S(), CA('#9fd0ff', 'Liens'), CB('#2a1f6b', 'Nébuleuse'), R('density', 'Densité', 'uParamA', 0.5)],
    glsl: `
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
vec2 starPos(vec2 cell) { return cell + 0.2 + 0.6 * hash22(cell + uSeed); }
vec3 effect(vec2 uv) {
  float sc = 5.0 + uParamA * 9.0;
  vec2 p = asp(uv) * sc;
  vec2 cell = floor(p);
  float glow = 0.0, lines = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = cell + vec2(i, j);
    vec2 s = starPos(cc);
    float appear = sstep(hash21(cc) * 0.6, hash21(cc) * 0.6 + 0.05, uP * uSpeed);
    float tw = 0.6 + 0.4 * sin(uT * 3.0 + hash21(cc) * 30.0) + uBeat * 0.3;
    glow += exp(-length(p - s) * 22.0) * tw * appear * 1.5;
    vec2 s2 = starPos(cc + vec2(1.0, 0.0));
    vec2 s3 = starPos(cc + vec2(0.0, 1.0));
    float link = sstep(0.3 + hash21(cc + 5.0) * 0.6, 0.4 + hash21(cc + 5.0) * 0.6, uP * uSpeed);
    if (hash21(cc + 2.0) > 0.45) lines += sstep(0.03, 0.0, segd(p, s, s2)) * link;
    if (hash21(cc + 4.0) > 0.55) lines += sstep(0.03, 0.0, segd(p, s, s3)) * link;
  }
  float neb = fbm(asp(uv) * 2.5 + uT * 0.02);
  return uColB * neb * 0.6 + vec3(1.0, 0.97, 0.9) * glow + uColA * lines * 0.8 + uColB * lum(albedo(uv)) * 0.25;
}`,
  },
  {
    id: 'egaliseur', name: 'Égaliseur', category: 'Graphique', mood: 'fort', defaultDuration: 12,
    description: 'La façade devient un égaliseur géant : barres, calques ou anneaux qui dansent sur les basses, médiums et aigus.',
    tags: ['national', 'mariage', 'halloween'],
    params: [I(), CA('#2bd9ff', 'Couleur basse'), CB('#ff2bd6', 'Couleur haute'), SEL('mode', 'Forme', 'uParamC', ['Barres verticales', 'Calques par bande', 'Anneaux'], 0), R('height', 'Amplitude', 'uParamA', 0.8), R('stone', 'Mélange avec la pierre', 'uParamB', 0.5)],
    glsl: `
vec3 effect(vec2 uv) {
  vec3 c = vec3(0.0);
  float stone = mix(1.0, 0.4 + 1.2 * lum(albedo(uv)), uParamB);
  int mode = int(uParamC + 0.5);
  if (mode == 0) {
    float x = uv.x * 16.0;
    int b = int(clamp(floor(x), 0.0, 15.0));
    float fx = fract(x);
    float v = uSpec[b] * (0.3 + uParamA);
    float seg = step(0.12, fx) * step(fx, 0.88) * step(0.25, fract(uv.y * 24.0));
    float lit = step(uv.y, v);
    float peak = sstep(0.025, 0.0, abs(uv.y - v)) * step(0.12, fx) * step(fx, 0.88);
    c = mix(uColA, uColB, uv.y) * (lit * seg * 1.3 + peak * 2.0);
  } else if (mode == 1) {
    int id = zoneId(uv);
    int ty = zoneTypeAt(uv);
    float v = uBass;
    vec3 col = uColA;
    if (isOpening(ty) || ty == T_HORLOGE) { v = uHigh; col = uColB; }
    else if (ty == T_COLONNE || ty == T_TOUR || ty == T_STATUE) { v = uMid; col = mix(uColA, uColB, 0.5); }
    if (id == 0) { v = uBass * 0.35; }
    c = col * pow(v, 1.5) * 1.6 * (0.6 + uParamA * 0.6) + mix(uColA, uColB, uv.x) * edgeZone(uv) * uMid;
  } else {
    vec2 d = asp(uv) - asp(vec2(0.5, 0.45));
    float r = length(d) * 1.4;
    int b = int(clamp(floor(r * 16.0), 0.0, 15.0));
    float ring = sstep(0.5, 0.15, abs(fract(r * 16.0) - 0.5));
    c = mix(uColA, uColB, r) * uSpec[b] * ring * (0.6 + uParamA) * 1.4;
  }
  return c * stone;
}`,
  },
  {
    id: 'etincelles', name: 'Étincelles d’architecture', category: 'Architecture', mood: 'moyen', defaultDuration: 12,
    description: 'Des comètes de lumière courent le long des contours de chaque élément et des étincelles ruissellent des corniches.',
    tags: ['noel', 'national', 'mariage', 'patrimoine'],
    params: [I(), S(), CA('#ffd36b', 'Comètes'), CB('#ff7a2b', 'Étincelles'), R('comets', 'Nombre de comètes', 'uParamA', 0.5), R('sparks', 'Étincelles', 'uParamB', 0.6), R('stone', 'Contours de la pierre', 'uParamC', 0.3)],
    glsl: `
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  float ez = edgeZone(uv);
  vec3 c = uColA * glowLines(uv) * 0.08;
  int id = zoneId(uv);
  float gl = glowLines(uv);
  for (int r = 1; r <= 3 && id == 0; r++) {
    vec2 px = float(r * 3) / uZoneRes;
    for (int k = 0; k < 8 && id == 0; k++) {
      float a = float(k) * PI / 4.0;
      id = zoneId(uv + vec2(cos(a), sin(a)) * px);
    }
  }
  if (id > 0) {
    vec4 g = zoneGeom(id);
    vec4 m = zoneMeta(id);
    vec2 d = asp(uv) - asp(g.xy);
    float ang = (atan(d.y, d.x) + PI) / TAU;
    float heads = 0.0;
    int N = 1 + int(uParamA * 3.0);
    for (int k = 0; k < 4; k++) {
      if (k >= N) break;
      float hp = fract(t * 0.22 * (0.7 + m.x) + m.x * 3.0 + float(k) / float(N));
      float dd = fract(hp - ang + 1.0);
      heads += exp(-dd * 18.0) + exp(-dd * 120.0) * 2.0;
    }
    c += uColA * (ez * 2.2 + gl * 1.4) * heads + uColA * ez * 0.25;
  }
  // contours de la pierre parcourus par une lueur
  float wave = pow(0.5 + 0.5 * sin(uv.y * 9.0 - t * 2.0 + fbm(asp(uv) * 3.0) * 4.0), 8.0);
  c += uColA * edgeImg(uv) * uParamC * wave * 0.9;
  // étincelles qui tombent sous les lignes
  float above = 0.0;
  for (int k = 1; k <= 6; k++) above = max(above, edgeZone(uv + vec2(0.0, float(k) * 0.018)) * (1.0 - float(k) / 7.0));
  vec2 q = vec2(uv.x * uAspect * 70.0, uv.y * 9.0 + t * (1.6 + uBeat * 0.6));
  vec2 cell = floor(q);
  vec2 f = fract(q) - vec2(0.5, 0.5) - (hash22(cell) - 0.5) * vec2(0.6, 0.8);
  float on = step(1.0 - uParamB * 0.7, hash21(cell + 3.1));
  float spark = on * exp(-length(f * vec2(2.2, 0.9)) * 6.0) * 5.0;
  c += uColB * spark * sat(above * 2.0) * (0.7 + 0.3 * sin(t * 20.0 + cell.x));
  return c * sstep(0.0, 0.06, uP);
}`,
  },
  {
    id: 'objets3d', name: 'Objets 3D', category: 'Illusions', mood: 'moyen', defaultDuration: 14,
    description: 'Des objets en 3D flottent devant la façade et projettent leurs ombres sur la pierre : sphères, cubes, anneaux ou boule à facettes.',
    tags: ['national', 'mariage', 'noel', 'halloween'],
    params: [I(), S(), CA('#ffcf5c', 'Couleur 1'), CB('#3d7fff', 'Couleur 2'),
      SEL('shape', 'Objets', 'uParamC', ['Sphères flottantes', 'Cubes en orbite', 'Anneaux', 'Boule à facettes'], 0),
      R('count', 'Nombre', 'uParamA', 0.5), R('wall', 'Lumière sur la façade', 'uParamB', 0.6), R('size', 'Taille', 'uParamD', 0.5)],
    glsl: `
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
mat3 rotXY(float a, float b) {
  float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  return mat3(cb, 0.0, -sb, 0.0, 1.0, 0.0, sb, 0.0, cb) * mat3(1.0, 0.0, 0.0, 0.0, ca, sa, 0.0, -sa, ca);
}
int NOBJ() { int sh = int(uParamC + 0.5); return sh == 3 ? 1 : 2 + int(uParamA * 5.0); }
vec3 objPos(int i, float t) {
  float fi = float(i);
  int sh = int(uParamC + 0.5);
  if (sh == 3) return vec3(uAspect * 0.5, 0.62 + 0.03 * sin(t), 0.35);
  float n = float(NOBJ());
  if (sh == 1) {
    float a = t * 0.5 + fi / n * TAU;
    return vec3(uAspect * 0.5 + cos(a) * uAspect * 0.3, 0.5 + sin(a * 2.0) * 0.12, 0.25 + 0.12 * sin(a));
  }
  return vec3((0.15 + 0.7 * hash11(fi * 3.7)) * uAspect + sin(t * 0.4 + fi) * 0.06, 0.25 + 0.55 * hash11(fi * 9.1) + sin(t * (0.6 + 0.2 * fi) + fi * 2.0) * 0.08, 0.18 + 0.2 * hash11(fi * 5.3));
}
float objSize() { return (0.05 + uParamD * 0.12) * (int(uParamC + 0.5) == 3 ? 1.8 : 1.0); }
// distance à la scène, id de l'objet le plus proche
vec2 mapScene(vec3 p, float t) {
  vec2 r = vec2(1e5, -1.0);
  int sh = int(uParamC + 0.5);
  float s = objSize();
  for (int i = 0; i < 7; i++) {
    if (i >= NOBJ()) break;
    vec3 q = p - objPos(i, t);
    float d;
    if (sh == 0 || sh == 3) d = length(q) - s;
    else if (sh == 1) d = sdBox(rotXY(t * 0.7 + float(i), t * 0.9 + float(i) * 2.0) * q, vec3(s * 0.75)) - s * 0.08;
    else d = sdTorus(rotXY(t * 0.6 + float(i), t * 0.4 + float(i)) * q, vec2(s, s * 0.28));
    if (d < r.x) r = vec2(d, float(i));
  }
  return r;
}
vec3 nrm(vec3 p, float t) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(mapScene(p + e.xyy, t).x - mapScene(p - e.xyy, t).x, mapScene(p + e.yxy, t).x - mapScene(p - e.yxy, t).x, mapScene(p + e.yyx, t).x - mapScene(p - e.yyx, t).x));
}
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  int sh = int(uParamC + 0.5);
  vec3 cam = vec3(uAspect * 0.5, 0.5, 2.2);
  vec3 wallP = vec3(uv.x * uAspect, uv.y, depthAt(uv) * uRelief * 0.06);
  vec3 rd = normalize(wallP - cam);
  vec3 L = normalize(vec3(-0.5, 0.7, 0.9));
  // marche vers le mur à travers les objets
  float tr = 0.0, tMax = length(wallP - cam);
  float hit = -1.0;
  for (int k = 0; k < 64; k++) {
    vec3 p = cam + rd * tr;
    vec2 d = mapScene(p, t);
    if (d.x < 0.001) { hit = d.y; break; }
    tr += d.x;
    if (tr > tMax) break;
  }
  float appear = sstep(0.0, 0.1, uP) * (1.0 - sstep(0.92, 1.0, uP));
  if (hit >= 0.0 && appear > 0.01) {
    vec3 p = cam + rd * tr;
    vec3 n = nrm(p, t);
    vec3 col = mod(hit, 2.0) < 1.0 ? uColA : uColB;
    float dif = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 40.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    if (sh == 3) {
      // facettes miroir
      vec3 fn = normalize(floor(n * 9.0 + 0.5));
      float f = pow(max(dot(reflect(-L, fn), -rd), 0.0), 8.0);
      col = mix(vec3(0.55), vec3(1.0), hash21(floor((n.xy + 1.0) * 18.0))) * (0.3 + 1.2 * f) + uColA * f;
      return col * appear * 1.3;
    }
    return (col * (0.18 + 0.95 * dif) + vec3(1.0) * spec * 1.2 + col * rim * 0.5) * appear;
  }
  // mur : éclairage + ombres douces des objets
  float shd = 1.0, st = 0.01;
  for (int k = 0; k < 40; k++) {
    float d = mapScene(wallP + L * st, t).x;
    shd = min(shd, 10.0 * d / st);
    st += clamp(d, 0.004, 0.08);
    if (shd < 0.01 || st > 1.5) break;
  }
  shd = mix(1.0, sat(shd), appear);
  vec3 c = vec3(1.0, 0.97, 0.92) * uParamB * (0.45 + 0.55 * diffuseAt(uv, L)) * shd;
  // reflets colorés des objets sur la pierre
  for (int i = 0; i < 7; i++) {
    if (i >= NOBJ()) break;
    vec3 o = objPos(i, t);
    float dd = length(wallP - o);
    c += (mod(float(i), 2.0) < 1.0 ? uColA : uColB) * 0.05 / (dd * dd * 18.0 + 0.2) * appear;
  }
  if (sh == 3) {
    // taches de lumière renvoyées par la boule
    vec3 o = objPos(0, t);
    vec3 dir = normalize(wallP - o);
    float a = atan(dir.y, dir.x) + t * 0.35;
    vec2 g = vec2(a * 7.0, acos(clamp(dir.z, -1.0, 1.0)) * 14.0);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float spot = step(0.55, hash21(cell)) * exp(-dot(f, f) * 30.0);
    c = c * 0.5 + mix(uColA, vec3(1.0), hash21(cell + 2.0)) * spot * 1.6 * appear * (0.8 + uBeat * 0.4);
  }
  return c;
}`,
  },
  {
    id: 'calqueanime', name: 'Calques animés', category: 'Architecture', mood: 'moyen', defaultDuration: 10,
    description: 'Les éléments s’animent un à un : portes qui s’ouvrent, remplissage, éclosion, rideau, fissure qui progresse, battement.',
    tags: ['patrimoine', 'halloween', 'noel', 'mariage'],
    params: [I(), CA('#ffe2a8', 'Lumière'), CB('#ff9a3c', 'Intérieur / fissure'),
      SEL('mode', 'Animation', 'uParamC', ['Portes qui s’ouvrent', 'Remplissage de bas en haut', 'Éclosion depuis le centre', 'Rideau latéral', 'Fissure qui progresse', 'Battement'], 0),
      R('cascade', 'Décalage entre éléments', 'uParamA', 0.5), R('bg', 'Lumière sur les murs', 'uParamB', 0.25)],
    glsl: `
vec3 effect(vec2 uv) {
  int mode = int(uParamC + 0.5);
  vec3 L = normalize(vec3(-0.4, 0.6, 0.8));
  vec3 wall = vec3(1.0, 0.97, 0.92) * uParamB * (0.5 + 0.5 * diffuseAt(uv, L));
  if (mode == 4) {
    // fissure qui part du pied de la façade et grimpe en se ramifiant
    vec3 v = voronoi(asp(uv) * 7.0);
    vec3 v2 = voronoi(asp(uv) * 19.0 + 3.0);
    float d = length(asp(uv) - asp(vec2(0.5, 0.0))) / max(uAspect, 1.0) + fbm(asp(uv) * 3.0) * 0.25;
    float front = uP * 1.5;
    float grown = sstep(d, d - 0.04, front);
    float crack = (sstep(0.03, 0.0, v.y) + sstep(0.02, 0.0, v2.y) * 0.6 * step(0.5, v2.z)) * grown;
    float tip = sstep(0.05, 0.0, abs(front - d)) * sstep(0.03, 0.0, v.y);
    return wall * (1.0 - crack * 0.9) + uColB * crack * 2.2 + vec3(1.0, 0.95, 0.8) * tip * 3.0;
  }
  int id = zoneId(uv);
  if (id == 0) return wall;
  int ty = zoneTypeAt(uv);
  // les portes ne concernent que les ouvertures ; les autres animations, tous les éléments sauf les grands volumes
  if (mode == 0 && ty != T_PORTE && ty != T_FENETRE) return wall;
  if (ty == T_TOUR || ty == T_MUR) return wall;
  vec4 g = zoneGeom(id);
  vec4 m = zoneMeta(id);
  vec2 q = (uv - (g.xy - g.zw * 0.5)) / max(g.zw, vec2(1e-4));
  float span = 1.0 + uParamA * 0.9;
  float p = sat((uP * span - m.y * uParamA * 0.9) / 0.6);
  p = p * p * (3.0 - 2.0 * p);
  vec3 a = albedo(uv);
  if (mode == 0) {
    float gap = p * 0.5;
    float x = abs(q.x - 0.5);
    if (x < gap) {
      float glow = 1.0 - x / max(gap, 1e-3) * 0.5;
      return uColB * (1.2 + 0.5 * glow) * (0.7 + 0.3 * q.y) + vec3(1.0, 0.9, 0.7) * sstep(0.02, 0.0, gap - x) * 2.0;
    }
    // vantail écrasé vers la charnière (perspective)
    float side = q.x < 0.5 ? 0.0 : 1.0;
    float lx = side < 0.5 ? q.x / max(0.5 - gap, 1e-3) * 0.5 : 0.5 + (q.x - 0.5 - gap) / max(0.5 - gap, 1e-3) * 0.5;
    vec2 src = (g.xy - g.zw * 0.5) + vec2(lx, q.y) * g.zw;
    return albedo(src) * uColA * 1.5 * (1.0 - p * 0.55);
  }
  if (mode == 1) {
    float edge = p + 0.03 * sin(q.x * 20.0 + uT * 4.0) * (1.0 - p);
    float lit = step(q.y, edge);
    return wall + uColA * a * 1.8 * lit + uColB * sstep(0.04, 0.0, abs(q.y - edge)) * 2.0 * step(0.01, p) * step(p, 0.99);
  }
  if (mode == 2) {
    vec2 d = (q - 0.5) * vec2(g.z * uAspect / max(g.w, 1e-4), 1.0);
    float r = length(d) / max(0.5 * max(g.z * uAspect / max(g.w, 1e-4), 1.0), 1e-3);
    float lit = sstep(p * 1.3, p * 1.3 - 0.06, r);
    return wall + uColA * a * 1.8 * lit + uColB * sstep(0.06, 0.0, abs(r - p * 1.3)) * 1.8 * step(p, 0.99);
  }
  if (mode == 3) {
    float lit = step(q.x, p);
    return wall + uColA * a * 1.8 * lit + uColB * sstep(0.03, 0.0, abs(q.x - p)) * 2.0 * step(p, 0.99);
  }
  // battement : l'élément « respire » sur le rythme
  float k = 1.0 + 0.12 * uBeat + 0.05 * sin(uT * 3.0 + m.x * 6.0);
  vec2 qq = (q - 0.5) * k + 0.5;
  float inside = step(0.0, qq.x) * step(qq.x, 1.0) * step(0.0, qq.y) * step(qq.y, 1.0);
  return wall + uColA * a * (1.0 + uBeat) * 1.4 * inside * sstep(0.0, 0.1, uP) + uColB * edgeZone(uv) * uBeat * 2.0;
}`,
  },
  {
    id: 'personnages', name: 'Personnages', category: 'Illusions', mood: 'calme', defaultDuration: 14,
    description: 'Des oiseaux s’envolent des corniches, des fantômes traversent les fenêtres, des lucioles dansent, des silhouettes se promènent.',
    tags: ['halloween', 'saisons', 'noel', 'patrimoine'],
    params: [I(), S(), CA('#dfeaff', 'Personnages'), CB('#ffb36b', 'Fond lumineux'),
      SEL('kind', 'Personnages', 'uParamC', ['Envol d’oiseaux', 'Fantômes', 'Lucioles', 'Promeneurs'], 0),
      R('count', 'Nombre', 'uParamA', 0.5), R('bg', 'Lumière de fond', 'uParamB', 0.55)],
    glsl: `
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float walker(vec2 p, float ph) {
  float d = length(p - vec2(0.0, 0.62)) - 0.09;
  d = min(d, seg(p, vec2(0.0, 0.52), vec2(0.0, 0.22)) - 0.06);
  float sw = sin(ph) * 0.12;
  d = min(d, seg(p, vec2(0.0, 0.22), vec2(sw, 0.0)) - 0.035);
  d = min(d, seg(p, vec2(0.0, 0.22), vec2(-sw, 0.0)) - 0.035);
  d = min(d, seg(p, vec2(0.0, 0.48), vec2(-sw * 0.8, 0.3)) - 0.03);
  d = min(d, seg(p, vec2(0.0, 0.48), vec2(sw * 0.8, 0.3)) - 0.03);
  return d;
}
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  int kind = int(uParamC + 0.5);
  vec2 p = asp(uv);
  vec3 L = normalize(vec3(-0.4, 0.6, 0.8));
  vec3 bg = uColB * uParamB * (0.45 + 0.55 * diffuseAt(uv, L));
  int N = 3 + int(uParamA * 12.0);
  if (kind == 0) {
    // oiseaux en ombres chinoises sur un ciel de coucher de soleil
    float sh = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= N) break;
      float fi = float(i);
      float t0 = hash11(fi * 3.1) * 0.45 * uDur;
      float lt = max(0.0, t - t0);
      vec2 start = vec2((0.1 + 0.8 * hash11(fi * 7.7)) * uAspect, 0.35 + 0.45 * hash11(fi * 1.9));
      float dir = hash11(fi * 5.3) < 0.5 ? -1.0 : 1.0;
      vec2 pos = start + vec2(dir * lt * 0.12, lt * 0.06 + lt * lt * 0.012);
      float s = 0.032 + 0.02 * hash11(fi);
      vec2 q = (p - pos) / s;
      q.x *= dir;
      float flap = sin(lt * 14.0 + fi) * 0.6;
      float d = min(seg(q, vec2(0.0), vec2(-1.0, 0.4 + flap)), seg(q, vec2(0.0), vec2(1.0, 0.4 + flap)));
      d = min(d, length(q * vec2(1.0, 1.6)) - 0.25);
      sh = max(sh, sstep(0.14, 0.04, d) * step(0.001, lt + 0.5));
    }
    return bg * (1.0 - sh * 0.95);
  }
  if (kind == 1) {
    vec3 c = bg * 0.35;
    for (int i = 0; i < 12; i++) {
      if (i >= max(2, N / 2)) break;
      float fi = float(i);
      float sp = 0.05 + 0.04 * hash11(fi);
      float x = mod(hash11(fi * 2.3) * uAspect * 1.6 + t * sp, uAspect * 1.4) - uAspect * 0.2;
      vec2 pos = vec2(x, 0.25 + 0.55 * hash11(fi * 4.1) + 0.04 * sin(t * 1.3 + fi));
      vec2 q = (p - pos) / 0.06;
      float body = length(q * vec2(1.0, 0.75) - vec2(0.0, 0.25)) - 0.55;
      float skirt = max(abs(q.x) - 0.55 - 0.08 * sin(q.y * 6.0), -q.y - 0.4 - 0.12 * sin(q.x * 9.0 + t * 6.0));
      skirt = max(skirt, q.y - 0.3);
      float d = min(body, skirt);
      float eyes = min(length(q - vec2(-0.2, 0.35)), length(q - vec2(0.2, 0.35))) - 0.09;
      vec2 zuv = uv;
      float vis = isOpening(zoneTypeAt(zuv)) ? 1.0 : 0.35;
      float g = sstep(0.05, -0.05, d) * (1.0 - sstep(0.03, -0.03, eyes)) + exp(-max(d, 0.0) * 4.0) * 0.3;
      c += uColA * g * vis * (0.8 + 0.2 * sin(t * 3.0 + fi));
    }
    return c;
  }
  if (kind == 2) {
    vec3 c = bg * 0.3;
    for (int i = 0; i < 40; i++) {
      if (i >= N * 3) break;
      float fi = float(i);
      vec2 pos = vec2((0.05 + 0.9 * hash11(fi * 1.7)) * uAspect, 0.05 + 0.9 * hash11(fi * 2.9));
      pos += vec2(sin(t * 0.4 + fi * 2.0), cos(t * 0.33 + fi)) * 0.05 + vec2(fbm(vec2(t * 0.2, fi)) - 0.5, fbm(vec2(fi, t * 0.2)) - 0.5) * 0.08;
      float blink = pow(0.5 + 0.5 * sin(t * (1.5 + hash11(fi)) + fi * 4.0), 3.0);
      float d = length(p - pos);
      c += uColA * blink * (0.0009 / (d * d + 0.00025)) * 0.4;
    }
    return c;
  }
  // promeneurs : silhouettes sur le parvis et sur un bandeau
  float sh = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= max(2, N / 2)) break;
    float fi = float(i);
    float dir = hash11(fi * 3.3) < 0.5 ? -1.0 : 1.0;
    float sp = 0.06 + 0.04 * hash11(fi * 1.1);
    float x = mod(hash11(fi * 8.1) * uAspect * 1.5 + t * sp * dir, uAspect * 1.4) - uAspect * 0.2;
    float y = hash11(fi * 4.4) < 0.6 ? 0.02 : 0.5;
    float s = y < 0.1 ? 0.24 : 0.15;
    vec2 q = (p - vec2(x, y)) / s;
    q.x *= dir;
    sh = max(sh, sstep(0.03, -0.01, walker(q, t * 5.0 * sp / 0.08 + fi)));
  }
  return bg * (1.0 - sh * 0.95) + uColA * 0.05;
}`,
  },
  // ─────────────────────────── CONSOLE LUMIÈRE ───────────────────────────
  {
    id: 'poursuite', name: 'Poursuite (chase)', category: 'Console lumière', mood: 'fort', defaultDuration: 12,
    description: 'Les éléments s’allument l’un après l’autre sur le tempo, comme une poursuite de console lumière, avec traîne.',
    tags: ['national', 'mariage', 'halloween', 'musique'],
    params: [I(), CA('#ffffff', 'Couleur 1'), CB('#ffb300', 'Couleur 2'),
      SEL('dir', 'Sens', 'uParamC', ['Gauche → droite', 'Droite → gauche', 'Aller-retour', 'Du centre vers les bords', 'Aléatoire'], 0),
      SEL('rate', 'Vitesse', 'uParamD', ['1 pas par temps', '2 pas par temps', '1 pas par mesure', '4 pas par temps'], 0),
      R('group', 'Éléments allumés ensemble', 'uParamA', 0.15), R('trail', 'Traîne', 'uParamB', 0.5), R('base', 'Lumière de fond', 'uParamE', 0.05)],
    glsl: HELPERS + `
vec3 effect(vec2 uv) {
  float n;
  float r = unitRank(uv, n);
  int dir = int(uParamC + 0.5);
  float s = stepClock(rateOf(uParamD));
  float N = max(2.0, n);
  float i = floor(r * (N - 1.0) + 0.5);
  if (dir == 1) i = N - 1.0 - i;
  if (dir == 3) i = floor(abs(unitX(uv) - 0.5) * 2.0 * (N * 0.5) + 0.5);
  float steps = dir == 3 ? floor(N * 0.5) + 1.0 : N;
  float k = floor(s);
  float head = mod(k, steps);
  if (dir == 2) { float pp = mod(k, max(1.0, 2.0 * steps - 2.0)); head = pp < steps ? pp : 2.0 * steps - 2.0 - pp; }
  float group = 1.0 + floor(uParamA * 4.0);
  float lit;
  if (dir == 4) lit = step(1.0 - group / N - 0.05, hash11(k * 7.31 + i * 1.7));
  else {
    float d = dir == 2 ? abs(head - i) : mod(head - i + steps * 4.0, steps);
    float fr = fract(s);
    lit = d < group ? 1.0 : uParamB * exp(-(d - group + fr) * (3.5 - uParamB * 2.5));
  }
  vec3 col = mod(k, 2.0) < 1.0 ? uColA : uColB;
  return col * stoneLit(uv) * (uParamE + lit * 1.3);
}`,
  },
  {
    id: 'strobe', name: 'Stroboscope', category: 'Console lumière', mood: 'fort', defaultDuration: 6,
    description: 'Flashs secs sur le tempo ou sur les basses. Attention aux personnes photosensibles : à utiliser avec modération.',
    tags: ['halloween', 'musique', 'national'],
    params: [I(), CA('#ffffff', 'Couleur'), SEL('rate', 'Cadence', 'uParamC', ['1 flash par temps', '2 par temps', '1 par mesure', 'Sur les basses'], 0), R('duty', 'Durée du flash', 'uParamA', 0.25), R('base', 'Lumière de fond', 'uParamB', 0.0)],
    glsl: HELPERS + `
vec3 effect(vec2 uv) {
  float f;
  int m = int(uParamC + 0.5);
  if (m == 3) f = step(0.62, uBass) * uBass;
  else {
    float s = stepClock(m == 0 ? 1.0 : m == 1 ? 2.0 : 0.25);
    f = step(fract(s), 0.05 + uParamA * 0.4);
  }
  return uColA * stoneLit(uv) * (uParamB + f * 1.6);
}`,
  },
  {
    id: 'alternance', name: 'Alternance', category: 'Console lumière', mood: 'moyen', defaultDuration: 10,
    description: 'Deux groupes d’éléments s’allument en alternance : un sur deux, gauche/droite ou haut/bas, en douceur ou en coupe franche.',
    tags: ['national', 'mariage', 'noel', 'musique'],
    params: [I(), CA('#ffffff', 'Groupe A'), CB('#ff3355', 'Groupe B'),
      SEL('split', 'Groupes', 'uParamC', ['Un sur deux', 'Gauche / droite', 'Haut / bas', 'Damier'], 0),
      SEL('rate', 'Bascule', 'uParamD', ['À chaque temps', 'Deux fois par temps', 'À chaque mesure', '4 fois par temps'], 0),
      R('soft', 'Douceur', 'uParamA', 0.3), R('base', 'Lumière de fond', 'uParamB', 0.05)],
    glsl: HELPERS + `
vec3 effect(vec2 uv) {
  float n;
  float r = unitRank(uv, n);
  int sp = int(uParamC + 0.5);
  float g;
  int id = zoneId(uv);
  vec2 c = id > 0 ? zoneGeom(id).xy : uv;
  if (sp == 0) g = mod(floor(r * (max(n, 2.0) - 1.0) + 0.5), 2.0);
  else if (sp == 1) g = step(0.5, c.x);
  else if (sp == 2) g = step(0.5, c.y);
  else g = mod(floor(c.x * 6.0) + floor(c.y * 4.0), 2.0);
  float s = stepClock(rateOf(uParamD));
  float ph = fract(s * 0.5) ;
  float w = uParamA * 0.45 + 0.001;
  float aOn = sstep(0.5 + w, 0.5 - w, abs(ph * 2.0 - 1.0)) ;
  float on = g < 0.5 ? aOn : 1.0 - aOn;
  vec3 col = g < 0.5 ? uColA : uColB;
  return col * stoneLit(uv) * (uParamB + on * 1.3);
}`,
  },
  {
    id: 'pulsation', name: 'Pulsation d’intensité', category: 'Console lumière', mood: 'calme', defaultDuration: 12,
    description: 'Le gradateur respire : toute la façade (ou les calques ciblés) monte et descend en intensité, sur place ou en vague.',
    tags: ['noel', 'mariage', 'patrimoine', 'musique'],
    params: [I(), CA('#ffe2b0', 'Couleur'), CB('#ff7a3c', 'Couleur creuse'),
      SEL('shape', 'Forme', 'uParamC', ['Respiration (sinus)', 'Sur chaque temps', 'Vague gauche → droite', 'Vague depuis le centre'], 0),
      SEL('rate', 'Période', 'uParamD', ['1 temps', '1/2 temps', '1 mesure', '1/4 de temps'], 2),
      R('min', 'Intensité minimale', 'uParamA', 0.1), R('max', 'Intensité maximale', 'uParamB', 1.0)],
    glsl: HELPERS + `
vec3 effect(vec2 uv) {
  int sh = int(uParamC + 0.5);
  float rate = rateOf(uParamD);
  float s = stepClock(rate);
  float v;
  if (sh == 0) v = 0.5 - 0.5 * cos(s * TAU);
  else if (sh == 1) v = exp(-fract(s) * 5.0);
  else if (sh == 2) v = 0.5 - 0.5 * cos((s - unitX(uv) * 1.5) * TAU);
  else v = 0.5 - 0.5 * cos((s - abs(unitX(uv) - 0.5) * 2.0) * TAU);
  float lvl = mix(uParamA, uParamB, v);
  return mix(uColB, uColA, v) * stoneLit(uv) * lvl * 1.3;
}`,
  },
  {
    id: 'balayage', name: 'Balayage aller-retour', category: 'Console lumière', mood: 'fort', defaultDuration: 10,
    description: 'Une barre de lumière va et vient d’un bord à l’autre de la façade, avec traîne, sur la mesure.',
    tags: ['national', 'halloween', 'musique'],
    params: [I(), CA('#ff2030', 'Barre'), CB('#3050ff', 'Traîne'), SEL('axis', 'Sens', 'uParamC', ['Horizontal', 'Vertical'], 0),
      SEL('rate', 'Vitesse', 'uParamD', ['1 passage par temps', '2 par temps', '1 par mesure', '4 par temps'], 2), R('width', 'Largeur', 'uParamA', 0.25), R('trail', 'Traîne', 'uParamB', 0.6)],
    glsl: HELPERS + `
vec3 effect(vec2 uv) {
  float s = stepClock(rateOf(uParamD));
  float tri = abs(fract(s * 0.5) * 2.0 - 1.0);
  float pos = tri;
  float x = uParamC < 0.5 ? unitX(uv) : uv.y;
  float d = abs(x - pos);
  float w = 0.02 + uParamA * 0.12;
  float bar = sstep(w, w * 0.3, d);
  float goingRight = step(0.5, fract(s * 0.5));
  float behind = uParamC < 0.5 ? (goingRight > 0.5 ? pos - x : x - pos) : (goingRight > 0.5 ? x - pos : pos - x);
  float tr = behind > 0.0 ? exp(-behind * (12.0 - uParamB * 9.0)) * uParamB : 0.0;
  return (uColA * bar * 1.6 + uColB * tr) * stoneLit(uv);
}`,
  },
  // ─────────────────────────── SAISONS ET FÊTES ───────────────────────────
  {
    id: 'traineau', name: 'Traîneau du Père Noël', category: 'Saisons et fêtes', mood: 'moyen', defaultDuration: 14,
    description: 'Le traîneau et ses rennes au galop traversent le ciel devant la lune, en laissant une traînée d’étoiles.',
    tags: ['noel'],
    params: [I(), S(), CA('#ffe7a8', 'Lune / traînée'), CB('#1d3b7a', 'Ciel'), SEL('style', 'Rendu', 'uParamE', ['Silhouette sombre devant la lune', 'Silhouette lumineuse'], 0),
      SEL('passes', 'Passages', 'uParamC', ['1 passage', '2 passages', '3 passages'], 0), R('alt', 'Hauteur de vol', 'uParamA', 0.6), R('size', 'Taille', 'uParamB', 0.5), TOG('snow', 'Neige', 'uParamD', true)],
    glsl: HELPERS + SDF + `
float deer(vec2 q, float ph) {
  float d = sdEll(q, vec2(0.15, 0.065));
  d = smin(d, sdSeg(q, vec2(0.11, 0.02), vec2(0.18, 0.11)) - 0.03, 0.02);
  d = min(d, sdEll(q - vec2(0.215, 0.115), vec2(0.055, 0.03)));
  d = min(d, sdSeg(q, vec2(0.19, 0.14), vec2(0.16, 0.24)) - 0.008);
  d = min(d, sdSeg(q, vec2(0.172, 0.2), vec2(0.21, 0.25)) - 0.007);
  d = min(d, sdSeg(q, vec2(0.165, 0.23), vec2(0.13, 0.26)) - 0.006);
  d = min(d, sdSeg(q, vec2(0.205, 0.14), vec2(0.24, 0.22)) - 0.007);
  float a = sin(ph), b = sin(ph + 1.6);
  d = min(d, sdSeg(q, vec2(0.10, -0.03), vec2(0.10 + 0.08 * a, -0.15)) - 0.013);
  d = min(d, sdSeg(q, vec2(0.07, -0.03), vec2(0.07 + 0.08 * b, -0.15)) - 0.013);
  d = min(d, sdSeg(q, vec2(-0.10, -0.03), vec2(-0.10 - 0.08 * a, -0.15)) - 0.013);
  d = min(d, sdSeg(q, vec2(-0.07, -0.03), vec2(-0.07 - 0.08 * b, -0.15)) - 0.013);
  d = min(d, sdSeg(q, vec2(-0.14, 0.02), vec2(-0.18, 0.05)) - 0.015);
  return d;
}
float sleigh(vec2 q) {
  float d = sdBox(q - vec2(0.0, 0.02), vec2(0.24, 0.07)) - 0.02;
  d = min(d, sdBox(q - vec2(-0.2, 0.1), vec2(0.06, 0.13)) - 0.02);
  d = min(d, max(length(q - vec2(0.27, 0.08)) - 0.06, -(length(q - vec2(0.29, 0.13)) - 0.035)));
  d = min(d, sdSeg(q, vec2(-0.32, -0.12), vec2(0.30, -0.12)) - 0.013);
  d = min(d, sdSeg(q, vec2(0.30, -0.12), vec2(0.38, -0.04)) - 0.013);
  d = min(d, sdSeg(q, vec2(-0.15, -0.12), vec2(-0.15, -0.04)) - 0.01);
  d = min(d, sdSeg(q, vec2(0.15, -0.12), vec2(0.15, -0.04)) - 0.01);
  d = min(d, sdEll(q - vec2(0.02, 0.14), vec2(0.09, 0.1)));
  d = min(d, length(q - vec2(0.05, 0.27)) - 0.05);
  d = min(d, sdTri(q, vec2(0.0, 0.3), vec2(0.1, 0.3), vec2(-0.06, 0.40)));
  d = min(d, length(q - vec2(-0.07, 0.40)) - 0.022);
  d = min(d, sdSeg(q, vec2(0.08, 0.17), vec2(0.17, 0.15)) - 0.02);
  d = min(d, sdEll(q - vec2(-0.15, 0.2), vec2(0.09, 0.1)));
  d = min(d, sdSeg(q, vec2(-0.15, 0.29), vec2(-0.13, 0.33)) - 0.015);
  return d;
}
vec2 flyPath(float ph, float sc) {
  return vec2(mix(-0.45 - 1.25 * sc, uAspect + 0.45, ph), uParamA * 0.6 + 0.2 + 0.16 * sin(ph * PI) - 0.08);
}
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float sc = 0.18 + uParamB * 0.5;
  float passes = uParamC + 1.0;
  float ph = fract(uP * passes);
  vec2 P = flyPath(ph, sc);
  vec2 P2 = flyPath(ph + 0.002, sc);
  float ang = atan(P2.y - P.y, P2.x - P.x);
  vec2 q = rot2(ang) * (pa - P) / sc;
  q.y -= 0.01 * sin(uT * 7.0);
  float gal = uT * uSpeed * 9.0;
  float d = sleigh(q);
  d = min(d, deer(q - vec2(0.68, 0.06), gal));
  d = min(d, deer(q - vec2(1.04, 0.09), gal + 1.3));
  d = min(d, deer(q - vec2(0.75, 0.13), gal + 0.6));
  d = min(d, deer(q - vec2(1.11, 0.16), gal + 2.0));
  d = min(d, sdSeg(q, vec2(0.17, 0.16), vec2(0.86, 0.13)) - 0.004);
  d = min(d, sdSeg(q, vec2(0.86, 0.13), vec2(1.2, 0.16)) - 0.004);
  float px = 1.5 / uRes.y / sc;
  float shape = fillD(d, px);
  float glow = exp(-max(d, 0.0) * 18.0);
  // traînée d'étoiles derrière le traîneau
  float trail = 0.0;
  for (int i = 1; i < 36; i++) {
    float fi = float(i);
    float pp = ph - fi * 0.0045;
    vec2 T = flyPath(pp, sc) + vec2(-0.32 * sc, -0.1 * sc);
    T += (hash22(vec2(fi, floor(uT * 6.0))) - 0.5) * 0.035 * (1.0 + fi * 0.05);
    trail += smoothstep(0.006 + 0.002 * hash11(fi), 0.0, length(pa - T)) * (1.0 - fi / 36.0);
  }
  vec3 bg;
  if (uParamE < 0.5) {
    bg = skyMoon(uv, pa, uColB, vec3(1.0, 0.97, 0.88), vec2(uAspect * 0.68, 0.7), 0.17);
    bg *= 1.0 - shape;
  } else {
    bg = uColB * 0.15 * (0.4 + uv.y) + uColA * (shape * 1.3 + glow * 0.35);
  }
  bg += uColA * trail * 1.4;
  if (uParamD > 0.5) {
    vec2 sp = pa * vec2(18.0, 10.0) + vec2(sin(uT * 0.7) * 2.0, uT * 1.6);
    bg += vec3(0.9) * smoothstep(0.08, 0.0, length(fract(sp) - 0.5 + (hash22(floor(sp)) - 0.5) * 0.5)) * step(0.6, hash21(floor(sp) + 9.0)) * 0.7;
  }
  bg += twinkle(pa, 40.0, 0.06) * 0.5 * step(0.55, uv.y);
  return bg * stoneLit(uv);
}`,
  },
  {
    id: 'sorciere', name: 'Sorcière sur son balai', category: 'Saisons et fêtes', mood: 'moyen', defaultDuration: 14,
    description: 'Une sorcière et son chat traversent la pleine lune sur un balai, entourées de chauves-souris.',
    tags: ['halloween'],
    params: [I(), S(), CA('#ffb347', 'Lune'), CB('#4b1d6e', 'Ciel'), SEL('style', 'Rendu', 'uParamE', ['Silhouette sombre devant la lune', 'Silhouette lumineuse'], 0),
      SEL('passes', 'Passages', 'uParamC', ['1 passage', '2 passages', '3 passages'], 0), R('alt', 'Hauteur de vol', 'uParamA', 0.6), R('size', 'Taille', 'uParamB', 0.5), R('bats', 'Chauves-souris', 'uParamD', 0.6)],
    glsl: HELPERS + SDF + `
float witch(vec2 q, float t) {
  float d = sdSeg(q, vec2(-0.42, 0.0), vec2(0.38, 0.04)) - 0.012;
  float bx = clamp((q.x + 0.64) / 0.22, 0.0, 1.0);
  float hh = mix(0.11, 0.022, bx) * (1.0 + 0.15 * sin(q.y * 90.0));
  d = min(d, max(abs(q.y + 0.004) - hh, max(-0.64 - q.x, q.x + 0.41)));
  d = min(d, sdSeg(q, vec2(-0.43, -0.025), vec2(-0.43, 0.03)) - 0.014);
  float wav = sin(t * 9.0) * 0.025;
  d = min(d, sdTri(q, vec2(-0.08, 0.02), vec2(0.09, 0.03), vec2(0.03, 0.23)));
  d = min(d, sdTri(q, vec2(-0.06, 0.02), vec2(0.03, 0.21), vec2(-0.28, 0.07 + wav)));
  d = min(d, length(q - vec2(0.05, 0.26)) - 0.045);
  d = min(d, sdTri(q, vec2(0.085, 0.275), vec2(0.085, 0.25), vec2(0.135, 0.245)));
  d = min(d, sdSeg(q, vec2(-0.04, 0.30), vec2(0.13, 0.315)) - 0.01);
  d = min(d, sdTri(q, vec2(-0.01, 0.30), vec2(0.09, 0.312), vec2(-0.08, 0.48 + wav * 0.5)));
  d = min(d, sdSeg(q, vec2(0.04, 0.17), vec2(0.15, 0.06)) - 0.014);
  d = min(d, sdSeg(q, vec2(0.03, 0.03), vec2(0.11, -0.07)) - 0.016);
  d = min(d, sdSeg(q, vec2(0.11, -0.07), vec2(0.155, -0.06)) - 0.013);
  d = min(d, sdSeg(q, vec2(0.02, 0.27), vec2(-0.07, 0.17 + wav)) - 0.012);
  vec2 c = q - vec2(-0.29, 0.055);
  d = min(d, sdEll(c, vec2(0.045, 0.032)));
  d = min(d, length(c - vec2(0.035, 0.04)) - 0.024);
  d = min(d, sdTri(c, vec2(0.016, 0.055), vec2(0.032, 0.06), vec2(0.018, 0.088)));
  d = min(d, sdTri(c, vec2(0.04, 0.062), vec2(0.056, 0.055), vec2(0.058, 0.088)));
  d = min(d, sdSeg(c, vec2(-0.04, 0.0), vec2(-0.075, 0.05 + 0.02 * sin(t * 4.0))) - 0.008);
  return d;
}
float bat(vec2 q, float t) {
  float f = sin(t * 18.0);
  float d = sdEll(q, vec2(0.03, 0.02));
  vec2 m = vec2(abs(q.x), q.y);
  d = min(d, sdTri(m, vec2(0.01, 0.01), vec2(0.1, 0.03 + f * 0.05), vec2(0.06, -0.02 + f * 0.02)));
  d = min(d, sdTri(m, vec2(0.0, 0.015), vec2(0.012, 0.045), vec2(0.02, 0.012)));
  return d;
}
vec2 witchPath(float ph, float sc) {
  return vec2(mix(-0.4 - 0.7 * sc, uAspect + 0.75 * sc + 0.4, ph), uParamA * 0.55 + 0.22 + 0.06 * sin(ph * TAU * 1.5));
}
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float sc = 0.2 + uParamB * 0.55;
  float ph = fract(uP * (uParamC + 1.0));
  vec2 P = witchPath(ph, sc), P2 = witchPath(ph + 0.002, sc);
  float ang = atan(P2.y - P.y, P2.x - P.x) * 0.6 + 0.05 * sin(uT * 2.0);
  vec2 q = rot2(ang) * (pa - P) / sc;
  float d = witch(q, uT * uSpeed);
  float px = 1.5 / uRes.y / sc;
  int NB = int(uParamD * 8.0);
  for (int i = 0; i < 8; i++) {
    if (i >= NB) break;
    float fi = float(i);
    vec2 B = vec2(uAspect * (0.15 + 0.7 * hash11(fi * 3.1)) + 0.12 * sin(uT * (0.6 + hash11(fi) * 0.8) + fi), 0.55 + 0.35 * hash11(fi * 7.7) + 0.07 * sin(uT * 1.3 + fi * 2.0));
    d = min(d, bat((pa - B) / (sc * 0.55), uT * uSpeed + fi) * sc * 0.55 / sc);
  }
  float shape = fillD(d, px);
  float glow = exp(-max(d, 0.0) * 16.0);
  vec2 mc = vec2(uAspect * 0.5, uParamA * 0.55 + 0.27);
  vec3 c;
  if (uParamE < 0.5) {
    c = skyMoon(uv, pa, uColB, uColA * 1.1, mc, 0.2 + uParamB * 0.1);
    c *= 1.0 - shape;
  } else c = uColB * 0.2 * (0.4 + uv.y) + vec3(0.6, 1.0, 0.35) * (shape * 1.3 + glow * 0.4);
  c += twinkle(pa, 34.0, 0.05) * 0.4 * uColA;
  return c * stoneLit(uv);
}`,
  },
  {
    id: 'decompte', name: 'Décompte du Nouvel An', category: 'Saisons et fêtes', mood: 'fort', defaultDuration: 22,
    description: 'Un compte à rebours géant qui pulse à chaque seconde, puis explosion de feux d’artifice et votre message de vœux à zéro.',
    tags: ['noel', 'national'],
    params: [
      { key: 'text', label: 'Message à zéro', type: 'text', slot: 'aux', default: 'Bonne année !' },
      SEL('count', 'Décompte depuis', 'uParamC', ['10', '5', '3', '30', '60'], 0),
      SEL('font', 'Police', 'aux', ['Classique (Cinzel)', 'Gothique', 'Manuscrite', 'Affiche', 'Moderne'], 3),
      I(), CA('#ffe08a', 'Chiffres'), CB('#ff3355', 'Dernières secondes'), R('y', 'Position verticale', 'uParamA', 0.5), R('size', 'Taille', 'uParamB', 0.8)],
    dynText: (p, t) => {
      const n = [10, 5, 3, 30, 60][Number(p.count ?? 0)] ?? 10;
      const r = Math.ceil(n - t - 1e-6);
      return r > 0 ? String(r) : String(p.text ?? '');
    },
    glsl: HELPERS + SDF + `
float txt(vec2 uv) { return texture(uAux, uv).r; }
vec3 effect(vec2 uv) {
  float N = int(uParamC + 0.5) == 0 ? 10.0 : int(uParamC + 0.5) == 1 ? 5.0 : int(uParamC + 0.5) == 2 ? 3.0 : int(uParamC + 0.5) == 3 ? 30.0 : 60.0;
  vec2 pa = asp(uv);
  vec2 c0 = vec2(0.5, uParamA);
  float rem = N - uT;
  vec3 col;
  if (rem > 0.0) {
    float fr = fract(uT);
    float s = 1.0 + 0.45 * exp(-fr * 7.0);
    vec2 su = c0 + (uv - c0) / s;
    float m = txt(su);
    float last = step(rem, 3.0);
    vec3 dc = mix(uColA, uColB, last);
    float flash = exp(-fr * 5.0);
    // anneau qui se vide pendant la seconde
    vec2 d = pa - asp(c0);
    float r = length(d), R0 = 0.22 + uParamB * 0.12;
    float a = fract(atan(d.x, d.y) / TAU + 1.0);
    float ring = smoothstep(0.012, 0.0, abs(r - R0)) * step(a, 1.0 - fr);
    col = dc * (m * (1.3 + flash) + ring * 1.2 + exp(-abs(r - R0) * 30.0) * 0.25 * (1.0 - fr));
    col += dc * 0.1 * flash * stoneLit(uv);
  } else {
    float lt = -rem;
    col = vec3(1.0) * exp(-lt * 3.0) * 1.5;
    col += mix(uColA, vec3(1.0), 0.3) * txt(uv) * (1.0 + 0.3 * sin(uT * 6.0)) * smoothstep(0.0, 0.6, lt);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float P = 2.2;
      float tt = lt + fi * P / 6.0;
      float cyc = floor(tt / P), l2 = mod(tt, P);
      vec2 cp = asp(vec2(0.1 + hash21(vec2(cyc, fi)) * 0.8, 0.5 + hash21(vec2(fi, cyc + 3.0)) * 0.45));
      vec3 fc = hsv(hash21(vec2(cyc * 1.3, fi * 2.1)), 0.85, 1.0);
      float rad = l2 * 0.16 * (1.0 - l2 * 0.12);
      for (int k = 0; k < 16; k++) {
        float fk = float(k);
        float an = fk / 16.0 * TAU + hash11(cyc + fi);
        vec2 pp = cp + vec2(cos(an), sin(an)) * rad - vec2(0.0, l2 * l2 * 0.02);
        col += fc * smoothstep(0.009, 0.0, length(pa - pp)) * exp(-l2 * 1.4) * 1.5;
      }
      col += fc * exp(-l2 * 3.0) * 0.35 * exp(-length(pa - cp) * 2.5) * stoneLit(uv);
    }
  }
  return col;
}`,
  },
  {
    id: 'lapin', name: 'Lapin de Pâques', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 14,
    description: 'Un lapin traverse la façade en sautant et dépose un œuf décoré à chaque bond.',
    tags: ['saisons'],
    params: [I(), S(), CA('#ffffff', 'Lapin'), CB('#c8f5c8', 'Fond printanier'), R('ground', 'Hauteur du sol', 'uParamA', 0.1), R('size', 'Taille', 'uParamB', 0.65), R('bg', 'Lumière de fond', 'uParamC', 0.35)],
    glsl: HELPERS + SDF + `
float bunny(vec2 q, float sq, float ear) {
  q.y /= sq;
  float d = sdEll(q - vec2(0.0, 0.11), vec2(0.15, 0.11));
  d = smin(d, length(q - vec2(0.15, 0.21)) - 0.075, 0.03);
  vec2 e1 = rot2(-0.25 - ear) * (q - vec2(0.16, 0.26));
  d = min(d, sdEll(e1 - vec2(0.0, 0.1), vec2(0.028, 0.1)));
  vec2 e2 = rot2(0.05 - ear * 0.7) * (q - vec2(0.12, 0.26));
  d = min(d, sdEll(e2 - vec2(0.0, 0.09), vec2(0.026, 0.09)));
  d = min(d, length(q - vec2(-0.16, 0.15)) - 0.042);
  d = min(d, sdEll(q - vec2(-0.05, 0.01), vec2(0.1, 0.03)));
  d = min(d, sdSeg(q, vec2(0.1, 0.06), vec2(0.14, 0.0)) - 0.02);
  return d * sq;
}
vec3 egg(vec2 q, float sz, float h) {
  float d = sdEll(q - vec2(0.0, sz * 1.3), vec2(sz, sz * 1.35));
  if (d > 0.0) return vec3(0.0);
  vec3 c1 = hsv(h, 0.55, 1.0), c2 = hsv(fract(h + 0.4), 0.6, 1.0);
  float st = step(0.5, fract(q.y / sz * 2.2 + sin(q.x / sz * 6.0) * 0.15 * step(0.5, fract(h * 7.0))));
  vec3 c = mix(c1, c2, st);
  float dots = step(length(fract(q / sz * 2.5) - 0.5), 0.18) * step(0.6, fract(h * 13.0));
  return mix(c, vec3(1.0), dots) * smoothstep(0.0, -0.004, d);
}
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float sc = 0.15 + uParamB * 0.45;
  float P = 0.9 / uSpeed;
  float hop = uT / P;
  float n = floor(hop), f = fract(hop);
  float L = 0.42 * sc;
  float span = uAspect + 0.6;
  float x = mod(hop * L, span) - 0.3;
  float jump = 4.0 * f * (1.0 - f);
  float gy = uParamA;
  float sq = f < 0.12 ? mix(0.8, 1.0, f / 0.12) : f > 0.9 ? mix(1.0, 0.85, (f - 0.9) / 0.1) : 1.06;
  vec2 q = (pa - vec2(x, gy + jump * 0.22 * sc)) / sc;
  q = rot2(-0.25 * (0.5 - f) * step(0.12, f)) * q;
  float d = bunny(q, sq, jump * 0.4);
  float px = 1.5 / uRes.y / sc;
  vec3 c = uColB * uParamC * (0.5 + 0.5 * uv.y) * stoneLit(uv);
  c *= 1.0 - fillD(d, px) * 0.6;
  c += uColA * (fillD(d, px) * 1.3 + exp(-max(d, 0.0) * 14.0) * 0.3) * stoneLit(uv);
  for (int k = 1; k < 14; k++) {
    float nk = n - float(k) + 1.0;
    if (nk < 0.0) break;
    float ex = mod(nk * L, span) - 0.3 - 0.05 * sc;
    float age = (hop - nk) * P;
    float grow = smoothstep(0.0, 0.35, age);
    c += egg(pa - vec2(ex, gy - 0.01), 0.05 * sc * grow + 1e-4, hash11(nk * 1.37)) * 1.2 * stoneLit(uv);
  }
  return c;
}`,
  },
  {
    id: 'surf', name: 'Surf au coucher du soleil', category: 'Saisons et fêtes', mood: 'moyen', defaultDuration: 16,
    description: 'La mer monte sur la façade, un surfeur glisse sur les vagues devant le soleil couchant, les mouettes passent.',
    tags: ['saisons'],
    params: [I(), S(), CA('#1e6fd9', 'Mer'), CB('#ff7a59', 'Ciel couchant'), R('sea', 'Niveau de la mer', 'uParamA', 0.35), R('size', 'Taille du surfeur', 'uParamB', 0.45), R('wave', 'Houle', 'uParamC', 0.5)],
    glsl: HELPERS + SDF + `
float surfer(vec2 q, float t) {
  float d = sdEll(q, vec2(0.17, 0.018));
  float k = 0.025 * sin(t * 2.5);
  d = min(d, sdSeg(q, vec2(-0.05, 0.012), vec2(-0.01, 0.09)) - 0.016);
  d = min(d, sdSeg(q, vec2(0.06, 0.012), vec2(0.025, 0.09)) - 0.016);
  d = min(d, sdSeg(q, vec2(0.005, 0.09), vec2(0.015 + k, 0.19)) - 0.022);
  d = min(d, length(q - vec2(0.02 + k, 0.228)) - 0.028);
  d = min(d, sdSeg(q, vec2(0.01 + k, 0.17), vec2(-0.1, 0.13 + k)) - 0.011);
  d = min(d, sdSeg(q, vec2(0.01 + k, 0.17), vec2(0.12, 0.17 - k)) - 0.011);
  return d;
}
float seaY(float x, float t) {
  float A = 0.02 + uParamC * 0.06;
  return uParamA + A * sin(x * 5.0 - t * 1.6) + A * 0.5 * sin(x * 11.0 + t * 2.3) + 0.4 * A * sin(x * 23.0 - t * 3.1);
}
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float t = uT * uSpeed;
  float hz = uParamA + 0.08;
  vec3 sky = mix(uColB, vec3(0.35, 0.2, 0.55), smoothstep(hz, 1.0, uv.y));
  vec2 sc = vec2(uAspect * 0.62, hz + 0.06);
  float sd = length(pa - sc);
  sky += vec3(1.0, 0.85, 0.5) * (smoothstep(0.11, 0.105, sd) * 1.2 + exp(-sd * 5.0) * 0.4);
  float sy = seaY(pa.x, t);
  vec3 c;
  if (pa.y > sy) c = sky;
  else {
    float depth = sy - pa.y;
    c = mix(uColA * 1.1, uColA * 0.35, smoothstep(0.0, 0.3, depth));
    c += vec3(1.0, 0.8, 0.5) * exp(-abs(pa.x - sc.x) * 12.0) * (0.5 + 0.5 * sin(pa.y * 140.0 + t * 4.0)) * 0.5 * exp(-depth * 4.0);
    float foam = smoothstep(0.012, 0.0, depth) + smoothstep(0.55, 0.9, vnoise(vec2(pa.x * 30.0 - t * 2.0, depth * 60.0))) * exp(-depth * 25.0);
    c += vec3(1.0) * foam;
  }
  // surfeur
  float s = 0.12 + uParamB * 0.35;
  float xs = uAspect * (0.5 + 0.32 * sin(t * 0.35)) ;
  float ys = seaY(xs, t);
  float sl = (seaY(xs + 0.01, t) - ys) / 0.01;
  vec2 q = rot2(atan(sl) * 0.8) * (pa - vec2(xs, ys + 0.004)) / s;
  q.x *= cos(t * 0.35) > 0.0 ? 1.0 : -1.0;
  float d = surfer(q, t);
  float m = fillD(d, 1.5 / uRes.y / s);
  c *= 1.0 - m * 0.95;
  // mouettes
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 g = vec2(mod(t * (0.05 + 0.02 * fi) + fi * 0.7, uAspect + 0.4) - 0.2, 0.72 + 0.18 * hash11(fi) + 0.02 * sin(t + fi));
    vec2 gq = (pa - g) / 0.03;
    float fl = 0.35 * sin(t * 6.0 + fi);
    vec2 ga = vec2(abs(gq.x), gq.y);
    float gd = sdSeg(ga, vec2(0.0), vec2(0.6, 0.25 + fl)) - 0.06;
    c *= 1.0 - fillD(gd * 0.03, 1.5 / uRes.y) * 0.9;
  }
  return c * stoneLit(uv);
}`,
  },
  {
    id: 'feuilles', name: 'Feuilles d’automne', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 16,
    description: 'Des feuilles d’érable et de chêne tombent en tourbillonnant, poussées par le vent, et s’amoncellent au pied du monument.',
    tags: ['saisons', 'patrimoine'],
    params: [I(), S(), CA('#ff8a1e', 'Feuilles'), CB('#7a2a10', 'Fond'), R('count', 'Nombre de feuilles', 'uParamA', 0.6), R('wind', 'Vent', 'uParamB', 0.4), R('size', 'Taille', 'uParamC', 0.4), TOG('pile', 'Tas de feuilles', 'uParamD', true)],
    glsl: HELPERS + SDF + `
float leafD(vec2 q, float kind) {
  if (kind < 0.5) {
    float a = atan(q.x, q.y);
    float r = 0.05 * (0.55 + 0.45 * pow(abs(cos(a * 2.5)), 0.5)) * (1.0 - 0.25 * smoothstep(1.8, 3.1, abs(a)));
    float d = length(q) - r;
    d = min(d, sdSeg(q, vec2(0.0, 0.0), vec2(0.0, -0.065)) - 0.003);
    return d;
  }
  float w = 0.026 * (1.0 + 0.18 * sin(q.y * 140.0));
  float d = sdEll(q, vec2(w, 0.055));
  return min(d, sdSeg(q, vec2(0.0, -0.05), vec2(0.0, -0.07)) - 0.003);
}
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float t = uT * uSpeed;
  vec3 c = uColB * 0.18 * stoneLit(uv);
  int N = 8 + int(uParamA * 40.0);
  float sz = 0.5 + uParamC * 1.6;
  for (int i = 0; i < 48; i++) {
    if (i >= N) break;
    float fi = float(i);
    float h = hash11(fi * 1.71);
    float sp = 0.06 + 0.06 * hash11(fi * 3.3);
    float y = 1.15 - fract(t * sp + h) * 1.3;
    float x = mod(hash11(fi * 5.1) * (uAspect + 0.4) + 0.07 * sin(t * (0.8 + h) + fi) + uParamB * 0.25 * (1.15 - y) * 2.0, uAspect + 0.4) - 0.2;
    vec2 q = pa - vec2(x, y);
    if (dot(q, q) > 0.02 * sz * sz) continue;
    float ang = t * (1.0 + 2.0 * h) * (h > 0.5 ? 1.0 : -1.0) + fi;
    q = rot2(ang) * q / sz;
    q.x /= 0.4 + 0.6 * abs(cos(t * (1.5 + h) + fi));
    float d = leafD(q, step(0.6, h));
    float m = fillD(d, 1.5 / uRes.y / sz);
    vec3 lc = mix(uColA, hsv(0.0 + 0.12 * hash11(fi * 9.3), 0.9, 1.0), 0.6) * (0.8 + 0.4 * (q.x * 10.0 + 0.5));
    c = mix(c, lc * 1.2 * stoneLit(uv), m);
  }
  if (uParamD > 0.5) {
    float hgt = (0.02 + 0.1 * uP) * (0.6 + 0.6 * fbm(vec2(pa.x * 9.0, 1.0)));
    float pile = smoothstep(hgt, hgt - 0.01, uv.y);
    vec3 pc = mix(uColA, hsv(0.02 + 0.1 * vnoise(pa * 90.0), 0.9, 0.9), 0.6) * (0.5 + 0.7 * vnoise(pa * 160.0));
    c = mix(c, pc * stoneLit(uv), pile);
  }
  return c;
}`,
  },
  {
    id: 'citrouilles', name: 'Fenêtres citrouilles', category: 'Saisons et fêtes', mood: 'moyen', defaultDuration: 12,
    description: 'Chaque fenêtre et porte devient une citrouille d’Halloween qui s’allume une à une, avec la flamme qui vacille.',
    tags: ['halloween'],
    params: [I(), S(), CA('#ff8a1e', 'Lueur'), CB('#4b1d6e', 'Mur'), R('wall', 'Lumière sur les murs', 'uParamA', 0.3), R('fl', 'Vacillement', 'uParamB', 0.6)],
    glsl: HELPERS + SDF + `
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  vec3 wall = uColB * uParamA * (0.5 + 0.8 * lum(albedo(uv)));
  if (id == 0 || !isOpening(ty)) return wall;
  vec4 g = zoneGeom(id);
  vec4 mt = zoneMeta(id);
  float on = smoothstep(mt.y * 0.75, mt.y * 0.75 + 0.06, uP);
  vec2 z = (uv - g.xy) / g.zw;
  vec2 p = vec2(abs(z.x), z.y);
  float d = sdTri(p, vec2(0.06, 0.06), vec2(0.36, 0.06), vec2(0.2, 0.3));
  d = min(d, sdTri(z, vec2(-0.07, -0.06), vec2(0.07, -0.06), vec2(0.0, 0.05)));
  float mouth = max(sdEll(z - vec2(0.0, -0.1), vec2(0.4, 0.24)), -sdEll(z - vec2(0.0, 0.0), vec2(0.46, 0.22)));
  mouth = max(mouth, -sdBox(p - vec2(0.13, -0.2), vec2(0.045, 0.05)));
  mouth = max(mouth, -sdBox(z - vec2(0.0, -0.33), vec2(0.05, 0.05)));
  d = min(d, mouth);
  float fl = 1.0 - uParamB * 0.45 * (vnoise(vec2(uT * uSpeed * 8.0, mt.x * 40.0)) * 0.7 + 0.3 * sin(uT * 23.0 + mt.x * 9.0));
  float face = fillD(d, 0.01);
  vec3 c = uColA * on * (face * 1.6 * fl + 0.12 * fl);
  c += vec3(1.0, 0.85, 0.4) * on * face * exp(-length(z) * 3.0) * 0.6 * fl;
  return c + wall * 0.5;
}`,
  },
  {
    id: 'avent', name: 'Calendrier de l’Avent', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 20,
    description: 'Les fenêtres s’ouvrent une à une comme les cases d’un calendrier de l’Avent et révèlent étoiles, cadeaux, sapins et boules.',
    tags: ['noel'],
    params: [I(), S(), CA('#ffd65a', 'Surprises'), CB('#b3122f', 'Volets'), R('wall', 'Lumière sur les murs', 'uParamA', 0.25)],
    glsl: HELPERS + SDF + `
float icon(vec2 q, float k) {
  if (k < 0.25) return sdStar5(q, 0.32, 0.45);
  if (k < 0.5) {
    float d = sdBox(q - vec2(0.0, -0.08), vec2(0.28, 0.22));
    d = max(d, -sdBox(q - vec2(0.0, -0.08), vec2(0.04, 0.3)));
    d = max(d, -sdBox(q - vec2(0.0, -0.02), vec2(0.3, 0.035)));
    d = min(d, sdEll(vec2(abs(q.x), q.y) - vec2(0.09, 0.2), vec2(0.09, 0.05)));
    return d;
  }
  if (k < 0.75) {
    float d = sdTri(q, vec2(-0.3, -0.2), vec2(0.3, -0.2), vec2(0.0, 0.1));
    d = min(d, sdTri(q, vec2(-0.23, 0.0), vec2(0.23, 0.0), vec2(0.0, 0.3)));
    d = min(d, sdTri(q, vec2(-0.16, 0.18), vec2(0.16, 0.18), vec2(0.0, 0.42)));
    d = min(d, sdBox(q - vec2(0.0, -0.28), vec2(0.06, 0.08)));
    return d;
  }
  float d = length(q - vec2(0.0, -0.05)) - 0.28;
  d = min(d, sdBox(q - vec2(0.0, 0.26), vec2(0.07, 0.05)));
  return d;
}
vec3 effect(vec2 uv) {
  int id = zoneId(uv);
  int ty = zoneTypeAt(uv);
  vec3 wall = vec3(1.0, 0.85, 0.6) * uParamA * (0.4 + 0.8 * lum(albedo(uv)));
  wall += uColA * twinkle(asp(uv), 50.0, 0.05) * 0.6;
  if (id == 0 || !isOpening(ty)) return wall;
  vec4 g = zoneGeom(id);
  vec4 mt = zoneMeta(id);
  vec2 z = (uv - g.xy) / g.zw;
  float t0 = mt.y * 0.8;
  float open = smoothstep(t0, t0 + 0.08, uP);
  vec2 q = z * vec2(g.z * uAspect / g.w, 1.0);
  float d = icon(q * 1.25, hash11(mt.x * 91.0));
  float pulse = 0.85 + 0.15 * sin(uT * 3.0 + mt.x * 20.0);
  vec3 inside = vec3(1.0, 0.75, 0.45) * 0.25 + uColA * fillD(d, 0.012) * 1.5 * pulse + uColA * exp(-max(d, 0.0) * 12.0) * 0.3;
  // volet qui pivote sur sa charnière gauche
  float edge = 1.0 - open;
  float lx = z.x + 0.5;
  vec3 shutter = uColB * (0.55 + 0.25 * step(abs(fract((lx / max(edge, 0.01)) * 2.0) - 0.5), 0.45)) ;
  float frame = step(0.42, max(abs(z.x), abs(z.y)));
  shutter = mix(shutter, uColA * 0.9, frame);
  vec3 c = lx < edge ? shutter : inside * open;
  return c + wall * 0.3;
}`,
  },
  {
    id: 'coeurs', name: 'Cœurs de la Saint-Valentin', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 12,
    description: 'Des cœurs lumineux s’envolent en se balançant, et un grand cœur bat au centre de la façade.',
    tags: ['mariage'],
    params: [I(), S(), CA('#ff3b6b', 'Cœurs'), CB('#ffb3c7', '2e couleur'), R('count', 'Nombre', 'uParamA', 0.6), TOG('big', 'Grand cœur qui bat', 'uParamB', true), R('bg', 'Lumière de fond', 'uParamC', 0.2)],
    glsl: HELPERS + SDF + `
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  float t = uT * uSpeed;
  vec3 c = mix(uColB, uColA, 0.5) * uParamC * 0.4 * (0.3 + uv.y * 0.7);
  int N = 6 + int(uParamA * 30.0);
  for (int i = 0; i < 36; i++) {
    if (i >= N) break;
    float fi = float(i);
    float h = hash11(fi * 2.37);
    float sz = 0.02 + 0.04 * hash11(fi * 5.1);
    float y = fract(t * (0.04 + 0.05 * h) + h) * 1.3 - 0.15;
    float x = hash11(fi * 7.3) * uAspect + 0.05 * sin(t * (1.0 + h) + fi);
    vec2 q = rot2(0.3 * sin(t * 1.5 + fi)) * (pa - vec2(x, y)) / sz;
    float d = sdHeart(q + vec2(0.0, 0.5));
    vec3 hc = mix(uColA, uColB, step(0.5, h));
    c += hc * (fillD(d, 0.06) * 1.2 + exp(-max(d, 0.0) * 4.0) * 0.25) * smoothstep(1.15, 0.9, y);
  }
  if (uParamB > 0.5) {
    float beat = 1.0 + 0.08 * exp(-fract(uBeatIndex + uBeatPhase) * 6.0);
    vec2 q = (pa - vec2(uAspect * 0.5, 0.45)) / (0.25 * beat);
    float d = sdHeart(q + vec2(0.0, 0.5));
    c += uColA * (fillD(d, 0.01) * 1.1 + exp(-max(d, 0.0) * 8.0) * 0.4 + smoothstep(0.02, 0.0, abs(d)) * 0.6);
  }
  return c * stoneLit(uv);
}`,
  },
  {
    id: 'fleurs', name: 'Printemps en fleurs', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 16,
    description: 'Des tiges poussent depuis le pied du monument, les feuilles se déplient et les fleurs éclosent une à une.',
    tags: ['saisons', 'mariage'],
    params: [I(), S(), CA('#7ed957', 'Tiges'), CB('#ffd1ea', 'Fond'), R('count', 'Nombre de fleurs', 'uParamA', 0.6), R('height', 'Hauteur', 'uParamB', 0.5), R('bg', 'Lumière de fond', 'uParamC', 0.15)],
    glsl: HELPERS + SDF + `
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  vec3 c = uColB * uParamC * (0.4 + 0.6 * uv.y);
  int N = 5 + int(uParamA * 18.0);
  for (int i = 0; i < 23; i++) {
    if (i >= N) break;
    float fi = float(i);
    float h = hash11(fi * 4.13);
    float x0 = (fi + 0.5) / float(N) * uAspect + (h - 0.5) * 0.06;
    float H = (0.25 + 0.5 * uParamB) * (0.6 + 0.5 * hash11(fi * 1.9));
    float st = fi / float(N) * 0.3;
    float grow = smoothstep(st, st + 0.45, uP);
    float top = H * grow;
    float sway = 0.03 * sin(uT * 1.2 + fi);
    if (pa.y < top + 0.1 && abs(pa.x - x0) < 0.2) {
      float yy = clamp(pa.y, 0.0, top);
      float sx = x0 + sway * (yy / max(H, 0.01)) * (yy / max(H, 0.01)) + 0.02 * sin(yy * 12.0 + fi);
      float d = abs(pa.x - sx) - 0.004;
      d = max(d, pa.y - top);
      c += uColA * fillD(d, 1.5 / uRes.y) * 1.2;
      for (int k = 1; k < 3; k++) {
        float ly = H * (0.3 * float(k));
        if (ly > top) break;
        float lx = x0 + sway * (ly / H) * (ly / H) + 0.02 * sin(ly * 12.0 + fi);
        float sd = float(k) == 1.0 ? 1.0 : -1.0;
        vec2 q = rot2(sd * 0.9) * (pa - vec2(lx + sd * 0.025, ly + 0.01));
        float ld = sdEll(q, vec2(0.012, 0.03) * smoothstep(ly / H * 0.9, ly / H * 0.9 + 0.2, grow));
        c += uColA * fillD(ld, 1.5 / uRes.y) * 1.1;
      }
      float bloom = smoothstep(0.85, 1.0, grow) * smoothstep(st + 0.45, st + 0.6, uP);
      vec2 fc = vec2(x0 + sway + 0.02 * sin(top * 12.0 + fi), top);
      vec2 q = pa - fc;
      float a = atan(q.y, q.x) + uT * 0.2;
      float petals = 4.0 + floor(h * 3.0);
      float r = (0.025 + 0.02 * h) * bloom * (0.65 + 0.35 * abs(cos(a * petals * 0.5)));
      float fd = length(q) - r;
      vec3 pc = hsv(fract(0.85 + h * 0.35), 0.6, 1.0);
      c += pc * fillD(fd, 1.5 / uRes.y) * 1.3 + vec3(1.0, 0.85, 0.3) * fillD(length(q) - r * 0.3, 1.5 / uRes.y);
      c += pc * exp(-max(fd, 0.0) * 40.0) * 0.2 * bloom;
    }
  }
  return c * stoneLit(uv);
}`,
  },
  {
    id: 'minuteur', name: 'Minuteur d’avant-spectacle', category: 'Saisons et fêtes', mood: 'calme', defaultDuration: 300,
    description: 'Compte à rebours « Le spectacle commence dans 04:59 » projeté sur le monument, jusqu’à la fin du tableau ou jusqu’à une heure précise. Les 10 dernières secondes s’affichent en grand.',
    tags: ['intro'],
    params: [
      { key: 'text', label: 'Message', type: 'text', slot: 'aux', default: 'Le spectacle commence dans' },
      SEL('mode', 'Compte jusqu’à', 'uParamD', ['La fin du tableau', 'Une heure précise'], 0),
      { key: 'at', label: 'Heure précise (HH:MM)', type: 'text', slot: 'aux', default: '21:30' },
      { key: 'end', label: 'Message à zéro', type: 'text', slot: 'aux', default: 'C’est parti !' },
      SEL('font', 'Police', 'aux', ['Classique (Cinzel)', 'Gothique', 'Manuscrite', 'Affiche', 'Moderne'], 4),
      I(), CA('#ffe08a', 'Texte'), CB('#3a6bff', 'Ambiance'),
      SEL('anim', 'Animation de fond', 'uParamC', ['Anneau qui se vide', 'Ciel étoilé', 'Pulsation douce', 'Aucune'], 0),
      R('y', 'Position verticale', 'uParamA', 0.5), R('size', 'Taille', 'uParamB', 0.55)],
    dynText: (p, t, dur) => {
      let rem = dur - t;
      if (Number(p.mode) === 1) {
        const m = /^(\d{1,2})[:hH](\d{2})/.exec(String(p.at ?? ''));
        if (m) {
          const now = new Date();
          const target = new Date(now);
          target.setHours(Number(m[1]), Number(m[2]), 0, 0);
          rem = (target.getTime() - now.getTime()) / 1000;
          if (rem < -3600) rem += 86400; // heure de demain
        }
      }
      const r = Math.ceil(rem - 1e-6);
      if (r <= 0) return String(p.end ?? '');
      if (r <= 10) return String(r);
      const hh = Math.floor(r / 3600), mm = Math.floor((r % 3600) / 60), ss = r % 60;
      const time = (hh ? `${hh}:${String(mm).padStart(2, '0')}` : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
      return `~${String(p.text ?? '')}\n${time}`;
    },
    glsl: HELPERS + SDF + `
float txt(vec2 uv) { return texture(uAux, uv).r; }
vec3 effect(vec2 uv) {
  vec2 pa = asp(uv);
  int an = int(uParamC + 0.5);
  vec3 c = vec3(0.0);
  vec2 ce = asp(vec2(0.5, uParamA));
  float sec = fract(uT);
  if (an == 0) {
    vec2 d = pa - ce;
    float R0 = 0.3 + uParamB * 0.15;
    float r = length(d);
    float a = fract(atan(d.x, d.y) / TAU + 1.0);
    float prog = uParamD < 0.5 ? 1.0 - uP : 1.0 - sec;
    c += uColB * smoothstep(0.01, 0.0, abs(r - R0)) * mix(0.25, 1.3, step(a, prog));
    c += uColB * exp(-abs(r - R0) * 25.0) * 0.25;
    vec2 dot0 = ce + vec2(sin(prog * TAU), cos(prog * TAU)) * R0;
    c += vec3(1.0) * smoothstep(0.02, 0.0, length(pa - dot0));
  } else if (an == 1) {
    c += vec3(0.9, 0.95, 1.0) * twinkle(pa, 45.0, 0.1) * 0.8;
    float k = floor(uT / 3.0);
    float lt = fract(uT / 3.0);
    vec2 s0 = vec2(hash11(k) * uAspect, 0.75 + 0.2 * hash11(k + 1.0));
    vec2 dir = normalize(vec2(-1.0, -0.45));
    vec2 hd = s0 + dir * lt * 0.6;
    float along = dot(pa - hd, -dir);
    float dist = length(pa - hd - (-dir) * clamp(along, 0.0, 0.15));
    c += vec3(1.0) * smoothstep(0.004, 0.0, dist) * (1.0 - clamp(along / 0.15, 0.0, 1.0)) * step(lt, 0.4) * 1.5;
    c += uColB * 0.12 * (0.3 + 0.7 * uv.y);
  } else if (an == 2) {
    c += uColB * (0.15 + 0.25 * (0.5 - 0.5 * cos(uT * 1.2))) * (0.4 + 0.6 * uv.y);
  }
  c *= stoneLit(uv);
  float m = txt(uv);
  c = mix(c, uColA * 1.5, m) + uColA * 0.25 * texture(uAux, uv + vec2(0.002, -0.002)).r;
  return c;
}`,
  },
  // ───────────────────────────── MÉDIAS ─────────────────────────────
  {
    id: 'media', name: 'Image / vidéo', category: 'Illusions', mood: 'calme', defaultDuration: 10,
    description: 'Projette votre image ou votre vidéo sur la façade, ou cadrée dans chaque calque ciblé (ex. une vidéo dans chaque fenêtre). Déplacez-la et redimensionnez-la directement sur l’image.',
    tags: [],
    params: [
      { key: 'media', label: 'Média', type: 'media', slot: 'aux', default: '' },
      I(),
      SEL('fit', 'Placement', 'uParamC', ['Sur la façade', 'Dans chaque calque (cadré)'], 0),
      SEL('cover', 'Ajustement', 'uParamD', ['Entier (contenir)', 'Remplir (couvrir)'], 0),
      R('scale', 'Échelle', 'uParamB', 1, 0.05, 4),
      R('posX', 'Position horizontale', 'uParamE', 0, -1.5, 1.5),
      R('posY', 'Position verticale', 'uParamF', 0, -1.5, 1.5),
      R('rot', 'Rotation (°)', 'uParamG', 0, -180, 180, 1),
      R('stone', 'Mélange avec la pierre', 'uParamA', 0.3),
    ],
    glsl: `
vec3 effect(vec2 uv) {
  vec2 q = uv;
  float boxA = uAspect;
  if (uParamC > 0.5) {
    int id = zoneId(uv);
    if (id == 0) return vec3(0.0);
    vec4 g = zoneGeom(id);
    q = (uv - (g.xy - g.zw * 0.5)) / max(g.zw, vec2(1e-4));
    boxA = g.z * uAspect / max(g.w, 1e-4);
  }
  // taille du média dans la boîte (contenir ou couvrir), puis échelle
  vec2 size = vec2(1.0);
  bool wide = uAuxAspect > boxA;
  if (uParamD < 0.5) size = wide ? vec2(1.0, boxA / uAuxAspect) : vec2(uAuxAspect / boxA, 1.0);
  else size = wide ? vec2(uAuxAspect / boxA, 1.0) : vec2(1.0, boxA / uAuxAspect);
  size *= max(uParamB, 0.01);
  vec2 center = vec2(0.5 + uParamE * 0.5, 0.5 + uParamF * 0.5);
  vec2 d = (q - center) * vec2(boxA, 1.0);
  float a = radians(uParamG);
  d = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
  vec2 m = d / (size * vec2(boxA, 1.0)) + 0.5;
  if (m.x < 0.0 || m.y < 0.0 || m.x > 1.0 || m.y > 1.0) return vec3(0.0);
  vec3 c = texture(uAux, m).rgb;
  c *= mix(1.0, 0.4 + 1.2 * lum(albedo(uv)), uParamA);
  return c * 1.25;
}`,
  },
  {
    id: 'vide', name: 'Pause (noir)', category: 'Lumière', mood: 'calme', defaultDuration: 4,
    description: 'Aucune lumière : sert de silence visuel ou à espacer les tableaux d’une piste superposée.',
    tags: [],
    params: [],
    glsl: `
vec3 effect(vec2 uv) { return vec3(0.0); }`,
  },
];

export const EFFECT_MAP = new Map(EFFECTS.map((e) => [e.id, e]));

export const CATEGORIES: Category[] = ['Mes tableaux', 'Lumière', 'Console lumière', 'Saisons et fêtes', 'Architecture', 'Matières', 'Nature', 'Graphique', 'Illusions'];

export const CATEGORY_COLORS: Record<Category, string> = {
  Lumière: '#ffcf5c',
  Architecture: '#8fb8ff',
  Matières: '#e7a7ff',
  Nature: '#6ee7a8',
  Graphique: '#ff6fa3',
  Illusions: '#ffa26b',
  'Mes tableaux': '#5ef0ff',
  'Console lumière': '#ffe14d',
  'Saisons et fêtes': '#ff7a3c',
};

// ───────────── Tableaux personnalisés (écrits par l'utilisateur) ─────────────
export interface CustomFx {
  id: string;
  name: string;
  description: string;
  code: string; // corps GLSL : doit définir vec3 effect(vec2 uv)
}

export const CUSTOM_TEMPLATE = `// Votre tableau : renvoyez la lumière à projeter en chaque point de la façade.
// uv : position (0,0 = bas gauche, 1,1 = haut droit) · uT : temps (s) · uP : avancement 0→1
// Réglages : uParamA, uParamB, uParamC (0→1), uColA, uColB (couleurs), uSpeed, uBeat (rythme)
vec3 effect(vec2 uv) {
  float t = uT * uSpeed;
  // vagues de couleur qui montent, modulées par la pierre
  float w = 0.5 + 0.5 * sin(uv.y * (6.0 + uParamA * 20.0) - t * 2.0 + fbm(asp(uv) * 3.0) * 3.0);
  vec3 c = mix(uColA, uColB, w);
  float pierre = 0.4 + lum(albedo(uv));
  return c * pierre * (0.6 + uBeat * uParamB) + uColA * edgeZone(uv) * uParamC * 2.0;
}
`;

export function customEffectDef(c: CustomFx): EffectDef {
  return {
    id: `perso-${c.id}`, name: c.name || 'Tableau perso', category: 'Mes tableaux', mood: 'moyen', defaultDuration: 10,
    description: c.description || 'Tableau écrit en code (GLSL).', tags: [],
    params: [I(), S(), CA('#ff4fd8', 'Couleur A'), CB('#2bd9ff', 'Couleur B'), R('a', 'Réglage A', 'uParamA', 0.5), R('b', 'Réglage B', 'uParamB', 0.5), R('c', 'Réglage C', 'uParamC', 0.5)],
    glsl: c.code,
  };
}

/** Ajoute ou met à jour un tableau personnalisé dans la bibliothèque. */
export function registerCustom(c: CustomFx) {
  const def = customEffectDef(c);
  const i = EFFECTS.findIndex((e) => e.id === def.id);
  if (i >= 0) EFFECTS[i] = def;
  else EFFECTS.push(def);
  EFFECT_MAP.set(def.id, def);
  return def;
}

export function unregisterCustom(id: string) {
  const fid = `perso-${id}`;
  const i = EFFECTS.findIndex((e) => e.id === fid);
  if (i >= 0) EFFECTS.splice(i, 1);
  EFFECT_MAP.delete(fid);
}

export function defaultParams(effectId: string): Record<string, number | string | boolean> {
  const e = EFFECT_MAP.get(effectId);
  const out: Record<string, number | string | boolean> = {};
  if (!e) return out;
  for (const p of [...e.params, ...COMMON_PARAMS]) out[p.key] = p.default;
  return out;
}

/** Options avancées disponibles pour tous les tableaux. */
export const COMMON_PARAMS: ParamDef[] = [
  {
    key: '_target', label: 'Calques ciblés', type: 'select', slot: 'uTarget', default: 0,
    options: [
      { value: 0, label: 'Toute la façade' },
      { value: 20, label: 'Ouvertures (fenêtres, portes, rosace)' },
      { value: 22, label: 'Tous les calques' },
      { value: 21, label: 'Murs uniquement (hors calques)' },
      { value: 2, label: 'Fenêtres' },
      { value: 3, label: 'Portes / portails' },
      { value: 4, label: 'Rosace' },
      { value: 5, label: 'Colonnes / piliers' },
      { value: 6, label: 'Corniches / frises' },
      { value: 7, label: 'Toits / pignons' },
      { value: 8, label: 'Statues / ornements' },
      { value: 9, label: 'Tours / clochers' },
      { value: 10, label: 'Horloge' },
    ],
  },
  { key: '_targetBg', label: 'Hors cible', type: 'select', slot: 'uTargetBg', default: 0, options: [{ value: 0, label: 'Noir' }, { value: 1, label: 'Lumière douce' }] },
  { key: '_react', label: 'Réaction à la musique', type: 'range', slot: 'uReact', min: 0, max: 1.5, step: 0.01, default: 0 },
  { key: '_reactBand', label: 'Réagit à…', type: 'select', slot: 'uReactBand', default: 0, options: [{ value: 0, label: 'Temps forts + énergie' }, { value: 1, label: 'Basses (grosse caisse, basse)' }, { value: 2, label: 'Médiums (voix, guitares)' }, { value: 3, label: 'Aigus (cymbales, brillance)' }] },
  { key: '_mirror', label: 'Symétrie', type: 'select', slot: 'uMirror', default: 0, options: [{ value: 0, label: 'Aucune' }, { value: 1, label: 'Gauche → droite' }, { value: 2, label: 'Droite → gauche' }] },
  { key: '_hue', label: 'Décalage de teinte', type: 'range', slot: 'uHue', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  { key: '_sat', label: 'Saturation', type: 'range', slot: 'uSat', min: 0, max: 2, step: 0.01, default: 1 },
];

export const TRANSITIONS = [
  { id: 'fondu', label: 'Fondu enchaîné' },
  { id: 'noir', label: 'Passage au noir' },
  { id: 'balayage', label: 'Balayage lumineux' },
  { id: 'montee', label: 'Montée de lumière' },
  { id: 'dissolution', label: 'Dissolution' },
  { id: 'cascade', label: 'Cascade de calques' },
  { id: 'flash', label: 'Flash blanc' },
  { id: 'cut', label: 'Coupe franche' },
  { id: 'iris', label: 'Iris (cercle)' },
  { id: 'volets', label: 'Volets' },
  { id: 'pixels', label: 'Pixellisation' },
  { id: 'tourbillon', label: 'Tourbillon' },
];
