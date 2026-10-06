/*
 * The lyrics-source catalogue — one source of truth for what the app can actually
 * use, and for what it cannot.
 *
 * Every "not wired" row below was probed by hand before it was written down, and
 * `evidence` is what the probe returned, not what the provider advertises. That
 * matters: Musixmatch's public desktop endpoint answers 200 with plausible-looking
 * LRC whose text is deliberately scrambled, so a naive integration would ship
 * gibberish to the player. Keeping the dead ends in this list — with their probe
 * result — is what stops them being re-proposed in six months.
 *
 * `wired: true` means the request path exists in app/api/music/lyrics/route.js.
 */

/** Providers this app can actually call today, in the order the cascade tries them. */
export const WIRED_LYRICS_SOURCES = ['saavn', 'lrclib'];

/**
 * How each wired provider behaves, so the UI never has to guess:
 *   synced  -> carries line timestamps, the karaoke highlight works
 *   plain   -> text only, no timing, the highlight is switched off
 */
export const WIRED_SOURCE_KIND = {
  saavn: 'plain',
  lrclib: 'synced',
};

export const LYRICS_SOURCES = [
  {
    id: 'auto',
    name: 'Auto',
    mark: 'A',
    group: 'wired',
    pickable: true,
    kind: 'auto',
    note: 'The cascade the app already runs, re-tuned to prefer lines that carry timestamps.',
    evidence: 'saavn → lrclib, first timed hit wins',
  },
  {
    id: 'lrclib',
    name: 'LRCLIB',
    mark: 'LR',
    group: 'wired',
    pickable: true,
    kind: 'synced',
    note: 'Timed LRC plus plain text and an instrumental flag. Already the primary source.',
    evidence: 'HTTP 200 · real Tamil lines · instrumental:false · line timing, no word timing',
  },
  {
    id: 'saavn',
    name: 'JioSaavn',
    mark: 'JS',
    group: 'wired',
    pickable: true,
    kind: 'plain',
    note: 'Plain text only, so the lyric stage drops to a static read with no highlight.',
    evidence: 'already wired · plain text, no timing · strongest for Tamil back catalogue',
  },
  {
    id: 'inst',
    name: 'Mark instrumental',
    mark: '♪',
    group: 'local',
    pickable: true,
    kind: 'none',
    local: true,
    note: 'Hides the lyric stage and leaves the signal field. Purely local — no provider involved.',
    evidence: 'local action, nothing is fetched',
  },
  {
    id: 'genius',
    name: 'Genius',
    mark: 'G',
    group: 'key',
    pickable: false,
    kind: 'plain',
    needs: 'a client id and secret',
    note: 'Fuller verses than most, but plain text and a registered key.',
    evidence: 'no keyless endpoint',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    mark: '',
    group: 'key',
    pickable: false,
    kind: 'synced',
    needs: 'a signed developer token',
    note: 'Time-synced lyrics exist, behind MusicKit and a developer token.',
    evidence: 'api.music.apple.com → HTTP 401',
  },
  {
    id: 'ai',
    name: 'AI transcription',
    mark: 'AI',
    group: 'key',
    pickable: false,
    kind: 'synced',
    needs: 'a model and a budget',
    note: 'Catches what nothing else has. Rough on Tamil script — worth it only as a last resort.',
    evidence: 'needs a model + a budget',
  },
  {
    id: 'netease',
    name: 'NetEase Cloud Music',
    mark: 'NE',
    group: 'blocked',
    pickable: false,
    kind: 'synced',
    note: 'Genuinely keyless and returns timed LRC. Deliberately not shipped: it helps a non-Tamil library more than this one.',
    evidence: 'HTTP 200 search + HTTP 200 timed LRC (keyless) — passed over by choice',
  },
  {
    id: 'kugou',
    name: 'KuGou',
    mark: 'KG',
    group: 'blocked',
    pickable: false,
    kind: 'synced',
    note: 'The chain works end to end, but it matched an entirely different track for the test song. Usable only with strict hash + duration matching.',
    evidence: 'search 200 · krcs 200 · base64 LRC decoded (167 chars, wrong track)',
  },
  {
    id: 'musixmatch',
    name: 'Musixmatch',
    mark: 'MX',
    group: 'blocked',
    pickable: false,
    kind: 'none',
    note: 'The trap in this list: the public endpoint answers 200 with plausible-looking LRC whose text is deliberately scrambled. Wiring it would show gibberish in the player.',
    evidence: 'HTTP 200 but the body was garble ("Wob gopini den") and the track matched was wrong',
  },
  {
    id: 'qq',
    name: 'QQ Music',
    mark: 'QQ',
    group: 'blocked',
    pickable: false,
    kind: 'none',
    note: 'Search finds an exact match, but the lyric endpoint returns nothing without a session cookie.',
    evidence: 'search HTTP 200 (exact match) · lyric HTTP 200, 0 bytes',
  },
  {
    id: 'lyricsovh',
    name: 'lyrics.ovh',
    mark: 'LO',
    group: 'blocked',
    pickable: false,
    kind: 'none',
    note: 'No response at all. Kept only so it is not re-proposed later.',
    evidence: 'timed out — no response in 12 s',
  },
];

export const SOURCE_GROUPS = [
  { id: 'wired', tone: 'is-live', badge: 'works now', label: 'Wired in this app', note: 'These answered a real request and are reachable from this route.' },
  { id: 'key', tone: 'is-key', badge: 'needs a key', label: 'Works only with a key or a budget', note: 'Designed into the picker so the UI never needs a redesign to add them.' },
  { id: 'blocked', tone: 'is-no', badge: 'tested — not usable', label: 'Not usable without a key', note: 'The names people assume work for free. One of them actively misleads.' },
];

export function sourceById(id = '') {
  const key = String(id || '').trim().toLowerCase();
  return LYRICS_SOURCES.find((item) => item.id === key) || null;
}

export function isPickable(id = '') {
  const source = sourceById(id);
  return Boolean(source && source.pickable);
}

/** Grouped, in the order the UI renders them, with the local row folded into "wired". */
export function groupedSources() {
  const local = LYRICS_SOURCES.filter((item) => item.group === 'local');
  return SOURCE_GROUPS.map((group) => ({
    ...group,
    items: LYRICS_SOURCES.filter((item) => item.group === group.id).concat(group.id === 'wired' ? local : []),
  }));
}
