/** Presentation-only covers for two existing website cards. No registry/URL mutation. */
export function bundledExtraCover(site = {}) {
  let url;
  try { url = new URL(site.url); } catch { return ''; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'arivumani.net') return '/tamil-serials-card.jpg';
  if (host === 'piratexplay.cc' && url.pathname.replace(/\/+$/, '') === '/language/tamil') return '/anime-card.jpg';
  return '';
}

export function extraCoverSources(site = {}) {
  // The requested artwork replaces old custom covers on these two exact targets.
  // Keep a stored custom image as a fallback if a bundled asset cannot load.
  return [...new Set([bundledExtraCover(site), site.coverUrl].filter(Boolean))];
}
