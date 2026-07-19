function normalizeHttpUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function makeId(label = '', index = 0) {
  const slug = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `site-${index + 1}`;
}

function isPlaceholderSite(label = '', url = '') {
  const text = `${label} ${url}`.toLowerCase();
  return (
    text.includes('example.com') ||
    text.includes('example.org') ||
    text.includes('example.net') ||
    /^example/.test(String(label || '').trim().toLowerCase())
  );
}

function parseSiteEntry(entry = '', index = 0) {
  const raw = String(entry || '').trim();
  if (!raw) return null;

  // Preferred format: Label|https://example.com/path
  // Also accepts Label=https://example.com/path for convenience.
  const separator = raw.includes('|') ? '|' : raw.includes('=') ? '=' : '';
  let label = `Site ${index + 1}`;
  let urlValue = raw;

  if (separator) {
    const first = raw.indexOf(separator);
    label = raw.slice(0, first).trim() || label;
    urlValue = raw.slice(first + 1).trim();
  }

  const url = normalizeHttpUrl(urlValue);
  if (!url || isPlaceholderSite(label, url)) return null;

  return {
    id: makeId(label, index),
    label: label.slice(0, 48),
    url,
  };
}

export function getConfiguredEmbedSites() {
  const sites = [];
  // Short names first:
  // EMBED  = one site URL
  // ELABEL = one site label
  // EMBEDS = comma-separated Label|URL list
  const multi = String(process.env.EMBEDS || process.env.CLEAN_EMBED_SITES || process.env.EMBED_SITES || '').trim();

  if (multi) {
    multi
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry, index) => {
        const parsed = parseSiteEntry(entry, index);
        if (parsed) sites.push(parsed);
      });
  }

  const singleUrl = normalizeHttpUrl(
    process.env.EMBED ||
      process.env.CLEAN_EMBED_URL ||
      process.env.EXTERNAL_SITE_URL ||
      process.env.SITE_URL ||
      '',
  );

  if (singleUrl) {
    const label = String(
      process.env.ELABEL ||
        process.env.CLEAN_EMBED_LABEL ||
        process.env.EXTERNAL_SITE_LABEL ||
        process.env.SITE_LABEL ||
        'Clean Embed',
    ).trim();
    if (!isPlaceholderSite(label, singleUrl)) {
      sites.unshift({
        id: makeId(label || 'Clean Embed', 0),
        label: (label || 'Clean Embed').slice(0, 48),
        url: singleUrl,
      });
    }
  }

  const seen = new Set();
  return sites.filter((site) => {
    const key = site.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
