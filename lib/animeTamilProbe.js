/**
 * The browser-side half of “this row will play”.
 *
 * `probeStream` on the server can only prove that *the server* can fetch a stream. A CDN token is minted for the
 * page that asked for it and some of them care where the bytes are pulled from, so a row can be genuinely fetchable
 * from a Render container and refused by the device in front of the screen — which is exactly what “the row says
 * playable and clicking play does nothing” looks like. This module asks the question where it matters: from the
 * tab, with `mode: 'cors'`, no cookies and no custom headers, so the browser is doing the same request hls.js or
 * `<video>` is about to make.
 *
 * Nothing here downloads media. A manifest is a few hundred bytes; for the rest, the body is read one chunk deep
 * and cancelled. No `Range` header is sent, because that would need the CDN to answer a preflight and a refusal
 * there is not evidence about the stream.
 */

export const PROBE_TIMEOUT_MS = 4500;
export const MAX_PROBES = 3;

/** Same rule the server uses: read the playlist line by line, prefer the line that means a manifest. */
export function firstUriOfPlaylist(text = '', prefer = /\.m3u8(\?|$)/i) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return lines.find((line) => prefer.test(line)) || lines[0] || '';
}

async function readHead(response, maxBytes = 4096) {
  try {
    if (response?.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let text = '';
      while (text.length < maxBytes) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      await reader.cancel().catch(() => {});
      return text.slice(0, maxBytes);
    }
    return (await response.text()).slice(0, maxBytes);
  } catch {
    return '';
  }
}

function absolute(child = '', base = '') {
  if (!child) return '';
  try {
    return new URL(child, base).href;
  } catch {
    return /^https?:/i.test(child) ? child : '';
  }
}

/**
 * @returns `{ ok: true }` when this browser can fetch it, `{ ok: false, why }` when it definitely cannot, and
 * `{ ok: null, why }` when the attempt told us nothing (a timeout on a slow phone connection is not a refusal).
 */
export async function verifyFromBrowser(url, { kind = 'hls', timeoutMs = PROBE_TIMEOUT_MS, fetchImpl = null } = {}) {
  const target = String(url || '');
  if (!target) return { ok: false, why: 'nothing was resolved for this row' };
  const fetchFn = fetchImpl || ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  // A slow phone link must not be reported as a dead stream, so the clock is remembered: once it has run
  // out, “no playlist” is only evidence of “we did not finish”, never of “this CDN refuses you”.
  let aborted = false;
  const timer = setTimeout(() => { aborted = true; controller.abort(); }, Math.max(500, Number(timeoutMs) || PROBE_TIMEOUT_MS));
  const tooSlow = () => ({ ok: null, why: 'took too long from here to say either way' });
  const attempt = async (href, wantsPlaylist) => {
    const response = await fetchFn(href, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, why: `answered HTTP ${response.status}` };
    if (!wantsPlaylist) return { ok: true, status: response.status };
    const head = await readHead(response);
    if (!/#EXTM3U/.test(head)) {
      return aborted ? tooSlow() : { ok: false, why: 'did not answer with a playlist' };
    }
    return { ok: true, head, status: response.status };
  };

  try {
    const isHls = kind !== 'direct';
    const manifest = await attempt(target, isHls);
    if (!manifest.ok) return manifest;
    if (!isHls) return { ok: true, via: 'progressive' };

    // A playlist is only a promise; the segment under it is the fact. One hop, one chunk.
    const child = firstUriOfPlaylist(manifest.head, /\.m3u8(\?|$)/i);
    if (/\.m3u8(\?|$)/i.test(child)) {
      const variant = await attempt(absolute(child, target), true);
      if (!variant.ok) return variant;
      const segment = firstUriOfPlaylist(variant.head, /\.(ts|m4s)(\?|$)/i);
      return await attempt(absolute(segment, absolute(child, target)) || target, false).then((verdict) => ({ ...verdict, via: 'hls' }));
    }
    const segment = firstUriOfPlaylist(manifest.head, /\.(ts|m4s)(\?|$)/i);
    if (!segment) return { ok: null, why: 'the playlist names no segment to try' };
    return await attempt(absolute(segment, target), false).then((verdict) => ({ ...verdict, via: 'hls' }));
  } catch (err) {
    if (err?.name === 'AbortError' || aborted) return tooSlow();
    // A CORS refusal, a DNS failure and a blocked mixed-content request all land here, and all of them are real.
    return { ok: false, why: 'this browser was not allowed to fetch it (CORS or network)' };
  } finally {
    clearTimeout(timer);
  }
}

/** One line for the sheet, written so a timeout does not read as a dead stream. */
export function preFlightNote(verdicts = [], pickedLabel = '') {
  const hard = verdicts.filter((row) => row && row.ok === false);
  const slow = verdicts.filter((row) => row && row.ok === null);
  if (!hard.length && !slow.length) return '';
  const parts = [];
  if (hard.length) parts.push(hard.map((row) => `${row.label} — ${row.why}`).join('; '));
  if (slow.length) parts.push(`${slow.map((row) => row.label).join(', ')} did not answer in time`);
  return `your browser could not use every address: ${parts.join('. ')}${pickedLabel ? `; ${pickedLabel} is being tried` : ''}.`;
}
