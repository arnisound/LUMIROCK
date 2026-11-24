// Kit pro : matière première pour After Effects, DaVinci Resolve / Fusion, Resolume, MadMapper, Modulo Pi.
import { zipSync } from 'fflate';
import type { SceneMaps } from '../gl/renderer';
import { rasterizeZones } from '../analysis/maps';
import { Project, ZONE_TYPES, zoneType } from '../types';

export async function rgbaToPng(rgba: Uint8Array | Uint8ClampedArray, W: number, H: number): Promise<Uint8Array> {
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  const id = new ImageData(new Uint8ClampedArray(rgba), W, H);
  ctx.putImageData(id, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function canvasToPng(cv: OffscreenCanvas) {
  return new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

function safe(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

/** Gabarit de calage : contours, grille, repères. `onBlack` = version à projeter pour caler. */
export function drawTemplate(scene: SceneMaps, project: Project, onBlack: boolean, scale = 1) {
  const W = Math.round(scene.width * scale), H = Math.round(scene.height * scale);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  if (onBlack) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  } else {
    const src = new OffscreenCanvas(scene.width, scene.height);
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(scene.albedo), scene.width, scene.height), 0, 0);
    ctx.filter = 'brightness(0.55) saturate(0.6)';
    ctx.drawImage(src, 0, 0, W, H);
    ctx.filter = 'none';
  }
  // grille
  ctx.strokeStyle = onBlack ? 'rgba(80,160,255,0.45)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, W / 1600);
  const step = W / 16;
  for (let x = step; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = H - step; y > 0; y -= step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // axes centraux
  ctx.strokeStyle = onBlack ? 'rgba(255,60,60,0.9)' : 'rgba(255,80,80,0.8)';
  ctx.lineWidth = Math.max(2, W / 800);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  // calques
  ctx.lineJoin = 'round';
  for (const z of project.zones) {
    const t = zoneType(z.type);
    ctx.strokeStyle = z.type === 'silhouette' ? '#ffffff' : t.color;
    ctx.lineWidth = Math.max(2, W / (z.type === 'silhouette' ? 400 : 700));
    ctx.beginPath();
    z.points.forEach(([x, y], k) => (k ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    ctx.closePath();
    ctx.stroke();
  }
  // repères d'angle
  const m = W * 0.04;
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = Math.max(3, W / 500);
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [W, H, -1, -1], [0, H, 1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * m, cy + sy * 2);
    ctx.lineTo(cx + sx * 2, cy + sy * 2);
    ctx.lineTo(cx + sx * 2, cy + sy * m);
    ctx.stroke();
  }
  ctx.fillStyle = onBlack ? '#9fc6ff' : '#ffffff';
  ctx.font = `${Math.round(W / 70)}px sans-serif`;
  ctx.fillText(`LUMIROCK — ${project.name} — ${scene.width}×${scene.height} (ratio ${(scene.width / scene.height).toFixed(3)})`, W * 0.02, H - W * 0.02);
  return cv;
}

function svgContours(project: Project) {
  const W = project.width, H = project.height;
  const paths = project.zones
    .map((z) => {
      const d = z.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' ') + ' Z';
      return `  <path id="${safe(z.name)}" data-type="${z.type}" d="${d}" fill="none" stroke="${zoneType(z.type).color}" stroke-width="2"><title>${z.name}</title></path>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${paths}\n</svg>\n`;
}

function guide(project: Project, scene: SceneMaps) {
  return `LUMIROCK — KIT PRO
==================
Projet : ${project.name}
${project.credits ? `Photo de la façade : ${project.credits.author} — ${project.credits.license} (${project.credits.page})\n` : ''}${project.music ? `Musique : « ${project.music.title} » ${project.music.author} — ${project.music.license} (${project.music.page}) — crédit obligatoire lors de la diffusion\n` : ''}Résolution de référence : ${scene.width} × ${scene.height} px (ratio ${(scene.width / scene.height).toFixed(4)})
Toutes les images du kit sont alignées pixel par pixel sur « facade_redressee.png ».

CONTENU
-------
facade_redressee.png      Photo de la façade, redressée (vue de face). Calque de référence.
gabarit_calage.png        Façade assombrie + contours + grille : pour préparer le calage.
gabarit_calage_noir.png   Contours sur fond noir : à PROJETER sur le monument pour caler le maillage.
profondeur.png            Carte de profondeur (blanc = proche, noir = loin).
normales.png              Carte de normales (convention OpenGL : R = droite, V = haut).
contours_pierre.png       Contours détectés dans la pierre (lignes architecturales).
contours_calques.png      Contours des calques (traits blancs sur noir).
calques_couleurs.png      Tous les calques, une couleur par type.
calques/*.png             Un masque par élément (blanc + transparence) : rosace, portail, fenêtres…
contours.svg              Contours vectoriels (Illustrator, Inkscape, After Effects, MadMapper).
projet.json               Description du projet (calques, spectacle).

UTILISATION
-----------
After Effects
  • Importez facade_redressee.png et créez une composition à sa taille.
  • Utilisez les masques de calques/ comme « Cache alpha » (Track Matte) pour animer chaque élément.
  • profondeur.png + effet « Déplacement de pixels » / « Displacement Map » = faux relief.
  • normales.png avec un plug-in d'éclairage (Normality, Lightwrap…) = lumière qui tourne.
  • contours.svg : Fichier > Importer, puis « Créer des formes à partir du calque vectoriel ».

DaVinci Resolve / Fusion
  • Loader > facade_redressee.png ; les masques en Loader + « Channel Booleans » ou en entrée « Effect Mask ».
  • Nœud « Shader » / « Relight » (Studio) avec normales.png ; « Displace » avec profondeur.png.

Resolume Arena / MadMapper / Modulo Pi / Millumin
  • Calez la sortie avec gabarit_calage_noir.png projeté sur le monument (maillage / warping).
  • Remplacez ensuite le gabarit par les vidéos Lumirock : elles ont exactement le même cadrage.
  • Conseil : convertissez les MP4 en HAP (Shutter Encoder, gratuit, ou Alley de Resolume) pour une lecture fluide.

Créé avec Lumirock — 100 % navigateur, 0 €.
`;
}

export async function buildKit(scene: SceneMaps, project: Project, onProgress?: (r: number, msg: string) => void): Promise<Blob> {
  const W = scene.width, H = scene.height, N = W * H;
  const files: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  files['00_LISEZMOI.txt'] = enc.encode(guide(project, scene));
  onProgress?.(0.05, 'Façade…');
  files['facade_redressee.png'] = await rgbaToPng(scene.albedo, W, H);
  files['profondeur.png'] = await rgbaToPng(scene.depth, W, H);
  files['normales.png'] = await rgbaToPng(scene.normal, W, H);
  onProgress?.(0.3, 'Contours…');
  const chan = (c: number) => {
    const out = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = scene.edges[i * 4 + c];
      out[i * 4 + 3] = 255;
    }
    return out;
  };
  files['contours_pierre.png'] = await rgbaToPng(chan(0), W, H);
  files['contours_calques.png'] = await rgbaToPng(chan(1), W, H);
  files['contours.svg'] = enc.encode(svgContours(project));
  files['gabarit_calage.png'] = await canvasToPng(drawTemplate(scene, project, false));
  files['gabarit_calage_noir.png'] = await canvasToPng(drawTemplate(scene, project, true));
  onProgress?.(0.5, 'Masques des calques…');
  const { ids, drawable } = rasterizeZones(project.zones, W, H);
  const colored = new Uint8Array(N * 4);
  const typeColor = new Map(ZONE_TYPES.map((t) => [t.key, t.color]));
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const cols = drawable.map((z) => rgb(typeColor.get(z.type)!));
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    if (id) {
      const c = cols[id - 1];
      colored.set([c[0], c[1], c[2], 255], i * 4);
    } else colored.set([0, 0, 0, 255], i * 4);
  }
  files['calques_couleurs.png'] = await rgbaToPng(colored, W, H);
  for (let k = 0; k < drawable.length; k++) {
    const z = drawable[k];
    const m = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      if (ids[i] === k + 1) m.set([255, 255, 255, 255], i * 4);
    }
    files[`calques/${String(k + 1).padStart(2, '0')}_${safe(z.type)}_${safe(z.name)}.png`] = await rgbaToPng(m, W, H);
    if (k % 4 === 0) onProgress?.(0.5 + (0.45 * k) / drawable.length, `Masque ${k + 1}/${drawable.length}`);
  }
  files['projet.json'] = enc.encode(JSON.stringify(project, null, 2));
  onProgress?.(0.97, 'Compression…');
  const zip = zipSync(files, { level: 0 });
  return new Blob([zip], { type: 'application/zip' });
}

export function zipFiles(files: Record<string, Uint8Array>) {
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
