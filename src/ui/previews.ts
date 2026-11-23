// Vignettes des tableaux, rendues sur la façade du projet ; animées au survol.
import { Renderer, SceneMaps } from '../gl/renderer';
import { newClip } from '../scenarios';
import type { Show } from '../types';

export class Previews {
  private renderer: Renderer | null = null;
  private canvas = document.createElement('canvas');
  private targets = new Map<string, HTMLCanvasElement>();
  private queue: string[] = [];
  private hovered: string | null = null;
  private raf = 0;
  private scene: SceneMaps | null = null;
  private t0 = 0;
  private shows = new Map<string, Show>();

  register(effect: string, cv: HTMLCanvasElement) {
    this.targets.set(effect, cv);
  }

  private showFor(effect: string): Show {
    let s = this.shows.get(effect);
    if (!s) {
      const c = newClip(effect, 8);
      if (effect === 'texte') c.params.text = 'Lumirock';
      s = { clips: [c], bpm: 110, master: { brightness: 1, bloom: 0.6, relief: 0.6, vignette: 0, ambient: 0.06 } };
      this.shows.set(effect, s);
    }
    return s;
  }

  start(scene: SceneMaps | null) {
    if (!scene) return;
    try {
      this.renderer ??= new Renderer(this.canvas);
    } catch {
      return;
    }
    if (this.scene !== scene) {
      this.renderer.setScene(scene);
      this.scene = scene;
    }
    const aspect = scene.width / scene.height;
    const W = 160, H = Math.round(W / Math.max(0.6, Math.min(aspect, 2.2)));
    this.renderer.resize(W, H);
    for (const cv of this.targets.values()) {
      cv.width = W;
      cv.height = H;
    }
    this.queue = [...this.targets.keys()];
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.tick());
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.targets.clear();
    this.queue = [];
    this.hovered = null;
  }

  forget(effect: string) {
    this.renderer?.forgetProgram(effect);
    this.shows.delete(effect);
  }

  hover(effect: string | null) {
    this.hovered = effect;
    this.t0 = performance.now();
  }

  private draw(effect: string, t: number) {
    const cv = this.targets.get(effect);
    if (!cv || !this.renderer) return;
    this.renderer.render(this.showFor(effect), t, { beat: Math.exp(-((t * 1.8) % 1) * 5), beatPhase: (t * 1.8) % 1, beatIndex: Math.floor(t * 1.8), energy: 0.6 }, 'simulation', { fade: false });
    cv.getContext('2d')!.drawImage(this.canvas, 0, 0, cv.width, cv.height);
  }

  private tick() {
    // quelques vignettes fixes par image, puis l'animation de la vignette survolée
    for (let k = 0; k < 3 && this.queue.length; k++) this.draw(this.queue.shift()!, 4.4);
    if (this.hovered) this.draw(this.hovered, 0.5 + ((performance.now() - this.t0) / 1000) % 7.5);
    if (this.queue.length || this.hovered || this.targets.size) this.raf = requestAnimationFrame(() => this.tick());
  }
}
