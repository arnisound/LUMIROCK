// Estimation de profondeur par IA, entièrement dans le navigateur (Depth Anything V2 Small, licence Apache 2.0).
// Le modèle (~25 Mo) est téléchargé une seule fois puis mis en cache par le navigateur.

let pipePromise: Promise<any> | null = null;

export async function estimateDepth(img: ImageData, onProgress?: (msg: string, ratio?: number) => void): Promise<Float32Array> {
  const { pipeline, RawImage, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  if (!pipePromise) {
    let gpuOk = false;
    try {
      gpuOk = !!(await (navigator as any).gpu?.requestAdapter());
    } catch {
      gpuOk = false;
    }
    const load = (device: 'webgpu' | 'wasm') => {
      onProgress?.(`Chargement du modèle (${device === 'webgpu' ? 'carte graphique' : 'processeur'})…`, 0);
      return pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
        device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (p: any) => {
          if (p.status === 'progress' && p.total) onProgress?.('Téléchargement du modèle…', p.loaded / p.total);
        },
      } as any);
    };
    pipePromise = (gpuOk ? load('webgpu').catch(() => load('wasm')) : load('wasm')).catch((e: unknown) => {
      pipePromise = null;
      throw e;
    });
  }
  const pipe = await pipePromise;
  onProgress?.('Analyse de la profondeur…', 1);
  const raw = new RawImage(new Uint8ClampedArray(img.data), img.width, img.height, 4);
  const out = await pipe(raw);
  const depth = (Array.isArray(out) ? out[0] : out).depth as { width: number; height: number; data: Uint8Array; channels: number };
  // remise à l'échelle vers la résolution de travail
  const cv = new OffscreenCanvas(depth.width, depth.height);
  const ctx = cv.getContext('2d')!;
  const id = ctx.createImageData(depth.width, depth.height);
  const ch = depth.channels || 1;
  for (let i = 0; i < depth.width * depth.height; i++) {
    const v = depth.data[i * ch];
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const big = new OffscreenCanvas(img.width, img.height);
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(cv, 0, 0, img.width, img.height);
  const d = bctx.getImageData(0, 0, img.width, img.height).data;
  const res = new Float32Array(img.width * img.height);
  for (let i = 0; i < res.length; i++) res[i] = d[i * 4] / 255;
  return res;
}
