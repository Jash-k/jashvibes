// Memory-first session cache: route revisits avoid parsing/serializing large catalogues.
// Writes are coalesced off the interaction path; pagehide flushes the last successful state.
export const DEFAULT_CACHE_TTL = 15 * 60 * 1000;
const memory = new Map(), pending = new Map();
let timer = null, listening = false;
const MAX_ENTRIES = 48;
function flush() {
  clearTimeout(timer); timer = null;
  for (const [key, entry] of pending) {
    try { window.sessionStorage.setItem(key, JSON.stringify(entry)); } catch {}
  }
  pending.clear();
}
function remember(key, entry) {
  memory.delete(key); memory.set(key, entry);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
}
export function readSessionCache(key, maxAgeMs = DEFAULT_CACHE_TTL) {
  if (typeof window === 'undefined') return null;
  try {
    let entry = memory.get(key);
    if (!entry) {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      entry = JSON.parse(raw);
      if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.savedAt)) return null;
      remember(key, entry);
    }
    if (Date.now() - entry.savedAt > maxAgeMs) return null;
    return entry.data ?? null;
  } catch { return null; }
}
export function writeSessionCache(key, data) {
  if (typeof window === 'undefined') return;
  const entry = { savedAt: Date.now(), data };
  remember(key, entry); pending.set(key, entry);
  if (!listening) { window.addEventListener('pagehide', flush); listening = true; }
  if (timer === null) timer = setTimeout(flush, 400);
}
export function clearSessionCaches() {
  memory.clear(); pending.clear(); clearTimeout(timer); timer = null;
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith('jash:')) window.sessionStorage.removeItem(key);
    }
  } catch {}
}
export function restoreScroll(key) {
  if (typeof window === 'undefined') return;
  try {
    const y = Number(window.sessionStorage.getItem(`${key}:scroll`) || 0);
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  } catch {}
}
export function saveScroll(key) {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(`${key}:scroll`, String(window.scrollY || 0)); } catch {}
}
