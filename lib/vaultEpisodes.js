/**
 * Episode helpers for the Movie Vault (client-safe — no I/O, no server imports).
 *
 * Series are stored FLAT in the catalogue: an embed carries `season`/`episode`
 * alongside its quality, so one episode contributes one embed per quality
 * (1080p + 720p under the locked vault standard). Grouping is derived here
 * rather than shipped in the API payload: `vault.json` upstream also carries a
 * canonical `seasons[]` tree, but sending both to the browser would duplicate
 * every episode URL (~734 of them today) for no gain.
 *
 * A record with no `season`/`episode` on any embed simply produces no episodes,
 * which is how movies keep the pre-series behaviour byte-for-byte.
 */

/** Flat embeds → [{ season, episode, embeds }], episode-major, best quality first. */
export function groupEpisodes(embeds = []) {
  const byEpisode = new Map();

  for (const embed of Array.isArray(embeds) ? embeds : []) {
    if (!embed || typeof embed.url !== 'string' || !embed.url) continue;
    const season = Number(embed.season) || 0;
    const episode = Number(embed.episode) || 0;
    if (!season && !episode) continue; // a movie embed — nothing to group
    const key = `${season}:${episode}`;
    if (!byEpisode.has(key)) byEpisode.set(key, { season, episode, embeds: [] });
    byEpisode.get(key).embeds.push(embed);
  }

  return [...byEpisode.values()].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
}

/** `S1 E5`, or `E5` when the collection has no seasons. */
export function episodeLabel(entry = {}) {
  const episode = Number(entry.episode) || 0;
  if (!episode) return '—';
  const season = Number(entry.season) || 0;
  return season ? `S${season} E${episode}` : `E${episode}`;
}

/** Distinct seasons present, for a "3 seasons · 42 episodes" card line. */
export function countSeasons(episodes = []) {
  return new Set(episodes.map((entry) => Number(entry.season) || 0)).size;
}
