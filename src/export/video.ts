// Export vidéo entièrement dans le navigateur (WebCodecs via Mediabunny).
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_HIGH,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { AudioAnalysis, audioFrameAt } from '../audio';
import { Renderer, SceneMaps, ViewMode, computeTimings } from '../gl/renderer';
import type { Show } from '../types';

export interface VideoExportOptions {
  scene: SceneMaps;
  show: Show;
  analysis: AudioAnalysis | null;
  width: number;
  height: number;
  fps: number;
  t0: number;
  t1: number;
  withAudio: boolean;
  fade: boolean;
  quality: 'haute' | 'tres-haute';
  mode?: ViewMode;
  onProgress?: (ratio: number, msg: string) => void;
  signal?: AbortSignal;
}

export async function videoCodecFor(width: number, height: number) {
  return getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
}

function sliceAudio(buf: AudioBuffer, t0: number, t1: number) {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(t0 * sr));
  const b = Math.min(buf.length, Math.ceil(t1 * sr));
  const len = Math.max(1, b - a);
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

export async function exportVideo(o: VideoExportOptions): Promise<{ blob: Blob; codec: string }> {
  const W = Math.round(o.width / 2) * 2;
  const H = Math.round(o.height / 2) * 2;
  const codec = await videoCodecFor(W, H);
  if (!codec) throw new Error('Votre navigateur ne sait pas encoder de vidéo à cette taille. Essayez une résolution plus petite ou Chrome/Edge.');
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  renderer.setScene(o.scene);
  renderer.resize(W, H);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, quality: o.quality === 'tres-haute' ? QUALITY_VERY_HIGH : QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(video, { frameRate: o.fps });
  let audioSrc: AudioBufferSource | null = null;
  if (o.withAudio && o.analysis) {
    const ac = await getFirstEncodableAudioCodec(['aac', 'opus']);
    if (ac) {
      audioSrc = new AudioBufferSource({ codec: ac, quality: QUALITY_HIGH });
      output.addAudioTrack(audioSrc);
    }
  }
  await output.start();
  const frames = Math.max(1, Math.round((o.t1 - o.t0) * o.fps));
  for (let i = 0; i < frames; i++) {
    if (o.signal?.aborted) {
      await output.cancel();
      throw new DOMException('Export annulé', 'AbortError');
    }
    const t = o.t0 + i / o.fps;
    renderer.render(o.show, t, audioFrameAt(t, o.analysis, o.show.bpm), o.mode ?? 'projection', { fade: o.fade });
    await video.add(i / o.fps, 1 / o.fps);
    if (i % 5 === 0) {
      o.onProgress?.(i / frames, `Image ${i + 1} / ${frames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (audioSrc && o.analysis) await audioSrc.add(sliceAudio(o.analysis.buffer, o.t0, o.t1));
  o.onProgress?.(1, 'Finalisation du fichier…');
  await output.finalize();
  const buf = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buf], { type: 'video/mp4' }), codec };
}

/** Un fichier par tableau (pour déclencher les scènes en direct dans Resolume, MadMapper…). */
export async function exportClips(o: Omit<VideoExportOptions, 't0' | 't1' | 'fade'>, onFile: (name: string, blob: Blob) => void) {
  const timings = computeTimings(o.show);
  for (const [k, tm] of timings.entries()) {
    const single: Show = { ...o.show, clips: [{ ...tm.clip, transition: 'cut' }] };
    const { blob } = await exportVideo({
      ...o, show: single, t0: 0, t1: tm.clip.duration, fade: false, withAudio: false,
      onProgress: (r, m) => o.onProgress?.((k + r) / timings.length, `Tableau ${k + 1}/${timings.length} — ${m}`),
    });
    onFile(`${String(k + 1).padStart(2, '0')}_${tm.clip.effect}.mp4`, blob);
  }
}
