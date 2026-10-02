// Browser-forbidden headers are applied by the authenticated server relay.
export function proxyMediaUrl(uri, stream = {}) {
  const p = new URLSearchParams({ u: uri });
  if (stream.referer) p.set('ref', stream.referer);
  if (stream.userAgent) p.set('ua', stream.userAgent);
  if (stream.cookie) p.set('ck', stream.cookie);
  if (Object.keys(stream.headers || {}).length) p.set('hd', JSON.stringify(stream.headers));
  return `/api/live-proxy?${p}`;
}
export function proxyResponseBase(_type, response) {
  const final = response.headers?.['x-jash-upstream-url'];
  if (final && /^https?:\/\//i.test(final)) { response.uri = final; response.originalUri = final; }
}
export function needsServerHeaders(stream = {}) {
  const h = stream.headers || {};
  return Boolean(stream.referer || stream.userAgent || stream.cookie || Object.keys(h).some((k) => /^(cookie|referer|referrer|user-agent)$/i.test(k)) || /^http:\/\//i.test(stream.url || ''));
}
