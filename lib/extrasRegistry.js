/** Pure validation and optimistic-version registry commands; no network or DB access. */
export const EXTRAS_KEY = 'extras_sites_v1';
export const MAX_EXTRA_SITES = 100;
export const EXTRA_THEMES = ['amber', 'mint', 'lilac'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function extraUrl(value, appOrigin = '') {
  if (typeof value !== 'string' || value.length > 2048) fail('Enter a valid HTTPS URL (maximum 2048 characters).');
  let url;
  try { url = new URL(value.trim()); } catch { fail('Enter a complete HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('Use HTTPS without embedded usernames or passwords.');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(':') || /\.(local|internal|localhost)$/.test(host)) fail('Use a public website, not a local or private address.');
  if (appOrigin) {
    try { if (url.host === new URL(appOrigin).host) fail('Do not embed JashVibes inside itself.'); } catch (error) { if (error.status) throw error; }
  }
  return url.href;
}

export function validateExtra(input, appOrigin = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid website settings.');
  const text = (field, limit, required = false) => {
    if (typeof input[field] !== 'string') fail(`Invalid ${field}.`);
    const value = input[field].trim();
    if ((required && !value) || value.length > limit) fail(`${field} must be ${required ? '1–' : 'at most '}${limit} characters.`);
    return value;
  };
  for (const field of ['enabled', 'allowPopups']) if (typeof input[field] !== 'boolean') fail(`Invalid ${field}.`);
  if (!EXTRA_THEMES.includes(input.theme)) fail('Choose a supported card appearance.');
  return {
    label: text('label', 60, true), url: extraUrl(input.url, appOrigin),
    description: text('description', 180), coverUrl: input.coverUrl ? extraUrl(input.coverUrl, appOrigin) : '',
    theme: input.theme, enabled: input.enabled, allowPopups: input.allowPopups,
  };
}

export function legacyExtras(configured, appOrigin = '') {
  const seen = new Set();
  return configured.flatMap((s, index) => {
    try {
      const row = validateExtra({ label: s.label, url: s.url, description: '', coverUrl: '', theme: EXTRA_THEMES[index % 3], enabled: true, allowPopups: false }, appOrigin);
      if (seen.has(row.url)) return [];
      seen.add(row.url);
      return [{ id: `env-${index}-${String(s.id).slice(0,70)}`, legacyId: s.id, ...row }];
    } catch { return []; }
  });
}

export function changeExtras(registry, command, body, newId, appOrigin = '') {
  if (!Number.isInteger(body?.version) || body.version !== registry.version) fail('The website list changed. Reload it before saving again.', 409);
  let sites = registry.sites.map(s => ({ ...s }));
  if (command === 'add') {
    if (sites.length >= MAX_EXTRA_SITES) fail(`You can add up to ${MAX_EXTRA_SITES} websites.`);
    const row = validateExtra(body.site, appOrigin);
    if (sites.some(s => s.url === row.url)) fail('This website URL is already in Extras.');
    if (!Number.isInteger(body.position) || body.position < 0 || body.position > sites.length) fail('Invalid display order.');
    sites.splice(body.position, 0, { id: newId, ...row });
  } else if (command === 'edit' || command === 'remove') {
    const index = sites.findIndex(s => s.id === body.id);
    if (index < 0) fail('Website not found.', 404);
    if (command === 'remove') sites.splice(index, 1);
    else {
      const row = validateExtra(body.site, appOrigin);
      if (sites.some(s => s.id !== body.id && s.url === row.url)) fail('This website URL is already in Extras.');
      if (!Number.isInteger(body.position) || body.position < 0 || body.position >= sites.length) fail('Invalid display order.');
      const legacyId = sites[index].legacyId;
      sites.splice(index, 1); sites.splice(body.position, 0, { id: body.id, ...(legacyId ? { legacyId } : {}), ...row });
    }
  } else if (command === 'reorder') {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length !== sites.length || new Set(ids).size !== sites.length || ids.some(id => !sites.some(s => s.id === id))) fail('Invalid website order.');
    sites = ids.map(id => sites.find(s => s.id === id));
  } else fail('Unknown website action.');
  return { version: registry.version + 1, sites };
}
