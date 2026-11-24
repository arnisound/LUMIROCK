// Recherche de photos libres de droits sur Wikimedia Commons (API publique, sans clé).

export interface CommonsResult {
  title: string;
  thumb: string;
  url: string; // image en grande taille (vignette standard 1920 px, ou l'original s'il est plus petit)
  urls: string[]; // adresses à essayer dans l'ordre
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
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '500', // tailles standard Wikimedia : 250, 330, 500, 960, 1280, 1920, 3840
  });
  let r = await fetch(`${API}?${params}`, { headers: { 'Api-User-Agent': 'Lumirock/1.0 (https://arnisound.github.io/LUMIROCK/)' } }).catch(() => null);
  // repli sans en-tête si le navigateur ou un bloqueur refuse la requête
  if (!r) r = await fetch(`${API}?${params}`);
  if (r.status === 429) throw new Error('Wikimedia limite le nombre de recherches : patientez une minute.');
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
    // Wikimedia n'accepte plus que des tailles de vignettes standard : 1920 px puis 1280 px, sinon l'original
    const step = (w: number) => (ii.thumburl ? String(ii.thumburl).replace(/\/\d+px-/, `/${w}px-`) : null);
    const urls: string[] = [];
    if (ii.width > 1920 && step(1920)) urls.push(step(1920)!);
    if (ii.width > 1280 && step(1280)) urls.push(step(1280)!);
    if (/jpe?g|png|webp/i.test(ii.mime ?? '') && (ii.size ?? 0) < 30e6) urls.push(ii.url);
    if (!urls.length) continue;
    const big = urls[0];
    results.push({
      title: String(p.title).replace(/^File:|^Fichier:/, '').replace(/\.[^.]+$/, ''),
      thumb: ii.thumburl ?? ii.url,
      url: big,
      urls,
      page: ii.descriptionurl,
      author: strip(md.Artist?.value ?? 'Auteur inconnu').slice(0, 120),
      license: strip(md.LicenseShortName?.value ?? 'Licence libre'),
      width: ii.width,
      height: ii.height,
    });
  }
  return { results, next: data.continue?.gsroffset ?? null };
}
