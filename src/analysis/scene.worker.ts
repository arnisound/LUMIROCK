// Calcul des cartes de la façade en arrière-plan : l'interface reste fluide.
import { buildScene } from './maps';
import type { Zone } from '../types';
import type { LineStyle } from './maps';

self.onmessage = (e: MessageEvent<{ id: number; image: ImageData; zones: Zone[]; aiDepth: Float32Array | null; lines?: LineStyle }>) => {
  const { id, image, zones, aiDepth, lines } = e.data;
  try {
    const s = buildScene(image, zones, { aiDepth, lines });
    (self as unknown as Worker).postMessage({ id, scene: s }, [s.albedo.buffer, s.depth.buffer, s.normal.buffer, s.zones.buffer, s.edges.buffer, s.zoneInfo.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
