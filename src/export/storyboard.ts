// Storyboard imprimable (PDF via l'impression du navigateur) : déroulé du spectacle pour le client.
import { Renderer, SceneMaps, ViewMode, trackTimings, showDuration } from '../gl/renderer';
import { audioFrameAt, AudioAnalysis } from '../audio';
import { CATEGORY_COLORS, EFFECT_MAP, TRANSITIONS } from '../effects/library';
import type { Project } from '../types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export async function openStoryboard(o: {
  scene: SceneMaps; project: Project; analysis: AudioAnalysis | null; musicName: string | null;
  mediaProvider: Renderer['mediaProvider']; logoUrl: string; facadeUrl: string;
}) {
  const w = window.open('', 'lumirock-storyboard', 'width=1000,height=900');
  if (!w) throw new Error('Fenêtre bloquée : autorisez les pop-up pour ce site.');
  w.document.write('<p style="font:16px sans-serif;padding:40px">Préparation du storyboard…</p>');
  const show = o.project.show;
  const cv = document.createElement('canvas');
  const r = new Renderer(cv);
  r.setScene(o.scene);
  const W = 480, H = Math.round((W * o.scene.height) / o.scene.width);
  r.resize(W, Math.min(H, 640));
  r.mediaProvider = o.mediaProvider;
  r.quality = 1;
  const rows: { start: number; end: number; track: string; name: string; cat: string; desc: string; trans: string; colors: string[]; img: string }[] = [];
  const tracks = [{ name: 'Principale', clips: show.clips }, ...(show.layers ?? []).map((l) => ({ name: l.name, clips: l.clips }))];
  for (const tr of tracks) {
    for (const tm of trackTimings(tr.clips)) {
      const e = EFFECT_MAP.get(tm.clip.effect);
      if (!e || tm.clip.effect === 'vide') continue;
      const t = tm.start + tm.clip.duration * 0.55;
      r.render(show, t, audioFrameAt(t, o.analysis, show.bpm), 'simulation' as ViewMode, { fade: false });
      const colors = ['colorA', 'colorB'].map((k) => tm.clip.params[k]).filter((x): x is string => typeof x === 'string');
      rows.push({
        start: tm.start, end: tm.end, track: tr.name, name: e.name, cat: e.category,
        desc: tm.clip.effect === 'texte' ? `« ${String(tm.clip.params.text ?? '').replace(/\n/g, ' ')} » — ${e.description}` : e.description,
        trans: TRANSITIONS.find((x) => x.id === tm.clip.transition)?.label ?? '',
        colors, img: cv.toDataURL('image/jpeg', 0.85),
      });
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  rows.sort((a, b) => a.start - b.start);
  const total = showDuration(show);
  const cr = o.project.credits;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Storyboard — ${esc(o.project.name)}</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font: 12px/1.45 Inter, Arial, sans-serif; color: #1b1d22; margin: 0; padding: 24px; background: #fff; }
.bar { position: sticky; top: 0; background: #fff; padding: 8px 0 14px; display: flex; gap: 8px; }
.bar button { font: 600 13px sans-serif; padding: 8px 14px; border-radius: 8px; border: 0; background: #e0a23e; color: #1b1206; cursor: pointer; }
header { display: flex; gap: 18px; align-items: center; border-bottom: 3px solid #e0a23e; padding-bottom: 12px; margin-bottom: 14px; }
header img.logo { width: 74px; height: 74px; }
h1 { font: 700 26px Georgia, serif; margin: 0; }
.meta { color: #555; margin-top: 4px; }
.facade { display: flex; gap: 16px; margin-bottom: 16px; align-items: flex-start; }
.facade img { width: 220px; border-radius: 6px; border: 1px solid #ddd; }
.stats div { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; }
tr { page-break-inside: avoid; }
td { border-bottom: 1px solid #e6e6e6; padding: 8px 6px; vertical-align: top; }
td.n { width: 26px; font-weight: 700; color: #b9741f; }
td.img img { width: 190px; border-radius: 4px; display: block; background: #000; }
td.time { width: 90px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.name { font-weight: 700; font-size: 13px; }
.cat { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 8px; color: #fff; margin-left: 4px; }
.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid #0002; margin-right: 3px; vertical-align: middle; }
.small { color: #666; font-size: 11px; }
footer { margin-top: 18px; color: #888; font-size: 10px; text-align: center; }
@media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="bar"><button onclick="print()">Imprimer / Enregistrer en PDF</button></div>
<header><img class="logo" src="${o.logoUrl}"><div><h1>${esc(o.project.name)}</h1>
<div class="meta">Storyboard de video mapping · ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div></header>
<div class="facade"><img src="${o.facadeUrl}"><div class="stats">
<div><b>Durée :</b> ${fmt(total)}</div><div><b>Tableaux :</b> ${rows.length}</div>
<div><b>Pistes :</b> ${tracks.length}</div>
${o.musicName ? `<div><b>Musique :</b> ${esc(o.musicName)}${o.analysis ? ` (${o.analysis.bpm} BPM)` : ''}</div>` : ''}
${(show.sounds ?? []).length ? `<div><b>Voix off / bruitages :</b> ${(show.sounds ?? []).length}</div>` : ''}
${cr ? `<div class="small">Photo : ${esc(cr.author)} — ${esc(cr.license)}</div>` : ''}
${o.project.music ? `<div class="small">Musique : « ${esc(o.project.music.title)} » ${esc(o.project.music.author)} — ${esc(o.project.music.license)} (${esc(o.project.music.page)})</div>` : ''}
</div></div>
<table>${rows.map((x, i) => `<tr><td class="n">${i + 1}</td><td class="img"><img src="${x.img}"></td>
<td><div class="name">${esc(x.name)}<span class="cat" style="background:${CATEGORY_COLORS[x.cat as keyof typeof CATEGORY_COLORS] ?? '#888'}">${esc(x.cat)}</span></div>
<div>${esc(x.desc)}</div>
<div class="small">${x.colors.map((c) => `<span class="sw" style="background:${c}"></span>`).join('')}${tracks.length > 1 ? `Piste : ${esc(x.track)} · ` : ''}${x.trans ? `Transition : ${esc(x.trans)}` : ''}</div></td>
<td class="time">${fmt(x.start)} → ${fmt(x.end)}<div class="small">${(x.end - x.start).toFixed(1)} s</div></td></tr>`).join('')}</table>
<footer>Réalisé avec Lumirock · by Arnisound tools</footer>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
