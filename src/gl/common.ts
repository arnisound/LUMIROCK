// En-tête GLSL partagé par tous les effets (« tableaux »).
// Convention : uv (0,0) = bas gauche de la façade redressée.

export const EFFECT_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uAlbedo;   // photo de la façade redressée
uniform sampler2D uDepth;    // profondeur (R, 1 = proche)
uniform sampler2D uNormal;   // normales encodées 0..1
uniform sampler2D uZones;    // R=id zone, G=type, B=relief, A=masque projetable
uniform sampler2D uEdges;    // R=contours image, G=contours des calques
uniform sampler2D uZoneInfo; // ligne 0 : (cx, cy, w, h) ; ligne 1 : (aléa, ordre, aire, type)
uniform sampler2D uAux;      // texture auxiliaire (texte, image importée...)
uniform vec2 uRes;       // résolution de rendu
uniform vec2 uZoneRes;   // résolution de la carte des calques
uniform float uAspect;
uniform float uTime;
uniform float uT;
uniform float uP;
uniform float uDur;
uniform float uBeat;
uniform float uBeatPhase;
uniform float uBeatIndex;
uniform float uEnergy;
uniform float uRelief;
uniform float uSeed;
uniform float uZoneCount;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uIntensity;
uniform float uSpeed;
uniform float uParamA;
uniform float uParamB;
uniform float uParamC;

#define PI 3.14159265359
#define TAU 6.28318530718

// Types de calques
#define T_MUR 1
#define T_FENETRE 2
#define T_PORTE 3
#define T_ROSACE 4
#define T_COLONNE 5
#define T_CORNICHE 6
#define T_TOIT 7
#define T_STATUE 8
#define T_TOUR 9
#define T_HORLOGE 10

float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
// Voronoi : renvoie (distance au centre, distance au bord, id cellule)
vec3 voronoi(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  vec2 mg, mr; float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j); vec2 o = hash22(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(i, j); vec2 o = hash22(n + g); vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) bd = min(bd, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(sqrt(md), bd, hash21(n + mg));
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1), k, s);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }

vec3 albedo(vec2 uv) { return texture(uAlbedo, uv).rgb; }
float depthAt(vec2 uv) { return texture(uDepth, uv).r; }
vec3 normalAt(vec2 uv) { return normalize(texture(uNormal, uv).xyz * 2.0 - 1.0); }
vec4 zoneRaw(vec2 uv) { return texelFetch(uZones, ivec2(clamp(uv, 0.0, 0.9999) * uZoneRes), 0); }
int zoneId(vec2 uv) { return int(zoneRaw(uv).r * 255.0 + 0.5); }
int zoneTypeAt(vec2 uv) { return int(zoneRaw(uv).g * 255.0 + 0.5); }
float maskAt(vec2 uv) { return texture(uZones, uv).a; }
vec4 zoneGeom(int id) { return texelFetch(uZoneInfo, ivec2(id, 0), 0); }
vec4 zoneMeta(int id) { return texelFetch(uZoneInfo, ivec2(id, 1), 0); }
float edgeImg(vec2 uv) { return texture(uEdges, uv).r; }
float edgeZone(vec2 uv) { return texture(uEdges, uv).g; }
float glowOpen(vec2 uv) { return texture(uEdges, uv).b; }   // halo flou autour des ouvertures
float glowLines(vec2 uv) { return texture(uEdges, uv).a; }  // halo flou autour des contours de calques
vec2 asp(vec2 uv) { return vec2(uv.x * uAspect, uv.y); }
bool isOpening(int t) { return t == T_FENETRE || t == T_PORTE || t == T_ROSACE; }

// Ombre portée par marche de rayon dans la carte de profondeur (lumière 2D + élévation).
float shadowAt(vec2 uv, vec3 L) {
  float h0 = depthAt(uv) * uRelief;
  vec2 dir = normalize(L.xy + 1e-5) / vec2(uAspect, 1.0);
  float slope = L.z / max(length(L.xy), 1e-3);
  float sh = 1.0;
  float stepLen = 0.004;
  for (int i = 1; i <= 28; i++) {
    float d = float(i) * stepLen * (1.0 + float(i) * 0.08);
    vec2 p = uv + dir * d;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    float h = depthAt(p) * uRelief;
    float rayH = h0 + d * slope * 0.35;
    sh = min(sh, sat(1.0 - (h - rayH) * 40.0));
  }
  return sh;
}
// Éclairage diffus à partir des normales (relief accentué par uRelief).
float diffuseAt(vec2 uv, vec3 L) {
  vec3 n = normalAt(uv);
  n = normalize(vec3(n.xy * (0.4 + uRelief * 1.6), n.z));
  return max(dot(n, normalize(L)), 0.0);
}
`;

export const EFFECT_FOOTER = /* glsl */ `
void main() {
  vec3 c = effect(vUv);
  c = max(c, 0.0) * uIntensity;
  outColor = vec4(c * maskAt(vUv), 1.0);
}
`;
