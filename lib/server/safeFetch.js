import ipaddr from 'ipaddr.js';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import { Readable } from 'node:stream';

export function isPublicAddress(address = '') {
  try {
    const parsed = ipaddr.process(String(address).replace(/^\[|\]$/g, ''));
    return parsed.range() === 'unicast';
  } catch { return false; }
}
export async function publicDestination(value, lookup = dns.lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) destinations without URL credentials are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private host refused.');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error('Destination resolves to a private/reserved address.');
  return { url, address: addresses.find((a) => a.family === 4) || addresses[0] };
}
function pinnedRequest(url, address, options) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
    headers['accept-encoding'] = 'identity';
    const request = transport.request(url, {
      method: options.method || 'GET', headers, agent: false,
      // Pin the vetted DNS result to the actual socket: no second DNS resolution/rebinding.
      lookup: (_host, opts, callback) => opts?.all ? callback(null, [address]) : callback(null, address.address, address.family),
    });
    const abort = () => request.destroy(Object.assign(new Error('Upstream request aborted'), { name: 'AbortError' }));
    if (options.signal?.aborted) { abort(); reject(new Error('Request aborted')); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => request.destroy(new Error('Upstream header timeout')), options.timeoutMs || 15000);
    request.on('error', (error) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error); });
    request.on('response', (incoming) => {
      clearTimeout(timer); incoming.setTimeout(30000, () => incoming.destroy(new Error('Upstream idle timeout')));
      const remove = () => options.signal?.removeEventListener('abort', abort); incoming.on('close', remove); incoming.on('end', remove);
      const responseHeaders = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value != null) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      const empty = options.method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode);
      const response = new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers: responseHeaders });
      Object.defineProperty(response, 'url', { value: url.href }); resolve(response);
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}
export async function safeFetch(value, options = {}) {
  let target = String(value), headers = new Headers(options.headers || {});
  for (let hop = 0; hop <= 5; hop++) {
    const destination = await publicDestination(target, options.lookup);
    if (options.validateUrl && !options.validateUrl(destination.url)) throw new Error('Upstream host is not allowed.');
    const response = await pinnedRequest(destination.url, destination.address, { ...options, headers });
    if (options.redirect === 'manual' || ![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel();
    const next = new URL(location, destination.url);
    if (next.origin !== destination.url.origin) for (const name of [...headers.keys()]) if (/cookie|authorization|token|api[-_]?key/i.test(name)) headers.delete(name);
    target = next.href;
  }
  throw new Error('Too many upstream redirects.');
}
export async function readLimitedText(response, maxBytes = 2 * 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) throw new Error('Upstream document is too large.'); chunks.push(value); } }
  finally { reader.releaseLock(); if (size > maxBytes) await response.body.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks.map((v) => Buffer.from(v))));
}
