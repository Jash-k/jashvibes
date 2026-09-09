/**
 * The client-safe half of the Tamil anime feed: labels, grouping, and the one definition of
 * "this title has something to play". The fetchers live in `lib/animeTamilFeed.js` (server-only);
 * nothing here touches the network, which is what lets `tests/anime-tamil.test.js` drive the whole
 * page logic without a socket.
 */

export function kindCounts(items = []) {
  return items.reduce((acc, item) => {
    const key = item?.kind === 'movie' ? 'movie' : 'series';
    acc[key] += 1;
    return acc;
  }, { series: 0, movie: 0 });
}

/** The chips are a filter over what has actually been loaded — never a promise about the source. */
export function filterByKind(items = [], kind = 'all') {
  if (kind !== 'series' && kind !== 'movie') return items;
  return items.filter((item) => (item?.kind === 'movie' ? 'movie' : 'series') === kind);
}

export function seasonGroups(episodes = []) {
  const rows = [];
  for (const episode of episodes) {
    const season = Number(episode?.season) || 0;
    let group = rows.find((row) => row.season === season);
    if (!group) {
      group = { season, label: season ? `Season ${season}` : 'Episodes', episodes: [] };
      rows.push(group);
    }
    group.episodes.push(episode);
  }
  return rows.sort((a, b) => a.season - b.season);
}

export function episodeLabel(episode = {}) {
  const number = Number(episode?.episode) || 0;
  if (!number) return episode?.title || episode?.id || 'Episode';
  return `Episode ${number}`;
}

export function episodeTag(episode = {}) {
  const season = Number(episode?.season) || 0;
  const number = Number(episode?.episode) || 0;
  if (!season || !number) return '';
  return `S${season} · E${number}`;
}

/** Every server row the source lists, with what we managed to do about it. Rows that could not be
 *  resolved stay visible and say why — a hidden row reads as a missing feature. */
export function sourceRows(episode = {}) {
  const playable = episode?.playable || [];
  const rows = (episode?.sources || []).map((row) => {
    const match = playable.find((item) => item.id === row.id);
    return {
      ...row,
      url: match?.url || '',
      canPlay: Boolean(match?.url),
    };
  });
  for (const row of playable) {
    if (!rows.some((item) => item.id === row.id)) rows.push({ ...row, canPlay: true });
  }
  return rows;
}

export function playerLineup(playable = []) {
  return playable.map((row, index) => ({
    url: row.url || row.streams?.[0]?.url || '',
    label: row.label || `Source ${index + 1}`,
    format: 'HLS',
    warn: row.warn || '',
  })).filter((row) => row.url);
}

export function watchKeyFor(path = '') {
  const clean = String(path || '').replace(/^https?:\/\/[^/]+/, '');
  return `anime-tamil:${clean || 'unknown'}`;
}

export function pageHint({ page = 1, maxPage = 1, hasNext = false, all = false } = {}) {
  if (all) return `the whole ${maxPage}-page list`;
  const shown = `page ${page} of ≥${Math.max(Number(maxPage) || 1, Number(page) || 1)}`;
  return hasNext ? `${shown} — more on request` : shown;
}

export function unavailableNote(episode = {}) {
  const rows = sourceRows(episode);
  if (!rows.length) return 'The source’s episode page lists no servers, so there is nothing to resolve.';
  const why = rows.map((row) => row.note).filter(Boolean)[0];
  return why
    ? `No host on this episode publishes a fetchable address — ${why}.`
    : 'No host on this episode publishes a fetchable address.';
}

/**
 * The one sentence that says how much of the catalogue is on screen. It counts the grid, because a page
 * that quotes the last API response while the user has loaded three of them is lying by one page — and
 * it never invents a total: an unfinished walk is reported as `≥` pages until a page comes back empty.
 */
export function summaryLine({ items = [], shown = 0, page = 1, maxPage = 1, all = false, complete = true, generatedAt = 0, query = '', now = Date.now() } = {}) {
  const count = items.length;
  const series = items.filter((row) => row.kind === 'series').length;
  const films = count - series;
  const when = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' })
    : '—';
  const scope = all
    ? `${complete ? 'all' : 'first'} ${maxPage} page${maxPage === 1 ? '' : 's'}`
    : `page ${page} of ≥${Math.max(Number(maxPage) || 1, Number(page) || 1)}`;
  const parts = [
    `${count} title${count === 1 ? '' : 's'} loaded`,
    shown && shown !== count ? `${shown} shown` : `${series} series · ${films} film${films === 1 ? '' : 's'}`,
    scope,
    `read ${when} IST`,
  ];
  if (query) parts.push(`search “${query}”`);
  return parts.join(' · ');
}
