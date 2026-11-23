// Éditeur de tableaux en code (GLSL), avec compilation et aperçu en direct.
import { h } from './dom';
import { CUSTOM_TEMPLATE, CustomFx, customEffectDef } from '../effects/library';
import { EFFECT_HEADER } from '../gl/common';

const HELP = `
<b>Entrées</b><br>
<code>uv</code> position (0,0 en bas à gauche) · <code>asp(uv)</code> sans déformation<br>
<code>uT</code> temps (s) · <code>uP</code> avancement 0→1 · <code>uSpeed</code><br>
<code>uParamA/B/C</code> réglages 0→1 · <code>uColA</code>, <code>uColB</code> couleurs<br>
<b>Musique</b> <code>uBeat</code> (pulsation), <code>uBass</code>, <code>uMid</code>, <code>uHigh</code>, <code>uSpec[16]</code>, <code>uEnergy</code><br>
<b>Façade</b> <code>albedo(uv)</code> photo · <code>depthAt(uv)</code> relief · <code>normalAt(uv)</code><br>
<code>diffuseAt(uv, L)</code> éclairage · <code>shadowAt(uv, L)</code> ombres portées<br>
<b>Calques</b> <code>zoneId(uv)</code> · <code>zoneTypeAt(uv)</code> (T_FENETRE, T_PORTE, T_ROSACE, T_COLONNE…) · <code>isOpening(t)</code><br>
<code>zoneGeom(id)</code> centre & taille · <code>edgeZone(uv)</code> contours · <code>glowLines(uv)</code> · <code>glowOpen(uv)</code><br>
<b>Outils</b> <code>fbm</code>, <code>vnoise</code>, <code>voronoi</code>, <code>hash11/21/22</code>, <code>hsv(h,s,v)</code>, <code>lum</code>, <code>sstep</code>, <code>sat</code>, <code>PI</code>, <code>TAU</code>
`;

export interface FxEditorHost {
  tryCompile: (fx: CustomFx) => string | null;
  apply: (fx: CustomFx) => void; // enregistre + aperçu
  close: () => void;
}

export function openFxEditor(initial: CustomFx | null, host: FxEditorHost) {
  const fx: CustomFx = initial ? { ...initial } : { id: Math.random().toString(36).slice(2, 9), name: 'Mon tableau', description: '', code: CUSTOM_TEMPLATE };
  const headerLines = EFFECT_HEADER.split('\n').length - 1;
  const name = h('input', { type: 'text', value: fx.name, placeholder: 'Nom du tableau' });
  const desc = h('input', { type: 'text', value: fx.description, placeholder: 'Description (facultatif)' });
  const code = h('textarea', { class: 'fx-code', spellcheck: false }, fx.code);
  const status = h('div', { class: 'fx-status ok' }, '✓ Compilé');
  let timer = 0;
  const check = () => {
    fx.name = name.value.trim() || 'Mon tableau';
    fx.description = desc.value.trim();
    fx.code = code.value;
    const err = host.tryCompile(fx);
    if (err) {
      const msg = err.replace(/ERROR: 0:(\d+):/g, (_, n) => `Ligne ${Math.max(1, Number(n) - headerLines)} :`).replace(/^Erreur de compilation du shader « [^»]+ » : /, '');
      status.className = 'fx-status err';
      status.textContent = msg.trim().split('\n').slice(0, 4).join('\n');
    } else {
      status.className = 'fx-status ok';
      status.textContent = '✓ Compilé — aperçu en direct sur la façade';
      host.apply({ ...fx });
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 350);
  };
  code.addEventListener('input', schedule);
  name.addEventListener('input', schedule);
  desc.addEventListener('input', schedule);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const a = code.selectionStart, b = code.selectionEnd;
      code.value = code.value.slice(0, a) + '  ' + code.value.slice(b);
      code.selectionStart = code.selectionEnd = a + 2;
      schedule();
    }
    e.stopPropagation();
  });
  const help = h('details', { class: 'fx-help' }, h('summary', {}, 'Aide : ce que vous pouvez utiliser'));
  help.insertAdjacentHTML('beforeend', `<div>${HELP}</div>`);
  const panel = h('div', { class: 'fx-editor' },
    h('div', { class: 'fx-head' }, h('b', {}, 'Éditeur de tableau'), h('button', { class: 'btn ghost small', onclick: () => {
      panel.remove();
      host.close();
    } }, 'Fermer')),
    h('div', { class: 'row' }, name),
    h('div', { class: 'row' }, desc),
    code,
    status,
    help,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => {
        code.value = CUSTOM_TEMPLATE;
        check();
      } }, 'Exemple'),
      h('button', { class: 'btn primary', onclick: () => {
        check();
        if (status.classList.contains('ok')) {
          panel.remove();
          host.close();
        }
      } }, 'Enregistrer et fermer'),
    ),
  );
  document.body.appendChild(panel);
  check();
  code.focus();
  return customEffectDef(fx).id;
}
