// Bibliothèque de musiques libres via Openverse (API publique, sans clé) : Jamendo, Freesound, Wikimedia…
// Uniquement CC0 et CC BY : utilisables en diffusion publique, en créditant l'auteur pour CC BY.

export interface MusicResult {
  id: string;
  title: string;
  author: string;
  license: string; // « CC BY 4.0 », « CC0 »
  page: string; // page de l'œuvre (licence, auteur)
  url: string; // fichier audio
  duration: number; // secondes (0 si inconnue)
  source: string;
}

export const MOODS: { id: string; label: string; q: string }[] = [
  { id: 'epique', label: 'Épique', q: 'epic cinematic orchestral' },
  { id: 'douce', label: 'Douce', q: 'piano calm relax' },
  { id: 'joyeuse', label: 'Joyeuse', q: 'happy fun joyful' },
  { id: 'mystere', label: 'Mystérieuse', q: 'mysterious dark suspense' },
  { id: 'electro', label: 'Électro', q: 'electronic dance techno' },
  { id: 'classique', label: 'Classique', q: 'classical orchestral piano' },
  { id: 'noel', label: 'Noël', q: 'christmas' },
  { id: 'halloween', label: 'Halloween', q: 'halloween horror' },
  { id: 'romantique', label: 'Romantique', q: 'romantic love' },
  { id: 'medieval', label: 'Médiévale', q: 'medieval celtic folk' },
  { id: 'rock', label: 'Rock', q: 'rock guitar' },
  { id: 'ambiance', label: 'Nappes', q: 'ambient atmosphere chill' },
];

const API = 'https://api.openverse.org/v1/audio/';

async function searchOne(q: string, page: number, category = 'music'): Promise<{ results: MusicResult[]; more: boolean }> {
  const params = new URLSearchParams({ q, license: 'cc0,by', category, page_size: '20', page: String(page), mature: 'false' });
  const r = await fetch(`${API}?${params}`);
  if (r.status === 400 && page > 1) return { results: [], more: false };
  if (!r.ok) throw new Error(r.status === 429 ? 'Trop de recherches d’affilée : réessayez dans une minute.' : `Openverse : erreur ${r.status}`);
  const d = await r.json();
  const results: MusicResult[] = (d.results ?? [])
    .filter((x: any) => x.url && (category !== 'music' || !x.duration || x.duration >= 30000))
    .map((x: any) => ({
      id: x.id,
      title: x.title || 'Sans titre',
      author: x.creator || 'Auteur inconnu',
      license: x.license === 'cc0' ? 'CC0 (domaine public)' : `CC ${String(x.license).toUpperCase()} ${x.license_version ?? ''}`.trim(),
      page: x.foreign_landing_url || x.url,
      url: x.url,
      duration: Math.round((x.duration ?? 0) / 1000),
      source: x.source ?? x.provider ?? '',
    }));
  return { results, more: (d.page_count ?? 1) > page };
}

/** Recherche : la phrase exacte d'abord ; si elle ne donne rien (l'API exige tous les mots), un mot à la fois, résultats mêlés. */
export async function searchMusic(q: string, page = 1, category = 'music'): Promise<{ results: MusicResult[]; more: boolean }> {
  const words = q.split(/\s+/).filter(Boolean);
  const exact = words.length > 1 ? await searchOne(q, page, category) : null;
  if (exact && exact.results.length) return exact;
  const parts = await Promise.all(words.slice(0, 4).map((w) => searchOne(w, page, category).catch(() => ({ results: [] as MusicResult[], more: false }))));
  const seen = new Set<string>();
  const results: MusicResult[] = [];
  for (let i = 0; i < 20; i++) for (const p of parts) {
    const m = p.results[i];
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      results.push(m);
    }
  }
  return { results, more: parts.some((p) => p.more) };
}

/** Télécharge le fichier audio (avec repli sur un autre serveur Jamendo si le premier refuse). */
export async function fetchMusic(m: MusicResult): Promise<Blob> {
  const urls = [m.url];
  const jam = /jamendo\.com\/\?trackid=(\d+)/.exec(m.url);
  if (jam) urls.unshift(`https://mp3l.jamendo.com/?trackid=${jam[1]}&format=mp31`); // serveur Jamendo ouvert à tous les sites
  let err: unknown = null;
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`erreur ${r.status}`);
      return await r.blob();
    } catch (e) {
      err = e;
    }
  }
  throw err instanceof Error ? err : new Error('téléchargement impossible');
}
