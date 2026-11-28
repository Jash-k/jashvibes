// Client-safe browsing classification only; never rewrites playback kind or episode identity.
export const VAULT_TABS = [
  { id: 'tamil-movie', label: 'Tamil Movies' },
  { id: 'tamil-dubbed-movie', label: 'Dubbed Movies' },
  { id: 'tamil-series', label: 'Tamil Series' },
  { id: 'tamil-dubbed-series', label: 'Dubbed Series' },
];
// Browse placement is independent of metadata identity verification.
export const vaultIsInferred = (item = {}) => item.metadataStatus === 'inferred' || item.metadataVerification?.status === 'inferred';
export function vaultNeedsReview(item = {}) {
  const language = String(item.originalLanguage || item.language || '').trim().toLowerCase();
  return !language || ['unknown','und','null','none','n/a'].includes(language)
    || ['review','unresolved','unavailable','inferred'].includes(item.metadataStatus || item.metadataVerification?.status);
}
export function vaultCategory(item = {}) {
  const language = String(item.originalLanguage || item.language || '').trim().toLowerCase();
  const known = language && !['unknown','und','null','none','n/a'].includes(language);
  const series = item.kind === 'series' || item.isSeries === true || (!item.kind && String(item.category || '').endsWith('-series'));
  let dubbed;
  if (known) dubbed = !['ta','tam','tamil'].includes(language);
  else {
    let host = ''; try { host = new URL(item.pageUrl).hostname.toLowerCase(); } catch {}
    if (/(^|\.)isaidub\./.test(host)) dubbed = true;
    else if (/(^|\.)moviesda[^.]*\./.test(host)) dubbed = false;
    else dubbed = String(item.catalogCategory || item.category || '').includes('dubbed');
  }
  return `${dubbed ? 'tamil-dubbed' : 'tamil'}-${series ? 'series' : 'movie'}`;
}
function vaultUpdatedTime(item = {}) {
  const updated = Date.parse(item.updatedAt || '');
  if (Number.isFinite(updated)) return updated;
  const added = Date.parse(item.addedAt || '');
  return Number.isFinite(added) ? added : 0;
}
export function latestVaultFirst(a, b) {
  // Stable sort preserves JSON order for tied or absent timestamps.
  return vaultUpdatedTime(b) - vaultUpdatedTime(a);
}

/** Search local/canonical aliases and both original/dub years without ASCII-only loss. */
export function vaultSearchMatch(item, query = '') {
  const key = value => String(value || '').normalize('NFKC').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const wanted = key(query);
  if (!wanted) return true;
  const titles = [item.title,item.originalTitle,item.tmdbTitle,...(item.aliases || [])].filter(Boolean);
  const years = [item.year,item.originalYear].filter(Boolean);
  return [...titles,...titles.flatMap(t => years.map(y => `${t} ${y}`)),item.tmdbId,item.imdbId].some(value => key(value).includes(wanted));
}

// Year is the source listing's year, not TMDB's release/dub year.
export function sourceOrderFirst(a,b) {
 const valid=x=>x?.sourceOrder && Number.isInteger(x.sourceOrder.year) && Number.isInteger(x.sourceOrder.position) && x.sourceOrder.position>=0;
 const ar=valid(a),br=valid(b);
 if(ar&&br)return b.sourceOrder.year-a.sourceOrder.year || a.sourceOrder.position-b.sourceOrder.position || String(a.id).localeCompare(String(b.id));
 if(ar||br)return ar?-1:1;
 // Stable fallback unaffected by metadata enrichment and episode refresh dates.
 return (Date.parse(b.addedAt)||0)-(Date.parse(a.addedAt)||0) || String(a.id).localeCompare(String(b.id));
}
