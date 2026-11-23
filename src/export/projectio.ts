// Sauvegarde : fichier .lumirock (zip) et sauvegarde automatique dans le navigateur (IndexedDB).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project, Pt } from '../types';

export interface SavedState {
  project: Project;
  quad: Pt[];
  source: Blob | null; // photo d'origine
  facade: Blob | null; // façade redressée (PNG)
  aiDepth: Blob | null; // profondeur IA (PNG)
  audio: { blob: Blob; name: string } | null;
}

export async function saveLumirock(s: SavedState): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    'projet.json': strToU8(JSON.stringify({ project: s.project, quad: s.quad, audioName: s.audio?.name ?? null }, null, 2)),
  };
  if (s.source) files['source.img'] = new Uint8Array(await s.source.arrayBuffer());
  if (s.facade) files['facade.png'] = new Uint8Array(await s.facade.arrayBuffer());
  if (s.aiDepth) files['profondeur_ia.png'] = new Uint8Array(await s.aiDepth.arrayBuffer());
  if (s.audio) files['musique.audio'] = new Uint8Array(await s.audio.blob.arrayBuffer());
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

export async function loadLumirock(file: Blob): Promise<SavedState> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files['projet.json']) throw new Error('Fichier .lumirock invalide.');
  const meta = JSON.parse(strFromU8(files['projet.json']));
  const blob = (k: string, type = '') => (files[k] ? new Blob([files[k] as BlobPart], { type }) : null);
  const audio = blob('musique.audio');
  return {
    project: meta.project,
    quad: meta.quad,
    source: blob('source.img'),
    facade: blob('facade.png', 'image/png'),
    aiDepth: blob('profondeur_ia.png', 'image/png'),
    audio: audio ? { blob: audio, name: meta.audioName ?? 'musique' } : null,
  };
}

// ── IndexedDB
const DB = 'lumirock';
const STORE = 'state';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function autosave(s: SavedState) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(s, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('Sauvegarde automatique impossible', e);
  }
}

export async function loadAutosave(): Promise<SavedState | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get('current');
      r.onsuccess = () => res((r.result as SavedState) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
