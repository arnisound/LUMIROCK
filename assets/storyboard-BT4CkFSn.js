import{a as e,c as t,i as n,n as r,o as i,r as a,s as o}from"./index-BHJNEaer.js";var s=e=>e.replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]),c=e=>`${Math.floor(e/60)}:${String(Math.floor(e%60)).padStart(2,`0`)}`;async function l(l){let u=window.open(``,`lumirock-storyboard`,`width=1000,height=900`);if(!u)throw Error(`Fenêtre bloquée : autorisez les pop-up pour ce site.`);u.document.write(`<p style="font:16px sans-serif;padding:40px">Préparation du storyboard…</p>`);let d=l.project.show,f=document.createElement(`canvas`),p=new r(f);p.setScene(l.scene);let m=Math.round(480*l.scene.height/l.scene.width);p.resize(480,Math.min(m,640)),p.mediaProvider=l.mediaProvider,p.quality=1;let h=[],g=[{name:`Principale`,clips:d.clips},...(d.layers??[]).map(e=>({name:e.name,clips:e.clips}))];for(let e of g)for(let r of n(e.clips)){let n=i.get(r.clip.effect);if(!n||r.clip.effect===`vide`)continue;let a=r.start+r.clip.duration*.55;p.render(d,a,t(a,l.analysis,d.bpm),`simulation`,{fade:!1});let s=[`colorA`,`colorB`].map(e=>r.clip.params[e]).filter(e=>typeof e==`string`);h.push({start:r.start,end:r.end,track:e.name,name:n.name,cat:n.category,desc:r.clip.effect===`texte`?`« ${String(r.clip.params.text??``).replace(/\n/g,` `)} » — ${n.description}`:n.description,trans:o.find(e=>e.id===r.clip.transition)?.label??``,colors:s,img:f.toDataURL(`image/jpeg`,.85)}),await new Promise(e=>setTimeout(e,0))}h.sort((e,t)=>e.start-t.start);let _=a(d),v=l.project.credits,y=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Storyboard — ${s(l.project.name)}</title>
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
<header><img class="logo" src="${l.logoUrl}"><div><h1>${s(l.project.name)}</h1>
<div class="meta">Storyboard de video mapping · ${new Date().toLocaleDateString(`fr-FR`,{day:`numeric`,month:`long`,year:`numeric`})}</div></div></header>
<div class="facade"><img src="${l.facadeUrl}"><div class="stats">
<div><b>Durée :</b> ${c(_)}</div><div><b>Tableaux :</b> ${h.length}</div>
<div><b>Pistes :</b> ${g.length}</div>
${l.musicName?`<div><b>Musique :</b> ${s(l.musicName)}${l.analysis?` (${l.analysis.bpm} BPM)`:``}</div>`:``}
${(d.sounds??[]).length?`<div><b>Voix off / bruitages :</b> ${(d.sounds??[]).length}</div>`:``}
${v?`<div class="small">Photo : ${s(v.author)} — ${s(v.license)}</div>`:``}
${l.project.music?`<div class="small">Musique : « ${s(l.project.music.title)} » ${s(l.project.music.author)} — ${s(l.project.music.license)} (${s(l.project.music.page)})</div>`:``}
${(l.project.media??[]).filter(e=>e.credit).map(e=>`<div class="small">Bruitage : ${s(e.credit)}</div>`).join(``)}
</div></div>
<table>${h.map((t,n)=>`<tr><td class="n">${n+1}</td><td class="img"><img src="${t.img}"></td>
<td><div class="name">${s(t.name)}<span class="cat" style="background:${e[t.cat]??`#888`}">${s(t.cat)}</span></div>
<div>${s(t.desc)}</div>
<div class="small">${t.colors.map(e=>`<span class="sw" style="background:${e}"></span>`).join(``)}${g.length>1?`Piste : ${s(t.track)} · `:``}${t.trans?`Transition : ${s(t.trans)}`:``}</div></td>
<td class="time">${c(t.start)} → ${c(t.end)}<div class="small">${(t.end-t.start).toFixed(1)} s</div></td></tr>`).join(``)}</table>
<footer>Réalisé avec Lumirock · by Arnisound tools</footer>
</body></html>`;u.document.open(),u.document.write(y),u.document.close()}export{l as openStoryboard};