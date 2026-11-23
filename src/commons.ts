// Recherche de photos libres de droits sur Wikimedia Commons (API publique, sans clé).

export interface CommonsResult {
  title: string;
  thumb: string;
  url: string; // image en grande taille (≤ 2400 px)
  page: string; // page de description (licence, auteur)
  author: string;
  license: string;
  width: number;
  height: number;
}

const API = 'https://commons.wikimedia.org/w/api.php';

function strip(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function searchCommons(query: string, offset = 0): Promise<{ results: CommonsResult[]; next: number | null }> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search',
    gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '24', gsroffset: String(offset),
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '360',
  });
  const r = await fetch(`${API}?${params}`);
  if (!r.ok) throw new Error(`Wikimedia : erreur ${r.status}`);
  const data = await r.json();
  const pages = Object.values(data.query?.pages ?? {}) as any[];
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const results: CommonsResult[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/jpe?g|png|webp/i.test(ii.mime ?? '')) continue;
    if (Math.max(ii.width, ii.height) < 900) continue;
    const md = ii.extmetadata ?? {};
    const big = ii.width > 2400 && ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, '/2400px-') : ii.url;
    results.push({
      title: String(p.title).replace(/^File:|^Fichier:/, '').replace(/\.[^.]+$/, ''),
      thumb: ii.thumburl ?? ii.url,
      url: big,
      page: ii.descriptionurl,
      author: strip(md.Artist?.value ?? 'Auteur inconnu').slice(0, 120),
      license: strip(md.LicenseShortName?.value ?? 'Licence libre'),
      width: ii.width,
      height: ii.height,
    });
  }
  return { results, next: data.continue?.gsroffset ?? null };
}
