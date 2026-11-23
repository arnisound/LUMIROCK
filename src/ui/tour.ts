// Visite guidée : bulles d'explication pointant les éléments de l'interface.
import { h } from './dom';

export interface TourStep {
  sel: string;
  title: string;
  text: string;
}

export const TOUR_HOME: TourStep[] = [
  { sel: '.brand', title: 'Bienvenue dans Lumirock', text: 'Créez un spectacle de video mapping à partir d’une simple photo de monument, en 5 étapes, directement dans votre navigateur.' },
  { sel: '.dropzone', title: '1. Votre monument', text: 'Importez une photo de façade prise bien en face, de jour. Vous pourrez la redresser à l’étape suivante.' },
  { sel: '.templates', title: 'Ou un monument modèle', text: 'Pour découvrir l’outil tout de suite : église, hôtel de ville ou château, avec leurs calques déjà prêts.' },
  { sel: '.steps', title: 'Les 5 étapes', text: 'Monument → Redressement → Calques (fenêtres, rosace… avec détourage IA en un clic) → Spectacle (tableaux, pistes, musique, live) → Export (vidéo, kit pro, présentation client).' },
  { sel: '.undo', title: 'Annuler / Rétablir', text: 'Ctrl+Z et Ctrl+Maj+Z : toutes vos modifications peuvent être annulées.' },
  { sel: '.actions', title: 'Vos projets', text: 'Le travail est sauvegardé automatiquement dans ce navigateur. « Enregistrer » crée un fichier .lumirock à garder ou à partager.' },
  { sel: '.help-btn', title: 'Besoin d’aide ?', text: 'Ce bouton relance la visite guidée à tout moment. Bonne création !' },
];

export const TOUR_SHOW: TourStep[] = [
  { sel: '.tabs', title: 'Composer le spectacle', text: 'Scénarios tout prêts, bibliothèque de tableaux (avec aperçus animés), réglages et images clés ◆, pistes superposées, musique et ambiance.' },
  { sel: '.tl-tracks', title: 'La ligne de temps', text: 'Cliquez sur un tableau pour le régler, glissez-le pour le déplacer, tirez son bord droit pour changer sa durée.' },
  { sel: '.tl-bar .btn.small', title: 'Pistes superposées', text: 'Ajoutez une piste pour superposer deux effets : par exemple des bougies dans les fenêtres par-dessus un soleil qui tourne.' },
  { sel: '.tl-extra', title: 'Vues, live et projecteur', text: 'Simulation de nuit (ce que voit le public) ou Projection (ce qui sort du vidéoprojecteur), mode Live au clavier et sortie sur une 2e fenêtre.' },
];

export function runTour(steps: TourStep[], onEnd?: () => void) {
  const avail = steps.filter((s) => document.querySelector(s.sel));
  if (!avail.length) return;
  let i = 0;
  const spot = h('div', { class: 'tour-spot' });
  const bubble = h('div', { class: 'tour-bubble' });
  const layer = h('div', { class: 'tour' }, spot, bubble);
  document.body.appendChild(layer);
  const end = () => {
    layer.remove();
    window.removeEventListener('resize', place);
    onEnd?.();
  };
  const place = () => {
    const st = avail[i];
    const el = document.querySelector(st.sel) as HTMLElement | null;
    if (!el) return end();
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    bubble.replaceChildren(
      h('div', { class: 'tb-count' }, `${i + 1} / ${avail.length}`),
      h('b', {}, st.title),
      h('p', {}, st.text),
      h('div', { class: 'tb-row' },
        h('button', { class: 'btn ghost small', onclick: end }, 'Passer'),
        i > 0 ? h('button', { class: 'btn small', onclick: () => { i--; place(); } }, 'Précédent') : null,
        h('button', { class: 'btn primary small', onclick: () => (i < avail.length - 1 ? (i++, place()) : end()) }, i < avail.length - 1 ? 'Suivant' : 'Terminer'),
      ),
    );
    const bw = Math.min(340, window.innerWidth - 24);
    let x = r.left + r.width / 2 - bw / 2;
    x = Math.max(12, Math.min(window.innerWidth - bw - 12, x));
    const below = r.bottom + 14 + 190 < window.innerHeight;
    const y = below ? r.bottom + 14 : Math.max(12, r.top - 14 - bubble.offsetHeight);
    Object.assign(bubble.style, { left: `${x}px`, top: `${y}px`, width: `${bw}px` });
    if (!below) requestAnimationFrame(() => (bubble.style.top = `${Math.max(12, r.top - 14 - bubble.offsetHeight)}px`));
  };
  window.addEventListener('resize', place);
  place();
}

export function tourDone(key: string) {
  try {
    return localStorage.getItem(`lumirock.tour.${key}`) === '1';
  } catch {
    return true;
  }
}

export function markTour(key: string) {
  try {
    localStorage.setItem(`lumirock.tour.${key}`, '1');
  } catch {
    /* rien */
  }
}
