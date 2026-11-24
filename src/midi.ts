// Contrôleur MIDI pour le mode live (Web MIDI) : apprentissage des pads et faders, horloge MIDI → tempo.

export type MidiAction = string; // 'pad:3', 'master', 'fade', 'blackout', 'next', 'tap'

export interface MidiHandlers {
  action: (a: MidiAction, value: number) => void; // value 0..1 (vélocité ou position du fader)
  clock: (bpm: number) => void;
  clockStart: () => void;
  changed: () => void; // état (appareils, apprentissage) modifié
}

const STORE = 'lumirock.midi';

/** Libellé lisible d'un message MIDI (« Note 36 », « CC 7 »). */
export function msgLabel(k: string) {
  const [t, ch, n] = k.split(':');
  return `${t === 'n' ? 'Note' : 'CC'} ${n}${ch !== '0' ? ` (canal ${Number(ch) + 1})` : ''}`;
}

export class MidiController {
  access: MIDIAccess | null = null;
  devices: string[] = [];
  map: Record<MidiAction, string> = {}; // action → message
  learning: MidiAction | null = null;
  followClock = true;
  error = '';
  private ticks: number[] = [];
  private lastClockBpm = 0;

  constructor(private h: MidiHandlers) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      this.map = raw.map ?? {};
      this.followClock = raw.followClock ?? true;
    } catch { /* stockage indisponible */ }
  }

  static supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ map: this.map, followClock: this.followClock }));
    } catch { /* ignore */ }
  }

  async connect() {
    if (!MidiController.supported()) {
      this.error = 'Ce navigateur ne gère pas le MIDI (utilisez Chrome, Edge ou Opera).';
      this.h.changed();
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.error = 'Accès MIDI refusé par le navigateur.';
      this.h.changed();
      return false;
    }
    this.error = '';
    this.bind();
    this.access.onstatechange = () => this.bind();
    return true;
  }

  private bind() {
    if (!this.access) return;
    this.devices = [];
    this.access.inputs.forEach((inp) => {
      inp.onmidimessage = (e) => this.onMessage(e.data);
      if (inp.state === 'connected') this.devices.push(inp.name ?? 'Appareil MIDI');
    });
    this.h.changed();
  }

  learn(a: MidiAction | null) {
    this.learning = a;
    this.h.changed();
  }

  unbind(a: MidiAction) {
    delete this.map[a];
    this.save();
    this.h.changed();
  }

  labelFor(a: MidiAction) {
    return this.map[a] ? msgLabel(this.map[a]) : '—';
  }

  /** Traite un message brut (exposé pour les tests). */
  onMessage(data: Uint8Array | null) {
    if (!data || !data.length) return;
    const st = data[0];
    // horloge : 24 impulsions par noire
    if (st === 0xf8) {
      if (!this.followClock) return;
      const now = performance.now();
      this.ticks.push(now);
      if (this.ticks.length > 49) this.ticks.shift();
      if (this.ticks.length >= 25) {
        const iv = (this.ticks[this.ticks.length - 1] - this.ticks[0]) / (this.ticks.length - 1);
        const bpm = Math.round((60000 / (iv * 24)) * 10) / 10;
        if (bpm > 30 && bpm < 300 && Math.abs(bpm - this.lastClockBpm) >= 0.3) {
          this.lastClockBpm = bpm;
          this.h.clock(bpm);
        }
      }
      return;
    }
    if (st === 0xfa || st === 0xfb) {
      this.ticks = [];
      if (this.followClock) this.h.clockStart();
      return;
    }
    const type = st & 0xf0, ch = st & 0x0f;
    let key: string, value: number;
    if (type === 0x90 && data[2] > 0) {
      key = `n:${ch}:${data[1]}`;
      value = data[2] / 127;
    } else if (type === 0xb0) {
      key = `c:${ch}:${data[1]}`;
      value = data[2] / 127;
    } else return; // note off et autres messages ignorés
    if (this.learning) {
      for (const a of Object.keys(this.map)) if (this.map[a] === key) delete this.map[a];
      this.map[this.learning] = key;
      this.learning = null;
      this.save();
      this.h.changed();
      return;
    }
    const act = Object.keys(this.map).find((a) => this.map[a] === key);
    if (act) this.h.action(act, value);
    else if (key.startsWith('n:') && data[1] >= 36 && data[1] < 36 + 33) this.h.action(`pad:${data[1] - 36}`, value); // pads usuels (note 36 = C1)
  }
}
