// Pure owner-edit contracts. A catalogue remap never reshapes playback.
export const VAULT_CATEGORIES = ['tamil-movie', 'tamil-dubbed-movie', 'tamil-series', 'tamil-dubbed-series'];
export const VAULT_EDIT_FIELDS = ['title','year','originalTitle','originalYear','originalLanguage','category','poster','rating','tmdbId','tmdbType','imdbId','pageUrl','metadataVerification'];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, max, field) {
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${field}.`);
  return value.trim();
}
function number(value, max, field, integer = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) fail(`Invalid ${field}.`);
  return value;
}
export function vaultPublicUrl(value, field, optional = true) {
  value = text(value, 2048, field);
  if (!value && optional) return '';
  let url; try { url = new URL(value); } catch { fail(`${field} needs a public HTTPS URL.`); }
  const host = url.hostname.toLowerCase();
  // These URLs are displayed/played directly, never fetched by this endpoint.
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || !host.includes('.') ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) || host.startsWith('[') || /\.(?:local|internal|localhost)$/.test(host)) fail(`${field} needs a public HTTPS URL.`);
  return value;
}
export function validateVaultPatch(input) {
  if (!object(input)) fail('Fields must be an object.');
  const out = {};
  for (const [field,value] of Object.entries(input)) {
    if (!VAULT_EDIT_FIELDS.includes(field)) fail(`Field ${field} cannot be changed here.`);
    if (['title','originalTitle'].includes(field)) { out[field] = text(value,300,field); if (field === 'title' && !out[field]) fail('A title is required.'); }
    else if (['year','originalYear'].includes(field)) { out[field] = number(value,2100,field); if (value && value < 1880) fail('Use a year from 1880 to 2100, or 0 for unknown.'); }
    else if (field === 'originalLanguage') { out[field] = text(value,12,field).toLowerCase(); if (out[field] && !/^[a-z]{2,3}$/.test(out[field])) fail('Use a two/three-letter original-language code, or leave it empty.'); }
    else if (field === 'category') { if (!VAULT_CATEGORIES.includes(value)) fail('Choose an existing Vault catalogue.'); out[field] = value; }
    else if (field === 'rating') out[field] = number(value,10,field,false);
    else if (field === 'tmdbId') out[field] = number(value,Number.MAX_SAFE_INTEGER,field);
    else if (field === 'tmdbType') { if (!['','movie','tv'].includes(value)) fail('TMDB type must be movie or TV.'); out[field] = value; }
    else if (field === 'imdbId') { out[field] = text(value,24,field); if (out[field] && !/^tt\d{5,12}$/.test(out[field])) fail('Use an IMDb tt ID, or leave it empty.'); }
    else if (['poster','pageUrl'].includes(field)) out[field] = vaultPublicUrl(value,field);
    else if (field === 'metadataVerification') {
      if (!object(value) || !['verified','inferred'].includes(value.status)) fail('Choose verified or inferred provenance.');
      const reason = text(value.reason,1000,'verification reason'); if (!reason) fail('Explain the verification or inference.');
      if (!Array.isArray(value.evidenceUrls) || value.evidenceUrls.length > 12) fail('Use up to 12 evidence URLs.');
      const evidenceUrls = value.evidenceUrls.map(u=>vaultPublicUrl(u,'evidence',false));
      if (value.status === 'verified' && !evidenceUrls.length) fail('A verified remap needs an evidence URL.');
      out[field] = { status:value.status, reason, evidenceUrls, checkedAt:new Date().toISOString() };
    }
  }
  return out;
}
export function validateVaultIdentity(record) {
  if (!record.title?.trim()) fail('A title is required.');
  if (!VAULT_CATEGORIES.includes(record.category)) fail('Choose an existing catalogue.');
  const series = record.kind === 'series';
  if (record.category.endsWith('series') !== series) fail('Catalogue must match playback kind. A remap cannot turn episodes into a film or a film into episodes.');
  if (record.tmdbType && (record.tmdbType === 'tv') !== series) fail('TMDB type must match playback kind.');
  const language = String(record.originalLanguage || '').trim().toLowerCase();
  const tamil = language === 'ta' || language === 'tam';
  if (language && (record.category.startsWith('tamil-dubbed') === tamil)) fail('Catalogue conflicts with original language. Correct the language or catalogue together.');
  if (!language && record.metadataVerification?.status !== 'inferred') fail('An unknown original language must be explicitly marked inferred.');
}
export function validateVaultEmbeds(value, kind) {
  if (!Array.isArray(value) || !value.length || value.length > 5000) fail('Use 1–5,000 playback entries.');
  const keys = new Set();
  return value.map(entry => {
    if (!object(entry) || Object.keys(entry).some(k=>!['url','quality','season','episode'].includes(k))) fail('Each playback entry needs url/quality and, for series, season/episode.');
    const url = vaultPublicUrl(entry.url,'playback URL',false), quality = text(entry.quality,32,'quality');
    if (!quality) fail('Playback quality is required.');
    const out = {url,quality};
    if (kind === 'series') {
      out.season = number(entry.season,1000,'season'); out.episode = number(entry.episode,10000,'episode');
      if (!out.episode) fail('Series episodes must be numbered above 0.');
    } else if ('season' in entry || 'episode' in entry) fail('Movie playback entries cannot have episodes.');
    const key = `${url}|${out.season ?? ''}|${out.episode ?? ''}`;
    if (keys.has(key)) fail('Duplicate playback entry.'); keys.add(key);
    return out;
  });
}
export function buildVaultSeasons(embeds) {
  const seasons = new Map();
  for (const e of embeds) {
    if (!seasons.has(e.season)) seasons.set(e.season,new Map());
    const eps = seasons.get(e.season); if (!eps.has(e.episode)) eps.set(e.episode,[]);
    eps.get(e.episode).push({quality:e.quality,url:e.url});
  }
  return [...seasons].sort((a,b)=>a[0]-b[0]).map(([season,eps])=>({season,episodes:[...eps].sort((a,b)=>a[0]-b[0]).map(([episode,embeds])=>({episode,embeds}))}));
}
export function mergeVaultRows(base, overrides, { includeHidden = false } = {}) {
  const map = new Map(base.map(row=>[row.id,{...row}]));
  for (const o of overrides) {
    const row = o.custom ? {...o.custom} : map.get(o.id);
    if (!row) continue; // orphan overlays remain available to Admin, not invented as records.
    map.set(o.id,{...row,...o.patch,id:o.id, ...(o.updatedAt ? {updatedAt:new Date(o.updatedAt).toISOString()} : {}),
      _vaultAdmin:{revision:o.revision,hidden:Boolean(o.hidden),custom:Boolean(o.custom),overriddenFields:Object.keys(o.patch || {}),note:o.note || ''}});
  }
  return [...map.values()].filter(row=>includeHidden || !row._vaultAdmin?.hidden);
}
