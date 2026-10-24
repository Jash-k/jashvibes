/**
 * lib/live/pipeline/fetch.js — v12 per-source tuned fetch
 * Host-specific timeout + retry for HJH 520KB; avoids global 15s trap.
 */

export async function fetchTextForSource(url, { timeoutMs = 15000, retry = 0, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'application/json,text/plain,application/x-mpegURL,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`Live source ${res.status}: ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|aborted/i.test(e?.message||'');
      if (isTimeout && attempt < retry) {
        // small backoff then retry
        await new Promise(r=>setTimeout(r, 400));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export function probeTimeoutForSource(sourceDef) {
  return Math.min(sourceDef?.timeoutMs || 12000, 15000);
}
