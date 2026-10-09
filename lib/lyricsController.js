// One owner for automatic lookup, manual refresh and bounded transient retries.
// No React/browser dependencies: race and cancellation behavior can be tested directly.
export function createLyricsController({ fetcher = (...args) => fetch(...args), onChange,
  requestTimeout = 15000, retryDelays = [1000, 3000], maxRetryWait = 60000 } = {}) {
  let selection = null, state = {}, job = null, generation = 0;
  const cache = new Map();
  const publish = (next) => { state = next; onChange(next); };
  function cancel() {
    generation++;
    if (job) { job.controller?.abort(); clearTimeout(job.timer); job.wake?.(); }
    job = null;
  }
  function select(next) {
    if (selection?.signature === next?.signature && (selection?.ready || selection?.ready === next?.ready)) return;
    cancel(); selection = next;
    if (!next?.key) { publish({ status: 'idle', lyrics: '', data: {} }); return; }
    const cached = cache.get(next.signature);
    if (cached?.expires > Date.now()) { publish(cached.value); return; }
    publish({ signature: next.signature, status: 'loading', lyrics: '', data: { loadedFor: next.key } });
    if (next.ready) refresh();
  }
  async function refresh({ force = false, discard = false } = {}) {
    if (!selection?.ready || !selection.key) return;
    if (job) return job.promise; // Even repeated clicks must not cancel a good request.
    if (!force && state.status === 'ready') return;
    const selected = selection, token = ++generation;
    const retained = !discard && state.signature === selected.signature && state.lyrics ? state : null;
    if (discard) cache.delete(selected.signature);
    const current = { controller: null, timer: null, wake: null, promise: null };
    job = current;
    const valid = () => token === generation && selection?.signature === selected.signature;
    const pending = (message = '') => publish({ signature: selected.signature, status: 'loading',
      lyrics: retained?.lyrics || '', data: { ...(retained?.data || {}), loadedFor: selected.key, message } });
    pending();
    current.promise = (async () => {
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (!valid()) return;
        const controller = new AbortController(); current.controller = controller;
        const timeout = setTimeout(() => controller.abort(), requestTimeout);
        let failure;
        try {
          const params = new URLSearchParams(selected.params);
          if (force || attempt) params.set('force', '1');
          const response = await fetcher('/api/music/lyrics?' + params, { signal: controller.signal, cache: 'no-store' });
          const data = await response.json();
          if (!valid()) return;
          if (!response.ok || data.retryable || data.source === 'error') {
            failure = { message: data.message || data.error || 'Lyrics provider is temporarily unavailable.',
              retryable: data.retryable !== false && (data.retryable || data.source === 'error' || response.status >= 500 || response.status === 429),
              retryAfter: Number(data.retryAfter || response.headers?.get('retry-after')) || 0 };
          } else {
            const plain = data.plainLyrics || data.lyrics || String(data.syncedLyrics || '').replace(/^\s*(?:\[[^\]]+\])+\s*/gm, '').trim();
            const value = { signature: selected.signature, status: plain || data.syncedLyrics ? 'ready' : 'not-found',
              lyrics: plain, data: { ...data, loadedFor: selected.key } };
            // A refresh failure/empty response must not erase already validated lyrics.
            if (value.status === 'not-found' && retained) publish({ ...retained, data: { ...retained.data, message: 'No replacement lyrics found. Keeping the current result.' } });
            else {
              publish(value);
              if (value.status === 'ready') {
                if (cache.size >= 100) cache.delete(cache.keys().next().value);
                cache.set(selected.signature, { value, expires: Date.now() + 3600000 });
              }
            }
            return;
          }
        } catch (error) {
          if (!valid()) return; // Superseded/unmounted is cancellation, not a lookup failure.
          failure = { retryable: true, message: error.name === 'AbortError' ? 'Lyrics lookup timed out.' : 'Could not reach the lyrics provider.' };
        } finally { clearTimeout(timeout); }
        if (!valid()) return;
        const wait = Math.max(retryDelays[attempt] || 0, (failure.retryAfter || 0) * 1000);
        if (!failure.retryable || attempt === retryDelays.length || wait > maxRetryWait) {
          if (retained) publish({ ...retained, data: { ...retained.data, message: `${failure.message} Keeping the current lyrics.` } });
          else publish({ signature: selected.signature, status: 'error', lyrics: '', data: { loadedFor: selected.key,
            source: 'error', message: `${failure.message} You can retry later.`, retryAfter: failure.retryAfter } });
          return;
        }
        pending('Provider is busy. Retrying automatically…');
        await new Promise(resolve => { current.wake = resolve; current.timer = setTimeout(resolve, wait); });
        current.wake = null;
      }
    })().finally(() => { if (job === current) job = null; });
    return current.promise;
  }
  return { select, refresh, dispose() { cancel(); selection = null; }, getState: () => state };
}
