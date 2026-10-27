/**
 * lib/live/v2/tokenStore.js — server-only harvest of the reference app's
 * account-level __hdnea__ token, key rotations and extra channels.
 *
 * Why harvest instead of minting per play: the reference app bakes ONE
 * six-hour token (acl=/*) into every channel record, so playback starts with
 * zero redirect hops. We read the same token server-side on a schedule and
 * keep it in memory + the Setting key/value store. The browser only ever
 * talks to our own API — Lovable is never a runtime dependency of the client.
 *
 * Fallback order when no fresh harvest exists:
 *   1. in-memory / persisted harvest (still valid)
 *   2. the existing Jio cookie sweep (getFreshJioCookie)
 *   3. the stale harvest, so a transient outage never hard-fails playback
 */
import { getSetting, setSetting } from '@/models/Setting';
import { getFreshJioCookie } from '@/lib/liveTv';
import { readHdneaExpiry } from '@/lib/live/tokens/hdnea';
import { PLUGX_URL, parsePlugxHtml } from '@/lib/live/v2/feed';

const SETTING_KEY = 'jash_v2_harvest';
/** Refresh this early so in-flight six-hour tokens never expire mid-watch. */
const SAFETY_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

let memory = null;
let inflight = null;

function isValid(harvest, skewMs = SAFETY_MS) {
  return Boolean(harvest?.token) && Number(harvest.tokenExpiry) > Date.now() + skewMs;
}

async function readPersisted() {
  try {
    const doc = await getSetting(SETTING_KEY);
    if (doc && typeof doc === 'object' && doc.token) return doc;
  } catch { /* MongoDB unavailable (dummy/local env) — memory only */ }
  return null;
}

async function persist(doc) {
  try { await setSetting(SETTING_KEY, doc); } catch { /* best effort */ }
}

/** Cached harvest (memory first, then the Setting store), or null. */
export async function readHarvest() {
  if (isValid(memory)) return memory;
  const persisted = await readPersisted();
  if (isValid(persisted)) {
    memory = persisted;
    return memory;
  }
  return memory || persisted;
}

/** Fetch and parse the reference SSR payload. De-duped concurrent callers. */
export function harvestFromPlugx({ force = false } = {}) {
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(PLUGX_URL, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; JashVibesV2/1.0; +https://jashvibes.local)' },
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`reference app responded ${res.status}`);
      const html = await res.text();
      const parsed = parsePlugxHtml(html);
      if (!parsed.token || parsed.tokenExpiry <= Date.now()) {
        throw new Error('no fresh __hdnea__ token found in reference payload');
      }
      const doc = { ...parsed, harvestedAt: Date.now() };
      memory = doc;
      await persist(doc);
      return doc;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Token for playback: harvest → Jio sweep → stale harvest.
 * Returns { token, expiry, source } — token is '' only when every source failed.
 */
export async function getV2Token() {
  let harvest = null;
  try {
    harvest = isValid(memory) ? memory : await readHarvest();
    if (!isValid(harvest)) harvest = await harvestFromPlugx().catch(() => harvest);
  } catch { /* fall through to sweep */ }

  if (isValid(harvest)) {
    return { token: harvest.token, expiry: harvest.tokenExpiry, source: 'plugx-harvest' };
  }
  try {
    const cookie = await getFreshJioCookie({ minValidityMs: SAFETY_MS });
    if (cookie) {
      return { token: cookie, expiry: readHdneaExpiry('', cookie) || 0, source: 'jio-sweep' };
    }
  } catch { /* fall through */ }
  if (harvest?.token) {
    return { token: harvest.token, expiry: harvest.tokenExpiry, source: 'plugx-stale' };
  }
  return { token: '', expiry: 0, source: 'none' };
}

/** Per-channel ClearKey rotations from the latest harvest (id → {keyId,key}). */
export async function getV2KeyOverrides() {
  const harvest = await readHarvest().catch(() => null);
  return harvest?.keyMap && typeof harvest.keyMap === 'object' ? harvest.keyMap : {};
}

/** Channels present in the reference app but missing from the JSON feed. */
export async function getV2Extras() {
  const harvest = await readHarvest().catch(() => null);
  return Array.isArray(harvest?.extras) ? harvest.extras : [];
}
