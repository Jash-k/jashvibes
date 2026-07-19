export const DEFAULT_CACHE_TTL = 15 * 60 * 1000;

export function readSessionCache(key, maxAgeMs = DEFAULT_CACHE_TTL) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeSessionCache(key, data) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

export function restoreScroll(key) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(`${key}:scroll`);
    const y = Number(raw || 0);
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  } catch {}
}

export function saveScroll(key) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${key}:scroll`, String(window.scrollY || 0));
  } catch {}
}
