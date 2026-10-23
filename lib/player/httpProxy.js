// Universal proxy helpers — media + license + mixed-content.
// Browser-forbidden headers (User-Agent, Cookie, Referer spoof) are applied by the server relay.
export function proxyMediaUrl(uri, stream = {}) {
  const p = new URLSearchParams({ u: uri });
  if (stream.referer) p.set('ref', stream.referer);
  if (stream.userAgent) p.set('ua', stream.userAgent);
  if (stream.cookie) p.set('ck', stream.cookie);
  if (Object.keys(stream.headers || {}).length) p.set('hd', JSON.stringify(stream.headers));
  if (stream.licenseHeaders && Object.keys(stream.licenseHeaders).length) p.set('lh', JSON.stringify(stream.licenseHeaders));
  return `/api/live-proxy?${p}`;
}

/**
 * Build license proxy URL for EME license requests that need Authorization/customData
 */
export function proxyLicenseUrl(uri, stream = {}) {
  const p = new URLSearchParams({ u: uri });
  const h = stream.licenseHeaders || stream.headers || {};
  if (h.Authorization || h.authorization) p.set('auth', h.Authorization || h.authorization);
  if (stream.token) p.set('token', stream.token);
  if (stream.customData) p.set('customData', stream.customData);
  if (Object.keys(h).length) p.set('hd', JSON.stringify(h));
  return `/api/live-license?${p}`;
}

export function proxyResponseBase(_type, response) {
  const final = response.headers?.['x-jash-upstream-url'];
  if (final && /^https?:\/\//i.test(final)) { response.uri = final; response.originalUri = final; }
}

/**
 * Should this channel go via server proxy?
 * Covers: forbidden headers, auth headers, mixed content, custom origin.
 */
export function needsProxy(stream = {}) {
  const h = stream.headers || {};
  const mixed = /^http:\/\//i.test(stream.url || '') && typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const hasForbidden = Boolean(stream.referer || stream.userAgent || stream.cookie);
  const hasHeaderAuth = Object.keys(h).some((k) => /^(cookie|referer|referrer|user-agent|authorization|token|customdata|x-api-key|origin)$/i.test(k));
  const hasExtraHeaders = Object.keys(h).length > 3;
  return Boolean(mixed || hasForbidden || hasHeaderAuth || hasExtraHeaders);
}

// Backward compat alias
export const needsServerHeaders = needsProxy;
