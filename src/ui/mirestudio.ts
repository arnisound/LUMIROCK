// Studio de mires de calage : aperçu en direct, préréglages, export PNG / pack ZIP, projection sur la sortie.
import { h, select, slider, toast } from './dom';
import type { SceneMaps } from '../gl/renderer';
import type { Project } from '../types';
import { MIRE_DEFAULT, MIRE_LAYERS, MIRE_PRESETS, MireOptions, drawMire, mireSize } from '../export/mire';
import { canvasToPng, zipFiles } from '../export/kit';
import { download } from '../export/projectio';

const STORE = 'lumirock.mire';

export interface MireHost {
  scene: SceneMaps;
  project: Project;
  projectOnOutput: (mire: OffscreenCanvas) => void;
}

function loadOpts(): MireOptions {
  try {
    return { ...MIRE_DEFAULT, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
  } catch {
    return { ...MIRE_DEFAULT };
  }
}

const slug = (s: string) => (s || 'lumirock').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\d-]+/g, '_');

export function openMireStudio(host: MireHost) {
  const o = loadOpts();
  const preview = h('canvas', { class: 'mire-canvas' });
  const sizeLbl = h('span', { class: 'muted small' });
  const controls = h('div', { class: 'mire-controls' });
  let timer = 0;
  const redraw = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(o));
      } catch { /* ignore */ }
      // aperçu à résolution réduite pour rester fluide
      const [w, hgt] = mireSize(o, host.scene);
      const k = Math.min(1, 1280 / Math.max(w, hgt));
      const m = drawMire(host.scene, host.project, { ...o, size: 'custom', cw: w * k, ch: hgt * k, line: o.line, realSize: [w, hgt] });
      preview.width = m.width;
      preview.height = m.height;
      const c = preview.getContext('2d')!;
      c.clearRect(0, 0, m.width, m.height);
      if (o.bg === 'transparent') {
        // damier pour visualiser la transparence
        for (let y = 0; y < m.height; y += 16) for (let x = 0; x < m.width; x += 16) {
          c.fillStyle = (x / 16 + y / 16) % 2 ? '#333' : '#222';
          c.fillRect(x, y, 16, 16);
        }
      }
      c.drawImage(m, 0, 0);
      sizeLbl.textContent = `${w} × ${hgt} px`;
    }, 60);
  };

  const check = (key: keyof MireOptions, label: string) => {
    const cb = h('input', { type: 'checkbox', checked: !!o[key] });
    cb.addEventListener('change', () => {
      (o as unknown as Record<string, unknown>)[key] = cb.checked;
      redraw();
    });
    return h('label', { class: 'check' }, cb, ' ', label);
  };
  const color = (key: keyof MireOptions, label: string) => {
    const i = h('input', { type: 'color', value: String(o[key]) });
    i.addEventListener('input', () => {
      (o as unknown as Record<string, unknown>)[key] = i.value;
      redraw();
    });
    return h('label', { class: 'mire-color' }, i, label);
  };
  const range = (key: keyof MireOptions, label: string, min: number, max: number, step: number, fmt?: (v: number) => string) =>
    slider({ label, min, max, step, value: Number(o[key]), format: fmt, onInput: (v) => {
      (o as unknown as Record<string, unknown>)[key] = v;
      redraw();
    } });
  const sec = (title: string, ...kids: (HTMLElement | null)[]) => h('details', { class: 'mire-sec', open: true }, h('summary', {}, title), ...kids.filter(Boolean) as HTMLElement[]);

  const build = () => {
    controls.replaceChildren(
      h('div', { class: 'mire-presets' }, ...MIRE_PRESETS.map((p) => h('button', { class: 'cat-toggle on', style: '--c:#ffd34d', title: p.desc, onclick: () => {
        Object.assign(o, p.o);
        build();
        redraw();
      } }, p.name))),
      sec('Image de sortie',
        select<string>({ label: 'Résolution', value: o.size, options: [
          { value: 'hd', label: 'Full HD 1920 × 1080 (16:9)' },
          { value: 'wuxga', label: 'WUXGA 1920 × 1200 (16:10)' },
          { value: '4k', label: '4K UHD 3840 × 2160' },
          { value: 'facade', label: 'Format de la façade' },
          { value: 'custom', label: 'Sur mesure…' },
        ], onChange: (v) => {
          o.size = v as MireOptions['size'];
          build();
          redraw();
        } }),
        o.size === 'custom' ? h('div', { class: 'row' }, range('cw', 'Largeur', 320, 8192, 2, (v) => `${v} px`), range('ch', 'Hauteur', 240, 8192, 2, (v) => `${v} px`)) : null,
        select<string>({ label: 'Fond', value: o.bg, options: [{ value: 'noir', label: 'Noir (projection)' }, { value: 'blanc', label: 'Blanc (impression)' }, { value: 'transparent', label: 'Transparent (superposition)' }], onChange: (v) => {
          o.bg = v as MireOptions['bg'];
          redraw();
        } }),
        range('line', 'Épaisseur des traits', 0.5, 4, 0.1),
        range('photo', 'Photo de la façade en filigrane', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`),
      ),
      sec('Tracé des calques',
        check('zones', 'Afficher le tracé'),
        select<string>({ label: 'Couleurs', value: o.zonesColorMode, options: [{ value: 'type', label: 'Une couleur par type (fenêtres, portes…)' }, { value: 'unique', label: 'Couleur unique' }], onChange: (v) => {
          o.zonesColorMode = v as 'type';
          build();
          redraw();
        } }),
        o.zonesColorMode === 'unique' ? color('zonesColor', 'Couleur du tracé') : null,
        check('zonesFill', 'Remplissage léger'),
        check('labels', 'Numéros des calques'),
        check('vertices', 'Points des sommets'),
        check('marks', 'Repères en croix et équerres sur chaque calque'),
        color('marksColor', 'Couleur des repères'),
      ),
      sec('Lignes réelles de la façade',
        check('edges', 'Contours détectés sur la photo (corniches, moulures, joints…)'),
        color('edgesColor', 'Couleur'),
        range('edgesOpacity', 'Intensité', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)} %`),
      ),
      sec('Relief du bâtiment',
        check('relief', 'Afficher le relief'),
        select<string>({ label: 'Rendu', value: o.reliefMode, options: [{ value: 'ombrage', label: 'Ombrage (lumière rasante)' }, { value: 'altitude', label: 'Carte des profondeurs en couleurs' }, { value: 'normales', label: 'Orientation des surfaces (normales)' }], onChange: (v) => {
          o.reliefMode = v as 'ombrage';
          redraw();
        } }),
        color('reliefColor', 'Couleur de l’ombrage'),
        range('lightAngle', 'Direction de la lumière', 0, 360, 5, (v) => `${Math.round(v)}°`),
        range('reliefOpacity', 'Intensité', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)} %`),
      ),
      sec('Grille et repères de l’image',
        check('grid', 'Grille sur la façade'),
        range('gridCols', 'Nombre de colonnes', 2, 48, 1, (v) => String(Math.round(v))),
        color('gridColor', 'Couleur de la grille'),
        check('gridLabels', 'Coordonnées des cases (A1, B2…)'),
        check('gridSub', 'Sous-divisions'),
        check('center', 'Croix centrale et cercles'),
        check('frame', 'Cadre, diagonales, contour de la façade et repère « HAUT »'),
        check('focus', 'Étoiles de netteté (mise au point au centre et aux coins)'),
        check('bars', 'Gammes de gris et de couleurs (réglage du projecteur)'),
        check('info', 'Cartouche (nom, résolution, date)'),
      ),
    );
  };

  const exportPng = async () => {
    const png = await canvasToPng(drawMire(host.scene, host.project, o));
    download(new Blob([png as BlobPart], { type: 'image/png' }), `mire_${slug(host.project.name)}_${mireSize(o, host.scene).join('x')}.png`);
  };
  const exportPack = async (btn: HTMLButtonElement) => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Préparation…';
    try {
      const files: Record<string, Uint8Array> = {};
      const add = async (name: string, opts: Partial<MireOptions>, only?: keyof MireOptions) => {
        files[name] = await canvasToPng(drawMire(host.scene, host.project, { ...o, ...opts }, only));
        await new Promise((r) => setTimeout(r, 0));
      };
      await add('mire_actuelle.png', {});
      for (const p of MIRE_PRESETS) await add(`mire_${p.id}.png`, p.o);
      await add('relief_ombrage.png', { ...MIRE_PRESETS[2].o, reliefMode: 'ombrage' });
      await add('relief_profondeurs.png', { ...MIRE_PRESETS[2].o, reliefMode: 'altitude' });
      await add('relief_normales.png', { ...MIRE_PRESETS[2].o, reliefMode: 'normales' });
      await add('mire_format_facade.png', { size: 'facade' });
      for (const l of MIRE_LAYERS) await add(`couches/${l.file}`, { bg: 'transparent' }, l.key);
      files['LISEZMOI.txt'] = new TextEncoder().encode(`Mires de calage Lumirock — ${host.project.name}
Résolution : ${mireSize(o, host.scene).join(' × ')} px (sauf mire_format_facade.png, au format exact de la façade).

mire_precis.png          tracé des calques + lignes réelles + repères + grille : la mire de référence
mire_photo.png           la photo en filigrane sous le tracé, pour vérifier la superposition
mire_relief.png          relief du bâtiment (ombrage) ; voir aussi relief_*.png
mire_lignes.png          uniquement les vraies lignes de la façade
mire_projecteur.png      grille, netteté, gammes de gris et couleurs (mise au point, keystone, colorimétrie)
mire_blanc.png           version fond blanc, à imprimer et annoter
couches/                 chaque élément seul sur fond transparent, à empiler dans MadMapper, Resolume, Millumin, Modulo Pi…

Méthode conseillée : projeter mire_precis, caler les 4 coins sur le cadre jaune pointillé (contour de la façade),
puis affiner la grille de déformation jusqu'à ce que les repères en croix tombent au centre de chaque fenêtre.
Contrôler la netteté sur les étoiles (centre et coins), puis valider avec « lignes seules » : chaque trait doit tomber sur une arête de pierre.
`);
      download(zipFiles(files), `mires_${slug(host.project.name)}.zip`);
      toast('Pack de mires téléchargé ✓', 'ok');
    } catch (e) {
      console.error(e);
      toast('Échec de la création du pack.', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };

  const packBtn = h('button', { class: 'btn ghost' }, 'Pack complet (ZIP)');
  packBtn.addEventListener('click', () => exportPack(packBtn));
  const panel = h('div', { class: 'mire-studio' },
    h('div', { class: 'mire-head' },
      h('b', {}, '🎯 Studio de mires de calage'), sizeLbl,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', title: 'Affiche cette mire dans la fenêtre projecteur, avec le calage en cours', onclick: () => host.projectOnOutput(drawMire(host.scene, host.project, { ...o, size: 'facade' })) }, 'Projeter sur la sortie'),
        packBtn,
        h('button', { class: 'btn primary', onclick: exportPng }, 'Télécharger la mire (PNG)'),
        h('button', { class: 'btn ghost', onclick: () => panel.remove() }, 'Fermer'))),
    h('div', { class: 'mire-body' }, controls, h('div', { class: 'mire-view' }, preview)),
  );
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') panel.remove();
  });
  document.body.appendChild(panel);
  build();
  redraw();
}
