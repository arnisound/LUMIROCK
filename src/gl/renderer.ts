import { EFFECT_HEADER, EFFECT_FOOTER } from './common';
import { FULLSCREEN_VS, Program, Target, createTarget, deleteTarget } from './glutil';
import { COMMON_PARAMS, EFFECT_MAP, EffectDef, TRANSITIONS } from '../effects/library';
import type { Clip, Show } from '../types';
import { effectiveProgress, paramAt } from '../keys';

export interface SceneMaps {
  width: number;
  height: number;
  albedo: Uint8Array; // RGBA, ligne 0 = haut de l'image
  depth: Uint8Array;
  normal: Uint8Array;
  zones: Uint8Array;
  edges: Uint8Array;
  zoneInfo: Float32Array; // 256 x 2 x RGBA
  zoneCount: number;
}

export interface AudioFrame {
  beat: number;
  beatPhase: number;
  beatIndex: number;
  energy: number;
  bass?: number;
  mid?: number;
  high?: number;
  spec?: Float32Array; // 16 bandes
}

export type ViewMode = 'projection' | 'simulation' | 'jour';

const TRANSITION_FS = EFFECT_HEADER + /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform int uType;
void main() {
  vec2 uv = vUv;
  vec3 a = texture(uA, uv).rgb;
  vec3 b = texture(uB, uv).rgb;
  float m = uMix;
  vec3 c;
  if (uType == 0) c = mix(a, b, sstep(0.0, 1.0, m));
  else if (uType == 1) c = m < 0.5 ? a * (1.0 - m * 2.0) : b * (m * 2.0 - 1.0);
  else if (uType == 2) {
    float e = m * 1.3 - 0.15 + (fbm(vec2(uv.y * 4.0, 1.0)) - 0.5) * 0.05;
    float w = sstep(e - 0.01, e + 0.01, uv.x);
    c = mix(b, a, w) + vec3(1.0, 0.95, 0.85) * exp(-abs(uv.x - e) * 60.0) * 1.5 * sin(m * PI);
  } else if (uType == 3) {
    float e = m * 1.3 - 0.15 + (fbm(vec2(uv.x * 6.0, 2.0)) - 0.5) * 0.12;
    float w = sstep(e - 0.02, e + 0.02, uv.y);
    c = mix(b, a, w) + vec3(1.0, 0.9, 0.7) * exp(-abs(uv.y - e) * 40.0) * 1.2 * sin(m * PI);
  } else if (uType == 4) {
    float n = fbm(asp(uv) * 12.0);
    float w = sstep(n - 0.05, n + 0.05, m * 1.2 - 0.1);
    c = mix(a, b, w);
  } else if (uType == 5) {
    int id = zoneId(uv);
    float th = id > 0 ? zoneMeta(id).y * 0.75 : 0.75 + hash21(floor(uv * 40.0)) * 0.2;
    float w = sstep(th, th + 0.08, m * 1.1);
    c = mix(a, b, w);
  } else if (uType == 6) {
    float f = 1.0 - abs(m * 2.0 - 1.0);
    c = (m < 0.5 ? a : b) + vec3(f * f * 2.5);
  } else if (uType == 8) {
    // iris : un cercle s'ouvre depuis le centre
    float r = length(asp(uv) - asp(vec2(0.5)));
    float R = m * 0.8 * max(uAspect, 1.0) * 1.2;
    float w = sstep(R - 0.015, R + 0.015, r);
    c = mix(b, a, w) + vec3(1.0, 0.9, 0.7) * exp(-abs(r - R) * 80.0) * sin(m * PI) * 1.4;
  } else if (uType == 9) {
    // volets : bandes verticales qui pivotent
    float f = fract(uv.x * 9.0);
    float k = sstep(f - 0.05, f + 0.05, m * 1.1 + (hash11(floor(uv.x * 9.0)) - 0.5) * 0.1);
    c = mix(a, b, k) + vec3(1.0) * exp(-abs(f - m) * 60.0) * sin(m * PI) * 0.6;
  } else if (uType == 10) {
    // pixels : l'image se pixellise puis se reconstitue
    float k = 1.0 - abs(m * 2.0 - 1.0);
    float n = mix(400.0, 14.0, k);
    vec2 g = vec2(n * uAspect, n);
    vec2 q = (floor(uv * g) + 0.5) / g;
    c = m < 0.5 ? texture(uA, q).rgb : texture(uB, q).rgb;
  } else if (uType == 11) {
    // tourbillon
    float k = 1.0 - abs(m * 2.0 - 1.0);
    vec2 d = asp(uv) - asp(vec2(0.5));
    float ang = k * 6.0 * exp(-length(d) * 1.5);
    vec2 rd = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    vec2 q = vec2(rd.x / uAspect, rd.y) + 0.5;
    c = mix(texture(uA, q).rgb, texture(uB, q).rgb, sstep(0.35, 0.65, m));
  } else c = m < 0.5 ? a : b;
  outColor = vec4(c, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uThreshold;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  outColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform vec2 uDir;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}`;

const BLEND_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uBase; uniform sampler2D uLayer; uniform float uOpacity; uniform int uMode;
void main() {
  vec3 a = texture(uBase, vUv).rgb;
  vec3 b = texture(uLayer, vUv).rgb * uOpacity;
  vec3 c = uMode == 0 ? a + b : uMode == 1 ? 1.0 - (1.0 - min(a, 1.0)) * (1.0 - min(b, 1.0)) + max(a - 1.0, 0.0) : max(a, b);
  outColor = vec4(c, 1.0);
}`;

const OUTPUT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uScene; uniform sampler2D uBloomA; uniform sampler2D uBloomB; uniform sampler2D uAlbedo; uniform sampler2D uZones;
uniform int uMode; uniform float uBright; uniform float uBloom; uniform float uFade; uniform float uVignette; uniform float uAmbient;
float knee(float x) { return x < 0.8 ? x : 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)); }
void main() {
  vec3 proj = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloomA, vUv).rgb + texture(uBloomB, vUv).rgb * 1.3;
  vec3 light = (proj + bloom * uBloom) * uBright * uFade;
  vec2 d = vUv - 0.5;
  light *= 1.0 - uVignette * dot(d, d) * 2.0;
  vec3 c;
  if (uMode == 0) {
    c = vec3(knee(light.r), knee(light.g), knee(light.b));
  } else {
    vec3 a = texture(uAlbedo, vUv).rgb;
    vec3 lin = pow(a, vec3(2.2));
    float isMonument = texture(uZones, vUv).a;
    vec3 night = lin * uAmbient * mix(vec3(0.55, 0.65, 1.0), vec3(1.0), 0.5);
    vec3 perceived = night + lin * (proj * uBright * uFade) * 1.75 + bloom * uBloom * uBright * uFade * 0.25;
    if (uMode == 2) perceived = lin;
    c = pow(max(perceived, 0.0), vec3(1.0 / 2.2));
    c = mix(c, c * vec3(0.8, 0.85, 1.0), (1.0 - isMonument) * 0.3 * float(uMode == 1));
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function seedFrom(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 10;
}

export const FONTS = [
  { css: '"Cinzel", Georgia, serif', weight: 600 },
  { css: '"UnifrakturMaguntia", "Old English Text MT", serif', weight: 400 },
  { css: '"Great Vibes", "Brush Script MT", cursive', weight: 400 },
  { css: '"Bebas Neue", Impact, sans-serif', weight: 400 },
  { css: '"Montserrat", Inter, sans-serif', weight: 700 },
];

export interface ClipTiming {
  clip: Clip;
  start: number;
  end: number;
  index: number;
}

export function computeTimings(show: Show): ClipTiming[] {
  return trackTimings(show.clips);
}

export function trackTimings(clips: Clip[]): ClipTiming[] {
  // position libre (clip.start) ; anciens projets : enchaînement avec chevauchement des transitions
  let t = 0;
  const out = clips.map((clip, index) => {
    const s = clip.start ?? t;
    const tm = { clip, start: s, end: s + clip.duration, index };
    t = tm.end - (clip.start === undefined && clip.transition !== 'cut' ? Math.min(clip.transitionDuration, clip.duration / 2) : 0);
    return tm;
  });
  return out.sort((a, b) => a.start - b.start || a.index - b.index);
}

/** Fixe la position de chaque tableau (migration des anciens projets enchaînés). */
export function freezeStarts(clips: Clip[]) {
  for (const tm of trackTimings(clips)) tm.clip.start = Math.round(tm.start * 1000) / 1000;
}

/** Enchaîne les tableaux dans l'ordre de la liste, en superposant les transitions. */
export function layoutSequential(clips: Clip[], from = 0) {
  let t = from;
  for (const c of clips) {
    c.start = Math.round(t * 1000) / 1000;
    t += c.duration - (c.transition !== 'cut' ? Math.min(c.transitionDuration, c.duration / 2) : 0);
  }
}

export function trackDuration(clips: Clip[]) {
  return trackTimings(clips).reduce((a, t) => Math.max(a, t.end), 0);
}

/** Durée totale : la plus longue des pistes. */
export function showDuration(show: Show) {
  return Math.max(trackDuration(show.clips), ...(show.layers ?? []).map((l) => trackDuration(l.clips)));
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private quad: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private transition: Program;
  private bright: Program;
  private blur: Program;
  private output: Program;
  private blend: Program;
  private tex: Record<'albedo' | 'depth' | 'normal' | 'zones' | 'edges' | 'zoneInfo', WebGLTexture | null> = {
    albedo: null, depth: null, normal: null, zones: null, edges: null, zoneInfo: null,
  };
  private blackTex: WebGLTexture;
  private aux = new Map<string, { key: string; tex: WebGLTexture; letters: Float32Array; count: number }>();
  private targets: { a: Target; b: Target; mix: Target; acc0: Target; acc1: Target; half: Target; q1: Target; q2: Target; e1: Target; e2: Target } | null = null;
  private w = 0;
  private h = 0;
  scene: SceneMaps | null = null;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 indisponible : utilisez un navigateur récent (Chrome, Edge, Firefox, Safari 17+).');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      console.warn('Rendu flottant indisponible, qualité réduite.');
    }
    gl.getExtension('OES_texture_float_linear');
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quad = vao;
    this.transition = new Program(gl, FULLSCREEN_VS, TRANSITION_FS, 'transition');
    this.bright = new Program(gl, FULLSCREEN_VS, BRIGHT_FS, 'bloom-seuil');
    this.blur = new Program(gl, FULLSCREEN_VS, BLUR_FS, 'bloom-flou');
    this.output = new Program(gl, FULLSCREEN_VS, OUTPUT_FS, 'sortie');
    this.blend = new Program(gl, FULLSCREEN_VS, BLEND_FS, 'fusion');
    this.blackTex = this.uploadRGBA(1, 1, new Uint8Array([0, 0, 0, 255]), true);
  }

  /** Compile (ou récupère) le programme d'un effet. */
  /** Oublie le programme compilé d'un effet (après modification de son code). */
  forgetProgram(id: string) {
    const p = this.programs.get(id);
    if (p) this.gl.deleteProgram(p.prog);
    this.programs.delete(id);
  }

  /** Compile un effet à part pour vérifier son code ; renvoie null si tout va bien, sinon le message. */
  tryCompile(effect: EffectDef): string | null {
    try {
      const p = new Program(this.gl, FULLSCREEN_VS, EFFECT_HEADER + effect.glsl + EFFECT_FOOTER, effect.name);
      this.gl.deleteProgram(p.prog);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  program(effect: EffectDef) {
    let p = this.programs.get(effect.id);
    if (!p) {
      p = new Program(this.gl, FULLSCREEN_VS, EFFECT_HEADER + effect.glsl + EFFECT_FOOTER, effect.name);
      this.programs.set(effect.id, p);
    }
    return p;
  }

  private uploadRGBA(w: number, h: number, data: Uint8Array, nearest = false, flip = true) {
    const gl = this.gl;
    let src = data;
    if (flip) {
      src = new Uint8Array(data.length);
      const row = w * 4;
      for (let y = 0; y < h; y++) src.set(data.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setScene(s: SceneMaps) {
    const gl = this.gl;
    for (const k of Object.keys(this.tex) as (keyof typeof this.tex)[]) if (this.tex[k]) gl.deleteTexture(this.tex[k]);
    this.scene = s;
    this.tex.albedo = this.uploadRGBA(s.width, s.height, s.albedo);
    this.tex.depth = this.uploadRGBA(s.width, s.height, s.depth);
    this.tex.normal = this.uploadRGBA(s.width, s.height, s.normal);
    this.tex.zones = this.uploadRGBA(s.width, s.height, s.zones, true);
    this.tex.edges = this.uploadRGBA(s.width, s.height, s.edges);
    const zi = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, zi);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 2, 0, gl.RGBA, gl.FLOAT, s.zoneInfo);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.tex.zoneInfo = zi;
    for (const a of this.aux.values()) gl.deleteTexture(a.tex);
    this.aux.clear();
  }

  resize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h && this.targets) return;
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.targets) for (const t of Object.values(this.targets)) deleteTarget(gl, t);
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    const ew = Math.max(2, w >> 3), eh = Math.max(2, h >> 3);
    this.targets = {
      a: createTarget(gl, w, h), b: createTarget(gl, w, h), mix: createTarget(gl, w, h), acc0: createTarget(gl, w, h), acc1: createTarget(gl, w, h),
      half: createTarget(gl, hw, hh), q1: createTarget(gl, qw, qh), q2: createTarget(gl, qw, qh),
      e1: createTarget(gl, ew, eh), e2: createTarget(gl, ew, eh),
    };
    this.w = w;
    this.h = h;
  }

  private draw(target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Fournisseur d'images/vidéos importées (défini par l'application). */
  mediaProvider: ((mediaId: string, clip: Clip, local: number) => { source: TexImageSource; dynamic: boolean } | null) | null = null;
  private mediaTex = new Map<string, { tex: WebGLTexture; src: TexImageSource | null }>();
  private auxAspect = 1;
  /** Qualité du rendu : 0 = aperçu, 1 = finale (ombres plus fines). */
  quality = 0;

  /** Appelé quand une police finit de se charger (pour redessiner). */
  onNeedRedraw: (() => void) | null = null;
  private letters = new Float32Array(256);
  private letterCount = 0;

  private auxFor(clip: Clip, local: number): WebGLTexture {
    this.letterCount = 0;
    if (clip.effect === 'media') return this.mediaFor(clip, local);
    const text = clip.params.text;
    if (typeof text !== 'string' || !this.scene) return this.blackTex;
    const y = Number(clip.params.y ?? 0.5);
    const size = Number(clip.params.size ?? 0.5);
    const family = FONTS[Number(clip.params.font ?? 0)] ?? FONTS[0];
    const key = `${text}|${y}|${size}|${family}|${this.scene.width}x${this.scene.height}`;
    const cached = this.aux.get(clip.id);
    if (cached && cached.key === key) {
      this.letters.set(cached.letters);
      this.letterCount = cached.count;
      return cached.tex;
    }
    if (cached) this.gl.deleteTexture(cached.tex);
    const W = 1600;
    const H = Math.round((W * this.scene.height) / this.scene.width);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    const lines = text.split('\n');
    let fs = (0.04 + size * 0.14) * H;
    const fontSpec = (px: number) => `${family.weight} ${px}px ${family.css}`;
    if (document.fonts && !document.fonts.check(fontSpec(40))) {
      document.fonts.load(fontSpec(40)).then(() => {
        this.aux.delete(clip.id);
        this.onNeedRedraw?.();
      }).catch(() => undefined);
    }
    ctx.font = fontSpec(fs);
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (maxW > W * 0.9) {
      fs *= (W * 0.9) / maxW;
      ctx.font = fontSpec(fs);
    }
    const cy = (1 - y) * H;
    const boxes = new Float32Array(256);
    let k = 0;
    lines.forEach((l, li) => {
      const base = cy + (li - (lines.length - 1) / 2) * fs * 1.15 + fs * 0.35;
      let x = W / 2 - ctx.measureText(l).width / 2;
      for (const ch of l) {
        const w = ctx.measureText(ch).width;
        if (ch.trim() && k < 254) {
          // rouge = forme, vert = numéro de lettre (rapport vert/rouge, robuste à l'anticrénelage)
          ctx.fillStyle = `rgb(255,${k + 1},0)`;
          ctx.fillText(ch, x, base);
          if (k < 64) boxes.set([x / W - 0.004, 1 - (base + fs * 0.25) / H, (x + w) / W + 0.004, 1 - (base - fs * 0.95) / H], k * 4);
          k++;
        }
        x += w;
      }
    });
    const img = ctx.getImageData(0, 0, W, H);
    const tex = this.uploadRGBA(W, H, new Uint8Array(img.data.buffer));
    const count = Math.min(64, k);
    this.aux.set(clip.id, { key, tex, letters: boxes, count });
    this.letters.set(boxes);
    this.letterCount = count;
    return tex;
  }

  private mediaFor(clip: Clip, local: number): WebGLTexture {
    const id = String(clip.params.media ?? '');
    const m = id && this.mediaProvider ? this.mediaProvider(id, clip, local) : null;
    if (!m) return this.blackTex;
    const src = m.source as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
    const mw = src.videoWidth || src.width || 1, mh = src.videoHeight || src.height || 1;
    this.auxAspect = mw / mh;
    const gl = this.gl;
    let e = this.mediaTex.get(id);
    if (!e) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e = { tex, src: null };
      this.mediaTex.set(id, e);
    }
    if (m.dynamic || e.src !== m.source) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, m.source);
      } catch {
        /* image vidéo pas encore prête */
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      e.src = m.source;
    }
    return e.tex;
  }

  forgetMedia(id: string) {
    const e = this.mediaTex.get(id);
    if (e) this.gl.deleteTexture(e.tex);
    this.mediaTex.delete(id);
  }

  private renderClip(clip: Clip, local: number, audio: AudioFrame, show: Show, time: number, target: Target) {
    const effect = EFFECT_MAP.get(clip.effect);
    if (!effect || !this.scene) return;
    const p = this.program(effect).use();
    const s = this.scene;
    const prog = effectiveProgress(clip, local);
    const t0 = clip.cut?.t0 ?? 0;
    const fullDur = clip.cut ? clip.duration / Math.max(1e-3, clip.cut.p1 - clip.cut.p0) : clip.duration;
    p.tex('uAlbedo', 0, this.tex.albedo).tex('uDepth', 1, this.tex.depth).tex('uNormal', 2, this.tex.normal)
      .tex('uZones', 3, this.tex.zones).tex('uEdges', 4, this.tex.edges).tex('uZoneInfo', 5, this.tex.zoneInfo)
      .tex('uAux', 6, this.auxFor(clip, local + t0));
    p.f('uAuxAspect', this.auxAspect);
    this.gl.uniform4fv(p.loc('uLetters'), this.letters);
    p.f('uLetterCount', this.letterCount);
    p.v2('uRes', target.w, target.h).v2('uZoneRes', s.width, s.height).f('uAspect', s.width / s.height);
    const t = Math.max(local, 0) + t0;
    p.f('uTime', time).f('uT', t).f('uP', prog).f('uDur', fullDur).f('uQuality', this.quality);
    p.f('uBeat', audio.beat).f('uBeatPhase', audio.beatPhase).f('uBeatIndex', audio.beatIndex).f('uEnergy', audio.energy);
    p.f('uBass', audio.bass ?? audio.beat).f('uMid', audio.mid ?? 0.5).f('uHigh', audio.high ?? 0.3);
    this.gl.uniform1fv(p.loc('uSpec'), audio.spec ?? new Float32Array(16));
    p.f('uRelief', show.master.relief).f('uSeed', seedFrom(clip.id)).f('uZoneCount', s.zoneCount);
    // valeurs par défaut des emplacements
    p.f('uIntensity', 1).f('uSpeed', 1).v3('uColA', [1, 1, 1]).v3('uColB', [1, 1, 1]).f('uParamA', 0.5).f('uParamB', 0.5).f('uParamC', 0).f('uParamD', 0).f('uParamE', 0).f('uParamF', 0).f('uParamG', 0);
    p.f('uTarget', 0).f('uTargetBg', 0).f('uReact', 0).f('uReactBand', 0).f('uMirror', 0).f('uHue', 0).f('uSat', 1);
    for (const def of [...effect.params, ...COMMON_PARAMS]) {
      if (def.slot === 'aux') continue;
      const v = paramAt(clip, def.key, prog, def.default);
      if (def.type === 'color') p.v3(def.slot, hexToRgb(String(v)));
      else if (def.type === 'toggle') p.f(def.slot, v ? 1 : 0);
      else p.f(def.slot, Number(v));
    }
    this.draw(target);
  }

  private clearTarget(t: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Transition entre deux tableaux (ou un seul si B est nul) rendue dans `out`. */
  renderPair(A: { clip: Clip; local: number } | null, B: { clip: Clip; local: number } | null, m: number, type: string,
    audio: AudioFrame, show: Show, time: number, out: Target) {
    const T = this.targets!;
    if (!A && !B) return this.clearTarget(out);
    if (!A || !B) {
      const one = (A ?? B)!;
      return this.renderClip(one.clip, one.local, audio, show, time, out);
    }
    this.renderClip(A.clip, A.local, audio, show, time, T.a);
    this.renderClip(B.clip, B.local, audio, show, time, T.b);
    const p = this.transition.use();
    p.tex('uA', 0, T.a.tex).tex('uB', 1, T.b.tex).tex('uZones', 3, this.tex.zones).tex('uZoneInfo', 5, this.tex.zoneInfo)
      .tex('uAlbedo', 7, this.tex.albedo);
    p.v2('uRes', out.w, out.h).v2('uZoneRes', this.scene!.width, this.scene!.height).f('uAspect', this.scene!.width / this.scene!.height);
    p.f('uMix', Math.min(Math.max(m, 0), 1)).i('uType', Math.max(0, TRANSITIONS.findIndex((x) => x.id === type)));
    this.draw(out);
  }

  private blackClip: Clip = { id: '__noir', effect: 'vide', duration: 1, params: {}, transition: 'cut', transitionDuration: 0 };

  /** Rend une piste à l'instant tt dans `out` : vide = noir, chevauchement = transition. */
  private renderTrack(clips: Clip[], tt: number, audio: AudioFrame, show: Show, out: Target) {
    const tms = trackTimings(clips);
    const act = tms.filter((x) => tt >= x.start && tt < x.end);
    if (!act.length) return this.clearTarget(out);
    if (act.length >= 2) {
      const B = act[act.length - 1], A = act[act.length - 2];
      const o0 = B.start, o1 = Math.min(A.end, B.end);
      const m = (tt - o0) / Math.max(1e-3, o1 - o0);
      return this.renderPair({ clip: A.clip, local: tt - A.start }, { clip: B.clip, local: tt - B.start }, m, A.clip.transition, audio, show, tt, out);
    }
    const X = act[0];
    const fade = X.clip.fade ?? 0.6;
    let k = 1;
    if (fade > 0) {
      const before = tms.some((y) => y !== X && y.start < X.start && y.end >= X.start - 0.02);
      const after = tms.some((y) => y !== X && y.start > X.start && y.start <= X.end + 0.02);
      if (!before) k = Math.min(k, (tt - X.start) / fade);
      if (!after) k = Math.min(k, (X.end - tt) / fade);
    }
    if (k < 1) return this.renderPair({ clip: this.blackClip, local: 0 }, { clip: X.clip, local: tt - X.start }, Math.max(0, k), 'fondu', audio, show, tt, out);
    this.renderClip(X.clip, tt - X.start, audio, show, tt, out);
  }

  private composite(base: Target, layer: Target, opacity: number, blend: string, out: Target) {
    const p = this.blend.use();
    p.tex('uBase', 0, base.tex).tex('uLayer', 1, layer.tex).f('uOpacity', opacity).i('uMode', blend === 'screen' ? 1 : blend === 'max' ? 2 : 0);
    this.draw(out);
  }

  /** Rend l'image du spectacle à l'instant `time` sur le canevas. */
  render(show: Show, time: number, audio: AudioFrame, mode: ViewMode, opts: { fade?: boolean } = {}) {
    if (!this.targets || !this.scene) return;
    const T = this.targets;
    const total = showDuration(show);
    let acc = T.acc0, other = T.acc1;
    if (total === 0 || mode === 'jour') this.clearTarget(acc);
    else {
      const tt = Math.min(Math.max(time, 0), Math.max(total - 1e-4, 0));
      this.renderTrack(show.clips, tt, audio, show, acc);
      for (const layer of show.layers ?? []) {
        if (layer.muted || !layer.clips.length) continue;
        this.renderTrack(layer.clips, tt, audio, show, T.mix);
        this.composite(acc, T.mix, layer.opacity, layer.blend, other);
        [acc, other] = [other, acc];
      }
    }
    let fade = 1;
    if (opts.fade !== false && total > 0) fade = Math.min(1, Math.max(0, time / 0.6)) * Math.min(1, Math.max(0, (total - time) / 1.2));
    this.finish(acc, show, mode, fade);
  }

  /** Mode live : deux tableaux et un fondu calculés par l'application. */
  renderLive(A: { clip: Clip; local: number } | null, B: { clip: Clip; local: number } | null, m: number, type: string,
    audio: AudioFrame, show: Show, time: number, mode: ViewMode, master: number) {
    if (!this.targets || !this.scene) return;
    this.renderPair(A, B, m, type, audio, show, time, this.targets.acc0);
    this.finish(this.targets.acc0, show, mode, master);
  }

  private finish(sceneTarget: Target, show: Show, mode: ViewMode, fade: number) {
    const T = this.targets!;
    // bloom
    this.bright.use().tex('uTex', 0, sceneTarget.tex).f('uThreshold', 0.6);
    this.draw(T.half);
    this.blur.use().tex('uTex', 0, T.half.tex).v2('uDir', 1 / T.q1.w, 0);
    this.draw(T.q1);
    this.blur.use().tex('uTex', 0, T.q1.tex).v2('uDir', 0, 1 / T.q1.h);
    this.draw(T.q2);
    this.blur.use().tex('uTex', 0, T.q2.tex).v2('uDir', 2 / T.e1.w, 0);
    this.draw(T.e1);
    this.blur.use().tex('uTex', 0, T.e1.tex).v2('uDir', 0, 2 / T.e1.h);
    this.draw(T.e2);
    const o = this.output.use();
    o.tex('uScene', 0, sceneTarget.tex).tex('uBloomA', 1, T.q2.tex).tex('uBloomB', 2, T.e2.tex).tex('uAlbedo', 3, this.tex.albedo).tex('uZones', 4, this.tex.zones);
    o.i('uMode', mode === 'projection' ? 0 : mode === 'simulation' ? 1 : 2);
    o.f('uBright', show.master.brightness).f('uBloom', show.master.bloom).f('uFade', fade).f('uVignette', show.master.vignette).f('uAmbient', show.master.ambient ?? 0.06);
    this.draw(null);
  }

  /** Écran noir (hors des horaires programmés). */
  blackout() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Rendu d'un aperçu « carte » (profondeur, normales…) pour l'éditeur de calques. */
  showMap(kind: 'depth' | 'normal' | 'edges' | 'albedo') {
    if (!this.targets || !this.scene) return;
    const o = this.output.use();
    const t = kind === 'depth' ? this.tex.depth : kind === 'normal' ? this.tex.normal : kind === 'edges' ? this.tex.edges : this.tex.albedo;
    o.tex('uScene', 0, t).tex('uBloomA', 1, this.blackTex).tex('uBloomB', 2, this.blackTex).tex('uAlbedo', 3, this.tex.albedo).tex('uZones', 4, this.tex.zones);
    o.i('uMode', 0).f('uBright', 1).f('uBloom', 0).f('uFade', 1).f('uVignette', 0).f('uAmbient', 0.06);
    this.draw(null);
  }

  /** Compile tous les effets (détection précoce des erreurs). */
  precompileAll(effects: EffectDef[]) {
    const errors: string[] = [];
    for (const e of effects) {
      try {
        this.program(e);
      } catch (err) {
        errors.push(`${e.name}: ${(err as Error).message}`);
      }
    }
    return errors;
  }

  readPixels(): Uint8Array {
    const gl = this.gl;
    const px = new Uint8Array(this.w * this.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }
}
