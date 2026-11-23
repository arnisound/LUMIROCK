// Historique Annuler / Rétablir : instantanés légers du projet (calques, spectacle, nom).
import type { Project } from './types';

type Snap = string;

export class History {
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private current: Snap | null = null;
  private timer = 0;
  onChange: (() => void) | null = null;

  private snap(p: Project): Snap {
    return JSON.stringify({ name: p.name, zones: p.zones, show: p.show, media: p.media ?? [] });
  }

  /** Réinitialise l'historique (nouveau projet, ouverture). */
  reset(p: Project) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = this.snap(p);
    this.onChange?.();
  }

  /** Enregistre l'état courant (regroupe les modifications rapprochées). */
  commit(p: Project, immediate = false) {
    clearTimeout(this.timer);
    const run = () => {
      const s = this.snap(p);
      if (s === this.current) return;
      if (this.current) this.undoStack.push(this.current);
      if (this.undoStack.length > 150) this.undoStack.shift();
      this.current = s;
      this.redoStack = [];
      this.onChange?.();
    };
    if (immediate) run();
    else this.timer = window.setTimeout(run, 350);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  /** Renvoie l'état à restaurer, ou null. */
  undo(p: Project): Partial<Project> | null {
    this.commit(p, true);
    const prev = this.undoStack.pop();
    if (!prev || !this.current) return null;
    this.redoStack.push(this.current);
    this.current = prev;
    this.onChange?.();
    return JSON.parse(prev);
  }

  redo(): Partial<Project> | null {
    const next = this.redoStack.pop();
    if (!next || !this.current) return null;
    this.undoStack.push(this.current);
    this.current = next;
    this.onChange?.();
    return JSON.parse(next);
  }
}
