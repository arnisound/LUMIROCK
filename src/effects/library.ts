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

export type Category = 'Lumière' | 'Architecture' | 'Matières' | 'Nature' | 'Graphique' | 'Illusions';
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
    id: 'texte', name: 'Texte lumineux', category: 'Illusions', mood: 'calme', defaultDuration: 8,
    description: 'Un message s’écrit en lumière ou se grave dans la pierre (nom de la commune, date, vœux…).',
    tags: ['intro', 'noel', 'mariage', 'national', 'patrimoine'],
    params: [
      { key: 'text', label: 'Texte', type: 'text', slot: 'aux', default: 'Joyeux Noël' },
      I(), CA('#ffe08a', 'Couleur du texte'), CB('#1b2a55', 'Fond'),
      SEL('style', 'Style', 'uParamC', ['Écrit en lumière', 'Gravé dans la pierre'], 0),
      R('y', 'Position verticale', 'uParamA', 0.5), R('size', 'Taille', 'uParamB', 0.5),
    ],
    glsl: `
float txt(vec2 uv) { return texture(uAux, uv).r; }
vec3 effect(vec2 uv) {
  float a = txt(uv);
  vec2 px = 1.5 / uRes;
  float glow = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) glow += txt(uv + vec2(float(i), float(j)) * px * 3.0);
  glow /= 49.0;
  float sweep = uP * 1.6 - 0.2;
  float rev = sstep(uv.x - 0.02, uv.x + 0.02, sweep);
  float head = sstep(0.03, 0.0, abs(sweep - uv.x));
  vec3 bg = uColB * (0.25 + 0.4 * diffuseAt(uv, normalize(vec3(-0.3, 0.6, 0.8))));
  if (uParamC < 0.5) {
    return bg + uColA * (a * 1.6 + glow * 1.2) * rev + vec3(1.0) * a * head * 2.0;
  }
  float gx = txt(uv + vec2(px.x, 0.0)) - txt(uv - vec2(px.x, 0.0));
  float gy = txt(uv + vec2(0.0, px.y)) - txt(uv - vec2(0.0, px.y));
  float emb = (gx * -0.7 + gy * 0.7);
  vec3 lit = vec3(1.0, 0.95, 0.85) * (0.6 + 0.3 * diffuseAt(uv, normalize(vec3(-0.5, 0.5, 0.8))));
  vec3 c = lit * (1.0 - a * 0.65 * rev) + vec3(1.0) * max(emb, 0.0) * 2.0 * rev - vec3(0.6) * max(-emb, 0.0) * rev;
  return max(c, 0.0) + uColA * a * glow * head * 2.0;
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

export const CATEGORIES: Category[] = ['Lumière', 'Architecture', 'Matières', 'Nature', 'Graphique', 'Illusions'];

export const CATEGORY_COLORS: Record<Category, string> = {
  Lumière: '#ffcf5c',
  Architecture: '#8fb8ff',
  Matières: '#e7a7ff',
  Nature: '#6ee7a8',
  Graphique: '#ff6fa3',
  Illusions: '#ffa26b',
};

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
