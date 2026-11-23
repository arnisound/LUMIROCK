// Sortie projecteur avec calage intégré (déformation par coins + grille fine).
// Tout tourne dans la fenêtre de sortie, pilotée depuis la fenêtre principale.
import { homography } from '../analysis/rectify';
import type { Pt } from '../types';

export interface Calibration {
  corners: Pt[]; // haut-gauche, haut-droit, bas-droit, bas-gauche (0..1 dans la fenêtre de sortie)
  n: number; // points par côté de la grille fine (2 = coins seuls)
  offsets: Pt[]; // décalages de la grille fine (n × n), en coordonnées 0..1
}

export function defaultCalibration(): Calibration {
  return { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], n: 2, offsets: [] };
}

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; out vec2 vUv;
void main() { vUv = aUv; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex;
uniform vec2 uRange;   // portion horizontale de l'image confiée à ce projecteur
uniform vec2 uBlend;   // largeur du fondu à gauche / à droite (0 = aucun)
void main() {
  float x = mix(uRange.x, uRange.y, vUv.x);
  vec3 c = texture(uTex, vec2(x, 1.0 - vUv.y)).rgb;
  float f = 1.0;
  if (uBlend.x > 0.0) f *= smoothstep(uRange.x, uRange.x + uBlend.x, x);
  if (uBlend.y > 0.0) f *= 1.0 - smoothstep(uRange.y - uBlend.y, uRange.y, x);
  o = vec4(c * pow(f, 1.0 / 2.2), 1.0);
}`;

/** Découpe de l'image pour N projecteurs côte à côte avec recouvrement. */
export function outputSlice(index: number, total: number, overlap: number) {
  if (total <= 1) return { range: [0, 1] as [number, number], blend: [0, 0] as [number, number] };
  const s = (1 + (total - 1) * overlap) / total;
  const x0 = index * (s - overlap);
  return { range: [x0, x0 + s] as [number, number], blend: [index > 0 ? overlap : 0, index < total - 1 ? overlap : 0] as [number, number] };
}

const MESH = 32;

export class OutputWarp {
  private gl: WebGL2RenderingContext;
  private cv: HTMLCanvasElement;
  private ov: HTMLCanvasElement;
  private help: HTMLDivElement;
  private tex: WebGLTexture;
  private buf: WebGLBuffer;
  private count = 0;
  calibrating = false;
  showMire = true;
  private sel = 0;
  private drag = false;
  private meshDirty = true;
  private mireSrc: HTMLCanvasElement | OffscreenCanvas | null = null;
  private mireUploaded = false;
  private prog: WebGLProgram;
  slice = outputSlice(0, 1, 0);
  label = '';

  constructor(
    private win: Window,
    private video: HTMLVideoElement,
    public calib: Calibration,
    private onChange: (c: Calibration) => void,
    private getMire: () => HTMLCanvasElement | OffscreenCanvas | null,
  ) {
    const d = win.document;
    this.cv = d.createElement('canvas');
    this.ov = d.createElement('canvas');
    for (const c of [this.cv, this.ov]) c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
    this.help = d.createElement('div');
    this.help.style.cssText = 'position:fixed;left:16px;top:16px;max-width:430px;font:13px/1.5 sans-serif;color:#eee;background:rgba(10,12,18,.88);border:1px solid #e0a23e;border-radius:10px;padding:12px 14px;display:none;z-index:3';
    d.body.append(this.cv, this.ov, this.help);
    const gl = this.cv.getContext('webgl2', { antialias: true, alpha: false })!;
    this.gl = gl;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aUv');
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.bind();
    const loop = () => {
      if (win.closed) return;
      this.frame();
      win.requestAnimationFrame(loop);
    };
    win.requestAnimationFrame(loop);
  }

  private ensureOffsets() {
    const c = this.calib;
    if (c.n < 2) c.n = 2;
    if (c.offsets.length !== c.n * c.n) c.offsets = Array.from({ length: c.n * c.n }, () => [0, 0] as Pt);
  }

  /** Position (0..1 fenêtre) du point source (u, v) après déformation. */
  private warp(u: number, v: number, H: number[]): Pt {
    const w = H[6] * u + H[7] * v + H[8];
    let x = (H[0] * u + H[1] * v + H[2]) / w;
    let y = (H[3] * u + H[4] * v + H[5]) / w;
    const c = this.calib;
    if (c.n > 2) {
      const gx = u * (c.n - 1), gy = v * (c.n - 1);
      const i = Math.min(c.n - 2, Math.floor(gx)), j = Math.min(c.n - 2, Math.floor(gy));
      const fx = gx - i, fy = gy - j;
      const o = (a: number, b: number) => c.offsets[b * c.n + a];
      for (const k of [0, 1] as const) {
        const val = (o(i, j)[k] * (1 - fx) + o(i + 1, j)[k] * fx) * (1 - fy) + (o(i, j + 1)[k] * (1 - fx) + o(i + 1, j + 1)[k] * fx) * fy;
        if (k === 0) x += val;
        else y += val;
      }
    }
    return [x, y];
  }

  private homog() {
    return homography([[0, 0], [1, 0], [1, 1], [0, 1]], this.calib.corners);
  }

  private buildMesh() {
    this.ensureOffsets();
    const H = this.homog();
    const data: number[] = [];
    const P = (u: number, v: number) => [...this.warp(u, v, H), u, v];
    for (let j = 0; j < MESH; j++)
      for (let i = 0; i < MESH; i++) {
        const u0 = i / MESH, u1 = (i + 1) / MESH, v0 = j / MESH, v1 = (j + 1) / MESH;
        data.push(...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v0), ...P(u1, v1), ...P(u0, v1));
      }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    this.count = data.length / 4;
    this.meshDirty = false;
  }

  /** Points manipulables : coins (n = 2) ou grille fine. */
  private handles(): Pt[] {
    this.ensureOffsets();
    const c = this.calib;
    if (c.n === 2) return c.corners;
    const H = this.homog();
    const pts: Pt[] = [];
    for (let j = 0; j < c.n; j++) for (let i = 0; i < c.n; i++) pts.push(this.warp(i / (c.n - 1), j / (c.n - 1), H));
    return pts;
  }

  private moveHandle(k: number, dx: number, dy: number) {
    const c = this.calib;
    if (c.n === 2) c.corners[k] = [c.corners[k][0] + dx, c.corners[k][1] + dy];
    else c.offsets[k] = [c.offsets[k][0] + dx, c.offsets[k][1] + dy];
    this.meshDirty = true;
    this.onChange(c);
  }

  setCalibrating(on: boolean) {
    this.calibrating = on;
    this.mireUploaded = false;
    this.win.document.body.style.cursor = on ? 'crosshair' : 'none';
    this.help.style.display = on ? 'block' : 'none';
    this.renderHelp();
  }

  reset() {
    this.calib = defaultCalibration();
    this.meshDirty = true;
    this.sel = 0;
    this.onChange(this.calib);
    this.renderHelp();
  }

  private renderHelp() {
    const c = this.calib;
    this.help.innerHTML = `<b style="color:#e0a23e">CALAGE DU PROJECTEUR${this.label ? ' ' + this.label : ''}</b><br>
      Glissez les points pour faire coïncider l'image avec le monument.<br>
      <b>Tab</b> point suivant · <b>flèches</b> ajuster (Maj = ×10)<br>
      <b>G</b> grille : ${c.n === 2 ? '<u>4 coins</u> · 3×3 · 5×5' : c.n === 3 ? '4 coins · <u>3×3</u> · 5×5' : '4 coins · 3×3 · <u>5×5</u>'}<br>
      <b>M</b> ${this.showMire ? '<u>mire</u> / spectacle' : 'mire / <u>spectacle</u>'} · <b>R</b> réinitialiser · <b>H</b> masquer l'aide<br>
      <b>C</b> ou <b>Échap</b> : terminer le calage · double-clic : plein écran`;
  }

  private bind() {
    const d = this.win.document;
    const norm = (e: MouseEvent): Pt => [e.clientX / this.win.innerWidth, e.clientY / this.win.innerHeight];
    d.addEventListener('pointerdown', (e) => {
      if (!this.calibrating) return;
      const p = norm(e);
      const hs = this.handles();
      let best = -1, bd = 0.04;
      hs.forEach((h, i) => {
        const dd = Math.hypot((h[0] - p[0]) * this.win.innerWidth, (h[1] - p[1]) * this.win.innerHeight) / this.win.innerWidth;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      if (best >= 0) {
        this.sel = best;
        this.drag = true;
      }
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.calibrating || !this.drag) return;
      const p = norm(e);
      const h = this.handles()[this.sel];
      this.moveHandle(this.sel, p[0] - h[0], p[1] - h[1]);
    });
    d.addEventListener('pointerup', () => (this.drag = false));
    d.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'c' || (k === 'escape' && this.calibrating)) {
        e.preventDefault();
        this.setCalibrating(!this.calibrating && k === 'c');
        return;
      }
      if (!this.calibrating) return;
      const px = (e.shiftKey ? 10 : 1);
      const dx = px / this.win.innerWidth, dy = px / this.win.innerHeight;
      if (k === 'tab') {
        e.preventDefault();
        this.sel = (this.sel + (e.shiftKey ? -1 : 1) + this.handles().length) % this.handles().length;
      } else if (k === 'arrowleft') this.moveHandle(this.sel, -dx, 0);
      else if (k === 'arrowright') this.moveHandle(this.sel, dx, 0);
      else if (k === 'arrowup') this.moveHandle(this.sel, 0, -dy);
      else if (k === 'arrowdown') this.moveHandle(this.sel, 0, dy);
      else if (k === 'm') {
        this.showMire = !this.showMire;
        this.mireUploaded = false;
        this.renderHelp();
      } else if (k === 'g') {
        this.calib.n = this.calib.n === 2 ? 3 : this.calib.n === 3 ? 5 : 2;
        this.calib.offsets = [];
        this.sel = 0;
        this.meshDirty = true;
        this.onChange(this.calib);
        this.renderHelp();
      } else if (k === 'r') this.reset();
      else if (k === 'h') this.help.style.display = this.help.style.display === 'none' ? 'block' : 'none';
      else return;
      e.preventDefault();
    });
  }

  private frame() {
    const w = this.win, gl = this.gl;
    const dpr = w.devicePixelRatio || 1;
    const W = Math.round(w.innerWidth * dpr), H = Math.round(w.innerHeight * dpr);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = this.ov.width = W;
      this.cv.height = this.ov.height = H;
    }
    if (this.meshDirty) this.buildMesh();
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (this.calibrating && this.showMire) {
      if (!this.mireUploaded) {
        this.mireSrc = this.getMire();
        if (this.mireSrc) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.mireSrc as TexImageSource);
        this.mireUploaded = true;
      }
    } else if (this.video.readyState >= 2) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRange'), this.slice.range[0], this.slice.range[1]);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uBlend'), this.slice.blend[0], this.slice.blend[1]);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    // poignées
    const ctx = this.ov.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (!this.calibrating) return;
    const hs = this.handles();
    const n = this.calib.n;
    ctx.strokeStyle = 'rgba(224,162,62,0.8)';
    ctx.lineWidth = 1.5 * dpr;
    if (n > 2) {
      for (let j = 0; j < n; j++) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const [x, y] = hs[j * n + i];
          if (i) ctx.lineTo(x * W, y * H);
          else ctx.moveTo(x * W, y * H);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const [x, y] = hs[i * n + j];
          if (i) ctx.lineTo(x * W, y * H);
          else ctx.moveTo(x * W, y * H);
        }
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      hs.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.closePath();
      ctx.stroke();
    }
    hs.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x * W, y * H, (i === this.sel ? 11 : 7) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = i === this.sel ? '#ffffff' : '#e0a23e';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();
    });
  }
}
