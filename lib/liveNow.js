/**
 * The one honest thing the homepage is allowed to say about live TV.
 *
 * `/live` knows what is on air because it already asked the guide endpoint for the whole lineup. The
 * homepage does not have a lineup, and asking for one means `/api/live-service/channels` + a guide
 * request on every visit — hours of container time for a line of text on a 512 MB box. So `/live`
 * publishes a two-field summary here, and `/` reads it.
 *
 * The age rule is the whole point: a stale "on air now" is a lie about the present tense, so anything
 * older than `MAX_AGE_MS` is dropped rather than shown dimmer. No poll, no subscription — the homepage
 * reads once on mount, which is also why it can only ever be as fresh as your last look at /live.
 */
export const LIVE_NOW_KEY = 'jash:live:now';
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function store(get) {
  try {
    const win = typeof window !== 'undefined' ? window : undefined;
    return get ? get(win) : win?.localStorage;
  } catch {
    return undefined;
  }
}

export function writeLiveNow({ channel, title, minutesLeft } = {}, options = {}) {
  const clean = {
    channel: String(channel || '').trim().slice(0, 42),
    title: String(title || '').trim().slice(0, 90),
    minutesLeft: Math.max(0, Math.round(Number(minutesLeft)) || 0),
    at: Date.now(),
  };
  if (!clean.channel || !clean.title) return false;
  const storage = store(options.localStorage ? () => options.localStorage : undefined);
  if (!storage?.setItem) return false;
  try {
    storage.setItem(LIVE_NOW_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function readLiveNow(options = {}) {
  const storage = store(options.localStorage ? () => options.localStorage : undefined);
  if (!storage?.getItem) return null;
  let raw = null;
  try {
    raw = storage.getItem(LIVE_NOW_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const age = Date.now() - Number(parsed?.at || 0);
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return null;
    if (!parsed?.channel || !parsed?.title) return null;
    return {
      channel: String(parsed.channel),
      title: String(parsed.title),
      minutesLeft: Math.max(0, Math.round(Number(parsed.minutesLeft)) || 0),
      age,
    };
  } catch {
    return null;
  }
}
